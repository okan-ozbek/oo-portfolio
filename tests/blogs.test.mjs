import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createAdminServer } from '../server/admin-server.mjs';
import { hashPassword } from '../server/security.mjs';
import { renderMarkdown } from '../server/blog-markdown.mjs';
import {technicalPresets,projectPresets} from '../lib/art-catalog.mjs';

const origin='https://pixelware.test',password='Blog integration test password!';
const passwordHash=await hashPassword(password);
const image=await sharp({create:{width:40,height:30,channels:3,background:'#ff3939'}}).png().toBuffer();
async function fixture(t,databasePath=':memory:'){
  let time=Date.parse('2026-10-31T10:00:00Z');
  const server=createAdminServer({origin,passwordHash,databasePath,now:()=>time});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const close=()=>new Promise(resolve=>{if(!server.listening)return resolve();server.close(resolve);server.closeAllConnections();});t.after(close);
  let cookie='',csrf='';
  const request=(path,{method='GET',body,headers={},anonymous=false}={})=>fetch(`${base}${path}`,{method,headers:{...(!anonymous?{Cookie:cookie}:{}),...(!['GET','HEAD'].includes(method)?{Origin:origin,'Content-Type':Buffer.isBuffer(body)?'image/png':'application/json','X-CSRF-Token':csrf}:{}),...headers},body:body===undefined?undefined:Buffer.isBuffer(body)?body:JSON.stringify(body),redirect:'manual'});
  const admin=(path='',options)=>request(`/api/admin/blogs${path}`,options);
  async function login(){const response=await request('/api/admin/login',{method:'POST',body:{password}});cookie=response.headers.get('set-cookie').split(';')[0];csrf=(await response.json()).csrf;}
  async function create(title='A systems note'){const response=await admin('',{method:'POST',body:{}});assert.equal(response.status,201,await response.clone().text());const {post}=await response.json();return save(post,{title,slug:`note-${post.id.slice(0,8)}`,summary:`Summary of ${title}`,markdown:'## A technical idea\n\n```cpp\nint answer = 42;\n```\n'});}
  async function save(post,changes={},sessionId='test-edit-session'){const value={...post,...changes};const data=Object.fromEntries(['title','slug','summary','markdown','tags','thumbnail','banner','relatedIds'].map(key=>[key,value[key]]));const response=await admin(`/${post.id}`,{method:'PATCH',body:{version:post.version,post:data,sessionId}});assert.equal(response.status,200,await response.clone().text());return (await response.json()).post;}
  async function action(post,name,body={}){const response=await admin(`/${post.id}/${name}`,{method:'POST',body:{version:post.version,...body}});assert.equal(response.status,200,await response.clone().text());return (await response.json()).post;}
  return {request,admin,login,create,save,action,close,advance:ms=>{time+=ms;}};
}

test('blog drafts, previews, and uploads require admin access and mutation protection',async t=>{
  const app=await fixture(t);
  assert.equal((await app.admin()).status,401);assert.equal((await app.admin('',{method:'POST',body:{}})).status,401);
  await app.login();const post=await app.create();
  for(const headers of [{Origin:'https://evil.test'},{'X-CSRF-Token':''}])for(const path of [`/${post.id}`,`/${post.id}/publish`,`/${post.id}/media`])assert.equal((await app.admin(path,{method:path.endsWith(post.id)?'PATCH':'POST',body:path.endsWith('media')?image:{},headers})).status,403);
  assert.equal((await app.request(`/admin/blog-preview/${post.id}`,{anonymous:true})).status,401);
  assert.equal((await app.request(`/blog/${post.slug}`,{anonymous:true})).status,404);
  assert.equal((await app.request(`/blog/share/${post.slug}.jpg`,{anonymous:true})).status,404);
  assert.deepEqual((await (await app.request('/api/public/blogs',{anonymous:true})).json()).posts,[]);
  const preview=await app.request(`/admin/blog-preview/${post.id}`);assert.equal(preview.status,200);assert.match(preview.headers.get('x-robots-tag'),/noindex/);assert.match(await preview.text(),/PRIVATE PREVIEW/);
});

