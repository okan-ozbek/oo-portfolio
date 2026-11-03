import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import { createBooks } from '../server/books.mjs';
import { createResumes } from '../server/resumes.mjs';
import { createAssetServer } from '../server/assets.mjs';
import { createLazyWorkspace } from '../server/admin/lazy-workspace.js';

const response = () => ({ headers: {}, setHeader(name, value) { this.headers[name] = value; }, removeHeader() {}, writeHead(status, headers = {}) { this.status = status; Object.assign(this.headers, headers); }, end(body) { this.body = body; } });
const patch = body => Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { method: 'PATCH', headers: { 'content-type': 'application/json' } });

test('book state migrates once and edits cannot rewrite the PDF row', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON');
    const options = { db, send: () => {}, inspect: async () => ({ pages: 3, thumbnail: Buffer.from('cover') }) };
    let books = createBooks(options);
    const book = await books.add(Buffer.from('%PDF-' + 'x'.repeat(20 * 1024 * 1024)), 'Original', ['Old']);
    db.exec('DROP TABLE book_state');
    db.prepare('UPDATE books SET bookmark_page=2, completed=1 WHERE id=?').run(book.id);
    books = createBooks(options);
    assert.equal(books.list()[0].bookmarkPage, 2); assert.equal(books.list()[0].completed, true);
    db.exec("CREATE TRIGGER no_pdf_rewrite BEFORE UPDATE ON books BEGIN SELECT RAISE(FAIL, 'PDF rewrite'); END");
    const url = suffix => new URL(`https://example.test/api/admin/books/${book.id}${suffix}`);
    await books.adminRoute(patch({ page: null }), {}, url('/bookmark'));
    await books.adminRoute(patch({ completed: false }), {}, url('/completion'));
    await books.adminRoute(patch({ name: 'Renamed', tags: ['New'] }), {}, url(''));
    books = createBooks(options);
    const saved = books.list()[0];
    assert.equal(saved.bookmarkPage, null); assert.equal(saved.completed, false); assert.equal(saved.name, 'Renamed'); assert.deepEqual(saved.tags, ['New']);
    assert.equal(db.prepare('SELECT name FROM books WHERE id=?').get(book.id).name, 'Original');
    await books.adminRoute({ method: 'DELETE' }, {}, url(''));
    assert.equal(db.prepare('SELECT count(*) AS n FROM book_state').get().n, 0);
  } finally { db.close(); }
});

test('cached resume thumbnails, metadata, and HEAD requests avoid PDF payload reads', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const queries = [];
    const resumes = createResumes({ db: { exec: sql => db.exec(sql), prepare: sql => { queries.push(sql); return db.prepare(sql); } }, origin: 'https://example.test', now: Date.now, send: () => {} });
    const id = '11111111-1111-4111-8111-111111111111';
    db.prepare(`INSERT INTO resumes(id,name,slug,main_file,files_json,scan_json,original_pdf,draft_pdf,pages,created_at,compiled_at)
      VALUES(?, 'Fixture', 'fixture', 'main.tex', '[]', '[]', zeroblob(20971520), zeroblob(20971520), 2, '2026-11-03', '2026-11-03')`).run(id);
    db.prepare('INSERT INTO resume_thumbnails VALUES(?,?,?)').run(id, 'version:1', Buffer.from('cached PNG'));
    db.prepare('UPDATE resume_settings SET default_resume_id=?').run(id);
    queries.length = 0;
    const thumbnail = response();
    await resumes.adminRoute({ method: 'GET', headers: {} }, thumbnail, new URL(`https://example.test/api/admin/resumes/${id}/thumbnail`));
    assert.deepEqual(Buffer.from(thumbnail.body), Buffer.from('cached PNG'));
    await resumes.publicRoute({ method: 'GET', headers: {} }, response(), new URL('https://example.test/api/public/resume'));
    const head = response();
    await resumes.publicRoute({ method: 'HEAD', headers: {}, url: '/resume.pdf' }, head, new URL('https://example.test/resume.pdf'));
    assert.equal(head.headers['Content-Length'], 20971520); assert.equal(head.body, undefined);
    assert.equal(queries.some(sql => /SELECT \*|SELECT (?:draft_pdf|original_pdf|published_pdf)/.test(sql)), false);
    const tableRoot = db.prepare("SELECT rootpage FROM sqlite_schema WHERE type='table' AND name='resumes'").get().rootpage;
    for (const sql of queries.filter(sql => sql.includes('FROM resumes INDEXED'))) {
      const instructions = db.prepare(`EXPLAIN ${sql}`).all(id);
      const cursors = instructions.filter(op => op.opcode === 'OpenRead' && op.p2 === tableRoot).map(op => op.p1);
      assert.equal(instructions.some(op => op.opcode === 'Column' && cursors.includes(op.p1)), false);
    }
  } finally { db.close(); }
});

test('public assets revalidate, keep bounded memory, and remain fresh during development', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pixelware-assets-'));
  try {
    const file = pathToFileURL(join(directory, 'entry.js')), other = pathToFileURL(join(directory, 'other.js'));
    await writeFile(file, 'old'); await writeFile(other, 'two');
    const serve = createAssetServer({ maxBytes: 5 });
    const first = response(); await serve({ method: 'GET', headers: {} }, first, file, 'text/javascript');
    const cached = response(); await serve({ method: 'GET', headers: { 'if-none-match': `W/${first.headers.ETag}` } }, cached, file, 'text/javascript');
    assert.equal(cached.status, 304); assert.equal(cached.body, undefined);
    await writeFile(file, 'new');
    const hit = response(); await serve({ method: 'GET', headers: {} }, hit, file, 'text/javascript'); assert.equal(hit.body.toString(), 'old');
    await serve({ method: 'GET', headers: {} }, response(), other, 'text/javascript');
    const evicted = response(); await serve({ method: 'GET', headers: {} }, evicted, file, 'text/javascript'); assert.equal(evicted.body.toString(), 'new');
    const dev = createAssetServer({ development: true });
    const before = response(); await dev({ method: 'GET', headers: {} }, before, file, 'text/javascript');
    await writeFile(file, 'edited');
    const after = response(); await dev({ method: 'HEAD', headers: { 'if-none-match': before.headers.ETag } }, after, file, 'text/javascript');
    assert.equal(after.status, 200); assert.notEqual(after.headers.ETag, before.headers.ETag); assert.equal(after.body, undefined); assert.equal(after.headers['Content-Length'], 6);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('workspace loading is shared, retains editor instances, and retries failed imports', async () => {
  let attempts = 0, initialized = 0, resets = 0;
  const instance = { reset: () => resets++, leave: () => false };
  const workspace = createLazyWorkspace(async () => { if (++attempts === 1) throw new Error('Network unavailable'); return () => { initialized++; return instance; }; }, {});
  assert.equal(attempts, 0); workspace.reset(); assert.equal(resets, 0);
  await assert.rejects(workspace.get(), /Network unavailable/);
  const [first, second] = await Promise.all([workspace.get(), workspace.get()]);
  assert.equal(first, second); assert.equal(await workspace.get(), instance); assert.equal(initialized, 1); assert.equal(attempts, 2);
  assert.equal(workspace.leave(), false); workspace.reset(); assert.equal(resets, 1);
});
