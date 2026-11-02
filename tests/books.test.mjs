import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { createAdminServer } from '../server/admin-server.mjs';
import { hashPassword } from '../server/security.mjs';
import { bookPdf } from './fixtures/book.mjs';
import sharp from 'sharp';
import { createBooks } from '../server/books.mjs';

test('library and thumbnail queries avoid reading large PDF table records', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const queries = [];
    const books = createBooks({
      db: { exec: sql => db.exec(sql), prepare: sql => { queries.push(sql); return db.prepare(sql); } },
      send: () => {}, inspect: async () => ({ pages: 2, thumbnail: Buffer.from('cached cover') }),
    });
    const book = await books.add(Buffer.from('%PDF-' + 'x'.repeat(20 * 1024 * 1024)), 'Large book', ['Read']);
    queries.length = 0;
    assert.equal(books.list()[0].id, book.id);
    let thumbnail;
    await books.adminRoute({ method: 'GET', headers: {} }, { writeHead() {}, end(body) { thumbnail = body; } }, new URL(`https://pixelware.test/api/admin/books/${book.id}/thumbnail`));
    assert.deepEqual(Buffer.from(thumbnail), Buffer.from('cached cover'));
    const reads = queries.filter(sql => /^SELECT /.test(sql));
    assert.equal(reads.length, 3, 'List, existence/metadata lookup, and thumbnail lookup');
    const tableRoot = db.prepare("SELECT rootpage FROM sqlite_schema WHERE type = 'table' AND name = 'books'").get().rootpage;
    for (const sql of reads) {
      const bindings = sql.includes('WHERE id = ?') ? [book.id] : [];
      const instructions = db.prepare(`EXPLAIN ${sql}`).all(...bindings);
      const tableCursors = instructions.filter(op => op.opcode === 'OpenRead' && op.p2 === tableRoot).map(op => op.p1);
      assert.equal(instructions.some(op => op.opcode === 'Column' && tableCursors.includes(op.p1)), false, `Must read the index rather than the PDF-containing table: ${sql}`);
      assert.match(db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...bindings).map(op => op.detail).join('\n'), /USING (?:COVERING )?INDEX/);
    }
  } finally { db.close(); }
});

test('notes load and autosave never read or rewrite the PDF-containing table record', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON');
    const queries = [];
    let response;
    const books = createBooks({
      db: { exec: sql => db.exec(sql), prepare: sql => { queries.push(sql); return db.prepare(sql); } },
      send: (_res, _status, body) => { response = body; },
      inspect: async () => ({ pages: 2, thumbnail: Buffer.from('cover') }),
    });
    const pdf = Buffer.from('%PDF-' + 'x'.repeat(20 * 1024 * 1024));
    const book = await books.add(pdf, 'Large book with notes', []);
    db.exec(`CREATE TRIGGER prevent_pdf_rewrite BEFORE UPDATE ON books BEGIN
      SELECT RAISE(FAIL, 'A note save must not rewrite the PDF record'); END;`);
    queries.length = 0;
    const url = new URL(`https://pixelware.test/api/admin/books/${book.id}/notes`);
    const markdown = '# Small note\n\nChanged without rewriting a large book.';
    const request = Readable.from([Buffer.from(JSON.stringify({ markdown }))]); request.method = 'PATCH'; request.headers = { 'content-type': 'application/json' };
    await books.adminRoute(request, {}, url);
    assert.deepEqual(response, { hasNotes: true });
    await books.adminRoute({ method: 'GET' }, {}, url);
    assert.deepEqual(response, { markdown });
    assert.equal(books.list()[0].hasNotes, true);
    const tableRoot = db.prepare("SELECT rootpage FROM sqlite_schema WHERE name = 'books' AND type = 'table'").get().rootpage;
    for (const sql of queries.filter(sql => /^SELECT /.test(sql))) {
      const bindings = sql.includes('?') ? [book.id] : [];
      const instructions = db.prepare(`EXPLAIN ${sql}`).all(...bindings);
      const cursors = instructions.filter(op => op.opcode === 'OpenRead' && op.p2 === tableRoot).map(op => op.p1);
      assert.equal(instructions.some(op => op.opcode === 'Column' && cursors.includes(op.p1)), false, `Notes must not traverse the PDF: ${sql}`);
    }
    assert.deepEqual(Buffer.from(db.prepare('SELECT pdf FROM books WHERE id = ?').get(book.id).pdf), pdf);
    await books.adminRoute({ method: 'DELETE' }, {}, new URL(`https://pixelware.test/api/admin/books/${book.id}`));
    assert.equal(db.prepare('SELECT count(*) AS count FROM book_notes').get().count, 0);
  } finally { db.close(); }
});

