import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createAdminServer } from '../server/admin-server.mjs';
import { hashPassword } from '../server/security.mjs';
import { renderMarkdown } from '../server/blog-markdown.mjs';
import { indexPage, articlePage, feedRow } from '../server/blog-pages.mjs';
import { formatMarkdown } from '../server/admin/blog-format.js';
import {technicalPresets,projectPresets} from '../lib/art-catalog.mjs';

const origin='https://pixelware.test',password='Blog integration test password!';
const passwordHash=await hashPassword(password);
const image=await sharp({create:{width:40,height:30,channels:3,background:'#ff3939'}}).png().toBuffer();
const articleMetadata = html => {
  const matches=[...html.matchAll(/<script type="application\/ld\+json">([^]*?)<\/script>/g)];
  assert.equal(matches.length,1,'Published articles have exactly one JSON-LD block');
  return {data:JSON.parse(matches[0][1]),raw:matches[0][1]};
};
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
  for(const count of [5,5,2]){const page=await (await app.request(`/api/public/blogs${cursor?`?cursor=${cursor}`:''}`,{anonymous:true})).json();assert.equal(page.posts.length,count);assert.equal(page.total,12);ids.push(...page.posts.map(post=>post.id));cursor=page.nextCursor;assert.doesNotMatch(JSON.stringify(page),/Secret suggestion/);}
  assert.equal(cursor,null);assert.equal(new Set(ids).size,12);assert.equal((await app.request('/api/public/blogs?cursor=broken')).status,400);
  let post=posts[0];let html=await (await app.request(`/blog/${post.slug}`)).text();assert.match(html,/KEEP EXPLORING/);assert.doesNotMatch(html,/Secret suggestion/);
  post=await app.save(post,{relatedIds:[posts[2].id,draft.id,posts[1].id]});post=await app.action(post,'publish');html=await (await app.request(`/blog/${post.slug}`)).text();const aside=html.split('<aside')[1];assert.ok(aside.indexOf('Public post 2')<aside.indexOf('Public post 1'));assert.doesNotMatch(aside,/Secret suggestion/);assert.doesNotMatch(aside,/Public post 3/);
  const sitemap=await (await app.request('/blog/sitemap.xml',{anonymous:true})).text();assert.match(sitemap,new RegExp(post.slug));assert.doesNotMatch(sitemap,new RegExp(draft.slug));
});

test('Markdown escapes executable content and supports code, Mermaid, safe embeds, and image sizing',()=>{
  const html=renderMarkdown('<script>alert(1)</script>\n\n[Bad](javascript:alert(1))\n\n```cpp\nint n = 42;\n```\n\n```mermaid\nflowchart LR\n A --> B\n```\n\n```embed\nhttps://youtu.be/dQw4w9WgXcQ\n```\n\n```embed\nhttps://evil.test/embed\n```\n\n![No](https://evil.test/x.png)');
  assert.doesNotMatch(html,/<script|href="javascript:|src="https:\/\/evil/);assert.match(html,/&lt;script&gt;/);assert.match(html,/hljs-type/);assert.match(html,/data-copy-code/);assert.match(html,/data-mermaid/);assert.match(html,/www.youtube-nocookie.com\/embed\/dQw4w9WgXcQ/);assert.match(html,/sandbox=/);assert.match(html,/Unsupported embed/);
});

