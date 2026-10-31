import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { HttpError, readJson } from './http.mjs';
import { artwork, artUrl, presets } from './blog-art.mjs';
import { renderMarkdown, referencedImages, escapeHtml } from './blog-markdown.mjs';
import { articlePage, indexPage, feedRow, blogCsp, blogPageCsp } from './blog-pages.mjs';
import { createLinkedIn } from './blog-linkedin.mjs';

const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const positions=['center','top','bottom','left','right'];
const fields=['title','slug','summary','tags','markdown','thumbnail','banner','relatedIds'];
const fresh = () => ({title:'Untitled draft',slug:`post-${randomUUID().slice(0,8)}`,summary:'',tags:[],markdown:'',thumbnail:{preset:'terrain',assetId:null,position:'center'},banner:{preset:'terrain',assetId:null,position:'center'},relatedIds:[]});
export function createBlogs({db,origin,now=Date.now,send,isAuthenticated,analytics,onPublicChange=()=>{}}) {
  db.exec(`CREATE TABLE IF NOT EXISTS blog_posts (
    id TEXT PRIMARY KEY, draft_json TEXT NOT NULL, published_json TEXT, published_slug TEXT UNIQUE,
    version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    published_at TEXT, live_updated_at TEXT
  ) STRICT;
  CREATE TABLE IF NOT EXISTS blog_media (
    id TEXT PRIMARY KEY, post_id TEXT REFERENCES blog_posts(id) ON DELETE CASCADE,
    name TEXT NOT NULL, body BLOB NOT NULL, original BLOB NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, created_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS blog_revisions (
    id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
    snapshot_json TEXT NOT NULL, base_json TEXT NOT NULL, kind TEXT NOT NULL, note TEXT NOT NULL,
    fields_json TEXT NOT NULL, session_id TEXT NOT NULL, created_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS blog_revisions_post ON blog_revisions(post_id,created_at);
  CREATE TABLE IF NOT EXISTS blog_image_variants (media_id TEXT NOT NULL REFERENCES blog_media(id) ON DELETE CASCADE, kind TEXT NOT NULL, body BLOB NOT NULL, PRIMARY KEY(media_id,kind)) STRICT;
  CREATE TABLE IF NOT EXISTS blog_author (id INTEGER PRIMARY KEY CHECK(id=1), profile_json TEXT NOT NULL) STRICT;
  CREATE TABLE IF NOT EXISTS blog_oauth_states (state TEXT PRIMARY KEY, session_hash TEXT NOT NULL, nonce TEXT NOT NULL, verifier TEXT NOT NULL, expires_at INTEGER NOT NULL) STRICT;`);
  db.prepare('INSERT OR IGNORE INTO blog_author VALUES (1,?)').run(JSON.stringify({name:'Okan Can Özbek',linkedinUrl:'',linkedinId:'',avatarId:null}));
  const timestamp=()=>new Date(now()).toISOString();
  const author=()=>JSON.parse(db.prepare('SELECT profile_json FROM blog_author WHERE id=1').get().profile_json);
  const rowFor=id=>{const row=db.prepare('SELECT * FROM blog_posts WHERE id=?').get(id);if(!row)throw new HttpError(404,'Post not found.');return row;};
  const profilePublic=()=>{const {name,linkedinUrl,avatarId}=author();return {name,linkedinUrl,avatarId};};
  const entry=row=>({id:row.id,uniqueViews:analytics?.count('blog',row.id)??0,...JSON.parse(row.draft_json),version:row.version,createdAt:row.created_at,updatedAt:row.updated_at,publishedAt:row.published_at,status:row.published_json?'published':'draft',hasUnpublishedChanges:Boolean(row.published_json&&row.draft_json!==row.published_json),publicUrl:row.published_json?`/blog/${row.published_slug}`:null});
  const summary=row=>{const post=JSON.parse(row.published_json);return {id:row.id,title:post.title,slug:row.published_slug,summary:post.summary,tags:post.tags,thumbnailUrl:artUrl(post.thumbnail,row.id),thumbnailPosition:post.thumbnail.position,thumbnailPreset:post.thumbnail.assetId?null:post.thumbnail.preset,publishedAt:row.published_at,updatedAt:row.live_updated_at,author:profilePublic()};};
  function transaction(action) {db.exec('BEGIN IMMEDIATE');try{const result=action();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
  function listPublic(cursor=null,limit=5) {
    let values=[],where='published_json IS NOT NULL';
    if(cursor){
      let parsed;try{if(cursor.length>300)throw new Error();parsed=JSON.parse(Buffer.from(cursor,'base64url').toString());}catch{throw new HttpError(400,'Invalid page cursor.');}
      if(!Array.isArray(parsed)||parsed.length!==2||typeof parsed[0]!=='string'||!/^\d{4}-\d\d-\d\dT/.test(parsed[0])||!UUID.test(parsed[1]))throw new HttpError(400,'Invalid page cursor.');
      where+=' AND (published_at < ? OR (published_at = ? AND id < ?))';values=[parsed[0],parsed[0],parsed[1]];
    }
    const rows=db.prepare(`SELECT * FROM blog_posts WHERE ${where} ORDER BY published_at DESC,id DESC LIMIT ?`).all(...values,limit+1);
    const hasMore=rows.length>limit,selected=rows.slice(0,limit),last=selected.at(-1);
    return {posts:selected.map(summary),nextCursor:hasMore?Buffer.from(JSON.stringify([last.published_at,last.id])).toString('base64url'):null};
  }
  function suggestions(post) {
    if(post.relatedIds.length)return post.relatedIds.filter(id=>id!==post.id).map(id=>db.prepare('SELECT * FROM blog_posts WHERE id=? AND published_json IS NOT NULL').get(id)).filter(Boolean).map(summary);
    return db.prepare('SELECT * FROM blog_posts WHERE published_json IS NOT NULL AND id<>? ORDER BY published_at DESC,id DESC LIMIT 4').all(post.id).map(summary);
  }
  function checkVersion(body,row){if(!Number.isSafeInteger(body.version)||body.version!==row.version)throw new HttpError(409,'This post changed in another window. Reopen it to load the latest version; your editor text is still here.');}
  function validatePost(value,row) {
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!fields.includes(key)))throw new HttpError(400,'Invalid post fields.');
    const text=(key,max,required=false)=>{if(typeof value[key]!=='string'||value[key].length>max||(required&&!value[key].trim()))throw new HttpError(400,`${key} must ${required?'not be empty and ':''}be at most ${max} characters.`);return key==='markdown'?value[key]:value[key].trim();};
    const post={title:text('title',180,true),slug:text('slug',100,true),summary:text('summary',500),markdown:text('markdown',300000)};
    if(!SLUG.test(post.slug))throw new HttpError(400,'Use lowercase letters, numbers, and single hyphens in the URL slug.');
    if(row.published_slug&&post.slug!==row.published_slug)throw new HttpError(400,'The URL stays fixed after first publication so shared links keep working.');
    const reserved=db.prepare('SELECT id,draft_json,published_slug FROM blog_posts WHERE id<>?').all(row.id).some(item=>item.published_slug===post.slug||JSON.parse(item.draft_json).slug===post.slug);
    if(reserved)throw new HttpError(409,'That URL slug is already in use.');
    if(!Array.isArray(value.tags)||value.tags.length>20||value.tags.some(tag=>typeof tag!=='string'||!tag.trim()||tag.length>60))throw new HttpError(400,'Use up to 20 tags of 1–60 characters.');
    post.tags=[...new Set(value.tags.map(tag=>tag.trim()))];
    for(const key of ['thumbnail','banner']){
      const spec=value[key];if(!spec||Object.keys(spec).some(name=>!['preset','assetId','position'].includes(name))||!presets.includes(spec.preset)||!positions.includes(spec.position)||(spec.assetId!==null&&(!UUID.test(spec.assetId)||!db.prepare('SELECT 1 FROM blog_media WHERE id=? AND post_id=?').get(spec.assetId,row.id))))throw new HttpError(400,`Choose a valid ${key} image or preset.`);
      post[key]={preset:spec.preset,assetId:spec.assetId,position:spec.position};
    }
    if(!Array.isArray(value.relatedIds)||value.relatedIds.length>6||value.relatedIds.some(id=>!UUID.test(id)||id===row.id||!db.prepare('SELECT 1 FROM blog_posts WHERE id=?').get(id)))throw new HttpError(400,'Choose up to six other posts for suggestions.');
    post.relatedIds=[...new Set(value.relatedIds)];
    for(const id of referencedImages(post))if(!db.prepare('SELECT 1 FROM blog_media WHERE id=? AND post_id=?').get(id,row.id))throw new HttpError(400,'An image does not belong to this post. Upload it here first.');
    return post;
  }
  function revision(row,post,kind,note='',sessionId='') {
    const prior=db.prepare('SELECT * FROM blog_revisions WHERE post_id=? ORDER BY rowid DESC LIMIT 1').get(row.id);
    const grouping=kind==='draft'&&prior?.kind==='draft'&&prior.session_id===sessionId&&sessionId&&now()-Date.parse(prior.created_at)<15*60000;
    const base=grouping?JSON.parse(prior.base_json):JSON.parse(row.draft_json);
    const changed=fields.filter(key=>JSON.stringify(base[key])!==JSON.stringify(post[key]));
    if(grouping)db.prepare('UPDATE blog_revisions SET snapshot_json=?, fields_json=?, created_at=? WHERE id=?').run(JSON.stringify(post),JSON.stringify(changed),timestamp(),prior.id);
    else db.prepare('INSERT INTO blog_revisions VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(),row.id,JSON.stringify(post),JSON.stringify(base),kind,note,JSON.stringify(changed),sessionId,timestamp());
  }
  let imagesProcessing=0;
  async function upload(req,postId) {
    if(imagesProcessing>=2)throw new HttpError(429,'Two images are already processing. Please try again in a moment.');
    imagesProcessing++;try{return await uploadImage(req,postId);}finally{imagesProcessing--;}
  }
  async function uploadImage(req,postId) {
    if(postId)rowFor(postId);
    if(!/^image\/(png|jpeg|webp|gif)(?:;|$)/.test(req.headers['content-type']??''))throw new HttpError(415,'Upload a PNG, JPEG, WebP, or GIF image.');
    const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>12*1024*1024)throw new HttpError(413,'Images must be 12 MB or smaller.');chunks.push(chunk);}
    let result;const original=Buffer.concat(chunks);
    try{const image=sharp(original,{limitInputPixels:24000000,animated:false,failOn:'warning'});const meta=await image.metadata();if(!['png','jpeg','webp','gif'].includes(meta.format))throw new Error();result=await image.rotate().resize({width:3000,height:3000,fit:'inside',withoutEnlargement:true}).webp({quality:90}).toBuffer({resolveWithObject:true});}catch{throw new HttpError(400,'The image could not be read. Use a PNG, JPEG, WebP, or GIF under 24 megapixels.');}
    if(postId){rowFor(postId);if(db.prepare('SELECT count(*) AS n FROM blog_media WHERE post_id=?').get(postId).n>=100)throw new HttpError(400,'This post already has 100 images.');}
    const id=randomUUID(),name=(new URL(req.url,origin).searchParams.get('name')??'Image').slice(0,180);
    db.prepare('INSERT INTO blog_media VALUES (?,?,?,?,?,?,?,?)').run(id,postId,name,result.data,original,result.info.width,result.info.height,timestamp());
    return {id,name,url:`/blog/media/${id}`,width:result.info.width,height:result.info.height};
  }
  const linkedIn=createLinkedIn({db,origin,now,author,save:profile=>db.prepare('UPDATE blog_author SET profile_json=? WHERE id=1').run(JSON.stringify(profile)),upload});
  async function adminRoute(req,res,url,current) {
    const path=url.pathname;
    if(!path.startsWith('/api/admin/blogs'))return false;
    if(await linkedIn.adminRoute(req,res,url,current,send))return true;
    if(path==='/api/admin/blogs/author'){
      if(req.method==='GET'){send(res,200,{author:author(),linkedinAvailable:linkedIn.available});return true;}
      if(req.method==='PUT'){
        const body=await readJson(req),existing=author();
        if(typeof body.name!=='string'||!body.name.trim()||body.name.length>100||typeof body.linkedinUrl!=='string'||(body.linkedinUrl&&!/^https:\/\/(www\.)?linkedin\.com\/in\/[a-zA-Z0-9_%\-]+\/?$/.test(body.linkedinUrl)))throw new HttpError(400,'Enter your name and a LinkedIn profile URL.');
        if(body.avatarId!==null&&(typeof body.avatarId!=='string'||!UUID.test(body.avatarId)||!db.prepare('SELECT 1 FROM blog_media WHERE id=? AND post_id IS NULL').get(body.avatarId)))throw new HttpError(400,'Choose an uploaded author photo.');
        const profile={...existing,name:body.name.trim(),linkedinUrl:body.linkedinUrl,avatarId:body.avatarId};
        if(existing.linkedinUrl!==profile.linkedinUrl)profile.linkedinId='';
        db.prepare('UPDATE blog_author SET profile_json=? WHERE id=1').run(JSON.stringify(profile));send(res,200,{author:profile});return true;
      }
    }
    if(path==='/api/admin/blogs/author/media'&&req.method==='POST'){send(res,201,{asset:await upload(req,null)});return true;}
    if(path==='/api/admin/blogs'){
      if(req.method==='GET'){send(res,200,{posts:db.prepare('SELECT * FROM blog_posts ORDER BY updated_at DESC,id DESC').all().map(entry),author:author()});return true;}
      if(req.method==='POST'){await readJson(req);const id=randomUUID(),time=timestamp(),post=fresh();db.prepare('INSERT INTO blog_posts (id,draft_json,created_at,updated_at) VALUES (?,?,?,?)').run(id,JSON.stringify(post),time,time);revision(rowFor(id),post,'created','Draft created');send(res,201,{post:entry(rowFor(id))});return true;}
    }
    const match=/^\/api\/admin\/blogs\/([a-f0-9-]{36})(?:\/(media|preview|publish|unpublish|revisions|restore))?$/.exec(path);
    if(!match)return false;
    const [,id,action]=match;let row=rowFor(id);
    if(action==='media'){
      if(req.method==='GET'){send(res,200,{assets:db.prepare('SELECT id,name,width,height FROM blog_media WHERE post_id=? ORDER BY created_at,id').all(id).map(asset=>({...asset,url:`/blog/media/${asset.id}`}))});return true;}
      if(req.method==='POST'){send(res,201,{asset:await upload(req,id)});return true;}
    }
    if(action==='preview'&&req.method==='POST'){const body=await readJson(req,400000),post=validatePost(body.post,row);send(res,200,{html:renderMarkdown(post.markdown)});return true;}
    if(action==='revisions'&&req.method==='GET'){send(res,200,{revisions:db.prepare('SELECT id,kind,note,fields_json,created_at FROM blog_revisions WHERE post_id=? ORDER BY rowid DESC LIMIT 100').all(id).map(rev=>({id:rev.id,kind:rev.kind,note:rev.note,fields:JSON.parse(rev.fields_json),createdAt:rev.created_at}))});return true;}
    if(!action&&req.method==='GET'){send(res,200,{post:entry(row)});return true;}
    if(!action&&req.method==='PATCH'){
      const body=await readJson(req,400000);row=rowFor(id);checkVersion(body,row);const post=validatePost(body.post,row);
      if(JSON.stringify(post)!==row.draft_json)transaction(()=>{revision(row,post,'draft','',typeof body.sessionId==='string'?body.sessionId.slice(0,80):'');db.prepare('UPDATE blog_posts SET draft_json=?,version=version+1,updated_at=? WHERE id=?').run(JSON.stringify(post),timestamp(),id);});
      send(res,200,{post:entry(rowFor(id))});return true;
    }
    if(['publish','unpublish','restore'].includes(action)&&req.method==='POST'){
      const body=await readJson(req);row=rowFor(id);checkVersion(body,row);let post=JSON.parse(row.draft_json);
      const note=typeof body.note==='string'?body.note.trim().slice(0,500):'';
      transaction(()=>{
        if(action==='publish'){
          post=validatePost(post,row);if(!post.summary||!post.markdown.trim())throw new HttpError(400,'Add a summary and article content before publishing.');
          revision(row,post,'published',note||'Published revision');const time=timestamp();db.prepare('UPDATE blog_posts SET published_json=?,published_slug=?,published_at=COALESCE(published_at,?),live_updated_at=?,version=version+1,updated_at=? WHERE id=?').run(JSON.stringify(post),post.slug,time,time,time,id);
        }else if(action==='unpublish'){
          revision(row,post,'unpublished',note||'Returned to draft');db.prepare('UPDATE blog_posts SET published_json=NULL,version=version+1,updated_at=? WHERE id=?').run(timestamp(),id);
        }else{
          const rev=db.prepare('SELECT snapshot_json FROM blog_revisions WHERE id=? AND post_id=?').get(body.revisionId??'',id);if(!rev)throw new HttpError(404,'Revision not found.');
          const restored=JSON.parse(rev.snapshot_json);
          post=validatePost({...restored,slug:row.published_slug??restored.slug},row);revision(row,post,'restored',note||'Restored an earlier revision');db.prepare('UPDATE blog_posts SET draft_json=?,version=version+1,updated_at=? WHERE id=?').run(JSON.stringify(post),timestamp(),id);
        }
        if(action==='publish'||(action==='unpublish'&&row.published_json))onPublicChange();
      });send(res,200,{post:entry(rowFor(id))});return true;
    }
    throw new HttpError(405,'Method not allowed.');
  }
  async function publicRoute(req,res,url) {
    if(await linkedIn.callback(req,res,url))return true;
    const path=url.pathname;
    if(!path.startsWith('/blog')&&!path.startsWith('/api/public/blogs')&&!path.startsWith('/admin/blog-preview/'))return false;
    if(!['GET','HEAD'].includes(req.method))throw new HttpError(405,'Method not allowed.');
    const bytes=(body,type,privatePage=false)=>{res.setHeader('Content-Security-Policy',type.startsWith('text/html')?blogPageCsp(body):blogCsp);if(!privatePage)res.removeHeader('X-Robots-Tag');res.writeHead(200,{'Content-Type':type,'Content-Length':Buffer.byteLength(body)});res.end(req.method==='HEAD'?undefined:body);return true;};
    const asset=/^\/blog\/assets\/([\w.-]+)$/.exec(path);
    if(asset){
      if(asset[1]==='theme.css')return bytes(readFileSync(new URL('./blog/theme.css',import.meta.url)),'text/css; charset=utf-8');
      if(asset[1]==='blog.css')return bytes(readFileSync(new URL('./blog/blog.css',import.meta.url)),'text/css; charset=utf-8');
      if(asset[1]==='reader.js')return bytes(readFileSync(new URL('./blog/reader.js',import.meta.url)),'text/javascript; charset=utf-8');
      if(/^[\w-]+\.js$/.test(asset[1])){try{return bytes(readFileSync(new URL(`./blog/vendor/${asset[1]}`,import.meta.url)),'text/javascript; charset=utf-8');}catch{throw new HttpError(404,'Asset not found.');}}
      throw new HttpError(404,'Asset not found.');
    }
    const art=/^\/blog\/art\/([a-z-]+)\.svg$/.exec(path);
    if(art&&presets.includes(art[1]))return bytes(artwork(art[1],(url.searchParams.get('seed')??'').slice(0,100),url.searchParams.get('wide')==='1'),'image/svg+xml');
    const media=/^\/blog\/media\/([a-f0-9-]{36})$/.exec(path);
    if(media){
      const item=db.prepare('SELECT * FROM blog_media WHERE id=?').get(media[1]);if(!item)throw new HttpError(404,'Image not found.');
      const isPublic=item.post_id?(()=>{const row=db.prepare('SELECT published_json FROM blog_posts WHERE id=?').get(item.post_id);return row?.published_json&&referencedImages(JSON.parse(row.published_json)).has(item.id);})():profilePublic().avatarId===item.id;
      if(!isPublic&&!isAuthenticated(req))throw new HttpError(404,'Image not found.');
      const kind=url.searchParams.get('size');let body=item.body;
      if(kind){
        const sizes={thumbnail:480,banner:1600,avatar:96};if(!Object.hasOwn(sizes,kind))throw new HttpError(400,'Invalid image size.');
        const cached=db.prepare('SELECT body FROM blog_image_variants WHERE media_id=? AND kind=?').get(item.id,kind);
        if(cached)body=cached.body;
        else{body=await sharp(item.body).resize({width:sizes[kind],height:sizes[kind],fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer();db.prepare('INSERT OR IGNORE INTO blog_image_variants VALUES (?,?,?)').run(item.id,kind,body);}
      }
      return bytes(body,'image/webp',!isPublic);
    }
    const share=/^\/blog\/share\/([a-z0-9]+(?:-[a-z0-9]+)*)\.jpg$/.exec(path);
    if(share){
      const row=db.prepare('SELECT id,published_json FROM blog_posts WHERE published_slug=? AND published_json IS NOT NULL').get(share[1]);if(!row)throw new HttpError(404,'Article not found.');
      const post=JSON.parse(row.published_json),spec=post.thumbnail;
      const source=spec.assetId?db.prepare('SELECT body FROM blog_media WHERE id=? AND post_id=?').get(spec.assetId,row.id).body:Buffer.from(artwork(spec.preset,row.id));
      const position={center:'centre',top:'north',bottom:'south',left:'west',right:'east'}[spec.position];
      return bytes(await sharp(source).resize(1200,630,{fit:'cover',position}).flatten({background:'#111113'}).jpeg({quality:85}).toBuffer(),'image/jpeg');
    }
    if(path==='/api/public/blogs'){const page=listPublic(url.searchParams.get('cursor'));res.removeHeader('X-Robots-Tag');send(res,200,{...page,html:page.posts.map(feedRow).join('')});return true;}
    if(path==='/blog'||path==='/blog/'){const page=listPublic();return bytes(indexPage(page.posts,page.nextCursor,origin),'text/html; charset=utf-8');}
    if(path==='/blog/sitemap.xml'){
      const posts=db.prepare('SELECT published_slug,live_updated_at FROM blog_posts WHERE published_json IS NOT NULL ORDER BY published_at DESC,id DESC').all();
      return bytes(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escapeHtml(origin)}/blog</loc></url>${posts.map(row=>`<url><loc>${escapeHtml(origin)}/blog/${row.published_slug}</loc><lastmod>${row.live_updated_at}</lastmod></url>`).join('')}</urlset>`,'application/xml; charset=utf-8');
    }
    const preview=/^\/admin\/blog-preview\/([a-f0-9-]{36})$/.exec(path);
    if(preview){if(!isAuthenticated(req))throw new HttpError(401,'Sign in to preview this draft.');const row=rowFor(preview[1]),post={...JSON.parse(row.draft_json),id:row.id};return bytes(articlePage(post,profilePublic(),suggestions(post),origin,{preview:true,publishedAt:row.published_at,updatedAt:row.updated_at}),'text/html; charset=utf-8',true);}
    const slug=/^\/blog\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(path);
    if(slug){const row=db.prepare('SELECT * FROM blog_posts WHERE published_slug=? AND published_json IS NOT NULL').get(slug[1]);if(!row)throw new HttpError(404,'Article not found.');const post={...JSON.parse(row.published_json),id:row.id};analytics?.record(req,res,'blog',row.id);return bytes(articlePage(post,profilePublic(),suggestions(post),origin,{publishedAt:row.published_at,updatedAt:row.live_updated_at,changelog:db.prepare("SELECT note,created_at FROM blog_revisions WHERE post_id=? AND kind='published' ORDER BY rowid DESC").all(row.id).map(rev=>({note:rev.note,createdAt:rev.created_at}))}),'text/html; charset=utf-8');}
    throw new HttpError(404,'Not found.');
  }
  return {adminRoute,publicRoute};
}