test('legacy notes migrate once, preserving text and PDFs without resurrecting cleared notes', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    // Reproduce the previous schema, including its covering metadata index.
    const options = { db, send: () => {}, inspect: async () => ({ pages: 2, thumbnail: Buffer.from('cover') }) };
    const original = createBooks(options);
    const pdf = Buffer.from('%PDF-legacy book');
    const book = await original.add(pdf, 'Existing notes', []);
    db.exec('DROP TABLE book_notes; DROP INDEX books_metadata; CREATE INDEX books_metadata ON books (id, name COLLATE NOCASE, tags_json, pages, size, created_at, bookmark_page, completed, (length(trim(notes_markdown)) > 0));');
    const markdown = '  # Existing notes\n\n```cpp\nint value = 1;\n```\n';
    db.prepare('UPDATE books SET notes_markdown = ? WHERE id = ?').run(markdown, book.id);
    let response;
    const books = createBooks({ ...options, send: (_res, _status, body) => { response = body; } });
    const url = new URL(`https://pixelware.test/api/admin/books/${book.id}/notes`);
    await books.adminRoute({ method: 'GET' }, {}, url);
    assert.deepEqual(response, { markdown });
    assert.equal(books.list()[0].hasNotes, true);
    const request = Readable.from([Buffer.from(JSON.stringify({ markdown: '' }))]); request.method = 'PATCH'; request.headers = { 'content-type': 'application/json' };
    await books.adminRoute(request, {}, url);
    const restarted = createBooks({ ...options, send: (_res, _status, body) => { response = body; } });
    await restarted.adminRoute({ method: 'GET' }, {}, url);
    assert.deepEqual(response, { markdown: '' });
    assert.equal(restarted.list()[0].hasNotes, false);
    assert.equal(db.prepare('SELECT notes_markdown FROM books WHERE id = ?').get(book.id).notes_markdown, markdown);
    assert.deepEqual(Buffer.from(db.prepare('SELECT pdf FROM books WHERE id = ?').get(book.id).pdf), pdf);
  } finally { db.close(); }
});

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
  return { base, request, login, upload, close };
}

test('the PDF reader serves local worker assets with scoped permissions and no private book data', async t => {
  const app = await fixture(t);
  const reader = await fetch(`${app.base}/admin/book-reader`);
  assert.equal(reader.status, 200);
  assert.match(reader.headers.get('content-security-policy'), /worker-src 'self'/);
  assert.match(await reader.text(), /Dark mode/);
  const admin = await fetch(`${app.base}/admin`);
  assert.doesNotMatch(admin.headers.get('content-security-policy'), /wasm-unsafe-eval|worker-src/);
  const worker = await fetch(`${app.base}/admin/pdfjs/build/pdf.worker.mjs`, { method: 'HEAD' });
  assert.equal(worker.status, 200);
  assert.match(worker.headers.get('content-type'), /javascript/);
  assert.ok(Number(worker.headers.get('content-length')) > 0);
  assert.equal((await worker.arrayBuffer()).byteLength, 0);
  assert.equal((await fetch(`${app.base}/admin/pdfjs/package.json`)).status, 404);
  assert.equal((await app.request('books')).status, 401);
});