test('editor formatting renders headings, subtext, inline styles, and task lists safely',()=>{
  const formatted=(source,kind,start=0,end=source.length)=>{const edit=formatMarkdown(source,start,end,kind);return source.slice(0,edit.start)+edit.text+source.slice(edit.end);};
  for(const [kind,tag]of [['h1','h1'],['heading','h2'],['h3','h3'],['strike','s'],['underline','u'],['bold','strong'],['italic','em']])assert.match(renderMarkdown(formatted('Selected text',kind)),new RegExp(`<${tag}>Selected text</${tag}>`));
  assert.match(renderMarkdown(formatted('A quiet aside','subtext')),/<p class="blog-subtext">A quiet aside<\/p>/);
  assert.equal(formatted('one\ntwo','bullet'),'- one\n- two');
  assert.equal(formatted('one\ntwo','ordered'),'1. one\n2. two');
  assert.equal(formatted('- one\n- two','bullet'),'one\ntwo');
  assert.equal(formatted('before\nalpha\nbeta\nafter','ordered',8,17),'before\n1. alpha\n2. beta\nafter');
  assert.equal(formatted('\nparagraph','h1',0,0),'# Your text\nparagraph');
  const todo=renderMarkdown(formatted('Open\nDone','todo').replace('[ ] Done','[x] Done'));
  assert.equal((todo.match(/class="blog-task-item"/g)??[]).length,2);assert.match(todo,/type="checkbox" disabled checked/);
  const malicious=renderMarkdown('++<img src=x onerror=alert(1)>++\n\n-# <script>bad()</script>\n\n- [x] <img src=x onerror=alert(1)>\n\n```text\n++literal++\n- [x] literal\n```');
  assert.doesNotMatch(malicious,/<script|<img/);assert.match(malicious,/&lt;img/);assert.match(malicious,/\+\+literal\+\+/);
});

