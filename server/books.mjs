import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { HttpError, readJson } from './http.mjs';
import { renderMarkdown } from './blog-markdown.mjs';

const run = promisify(execFile);
export const MAX_BOOK_BYTES = 100 * 1024 * 1024;
const MAX_NOTE_LENGTH = 100000;

async function readNote(req) {
  const body = await readJson(req, 650000);
  if (Object.keys(body).length !== 1 || typeof body.markdown !== 'string' || body.markdown.length > MAX_NOTE_LENGTH) {
    throw new HttpError(400, `Use a Markdown note of up to ${MAX_NOTE_LENGTH.toLocaleString('en-US')} characters.`);
  }
  return body.markdown;
}

export function bookIdentity(name, tags = []) {
  if (typeof name !== 'string' || !name.trim() || name.length > 200) throw new HttpError(400, 'Enter a book name of 1–200 characters.');
  if (!Array.isArray(tags) || tags.length > 20 || tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 60)) {
    throw new HttpError(400, 'Use up to 20 tags, each with 1–60 characters.');
  }
  const unique = new Map();
  for (const tag of tags) if (!unique.has(tag.trim().toLowerCase())) unique.set(tag.trim().toLowerCase(), tag.trim());
  return { name: name.trim(), tags: [...unique.values()] };
}