test('PDFs and covers are private; all book mutations require origin, CSRF, and correct content type', async t => {
  const app = await fixture(t);
  assert.equal((await app.request('books')).status, 401);
  assert.equal((await app.upload()).status, 401);
  await app.login();
  const response = await app.upload(); assert.equal(response.status, 201, await response.clone().text());
  const { book } = await response.json();
  assert.equal((await app.request(`books/${book.id}`, { anonymous: true })).status, 401);
  const metadata = await (await app.request(`books/${book.id}`)).json();
  assert.equal(metadata.book.id, book.id);
  assert.equal(metadata.book.name, book.name);
  assert.equal(Object.hasOwn(metadata.book, 'pdf'), false);
  assert.equal(Object.hasOwn(metadata.book, 'notes_markdown'), false);
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

test('first-page thumbnails respect the front-cover CropBox, including offset and negative MediaBoxes', async t => {
  const app = await fixture(t); await app.login();
  for (const [index, spec] of [
    { mediaBox: [0, 0, 1224, 792], cropBox: [612, 0, 1224, 792], content: '1 0 0 rg 0 0 1224 792 re f 0 0 1 rg 612 0 612 792 re f' },
    { mediaBox: [-104, -7, 1323, 870], cropBox: [670, 36, 1282, 828], content: '1 0 0 rg -104 -7 1427 877 re f 0 0 1 rg 670 36 612 792 re f' },
  ].entries()) {
    const pdf = bookPdf(`Wraparound cover ${index}`, spec);
    const uploaded = await app.upload(pdf, `Wraparound cover ${index}`);
    assert.equal(uploaded.status, 201, await uploaded.clone().text());
    const { book } = await uploaded.json();
    const response = await app.request(`books/${book.id}/thumbnail`);
    const { data, info } = await sharp(Buffer.from(await response.arrayBuffer())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.height, 240);
    assert.ok(Math.abs(info.width / info.height - 612 / 792) < 0.01, 'The thumbnail must be the portrait front cover, not the landscape spread.');
    for (const [x, y] of [[5, 5], [info.width - 6, info.height - 6], [Math.floor(info.width / 2), Math.floor(info.height / 2)]]) {
      const offset = (y * info.width + x) * info.channels;
      assert.deepEqual([...data.subarray(offset, offset + 3)], [0, 0, 255], 'Only the blue front cover should be visible; the red back cover is outside the CropBox.');
    }
    assert.equal(book.pages, 2);
    assert.deepEqual(Buffer.from(await (await app.request(`books/${book.id}/pdf`)).arrayBuffer()), pdf);
  }
});

test('invalid PDFs, duplicate uploads, and invalid metadata leave the library unchanged', async t => {
  const app = await fixture(t); await app.login();
  for (const pdf of [Buffer.from('not a pdf'), Buffer.from('%PDF-1.4\nbroken')]) assert.equal((await app.upload(pdf)).status, 400);
  for (const [name, tags] of [['', []], ['Book', ['']], ['Book', 'C++'], ['Book', Array(21).fill('C++')]]) assert.equal((await app.upload(bookPdf(), name, tags)).status, 400);
  const results = await Promise.all([app.upload(), app.upload()]); assert.deepEqual(results.map(result => result.status).sort(), [201,409]);
  const { books } = await (await app.request('books')).json(); assert.equal(books.length, 1);
  assert.equal((await app.request(`books/${books[0].id}`, { method: 'PATCH', body: { name: 'Book', tags: ['x'.repeat(61)] } })).status, 400);
});

test('bookmarks validate PDF page bounds, stay private, and survive metadata edits and clearing', async t => {
  const app = await fixture(t); await app.login();
  const { book } = await (await app.upload()).json();
  assert.equal(book.bookmarkPage, null);
  const path = `books/${book.id}/bookmark`;
  const patch = (body, options = {}) => app.request(path, { method: 'PATCH', body, ...options });
  assert.equal((await patch({ page: 2 }, { anonymous: true })).status, 401);
  for (const headers of [{ Origin: 'https://evil.test' }, { 'X-CSRF-Token': '' }]) assert.equal((await patch({ page: 2 }, { headers })).status, 403);
  for (const body of [{}, { page: 0 }, { page: 3 }, { page: -1 }, { page: 1.5 }, { page: '2' }, { page: true }, { page: 2, name: 'Unexpected rename' }]) assert.equal((await patch(body)).status, 400);
  assert.equal((await app.request(path)).status, 405, 'The bookmark route must not accidentally serve a thumbnail');
  const saved = await patch({ page: 2 }); assert.equal(saved.status, 200); assert.equal((await saved.json()).book.bookmarkPage, 2);
  await app.request(`books/${book.id}`, { method: 'PATCH', body: { name: 'Renamed book', tags: ['Concurrency'] } });
  let data = await (await app.request('books')).json(); assert.equal(data.books[0].bookmarkPage, 2); assert.equal(data.books[0].name, 'Renamed book');
  assert.deepEqual(Buffer.from(await (await app.request(`books/${book.id}/pdf?download=1`)).arrayBuffer()), bookPdf());
  assert.equal((await patch({ page: 1 })).status, 200);
  assert.equal((await patch({ page: null })).status, 200);
  data = await (await app.request('books')).json(); assert.equal(data.books[0].bookmarkPage, null);
});

test('completion validates input, stays private, and changes independently of other book details', async t => {
  const app = await fixture(t); await app.login();
  const { book } = await (await app.upload()).json();
  const { book: other } = await (await app.upload(bookPdf('Other'), 'Other')).json();
  assert.equal(book.completed, false);
  const path = `books/${book.id}/completion`;
  const patch = (body, options = {}) => app.request(path, { method: 'PATCH', body, ...options });
  assert.equal((await patch({ completed: true }, { anonymous: true })).status, 401);
  for (const headers of [{ Origin: 'https://evil.test' }, { 'X-CSRF-Token': '' }]) assert.equal((await patch({ completed: true }, { headers })).status, 403);
  for (const body of [{}, { completed: 1 }, { completed: null }, { completed: 'true' }, { completed: true, name: 'Unexpected rename' }]) assert.equal((await patch(body)).status, 400);
  assert.equal((await app.request(path)).status, 405);
  for (let attempt = 0; attempt < 2; attempt++) {
    const saved = await patch({ completed: true });
    assert.equal(saved.status, 200); assert.equal((await saved.json()).book.completed, true);
  }
  await app.request(`books/${book.id}`, { method: 'PATCH', body: { name: 'Completed book', tags: ['Read'] } });
  await app.request(`books/${book.id}/bookmark`, { method: 'PATCH', body: { page: 2 } });
  await app.request(`books/${book.id}/notes`, { method: 'PATCH', body: { markdown: '# Finished reading' } });
  let books = (await (await app.request('books')).json()).books;
  assert.equal(books.find(item => item.id === book.id).completed, true);
  assert.equal(books.find(item => item.id === other.id).completed, false);
  const cleared = await patch({ completed: false });
  assert.equal(cleared.status, 200);
  const updated = (await cleared.json()).book;
  assert.equal(updated.completed, false); assert.equal(updated.name, 'Completed book');
  assert.deepEqual(updated.tags, ['Read']); assert.equal(updated.bookmarkPage, 2); assert.equal(updated.hasNotes, true);
  assert.deepEqual(await (await app.request(`books/${book.id}/notes`)).json(), { markdown: '# Finished reading' });
  assert.deepEqual(Buffer.from(await (await app.request(`books/${book.id}/pdf`)).arrayBuffer()), bookPdf());
  await app.request(`books/${book.id}`, { method: 'DELETE', body: {} });
  assert.equal((await patch({ completed: true })).status, 404);
});

test('migration preserves existing PDFs and book reading state persists across server restarts', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pixelware-book-migration-'));
  const database = join(directory, 'admin.sqlite'); const pdf = bookPdf('Existing book');
  const id = '11111111-1111-4111-8111-111111111111';
  const legacy = new DatabaseSync(database);
  legacy.exec(`CREATE TABLE books (id TEXT PRIMARY KEY, name TEXT NOT NULL, tags_json TEXT NOT NULL, pages INTEGER NOT NULL,
    size INTEGER NOT NULL, sha256 TEXT NOT NULL UNIQUE, pdf BLOB NOT NULL, thumbnail BLOB NOT NULL, created_at TEXT NOT NULL) STRICT;`);
  legacy.prepare('INSERT INTO books VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, 'Existing book', '["C++"]', 2, pdf.length, createHash('sha256').update(pdf).digest('hex'), pdf, Buffer.from('original thumbnail'), new Date().toISOString());
  legacy.close();
  let app, restarted;
  t.after(async () => { await app?.close(); await restarted?.close(); await rm(directory, { recursive: true, force: true }); });
  app = await fixture(t, database); await app.login();
  let data = await (await app.request('books')).json(); assert.equal(data.books[0].bookmarkPage, null); assert.deepEqual(data.books[0].tags, ['C++']);
  assert.equal(data.books[0].hasNotes, false);
  assert.equal(data.books[0].completed, false);
  assert.deepEqual(await (await app.request(`books/${id}/notes`)).json(), { markdown: '' });
  assert.equal((await app.request(`books/${id}/notes`, { method: 'PATCH', body: { markdown: '# Existing book notes' } })).status, 200);
  assert.equal((await app.request(`books/${id}/bookmark`, { method: 'PATCH', body: { page: 2 } })).status, 200);
  assert.equal((await app.request(`books/${id}/completion`, { method: 'PATCH', body: { completed: true } })).status, 200);
  assert.equal((await app.upload(bookPdf('New book after migration'), 'New book')).status, 201);
  await app.close(); restarted = await fixture(t, database); await restarted.login();
  data = await (await restarted.request('books')).json(); assert.equal(data.books.find(book => book.id === id).bookmarkPage, 2);
  assert.equal(data.books.find(book => book.id === id).hasNotes, true);
  assert.equal(data.books.find(book => book.id === id).completed, true);
  assert.equal(data.books.find(book => book.name === 'New book').completed, false);
  assert.deepEqual(await (await restarted.request(`books/${id}/notes`)).json(), { markdown: '# Existing book notes' });
  assert.equal(data.books.find(book => book.name === 'New book').bookmarkPage, null);
  assert.deepEqual(Buffer.from(await (await restarted.request(`books/${id}/pdf`)).arrayBuffer()), pdf);
  assert.equal((await restarted.request(`books/${id}`, { method: 'DELETE', body: {} })).status, 200);
  assert.equal((await restarted.request(`books/${id}/bookmark`, { method: 'PATCH', body: { page: 1 } })).status, 404);
  assert.equal((await restarted.request(`books/${id}/notes`)).status, 404);
});

test('book notes are private, validate input, render safe Markdown, and clear independently', async t => {
  const app = await fixture(t); await app.login();
  const { book } = await (await app.upload()).json();
  const { book: other } = await (await app.upload(bookPdf('Other book'), 'Other book')).json();
  const path = `books/${book.id}/notes`;
  for (const [suffix, method] of [['', 'GET'], ['', 'PATCH'], ['/preview', 'POST']]) {
    assert.equal((await app.request(path + suffix, { method, anonymous: true, ...(method !== 'GET' ? { body: { markdown: '' } } : {}) })).status, 401);
    if (method === 'GET') continue;
    for (const headers of [{ Origin: 'https://evil.test' }, { 'X-CSRF-Token': '' }]) {
      assert.equal((await app.request(path + suffix, { method, headers, body: { markdown: '' } })).status, 403);
    }
  }
  const markdown = '# Takeaways\n\n**Useful** and ++underlined++\n\n- [x] Read chapter one\n\n<script>alert(1)</script>\n\n[Unsafe](javascript:alert(1))';
  assert.equal((await app.request(path, { method: 'PATCH', body: { markdown } })).status, 200);
  assert.deepEqual(await (await app.request(path)).json(), { markdown });
  assert.deepEqual(await (await app.request(`books/${other.id}/notes`)).json(), { markdown: '' });
  const preview = await app.request(`${path}/preview`, { method: 'POST', body: { markdown } });
  const { html } = await preview.json();
  assert.match(html, /<h1>Takeaways<\/h1>/); assert.match(html, /<strong>Useful<\/strong>/); assert.match(html, /<u>underlined<\/u>/);
  assert.match(html, /blog-task-check/); assert.doesNotMatch(html, /<script|href="javascript:/);
  for (const body of [{}, { markdown: null }, { markdown: 123 }, { markdown: 'x'.repeat(100001) }, { markdown: '', name: 'Overwrite' }]) {
    assert.equal((await app.request(path, { method: 'PATCH', body })).status, 400);
    assert.equal((await app.request(`${path}/preview`, { method: 'POST', body })).status, 400);
  }
  await app.request(`books/${book.id}`, { method: 'PATCH', body: { name: 'Renamed', tags: ['Notes'] } });
  await app.request(`books/${book.id}/bookmark`, { method: 'PATCH', body: { page: 2 } });
  assert.deepEqual(await (await app.request(path)).json(), { markdown });
  let books = (await (await app.request('books')).json()).books;
  assert.equal(books.find(item => item.id === book.id).hasNotes, true);
  assert.equal(Object.hasOwn(books[0], 'markdown'), false);
  assert.equal((await app.request(path, { method: 'PATCH', body: { markdown: '' } })).status, 200);
  books = (await (await app.request('books')).json()).books;
  const cleared = books.find(item => item.id === book.id);
  assert.equal(cleared.hasNotes, false); assert.equal(cleared.name, 'Renamed'); assert.equal(cleared.bookmarkPage, 2);
  assert.deepEqual(await (await app.request(path)).json(), { markdown: '' });
});