test('published snapshots stay unchanged while drafts autosave; stale writes and slug changes fail',async t=>{
  const app=await fixture(t);await app.login();let post=await app.create('Published title');
  const before=post;post=await app.action(post,'publish',{note:'Initial release'});
  assert.equal(post.status,'published');assert.equal(post.hasUnpublishedChanges,false);
  const live=await app.request(`/blog/${post.slug}`,{anonymous:true});assert.equal(live.status,200);assert.equal(live.headers.get('x-robots-tag'),null);assert.match(await live.text(),/Published title/);
  const share=await app.request(`/blog/share/${post.slug}.jpg`,{anonymous:true});assert.equal(share.status,200);assert.equal(share.headers.get('content-type'),'image/jpeg');
  const shareSize=await sharp(Buffer.from(await share.arrayBuffer())).metadata();assert.equal(shareSize.width,1200);assert.equal(shareSize.height,630);
  assert.equal((await app.admin(`/${post.id}`,{method:'PATCH',body:{version:before.version,post:{}}})).status,409);
  post=await app.save(post,{title:'Private next title',markdown:'Private next body'});
  assert.equal(post.hasUnpublishedChanges,true);assert.doesNotMatch(await (await app.request(`/blog/${post.slug}`,{anonymous:true})).text(),/Private next/);
  const page=await (await app.request('/api/public/blogs',{anonymous:true})).json();assert.equal(page.posts[0].title,'Published title');assert.equal(page.posts[0].markdown,undefined);
  const data=Object.fromEntries(['title','slug','summary','markdown','tags','thumbnail','banner','relatedIds'].map(key=>[key,post[key]]));
  assert.equal((await app.admin(`/${post.id}`,{method:'PATCH',body:{version:post.version,post:{...data,slug:'changed-url'}}})).status,400);
  app.advance(60000);post=await app.action(post,'publish');assert.match(await (await app.request(`/blog/${post.slug}`)).text(),/Private next body/);assert.equal(post.hasUnpublishedChanges,false);
  post=await app.action(post,'unpublish');assert.equal(post.status,'draft');assert.equal((await app.request(`/blog/${post.slug}`)).status,404);assert.deepEqual((await (await app.request('/api/public/blogs')).json()).posts,[]);
  assert.equal((await app.request(`/blog/share/${post.slug}.jpg`,{anonymous:true})).status,404);
});

test('editing sessions group changelog entries and restoring leaves live content intact',async t=>{
  const app=await fixture(t);await app.login();let post=await app.create('Original');post=await app.action(post,'publish');
  post=await app.save(post,{title:'Second'},'session-2');post=await app.save(post,{title:'Third',tags:['C++']},'session-2');
  let history=(await (await app.admin(`/${post.id}/revisions`)).json()).revisions;
  const grouped=history.filter(rev=>rev.kind==='draft');assert.equal(grouped.length,2);assert.deepEqual(new Set(grouped[0].fields),new Set(['title','tags']));
  const original=history.find(rev=>rev.kind==='published');post=await app.action(post,'restore',{revisionId:original.id});assert.equal(post.title,'Original');assert.deepEqual(post.tags,[]);
  assert.match(await (await app.request(`/blog/${post.slug}`)).text(),/Original/);
  history=(await (await app.admin(`/${post.id}/revisions`)).json()).revisions;assert.equal(history[0].kind,'restored');
  const initial=history.find(rev=>rev.kind==='created');
  const canonical=post.slug;post=await app.action(post,'restore',{revisionId:initial.id});
  assert.equal(post.slug,canonical,'Restoring a draft from before publication must preserve its shared URL');assert.equal(post.title,'Untitled draft');
});