// Poppler inspects the actual PDF; neither page count nor cover comes from the browser.
export async function inspectBook(pdf) {
  const directory = await mkdtemp(join(tmpdir(), 'pixelware-book-'));
  try {
    const input = join(directory, 'book.pdf');
    await writeFile(input, pdf, { mode: 0o600 });
    const { stdout } = await run('pdfinfo', [input], { timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true, env: { ...process.env, LC_ALL: 'C', LANG: 'C' } });
    const pages = Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1]);
    if (!Number.isSafeInteger(pages) || pages < 1 || /^Encrypted:\s+yes/m.test(stdout)) throw new HttpError(400, 'Upload an unencrypted PDF with at least one page.');
    // Print-ready ebooks can keep the entire back/spine/front spread in the
    // MediaBox while their CropBox selects the front cover shown by PDF viewers.
    await run('pdftoppm', ['-f', '1', '-l', '1', '-singlefile', '-cropbox', '-scale-to', '240', '-png', input, join(directory, 'cover')], { timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true });
    const thumbnail = await readFile(join(directory, 'cover.png'));
    return { pages, thumbnail };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error.code === 'ENOENT') throw new HttpError(503, 'PDF tools are unavailable. Install Poppler (pdfinfo and pdftoppm) on the admin server.');
    throw new HttpError(400, 'This PDF could not be read. Upload a valid, unencrypted PDF.');
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export function createBooks({ db, now = Date.now, send, inspect = inspectBook }) {
  db.exec(`CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, tags_json TEXT NOT NULL,
    pages INTEGER NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL UNIQUE,
    pdf BLOB NOT NULL, thumbnail BLOB NOT NULL, created_at TEXT NOT NULL,
    bookmark_page INTEGER CHECK(bookmark_page >= 1)
  ) STRICT;`);
  if (!db.prepare('PRAGMA table_info(books)').all().some(column => column.name === 'bookmark_page')) {
    db.exec('ALTER TABLE books ADD COLUMN bookmark_page INTEGER CHECK(bookmark_page >= 1)');
  }
  if (!db.prepare('PRAGMA table_info(books)').all().some(column => column.name === 'notes_markdown')) {
    db.exec("ALTER TABLE books ADD COLUMN notes_markdown TEXT NOT NULL DEFAULT ''");
  }
  if (!db.prepare('PRAGMA table_info(books)').all().some(column => column.name === 'completed')) {
    db.exec('ALTER TABLE books ADD COLUMN completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1))');
  }
  let processing = 0;
  const fields = "id, name, tags_json, pages, size, created_at, bookmark_page, completed, (length(trim(notes_markdown)) > 0) AS has_notes";
  const metadata = row => ({ id: row.id, name: row.name, tags: JSON.parse(row.tags_json), pages: row.pages, size: row.size, createdAt: row.created_at, bookmarkPage: row.bookmark_page, completed: Boolean(row.completed), hasNotes: Boolean(row.has_notes) });
  function list() { return db.prepare(`SELECT ${fields} FROM books ORDER BY name COLLATE NOCASE, id`).all().map(metadata); }
  function canonicalTags(tags) {
    const existing = new Map(list().flatMap(book => book.tags).map(tag => [tag.toLowerCase(), tag]));
    return tags.map(tag => existing.get(tag.toLowerCase()) ?? tag);
  }
  async function add(pdf, name, tags) {
    const identity = bookIdentity(name, tags);
    if (!Buffer.isBuffer(pdf) || pdf.length > MAX_BOOK_BYTES) throw new HttpError(413, 'Choose a PDF up to 100 MB.');
    if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new HttpError(400, 'Choose a valid PDF file.');
    const hash = createHash('sha256').update(pdf).digest('hex');
    const duplicate = () => db.prepare('SELECT id FROM books WHERE sha256 = ?').get(hash);
    if (duplicate()) throw new HttpError(409, 'This PDF is already in your library.');
    if (processing >= 2) throw new HttpError(429, 'Two PDFs are already processing. Try again shortly.');
    processing++;
    try {
      const { pages, thumbnail } = await inspect(pdf);
      if (duplicate()) throw new HttpError(409, 'This PDF is already in your library.');
      const id = randomUUID();
      db.prepare('INSERT INTO books (id, name, tags_json, pages, size, sha256, pdf, thumbnail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, identity.name, JSON.stringify(canonicalTags(identity.tags)), pages, pdf.length, hash, pdf, thumbnail, new Date(now()).toISOString());
      return metadata(db.prepare(`SELECT ${fields} FROM books WHERE id = ?`).get(id));
    } finally { processing--; }
  }
  async function adminRoute(req, res, url) {
    if (url.pathname === '/api/admin/books') {
      if (req.method === 'GET') {
        const books = list();
        const tag = url.searchParams.get('tag')?.toLowerCase();
        send(res, 200, { books: tag ? books.filter(book => book.tags.some(value => value.toLowerCase() === tag)) : books, tags: [...new Set(books.flatMap(book => book.tags))].sort((a, b) => a.localeCompare(b)) });
        return true;
      }
      if (req.method === 'POST') {
        let tags;
        try { tags = JSON.parse(url.searchParams.get('tags') ?? '[]'); } catch { throw new HttpError(400, 'Invalid tags.'); }
        const name = url.searchParams.get('name');
        bookIdentity(name, tags);
        if (Number(req.headers['content-length']) > MAX_BOOK_BYTES) throw new HttpError(413, 'Choose a PDF up to 100 MB.');
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > MAX_BOOK_BYTES) throw new HttpError(413, 'Choose a PDF up to 100 MB.');
          chunks.push(chunk);
        }
        const book = await add(Buffer.concat(chunks), name, tags);
        send(res, 201, { book });
        return true;
      }
    }
    const match = /^\/api\/admin\/books\/([a-f0-9-]{36})(?:\/(pdf|thumbnail|bookmark|completion|notes|notes\/preview))?$/.exec(url.pathname);
    if (!match) return false;
    const [, id, asset] = match;
    const row = db.prepare(`SELECT ${fields} FROM books WHERE id = ?`).get(id);
    if (!row) throw new HttpError(404, 'Book not found.');
    if (asset === 'completion' && req.method === 'PATCH') {
      const body = await readJson(req);
      if (Object.keys(body).length !== 1 || typeof body.completed !== 'boolean') {
        throw new HttpError(400, 'Choose whether the book is complete.');
      }
      db.prepare('UPDATE books SET completed = ? WHERE id = ?').run(Number(body.completed), id);
      send(res, 200, { book: metadata(db.prepare(`SELECT ${fields} FROM books WHERE id = ?`).get(id)) });
      return true;
    }
    if (asset === 'notes' && req.method === 'GET') {
      send(res, 200, { markdown: db.prepare('SELECT notes_markdown FROM books WHERE id = ?').get(id).notes_markdown });
      return true;
    }
    if (asset === 'notes' && req.method === 'PATCH') {
      const markdown = await readNote(req);
      db.prepare('UPDATE books SET notes_markdown = ? WHERE id = ?').run(markdown, id);
      send(res, 200, { hasNotes: Boolean(markdown.trim()) });
      return true;
    }
    if (asset === 'notes/preview' && req.method === 'POST') {
      send(res, 200, { html: renderMarkdown(await readNote(req)) });
      return true;
    }
    if (asset === 'bookmark' && req.method === 'PATCH') {
      const body = await readJson(req);
      if (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'page') || (body.page !== null && (!Number.isSafeInteger(body.page) || body.page < 1 || body.page > row.pages))) {
        throw new HttpError(400, `Choose a PDF page between 1 and ${row.pages}, or clear the bookmark.`);
      }
      db.prepare('UPDATE books SET bookmark_page = ? WHERE id = ?').run(body.page, id);
      send(res, 200, { book: metadata(db.prepare(`SELECT ${fields} FROM books WHERE id = ?`).get(id)) });
      return true;
    }
    if (['pdf', 'thumbnail'].includes(asset) && ['GET', 'HEAD'].includes(req.method)) {
      const body = db.prepare(`SELECT ${asset === 'pdf' ? 'pdf' : 'thumbnail'} AS body FROM books WHERE id = ?`).get(id).body;
      const download = url.searchParams.get('download') === '1';
      // As with resumes, CSP sandbox prevents Chromium's native PDF viewer loading.
      if (asset === 'pdf') {
        res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
        res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="book.pdf"; filename*=UTF-8''${encodeURIComponent(row.name + '.pdf').replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16))}`);
        res.setHeader('Accept-Ranges', 'bytes');
      }
      let start = 0, end = body.length - 1, status = 200;
      if (asset === 'pdf' && req.headers.range) {
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (!range || (!range[1] && !range[2])) { res.setHeader('Content-Range', `bytes */${body.length}`); throw new HttpError(416, 'Invalid byte range.'); }
        start = range[1] ? Number(range[1]) : Math.max(0, body.length - Number(range[2]));
        end = range[1] && range[2] ? Math.min(Number(range[2]), end) : end;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= body.length) { res.setHeader('Content-Range', `bytes */${body.length}`); throw new HttpError(416, 'Invalid byte range.'); }
        status = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${body.length}`);
      }
      res.writeHead(status, { 'Content-Type': asset === 'pdf' ? 'application/pdf' : 'image/png', 'Content-Length': end - start + 1 });
      res.end(req.method === 'HEAD' ? undefined : body.subarray(start, end + 1));
      return true;
    }
    if (!asset && req.method === 'PATCH') {
      const body = await readJson(req);
      const identity = bookIdentity(body.name, body.tags);
      db.prepare('UPDATE books SET name = ?, tags_json = ? WHERE id = ?').run(identity.name, JSON.stringify(canonicalTags(identity.tags)), id);
      send(res, 200, { book: metadata(db.prepare(`SELECT ${fields} FROM books WHERE id = ?`).get(id)) });
      return true;
    }
    if (!asset && req.method === 'DELETE') {
      db.prepare('DELETE FROM books WHERE id = ?').run(id);
      send(res, 200, { ok: true });
      return true;
    }
    throw new HttpError(405, 'Method not allowed.');
  }
  return { add, list, adminRoute };
}
