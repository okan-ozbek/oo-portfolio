import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAdminServer } from '../server/admin-server.mjs';
import { HttpError } from '../server/http.mjs';
import { hashPassword } from '../server/security.mjs';
import { validateProject } from '../server/resume-project.mjs';

const origin = 'https://pixelware.test';
const password = 'resume integration test password';
const passwordHash = await hashPassword(password);
const key = createHash('sha256').update('https://github.com/example').digest('hex').slice(0,24);
const scanned = [{ key, destination: 'https://github.com/example', occurrences: 2, pages: [1] }, { key: 'email', destination: 'mailto:alex@example.com', occurrences: 1, pages: [1] }];
const pdf = Buffer.from('%PDF-1.7\nTest fixture only').toString('base64');
const upload = { name: 'Engineering resume', slug: 'engineering', mainFile: 'main.tex', files: [{ path: 'main.tex', content: Buffer.from('test fixture').toString('base64') }, { path: 'styles/custom.sty', content: '' }] };
async function fixture(t) {
  let clock = Date.parse('2026-10-26T12:00:00Z'), fail = false, delay;
  const server = createAdminServer({ passwordHash, origin, databasePath: ':memory:', now: () => clock,
    compileResume: async (action, body) => {
      if (delay) await delay;
      if (fail) throw new HttpError(422, 'Synthetic compiler failure');
      return { pdf, pages: 1, links: action === 'compile' ? scanned : scanned.map(link => ({ ...link, destination: body.mappings.find(mapping => mapping.from === link.destination)?.to ?? link.destination })) };
    } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '', csrf = '', visitor = '';
  async function request(path, method = 'GET', body, extra = {}) {
    const response = await fetch(`${base}${path}`, { method, redirect: 'manual', headers: { Cookie: `${cookie}; ${visitor}`, ...(method !== 'GET' && method !== 'HEAD' ? { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    const next = response.headers.getSetCookie().find(value => value.startsWith('__Host-pixelware_click='));
    if (next) visitor = next.split(';')[0];
    return response;
  }
  async function json(path, method, body) { const response = await request(path, method, body); const result = await response.json(); assert.ok(response.ok, JSON.stringify(result)); return result; }
  async function login() { const response = await request('/api/admin/login', 'POST', { password }); cookie = response.headers.get('set-cookie').split(';')[0]; csrf = (await response.json()).csrf; }
  return { request, json, login, advance: () => { clock += 3600001; }, fail: value => { fail = value; }, delay: value => { delay = value; } };
}
const route = id => `/api/admin/resumes/${id}`;
const selection = slug => ({ links: [{ key, tracked: true, slug, label: 'GitHub' }] });

test('resume routes require authentication, origin and CSRF; sources and draft PDFs stay private', async t => {
  const app = await fixture(t);
  assert.equal((await app.request('/api/admin/resumes')).status, 401);
  await app.login();
  assert.equal((await app.request('/api/admin/resumes', 'POST', upload, { 'X-CSRF-Token': '' })).status, 403);
  assert.equal((await app.request('/api/admin/resumes', 'POST', upload, { Origin: 'https://evil.test' })).status, 403);
  const { resume } = await app.json('/api/admin/resumes', 'POST', upload);
  assert.equal(resume.links[0].occurrences, 2); assert.equal(resume.links[1].trackable, false);
  assert.equal(resume.published, false); assert.equal(resume.downloads, 0);
  assert.equal((await app.request('/resumes/engineering.pdf')).status, 404);
  assert.equal((await app.request('/resume.pdf')).status, 404);
  const preview = await app.request(`${route(resume.id)}/pdf`);
  assert.equal(preview.status, 200);
  assert.doesNotMatch(preview.headers.get('content-security-policy'), /sandbox/);
  assert.match((await app.request(`${route(resume.id)}/pdf?download=1`)).headers.get('content-disposition'), /attachment/);
  assert.equal((await app.json(route(resume.id))).resume.downloads, 0);
  const detail = JSON.stringify(await app.json(route(resume.id)));
  assert.ok(!detail.includes('content')); assert.ok(!detail.includes(pdf));
  assert.equal((await app.request('/api/admin/resumes/main.tex')).status, 404);
  assert.deepEqual(await app.json('/api/public/resume'), { available: false });
});

test('independent variants, PDF publication, browser cooldowns, rebuild failures and cascading deletion', async t => {
  const app = await fixture(t); await app.login();
  const { resume: first } = await app.json('/api/admin/resumes', 'POST', upload);
  const path = route(first.id);
  await app.json(`${path}/compile`, 'POST', selection('engineering-github'));
  let { links } = await app.json('/api/admin/links'); assert.equal(links.length, 1);
  assert.equal(links[0].destination, scanned[0].destination);
  await app.json(`${path}/publish`, 'POST', { makeDefault: true });
  assert.equal((await app.json('/api/public/resume')).url, '/resume.pdf');
  for (const [method, headers] of [['HEAD', {}], ['GET', { Purpose: 'prefetch' }]]) assert.equal((await app.request('/resume.pdf', method, undefined, headers)).status, 200);
  assert.equal((await app.json(path)).resume.downloads, 0);
  for (const url of ['/resume.pdf', '/resumes/engineering.pdf', '/resume.pdf']) {
    const response = await app.request(url); assert.equal(response.status, 200); assert.match(response.headers.get('content-disposition'), /attachment/);
  }
  assert.equal((await app.json(path)).resume.downloads, 1);
  await app.request('/r/engineering-github'); await app.request('/r/engineering-github');
  assert.equal((await app.json(path)).resume.clicks, 1);
  app.advance(); await app.request('/resume.pdf'); assert.equal((await app.json(path)).resume.downloads, 2);
  const { resume: second } = await app.json(`${path}/duplicate`, 'POST', { name: 'Engineering variant', slug: 'engineering-b' });
  assert.equal(second.published, false); assert.equal(second.clicks, 0); assert.equal(second.links[0].tracked, false);
  assert.equal((await app.request(`${route(second.id)}/compile`, 'POST', selection('engineering-github'))).status, 409);
  await app.json(`${route(second.id)}/compile`, 'POST', selection('engineering-b-github'));
  assert.equal((await app.json('/api/admin/links')).links.length, 2);
  app.fail(true);
  assert.equal((await app.request(`${path}/compile`, 'POST', selection('engineering-github'))).status, 422);
  assert.equal((await app.json(path)).resume.unpublishedChanges, false);
  assert.equal((await app.json(path)).resume.clicks, 1);
  app.fail(false);
  await app.json(`${path}/compile`, 'POST', { links: [] });
  assert.equal((await app.json(path)).resume.unpublishedChanges, true);
  // The previous published PDF and its redirect remain available until republishing.
  assert.equal((await app.request('/resume.pdf')).status, 200);
  assert.equal((await app.request('/r/engineering-github')).status, 302);
  await app.json(`${route(second.id)}/publish`, 'POST', { makeDefault: true });
  await app.json(path, 'PATCH', { published: false });
  assert.equal((await app.request('/resumes/engineering.pdf')).status, 404);
  assert.equal((await app.request('/resume.pdf')).status, 200);
  await app.json(path, 'DELETE', {});
  assert.equal((await app.request('/r/engineering-github')).status, 404);
  assert.equal((await app.request('/r/engineering-b-github')).status, 302);
  links = (await app.json('/api/admin/links')).links; assert.equal(links.length, 1);
  await app.json(route(second.id), 'DELETE', {});
  assert.equal((await app.json('/api/public/resume')).available, false);
  assert.equal((await app.json('/api/admin/resumes')).resumes.length, 0);
});

test('uploads reject traversal, hidden files, duplicate paths, unsupported files and bad main selection', () => {
  for (const path of ['../escape.tex', '/absolute.tex', 'C:/bad.tex', 'fonts/../bad.tex', '.env', 'build/main.tex', 'a\\b.tex', 'resume.js']) assert.throws(() => validateProject({ ...upload, files: [{ path, content: '' }] }), /safe relative/);
  assert.throws(() => validateProject({ ...upload, files: [...upload.files, upload.files[0]] }), /Duplicate/);
  assert.throws(() => validateProject({ ...upload, mainFile: 'missing.tex' }), /main .tex/);
  assert.throws(() => validateProject({ ...upload, files: [{ path: 'main.tex', content: 'not base64' }] }), /encoding/);
  assert.throws(() => validateProject({ ...upload, files: [null] }), /Invalid project file/);
  const large = { path: 'images/large.png', content: Buffer.alloc(10 * 1024 * 1024).toString('base64') };
  assert.throws(() => validateProject({ ...upload, files: [upload.files[0], large] }), /10 MB/);
});

test('failed uploads create no records and non-web or unknown hyperlink selections are rejected', async t => {
  const app = await fixture(t); await app.login(); app.fail(true);
  assert.equal((await app.request('/api/admin/resumes', 'POST', upload)).status, 422);
  assert.equal((await app.json('/api/admin/resumes')).resumes.length, 0);
  app.fail(false); const { resume } = await app.json('/api/admin/resumes', 'POST', upload);
  for (const selectedKey of ['email', 'unknown']) assert.equal((await app.request(`${route(resume.id)}/compile`, 'POST', { links: [{ key: selectedKey, tracked: true, slug: 'invalid', label: 'Invalid' }] })).status, 400);
  assert.equal((await app.json('/api/admin/links')).links.length, 0);
});