test('uploaded images stay private until referenced by a published revision and survive edits',async t=>{
  const app=await fixture(t);await app.login();let post=await app.create();
  const response=await app.admin(`/${post.id}/media?name=Screenshot.png`,{method:'POST',body:image});assert.equal(response.status,201,await response.clone().text());const {asset}=await response.json();
  assert.equal(asset.width,40);assert.equal(asset.height,30);assert.equal((await app.request(asset.url,{anonymous:true})).status,404);assert.equal((await app.request(asset.url)).headers.get('content-type'),'image/webp');
  assert.equal((await app.request(`${asset.url}?size=thumbnail`,{anonymous:true})).status,404);
  assert.equal((await app.request(`${asset.url}?size=thumbnail`)).status,200);assert.equal((await app.request(`${asset.url}?size=invalid`)).status,400);
  const other=await app.create('Another post');assert.equal((await app.admin(`/${other.id}/preview`,{method:'POST',body:{post:{title:other.title,slug:other.slug,summary:other.summary,tags:[],markdown:`![Private](${asset.url})`,thumbnail:other.thumbnail,banner:other.banner,relatedIds:[]}}})).status,400);
  post=await app.save(post,{markdown:`![A screenshot](${asset.url} "System diagram"){width=55 align=right}`});post=await app.action(post,'publish');
  const publicImage=await app.request(asset.url,{anonymous:true});assert.equal(publicImage.status,200);assert.equal(publicImage.headers.get('content-type'),'image/webp');
  assert.equal((await app.request(`${asset.url}?size=thumbnail`,{anonymous:true})).status,200);
  const html=await (await app.request(`/blog/${post.slug}`)).text();assert.match(html,/width:55%/);assert.match(html,/align-right/);assert.match(html,/System diagram/);
  post=await app.save(post,{markdown:'Image removed from draft'});assert.equal((await app.request(asset.url,{anonymous:true})).status,200);
  post=await app.action(post,'publish');assert.equal((await app.request(asset.url,{anonymous:true})).status,404);
  assert.equal((await app.admin(`/${post.id}/media`,{method:'POST',body:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')})).status,400);
  await app.action(post,'unpublish');assert.equal((await app.request(asset.url,{anonymous:true})).status,404);
});

test('feed pagination handles equal dates without duplicates; suggestions exclude drafts and the current post',async t=>{
  const app=await fixture(t);await app.login();const posts=[];
  for(let i=0;i<12;i++)posts.push(await app.action(await app.create(`Public post ${i}`),'publish'));
  const draft=await app.create('Secret suggestion');let cursor=null,ids=[];
  for(const count of [5,5,2]){const page=await (await app.request(`/api/public/blogs${cursor?`?cursor=${cursor}`:''}`,{anonymous:true})).json();assert.equal(page.posts.length,count);ids.push(...page.posts.map(post=>post.id));cursor=page.nextCursor;assert.doesNotMatch(JSON.stringify(page),/Secret suggestion/);}
  assert.equal(cursor,null);assert.equal(new Set(ids).size,12);assert.equal((await app.request('/api/public/blogs?cursor=broken')).status,400);
  let post=posts[0];let html=await (await app.request(`/blog/${post.slug}`)).text();assert.match(html,/KEEP EXPLORING/);assert.doesNotMatch(html,/Secret suggestion/);
  post=await app.save(post,{relatedIds:[posts[2].id,draft.id,posts[1].id]});post=await app.action(post,'publish');html=await (await app.request(`/blog/${post.slug}`)).text();const aside=html.split('<aside')[1];assert.ok(aside.indexOf('Public post 2')<aside.indexOf('Public post 1'));assert.doesNotMatch(aside,/Secret suggestion/);assert.doesNotMatch(aside,/Public post 3/);
  const sitemap=await (await app.request('/blog/sitemap.xml',{anonymous:true})).text();assert.match(sitemap,new RegExp(post.slug));assert.doesNotMatch(sitemap,new RegExp(draft.slug));
});

test('Markdown escapes executable content and supports code, Mermaid, safe embeds, and image sizing',()=>{
  const html=renderMarkdown('<script>alert(1)</script>\n\n[Bad](javascript:alert(1))\n\n```cpp\nint n = 42;\n```\n\n```mermaid\nflowchart LR\n A --> B\n```\n\n```embed\nhttps://youtu.be/dQw4w9WgXcQ\n```\n\n```embed\nhttps://evil.test/embed\n```\n\n![No](https://evil.test/x.png)');
  assert.doesNotMatch(html,/<script|href="javascript:|src="https:\/\/evil/);assert.match(html,/&lt;script&gt;/);assert.match(html,/hljs-type/);assert.match(html,/data-copy-code/);assert.match(html,/data-mermaid/);assert.match(html,/www.youtube-nocookie.com\/embed\/dQw4w9WgXcQ/);assert.match(html,/sandbox=/);assert.match(html,/Unsupported embed/);
});

test('ten technical scenes and all six project visuals render in banners and preserve published selections',async t=>{
  const app=await fixture(t);await app.login();let post=await app.create('Visual collection');
  assert.equal(technicalPresets.length,10);assert.equal(projectPresets.length,6);
  const catalog=[...technicalPresets,...projectPresets];assert.equal(new Set(catalog.map(item=>item.id)).size,16);
  for(const preset of catalog){
    const spec={preset:preset.id,assetId:null,position:'center'};
    post=await app.save(post,{thumbnail:spec,banner:spec});
    const art=await app.request(`/blog/art/${preset.id}.svg?seed=${post.id}`,{anonymous:true});assert.equal(art.status,200);assert.equal(art.headers.get('content-type'),'image/svg+xml');assert.match(await art.text(),/<svg/);
    const preview=await (await app.request(`/admin/blog-preview/${post.id}`)).text();assert.match(preview,new RegExp(`data-art-preset="${preset.id}"`));assert.ok(preview.indexOf('blog-hero-banner')<preview.indexOf('blog-site-header'),'The banner must precede the navigation and article');
  }
  post=await app.action(post,'publish');const page=await (await app.request('/api/public/blogs',{anonymous:true})).json();assert.equal(page.posts[0].thumbnailPreset,'project-latency');assert.match(page.html,/data-art-preset="project-latency"/);
  assert.equal((await app.request('/blog/art/unknown.svg')).status,404);
});

test('posts, live revisions, author photos, and original assets persist across restarts',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'pixelware-blogs-'));let app,restarted;t.after(async()=>{await app?.close();await restarted?.close();await rm(directory,{recursive:true,force:true});});
  const database=join(directory,'admin.sqlite');app=await fixture(t,database);await app.login();let post=await app.create('Persistent post');
  const {asset}=await (await app.admin('/author/media?name=Author.png',{method:'POST',body:image})).json();
  assert.equal((await app.admin('/author',{method:'PUT',body:{name:'Okan Can Özbek',linkedinUrl:'https://www.linkedin.com/in/oo-dev/',avatarId:asset.id}})).status,200);
  post=await app.action(post,'publish');post=await app.save(post,{title:'Unpublished revision'});await app.close();
  restarted=await fixture(t,database);await restarted.login();const data=await (await restarted.admin()).json();assert.equal(data.posts[0].title,'Unpublished revision');assert.equal(data.posts[0].hasUnpublishedChanges,true);assert.equal(data.author.avatarId,asset.id);
  assert.match(await (await restarted.request(`/blog/${post.slug}`,{anonymous:true})).text(),/Persistent post/);assert.equal((await restarted.request(asset.url,{anonymous:true})).status,200);
  assert.ok((await (await restarted.admin(`/${post.id}/revisions`)).json()).revisions.length>=3);
});

test('LinkedIn OAuth state is bound to its browser and session without weakening the admin cookie',async t=>{
  const originalId=process.env.LINKEDIN_CLIENT_ID,originalSecret=process.env.LINKEDIN_CLIENT_SECRET;let app;
  try{process.env.LINKEDIN_CLIENT_ID='test-client';process.env.LINKEDIN_CLIENT_SECRET='test-secret';app=await fixture(t);}finally{if(originalId===undefined)delete process.env.LINKEDIN_CLIENT_ID;else process.env.LINKEDIN_CLIENT_ID=originalId;if(originalSecret===undefined)delete process.env.LINKEDIN_CLIENT_SECRET;else process.env.LINKEDIN_CLIENT_SECRET=originalSecret;}
  await app.login();const response=await app.admin('/author/linkedin',{method:'POST',body:{}});assert.equal(response.status,200);const target=new URL((await response.json()).url),proof=response.headers.get('set-cookie').split(';')[0];assert.equal(target.hostname,'www.linkedin.com');assert.equal(target.searchParams.get('scope'),'openid profile');assert.equal(target.searchParams.get('code_challenge_method'),'S256');assert.match(response.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);
  const callback=`/api/public/blogs/linkedin/callback?state=${target.searchParams.get('state')}&error=access_denied`;
  assert.equal((await app.request(callback,{anonymous:true})).status,403);
  const cancelled=await app.request(callback,{anonymous:true,headers:{Cookie:proof}});assert.equal(cancelled.status,303);assert.match(cancelled.headers.get('location'),/cancelled/);assert.equal((await app.request(callback,{headers:{Cookie:proof}})).status,403);
});
