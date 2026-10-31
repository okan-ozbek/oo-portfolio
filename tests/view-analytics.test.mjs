import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAdminServer } from '../server/admin-server.mjs';
import { hashPassword } from '../server/security.mjs';

test('device views deduplicate forever per item, ignore previews and prefetches, and persist', async t => {
  const directory=await mkdtemp(join(tmpdir(),'pixelware-views-'));
  let server;const close=()=>new Promise(resolve=>{if(!server?.listening)return resolve();server.close(resolve);server.closeAllConnections();});
  t.after(async()=>{await close();await rm(directory,{recursive:true,force:true});});
  const password='Content view test password!';const passwordHash=await hashPassword(password);const origin='https://pixelware.test';let time=Date.now(),base,adminCookie,csrf;
  async function start(){server=createAdminServer({passwordHash,origin,databasePath:join(directory,'admin.sqlite'),now:()=>time});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;}
  const request=(path,options={})=>fetch(base+path,{redirect:'manual',...options});
  async function login(){const response=await request('/api/admin/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password})});adminCookie=response.headers.get('set-cookie').split(';')[0];csrf=(await response.json()).csrf;}
  const admin=(path,method='GET',body)=>request('/api/admin/'+path,{method,headers:{Cookie:adminCookie,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const counts=async()=>({projects:(await (await admin('projects')).json()).projects,posts:(await (await admin('blogs')).json()).posts});
  await start();await login();
  assert.equal((await request('/api/admin/view-activity?kind=blog')).status,401);
  assert.equal((await admin('view-activity?kind=other')).status,400);
  assert.equal((await admin('view-activity?kind=blog&range=invalid')).status,400);
  let post=(await (await admin('blogs','POST',{})).json()).post;
  post=(await (await admin('blogs/'+post.id,'PATCH',{version:post.version,post:{...Object.fromEntries(['title','slug','summary','markdown','tags','thumbnail','banner','relatedIds'].map(key=>[key,post[key]])),title:'A viewed article',summary:'A useful summary.',markdown:'Some useful content.'},sessionId:'view-test'})).json()).post;
  post=(await (await admin('blogs/'+post.id+'/publish','POST',{version:post.version})).json()).post;
  const article='/blog/'+post.slug,project='/api/public/projects/01/visit';
  for(const path of [article,project]){
    assert.equal((await request(path,{method:'HEAD'})).headers.get('set-cookie'),null);
    assert.equal((await request(path,{headers:{Purpose:'prefetch'}})).headers.get('set-cookie'),null);
    assert.equal((await request(path,{headers:{'User-Agent':'ExampleBot'}})).headers.get('set-cookie'),null);
  }
  await request('/admin/blog-preview/'+post.id,{headers:{Cookie:adminCookie}});
  await request('/api/public/projects');await request('/api/public/blogs');
  assert.equal((await counts()).posts[0].uniqueViews,0);assert.equal((await counts()).projects[0].uniqueViews,0);
  const first=await request(article);const raw=first.headers.get('set-cookie');assert.match(raw,/HttpOnly/);assert.match(raw,/Secure/);const device=raw.split(';')[0];
  await Promise.all(Array.from({length:6},()=>request(article,{headers:{Cookie:device}})));
  for(const kind of ['blog','project']){const response=await admin('view-activity?kind='+kind+'&range=30d');assert.equal(response.status,200);const chart=await response.json();assert.equal(chart.range,'30d');assert.ok(chart.chartStartDay<chart.chartEndDay);if(kind==='blog')assert.equal(chart.series[0].daily.reduce((sum,day)=>sum+day.views,0),1);}
  const opened=await request(project,{headers:{Cookie:device}});assert.equal(opened.status,302);assert.equal(opened.headers.get('location'),'https://systems.pixelware.nl/');
  await request(project,{headers:{Cookie:device}});
  assert.equal((await request('/api/public/projects/01/view',{method:'POST',headers:{Origin:origin,Cookie:device}})).status,204);
  assert.equal((await request('/api/public/projects/01/view',{method:'POST',headers:{Origin:'https://evil.test',Cookie:device}})).status,403);
  assert.equal((await request('/api/public/projects/02/view',{method:'POST',headers:{Origin:origin,Cookie:device}})).status,404);
  time+=365*86400000;await login();await request(article,{headers:{Cookie:device}});await request(project,{headers:{Cookie:device}});
  let data=await counts();assert.equal(data.posts[0].uniqueViews,1);assert.equal(data.projects[0].uniqueViews,1);
  await request(article);await request(project);data=await counts();assert.equal(data.posts[0].uniqueViews,2);assert.equal(data.projects[0].uniqueViews,2);
  for(const kind of ['blog','project']){const chart=await (await admin('view-activity?kind='+kind+'&range=7d')).json();assert.equal(chart.series.length,1);assert.equal(chart.series[0].daily.reduce((sum,day)=>sum+day.views,0),1,'Only the new device in the selected week counts; the returning device retains its original date');}
  assert.equal((await request('/api/public/projects/02/visit')).status,404);
  assert.equal((await request('/api/public/projects/01/visit',{method:'POST'})).status,405);
  await close();await start();await login();await request(article,{headers:{Cookie:device}});await request(project,{headers:{Cookie:device}});
  data=await counts();assert.equal(data.posts[0].uniqueViews,2);assert.equal(data.projects[0].uniqueViews,2);
});
