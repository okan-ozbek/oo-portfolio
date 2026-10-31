import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAdminServer } from '../server/admin-server.mjs';
import { hashPassword } from '../server/security.mjs';
import { bookPdf } from './fixtures/book.mjs';

const origin = 'https://pixelware.test', password = 'book-library test password!';
const passwordHash = await hashPassword(password);
async function fixture(t, databasePath = ':memory:') {
  const server = createAdminServer({ origin, passwordHash, databasePath });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const close = () => new Promise(resolve => { if (!server.listening) return resolve(); server.close(resolve); server.closeAllConnections(); });
  t.after(close);
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '', csrf = '';
  const request = (path = '', { method = 'GET', body, headers = {}, anonymous = false } = {}) => fetch(`${base}/api/admin/${path}`, {
    method, headers: { ...(!anonymous ? { Cookie: cookie } : {}), ...(method !== 'GET' && method !== 'HEAD' ? { Origin: origin, 'X-CSRF-Token': csrf, 'Content-Type': Buffer.isBuffer(body) ? 'application/pdf' : 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
  });
  async function login() { const response = await request('login', { method: 'POST', body: { password } }); cookie = response.headers.get('set-cookie').split(';')[0]; csrf = (await response.json()).csrf; }
  const upload = (pdf = bookPdf(), name = 'Test book', tags = ['C++', 'Computer Architecture']) => request(`books?${new URLSearchParams({ name, tags: JSON.stringify(tags) })}`, { method: 'POST', body: pdf });
  return { request, login, upload, close };
}

test('PDFs and covers are private; all book mutations require origin, CSRF, and correct content type', async t => {
  const app = await fixture(t);
  assert.equal((await app.request('books')).status, 401);
  assert.equal((await app.upload()).status, 401);
  await app.login();
  const response = await app.upload(); assert.equal(response.status, 201, await response.clone().text());
  const { book } = await response.json();
  for (const asset of ['pdf', 'thumbnail']) for (const method of ['GET', 'HEAD']) assert.equal((await app.request(`books/${book.id}/${asset}`, { method, anonymous: true })).status, 401);
  for (const method of ['PATCH', 'DELETE']) {
    for (const headers of [{ Origin: 'https://evil.test' }, { 'X-CSRF-Token': '' }]) assert.equal((await app.request(`books/${book.id}`, { method, headers, body: {} })).status, 403);
    assert.equal((await app.request(`books/${book.id}`, { method, body: {}, anonymous: true })).status, 401);
  }
  for (const headers of [{ Origin: 'https://evil.test' }, { 'X-CSRF-Token': '' }]) assert.equal((await app.request('books?name=Test', { method: 'POST', body: bookPdf(), headers })).status, 403);
  assert.equal((await app.request('books?name=Test', { method: 'POST', body: {} })).status, 415);
});

test('upload derives actual page count and first-page PNG; read, HEAD, download and byte ranges preserve PDF bytes', async t => {
  const app = await fixture(t); await app.login(); const pdf = bookPdf();
  const response = await app.upload(pdf); assert.equal(response.status, 201, await response.clone().text()); const { book } = await response.json();
  assert.equal(book.pages, 2); assert.equal(book.size, pdf.length);
  const path = `books/${book.id}`;
  const image = await app.request(`${path}/thumbnail`); assert.equal(image.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()).subarray(0, 8), Buffer.from([137,80,78,71,13,10,26,10]));
  const read = await app.request(`${path}/pdf`); assert.match(read.headers.get('content-disposition'), /^inline/); assert.equal(read.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(read.headers.get('content-security-policy'), /sandbox/);
  assert.deepEqual(Buffer.from(await read.arrayBuffer()), pdf);
  const head = await app.request(`${path}/pdf`, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), String(pdf.length)); assert.equal((await head.arrayBuffer()).byteLength, 0);
  const download = await app.request(`${path}/pdf?download=1`); assert.match(download.headers.get('content-disposition'), /^attachment/); assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf);
  for (const [range, expected] of [['bytes=0-4', pdf.subarray(0,5)], ['bytes=-5', pdf.subarray(-5)], ['bytes=5-', pdf.subarray(5)]]) {
    const partial = await app.request(`${path}/pdf`, { headers: { Range: range } }); assert.equal(partial.status, 206); assert.deepEqual(Buffer.from(await partial.arrayBuffer()), expected);
  }
  for (const range of ['bytes=999999-', 'bytes=9-4', 'bytes=abc', 'bytes=-0']) assert.equal((await app.request(`${path}/pdf`, { headers: { Range: range } })).status, 416);
});

test('tags normalize, filter exactly, update with book names, and deletion preserves other books across restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pixelware-books-test-'));
  let restarted;
  const database = join(directory, 'admin.sqlite'); const app = await fixture(t, database);
  t.after(async () => { await app.close(); await restarted?.close(); await rm(directory, { recursive: true, force: true }); });
  await app.login();
  const first = (await (await app.upload(bookPdf('First'), 'First', [' C++ ', 'c++', 'Data Structures & Algorithms'])).json()).book;
  const second = (await (await app.upload(bookPdf('Second'), 'Second', ['Computer Architecture'])).json()).book;
  assert.deepEqual(first.tags, ['C++', 'Data Structures & Algorithms']);
  assert.equal((await (await app.request(`books?tag=${encodeURIComponent('c++')}`)).json()).books.length, 1);
  assert.equal((await (await app.request('books?tag=C')).json()).books.length, 0);
  const renamed = await app.request(`books/${first.id}`, { method: 'PATCH', body: { name: 'Renamed', tags: ['computer architecture', 'Concurrency'] } });
  assert.equal(renamed.status, 200); assert.deepEqual((await renamed.json()).book.tags, ['Computer Architecture', 'Concurrency']);
  assert.equal((await (await app.request(`books?tag=${encodeURIComponent('Computer Architecture')}`)).json()).books.length, 2);
  await app.close(); restarted = await fixture(t, database); await restarted.login();
  assert.equal((await (await restarted.request('books')).json()).books.length, 2);
  assert.equal((await restarted.request(`books/${first.id}`, { method: 'DELETE', body: {} })).status, 200);
  for (const asset of ['pdf', 'thumbnail']) assert.equal((await restarted.request(`books/${first.id}/${asset}`)).status, 404);
  assert.equal((await restarted.request(`books/${first.id}`, { method: 'DELETE', body: {} })).status, 404);
  const data = await (await restarted.request('books')).json(); assert.deepEqual(data.books.map(book => book.id), [second.id]); assert.deepEqual(data.tags, ['Computer Architecture']);
});

test('invalid PDFs, duplicate uploads, and invalid metadata leave the library unchanged', async t => {
  const app = await fixture(t); await app.login();
  for (const pdf of [Buffer.from('not a pdf'), Buffer.from('%PDF-1.4\nbroken')]) assert.equal((await app.upload(pdf)).status, 400);
  for (const [name, tags] of [['', []], ['Book', ['']], ['Book', 'C++'], ['Book', Array(21).fill('C++')]]) assert.equal((await app.upload(bookPdf(), name, tags)).status, 400);
  const results = await Promise.all([app.upload(), app.upload()]); assert.deepEqual(results.map(result => result.status).sort(), [201,409]);
  const { books } = await (await app.request('books')).json(); assert.equal(books.length, 1);
  assert.equal((await app.request(`books/${books[0].id}`, { method: 'PATCH', body: { name: 'Book', tags: ['x'.repeat(61)] } })).status, 400);
});
