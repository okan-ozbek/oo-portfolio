import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAdminServer } from '../server/admin-server.mjs';
import { hashPassword } from '../server/security.mjs';

const origin='https://pixelware.test',password='Project integration test password!';
const passwordHash=await hashPassword(password);
async function fixture(t,databasePath=':memory:'){
  const server=createAdminServer({origin,passwordHash,databasePath});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const close=()=>new Promise(resolve=>{if(!server.listening)return resolve();server.close(resolve);server.closeAllConnections();});t.after(close);
  let cookie='',csrf='';
  const request=(path,{method='GET',body,anonymous=false,headers={}}={})=>fetch(base+path,{method,headers:{...(!anonymous?{Cookie:cookie}:{}),...(!['GET','HEAD'].includes(method)?{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrf}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const admin=(path='',options)=>request('/api/admin/projects'+path,options);
  const login=async()=>{const response=await request('/api/admin/login',{method:'POST',body:{password}});cookie=response.headers.get('set-cookie').split(';')[0];csrf=(await response.json()).csrf;};
  const publicList=async()=>(await (await request('/api/public/projects',{anonymous:true})).json()).projects;
  return {request,admin,login,publicList,close};
}
const draft={title:'A new tool',caption:'Systems engineering',description:'A useful experiment.',url:'/blog/a-post',state:'draft',thumbnail:'terrain'};
test('projects backfill once, preserve original scenes, and protect mutations',async t=>{
  const app=await fixture(t);
  assert.equal((await app.admin()).status,401);
  assert.equal((await app.admin('',{method:'POST',body:{project:draft}})).status,401);
  const projects=await app.publicList();assert.equal(projects.length,6);
  assert.equal(projects.filter(p=>p.state==='published').length,1);
  assert.equal(projects.filter(p=>p.state==='teaser').length,5);
  assert.equal(projects[0].url,'https://systems.pixelware.nl/');
  assert.deepEqual(projects.map(p=>p.thumbnail),['project-network','project-market','project-binary','project-stack','project-blackhole','project-latency']);
  await app.login();
  for(const headers of [{Origin:'https://evil.test'},{'X-CSRF-Token':''}])assert.equal((await app.admin('',{method:'POST',body:{project:draft},headers})).status,403);
});
test('draft, teaser and published transitions, links, stale writes, and deletion',async t=>{
  const app=await fixture(t);await app.login();
  let response=await app.admin('',{method:'POST',body:{project:draft}});assert.equal(response.status,201);let {project}=await response.json();
  assert.ok(!(await app.publicList()).some(p=>p.id===project.id));
  response=await app.admin('/'+project.id,{method:'PUT',body:{version:project.version,project:{...project,state:'teaser'}}});assert.equal(response.status,200);project=(await response.json()).project;
  assert.equal((await app.publicList()).find(p=>p.id===project.id).url,'');
  assert.equal((await app.admin('/'+project.id,{method:'PUT',body:{version:1,project}})).status,409);
  for(const url of ['javascript:alert(1)','data:text/html,test','//evil.test','https://user:pass@example.com',''])assert.equal((await app.admin('/'+project.id,{method:'PUT',body:{version:project.version,project:{...project,state:'published',url}}})).status,400);
  response=await app.admin('/'+project.id,{method:'PUT',body:{version:project.version,project:{...project,title:'Released tool',state:'published',url:'https://github.com/example/repo',thumbnail:'project-stack'}}});assert.equal(response.status,200);project=(await response.json()).project;
  assert.equal((await app.publicList()).find(p=>p.id===project.id).url,'https://github.com/example/repo');
  assert.equal((await app.admin('/'+project.id,{method:'DELETE',body:{version:1}})).status,409);
  assert.equal((await app.admin('/'+project.id,{method:'DELETE',body:{version:project.version}})).status,200);
  assert.ok(!(await app.publicList()).some(p=>p.id===project.id));
});
test('project edits and seed deletions persist across server restarts',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'pixelware-projects-'));let app,restarted;t.after(async()=>{await app?.close();await restarted?.close();await rm(directory,{recursive:true,force:true});});const path=join(directory,'admin.sqlite');
  app=await fixture(t,path);await app.login();let projects=(await (await app.admin()).json()).projects;
  const first=projects[0];assert.equal((await app.admin('/'+first.id,{method:'PUT',body:{version:first.version,project:{...first,title:'Updated Hardware IDE'}}})).status,200);
  for(const project of projects.slice(1))assert.equal((await app.admin('/'+project.id,{method:'DELETE',body:{version:project.version}})).status,200);
  await app.close();restarted=await fixture(t,path);const visible=await restarted.publicList();assert.equal(visible.length,1);assert.equal(visible[0].title,'Updated Hardware IDE');
});