test('ten technical scenes and all six project visuals preserve published thumbnails without article banners',async t=>{
  const app=await fixture(t);await app.login();let post=await app.create('Visual collection');
  assert.equal(technicalPresets.length,10);assert.equal(projectPresets.length,6);
  const catalog=[...technicalPresets,...projectPresets];assert.equal(new Set(catalog.map(item=>item.id)).size,16);
  for(const preset of catalog){
    const spec={preset:preset.id,assetId:null,position:'center'};
    post=await app.save(post,{thumbnail:spec});
    const art=await app.request(`/blog/art/${preset.id}.svg?seed=${post.id}`,{anonymous:true});assert.equal(art.status,200);assert.equal(art.headers.get('content-type'),'image/svg+xml');assert.match(await art.text(),/<svg/);
    const preview=await (await app.request(`/admin/blog-preview/${post.id}`)).text();assert.doesNotMatch(preview,/blog-hero-banner/);assert.ok(preview.indexOf('blog-site-header')<preview.indexOf('blog-article-layout'),'Navigation must precede the article');
  }
  post=await app.action(post,'publish');const page=await (await app.request('/api/public/blogs',{anonymous:true})).json();assert.equal(page.posts[0].thumbnailPreset,'project-latency');assert.match(page.html,/\/blog\/art\/project-latency\.svg/);assert.doesNotMatch(page.html,/<canvas/);assert.match(page.html,/data-art-preset="project-latency"/);
  for(const path of ['/blog',`/blog/${post.slug}`]){
    const html=await (await app.request(path,{anonymous:true})).text();
    assert.match(html,/class="site-wordmark"[^>]*aria-label="Pixelware, home"/);
    assert.match(html,/class="brand-icon"/);assert.match(html,/<nav aria-label="Main navigation">/);assert.match(html,/href="\/#projects"/);assert.match(html,/<a class="nav-blog" href="\/blog">Blog <span data-blog-count>01<\/span><\/a>/);assert.match(html,/id="contact"/);if(path!=='/blog')assert.match(html,/aria-label="Article changelog"/);
    assert.doesNotMatch(html,/blog-back|blog-hero-banner|href="\/#about"/);
  }
  const theme=await app.request('/blog/assets/theme.css',{anonymous:true});assert.equal(theme.status,200);assert.match(theme.headers.get('content-type'),/text\/css/);
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

test('homepage serves current projects and articles in HTML and blog pagination works without JavaScript',async t=>{
  const app=await fixture(t);await app.login();
  const markup=html=>html.replace(/<script\b[^]*?<\/script>/g,'');
  let html=await (await app.request('/',{anonymous:true})).text();assert.match(markup(html),/Visual Hardware IDE/);assert.equal((html.match(/<canvas\b/g)??[]).length,1);
  const projects=(await (await app.request('/api/admin/projects')).json()).projects;
  let project=projects[0];
  const response=await app.request('/api/admin/projects/'+project.id,{method:'PUT',body:{version:project.version,project:{...project,title:'Server rendered project',url:'/blog/project-writeup'}}});assert.equal(response.status,200);project=(await response.json()).project;
  let article=await app.create('Server rendered article');article=await app.action(article,'publish');
  const draft=await app.create('PRIVATE DRAFT NOT FOR HOMEPAGE');
  html=await (await app.request('/',{anonymous:true})).text();
  assert.match(markup(html),/Server rendered project/);assert.match(markup(html),/href="\/blog\/project-writeup"/);assert.match(markup(html),new RegExp(`href="/blog/${article.slug}"`));assert.doesNotMatch(html,/PRIVATE DRAFT NOT FOR HOMEPAGE/);
  assert.match(html,/id="home-data"/);assert.match(html,/home-client\.js/);
  await app.request('/api/admin/projects/'+project.id,{method:'PUT',body:{version:project.version,project:{...project,state:'draft'}}});
  html=await (await app.request('/',{anonymous:true})).text();assert.doesNotMatch(html,/Server rendered project/);
  for(let i=0;i<6;i++){app.advance(1000);const post=await app.create('Pagination entry '+i);await app.action(post,'publish');}
  html=markup(await (await app.request('/',{anonymous:true})).text());
  assert.match(html,/<div class="home-blog-more"><a href="\/blog">Read more<svg[^]*?<\/svg><\/a><\/div>/);
  assert.doesNotMatch(html,/Next page|Read more ↓|motion-control|Pause animations/);
  assert.match(html,/class="nav-blog" href="\/blog">Blog <span>07<\/span>/);
  const first=await (await app.request('/blog',{anonymous:true})).text(),second=await (await app.request('/blog?page=2',{anonymous:true})).text();
  assert.doesNotMatch(first+second,/blog-load-area|data-blog-more|Read more ↓/);
  assert.match(first,/<h1>All blog posts<\/h1>/);
  for(const page of [first,second])assert.match(page,/data-blog-count>07<\/span>/);
  const footer=page=>page.match(/<footer class="site-footer(?: site-frame)?">([^]*?)<\/footer>/)?.[1];
  assert.ok(footer(html));assert.equal(footer(first),footer(html));assert.equal(footer(second),footer(html));
  assert.doesNotMatch(first+second,/Back to the website|motion-control/);
  assert.match(first,/aria-label="Page 1" aria-current="page"/);
  assert.match(second,/href="\/blog\?page=2" aria-label="Page 2" aria-current="page"/);
  assert.match(first,/aria-disabled="true">« First/);assert.match(second,/href="\/blog">« First/);
  assert.match(first,/href="\/blog\?page=2">Last »/);assert.match(second,/aria-disabled="true">Last »/);
  assert.match(first,/aria-disabled="true">←︎ Previous/);assert.match(second,/aria-disabled="true">Next →︎/);
  assert.match(first,/rel="next"[^>]*href="\/blog\?page=2"/);assert.match(second,/rel="prev" href="\/blog"/);assert.match(second,/<link rel="canonical" href="https:\/\/pixelware.test\/blog\?page=2"/);
  const links=page=>[...page.matchAll(/class="blog-feed-image" href="([^"]+)"/g)].map(match=>match[1]);
  assert.match(await (await app.request('/sitemaps/pages.xml',{anonymous:true})).text(),/\/blog\?page=2/);
  assert.equal(links(first).length,5);assert.equal(links(second).length,2);assert.ok(links(first).every(link=>!links(second).includes(link)));assert.doesNotMatch(first,/<canvas/);
  assert.equal((await app.request('/blog?page=0',{anonymous:true})).status,400);assert.equal((await app.request('/blog?page=3',{anonymous:true})).status,404);assert.doesNotMatch(first+second,new RegExp(draft.slug));
});

test('numbered blog pagination stays compact for large archives and omits single-page controls',()=>{
  const html=indexPage([],null,origin,{page:50,totalPages:100});
  const nav=html.match(/<nav class="blog-pagination"[^]*?<\/nav>/)[0];
  assert.equal((nav.match(/aria-label="Page /g)??[]).length,7);
  for(const page of [1,48,49,50,51,52,100])assert.ok(nav.includes(`aria-label="Page ${page}"`));
  assert.equal((nav.match(/blog-pagination-gap/g)??[]).length,2);
  assert.match(nav,/rel="prev" href="\/blog\?page=49"/);assert.match(nav,/rel="next" href="\/blog\?page=51"/);
  assert.doesNotMatch(indexPage([],null,origin),/class="blog-pagination"/);
});

test('reading lists show title, caption, then author and omit tags; empty recommendations stay hidden',()=>{
  const author={name:'A writer',linkedinUrl:'',avatarId:null};
  const post={id:'reading-post',slug:'reading-post',title:'Readable title',summary:'A useful caption',tags:['List-only tag'],thumbnailUrl:'/cover.png',publishedAt:'2026-10-31T00:00:00Z',author,markdown:'A short article.'};
  const row=feedRow(post);
  assert.ok(row.indexOf('Readable title')<row.indexOf('A useful caption'));
  assert.ok(row.indexOf('A useful caption')<row.indexOf('A writer'));
  assert.doesNotMatch(row,/List-only tag|blog-feed-tags/);
  const html=articlePage(post,author,[],origin,{publishedAt:post.publishedAt,changelog:[{createdAt:post.publishedAt,note:'Clarified the example'}]});
  assert.doesNotMatch(html,/<aside|KEEP EXPLORING|Suggested for you/);
  assert.match(html,/without-suggestions/);
  assert.match(html,/<footer class="blog-changelog"[^]*?Clarified the example/);
  assert.doesNotMatch(html,/<h2>Changelog/);
  assert.match(articlePage(post,author,[{...post,id:'other',slug:'other'}],origin),/<aside class="blog-suggestions"/);
});

test('BlogPosting metadata matches the live article, safely serializes text, and retains publication dates',async t=>{
  const app=await fixture(t);await app.login();
  const title='Cache <&> "hit" </script><script>alert(1)</script>\u2028 safe';
  let post=await app.create(title);
  const preview=await (await app.request(`/admin/blog-preview/${post.id}`)).text();
  assert.doesNotMatch(preview,/application\/ld\+json/);
  post=await app.action(post,'publish');
  const response=await app.request(`/blog/${post.slug}`,{anonymous:true});assert.equal(response.status,200);assert.equal(response.headers.get('x-robots-tag'),null);
  const {data,raw}=articleMetadata(await response.text());
  const canonical=`${origin}/blog/${post.slug}`;
  assert.equal(data['@context'],'https://schema.org');assert.equal(data['@type'],'BlogPosting');
  assert.equal(data.headline,title);assert.equal(data.description,post.summary);assert.equal(data.url,canonical);assert.equal(data.mainEntityOfPage['@id'],canonical);
  assert.equal(data.author['@type'],'Person');assert.equal(data.author.name,'Okan Can Özbek');assert.equal(data.author.url,origin+'/#about');
  assert.deepEqual(data.image,[`${origin}/blog/share/${post.slug}.jpg`]);
  assert.equal(data.datePublished,post.publishedAt);assert.equal(data.dateModified,post.publishedAt);
  assert.doesNotMatch(raw,/[<>&\u2028\u2029]/);assert.match(raw,/\\u003c/);
  const hash=createHash('sha256').update(raw).digest('base64');assert.ok(response.headers.get('content-security-policy').includes(`'sha256-${hash}'`));
  assert.doesNotMatch(response.headers.get('content-security-policy').split(';').find(value=>value.includes('script-src')),/unsafe-inline/);
  const artwork=await app.request(`/blog/share/${post.slug}.jpg`,{anonymous:true});assert.equal(artwork.status,200);assert.equal(artwork.headers.get('content-type'),'image/jpeg');assert.equal(artwork.headers.get('x-robots-tag'),null);
  app.advance(60000);post=await app.save(post,{title:'Private draft changes',summary:'Private draft summary'});
  assert.deepEqual(articleMetadata(await (await app.request(`/blog/${post.slug}`,{anonymous:true})).text()).data,data);
  assert.doesNotMatch(await (await app.request(`/admin/blog-preview/${post.id}`)).text(),/application\/ld\+json/);
  post=await app.action(post,'publish');
  const updated=articleMetadata(await (await app.request(`/blog/${post.slug}`,{anonymous:true})).text()).data;
  assert.equal(updated.headline,'Private draft changes');assert.equal(updated.datePublished,data.datePublished);assert.ok(updated.dateModified>data.dateModified);
  const profile=await app.admin('/author',{method:'PUT',body:{name:'Okan Can Özbek',linkedinUrl:'https://www.linkedin.com/in/oo-dev/',avatarId:null}});assert.equal(profile.status,200);
  assert.equal(articleMetadata(await (await app.request(`/blog/${post.slug}`,{anonymous:true})).text()).data.author.url,'https://www.linkedin.com/in/oo-dev/');
  assert.doesNotMatch(await (await app.request('/blog',{anonymous:true})).text(),/application\/ld\+json/);
});

test('live sitemap index follows published content and ignores draft edits and analytics',async t=>{
  const app=await fixture(t);const xml=async path=>{const response=await app.request(path,{anonymous:true});assert.equal(response.status,200);assert.equal(response.headers.get('x-robots-tag'),null);assert.equal(response.headers.get('set-cookie'),null);return response.text();};
  const index=await xml('/sitemap.xml');assert.match(index,/<sitemapindex/);assert.match(index,/sitemaps\/blogs.xml/);assert.doesNotMatch(index,/projects.xml/);
  const robots=await xml('/robots.txt');assert.match(robots,/Sitemap: https:\/\/pixelware.test\/sitemap.xml/);assert.match(robots,/Disallow: \/admin/);
  assert.equal((await app.request('/sitemap.xml',{method:'HEAD',anonymous:true})).status,200);
  await app.login();let post=await app.create('Searchable project writeup');assert.doesNotMatch(await xml('/sitemaps/blogs.xml'),new RegExp(post.slug));
  post=await app.action(post,'publish');const first=await xml('/sitemaps/blogs.xml');assert.match(first,new RegExp(post.slug));assert.match(first,/<lastmod>/);
  const pages=await xml('/sitemaps/pages.xml');assert.match(pages,/https:\/\/pixelware.test\/blog<\/loc>/);
  app.advance(60000);post=await app.save(post,{summary:'Private changes only'});assert.equal(await xml('/sitemaps/blogs.xml'),first);assert.equal(await xml('/sitemaps/pages.xml'),pages);
  await app.request('/blog/'+post.slug,{anonymous:true});assert.equal(await xml('/sitemaps/blogs.xml'),first);
  post=await app.action(post,'publish');assert.notEqual(await xml('/sitemaps/blogs.xml'),first);
  app.advance(60000);await app.action(post,'unpublish');assert.doesNotMatch(await xml('/sitemaps/blogs.xml'),new RegExp(post.slug));assert.notEqual(await xml('/sitemaps/pages.xml'),pages);
  assert.doesNotMatch(await xml('/sitemaps/blogs.xml'),/\/admin|\/api\/|\/r\//);
});
