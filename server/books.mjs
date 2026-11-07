import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { HttpError, readJson } from './http.mjs';
import { renderMarkdown, renderNoteMarkdown } from './blog-markdown.mjs';

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
  // Notes must not share a record with the PDF: reading later columns walks its
  // overflow pages, and even a tiny autosave rewrites the entire PDF synchronously.
  // Copy legacy notes once, atomically. Keep the old column untouched so migration
  // never rewrites the PDFs, and never import it again after notes are edited/cleared.
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'book_notes'").get()) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`CREATE TABLE book_notes (
        book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
        markdown TEXT NOT NULL
      ) STRICT;
      INSERT INTO book_notes (book_id, markdown)
        SELECT id, notes_markdown FROM books WHERE notes_markdown <> '';`);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  // Metadata and covers follow large PDF blobs in the table records. Reading
  // those later columns otherwise walks the PDF's SQLite overflow pages.
  // Keep compact covering indexes for the library's hot paths instead.
  db.exec(`CREATE INDEX IF NOT EXISTS books_metadata ON books (
    id, name COLLATE NOCASE, tags_json, pages, size, created_at, bookmark_page,
    completed
  );
  CREATE INDEX IF NOT EXISTS books_thumbnails ON books (id, thumbnail);`);
  // All frequently edited state lives in a compact record. Keep legacy columns
  // untouched after the one-time copy, avoiding PDF rewrites on bookmark/tag edits.
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'book_state'").get()) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`CREATE TABLE book_state (
        id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
        name TEXT NOT NULL, tags_json TEXT NOT NULL, pages INTEGER NOT NULL,
        size INTEGER NOT NULL, created_at TEXT NOT NULL,
        bookmark_page INTEGER CHECK(bookmark_page >= 1),
        completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1))
      ) STRICT;
      INSERT INTO book_state SELECT id, name, tags_json, pages, size, created_at, bookmark_page, completed
        FROM books INDEXED BY books_metadata;
      CREATE INDEX book_state_name ON book_state (name COLLATE NOCASE, id);`);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  let processing = 0;
  db.exec(`CREATE TABLE IF NOT EXISTS book_annotations (
    id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    page INTEGER NOT NULL CHECK(page >= 1), x REAL NOT NULL CHECK(x BETWEEN 0 AND 1),
    y REAL NOT NULL CHECK(y BETWEEN 0 AND 1), markdown TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS book_annotations_book ON book_annotations (book_id, page, created_at);`);
  const annotationColumns = db.prepare('PRAGMA table_info(book_annotations)').all();
  for (const dimension of ['width', 'height']) if (!annotationColumns.some(column => column.name === dimension)) {
    db.exec(`ALTER TABLE book_annotations ADD COLUMN ${dimension} REAL CHECK(${dimension} > 0 AND ${dimension} <= 1)`);
  }
  // Rebuild only the compact annotation table; PDFs and existing note contents
  // stay untouched. Signed positions allow notes in gutters and across pages.
  if (!annotationColumns.some(column => column.name === 'layout_version')) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`CREATE TABLE book_annotations_free (
        id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        page INTEGER NOT NULL CHECK(page >= 1), x REAL NOT NULL CHECK(x BETWEEN -8 AND 8),
        y REAL NOT NULL CHECK(y BETWEEN -8 AND 8), markdown TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        width REAL CHECK(width > 0 AND width <= 4), height REAL CHECK(height > 0 AND height <= 4),
        layout_version INTEGER NOT NULL DEFAULT 2
      ) STRICT;
      INSERT INTO book_annotations_free (id, book_id, page, x, y, markdown, created_at, updated_at, width, height)
        SELECT id, book_id, page, x, y, markdown, created_at, updated_at, width, height FROM book_annotations;
      DROP TABLE book_annotations;
      ALTER TABLE book_annotations_free RENAME TO book_annotations;
      CREATE INDEX book_annotations_book ON book_annotations (book_id, page, created_at);`);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const fields = `id, name, tags_json, pages, size, created_at, bookmark_page, completed,
    (EXISTS (SELECT 1 FROM book_notes WHERE book_id = book_state.id AND length(trim(markdown)) > 0)
     OR EXISTS (SELECT 1 FROM book_annotations WHERE book_id = book_state.id)) AS has_notes`;
  const metadata = row => ({ id: row.id, name: row.name, tags: JSON.parse(row.tags_json), pages: row.pages, size: row.size, createdAt: row.created_at, bookmarkPage: row.bookmark_page, completed: Boolean(row.completed), hasNotes: Boolean(row.has_notes) });
  // This table contains compact metadata only; none of these reads visit PDFs.
  const metadataTable = 'book_state';
  const find = id => db.prepare(`SELECT ${fields} FROM ${metadataTable} WHERE id = ?`).get(id);
  function list() { return db.prepare(`SELECT ${fields} FROM ${metadataTable} ORDER BY name COLLATE NOCASE, id`).all().map(metadata); }
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
      const tagsJson = JSON.stringify(canonicalTags(identity.tags)), createdAt = new Date(now()).toISOString();
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO books (id, name, tags_json, pages, size, sha256, pdf, thumbnail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, identity.name, tagsJson, pages, pdf.length, hash, pdf, thumbnail, createdAt);
        db.prepare('INSERT INTO book_state (id, name, tags_json, pages, size, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, identity.name, tagsJson, pages, pdf.length, createdAt);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return metadata(find(id));
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
    const match = /^\/api\/admin\/books\/([a-f0-9-]{36})(?:\/(pdf|thumbnail|bookmark|completion|notes|notes\/preview|annotations(?:\/[a-f0-9-]{36})?))?$/.exec(url.pathname);
    if (!match) return false;
    const [, id, asset] = match;
    const row = find(id);
    if (!row) throw new HttpError(404, 'Book not found.');
    if (asset?.startsWith('annotations')) {
      const annotationId = asset.split('/')[1];
      const serialize = note => ({ id: note.id, page: note.page, x: note.x, y: note.y, width: note.width, height: note.height, markdown: note.markdown,
        html: renderNoteMarkdown(note.markdown), createdAt: note.created_at, updatedAt: note.updated_at });
      if (!annotationId && req.method === 'GET') {
        send(res, 200, { annotations: db.prepare('SELECT * FROM book_annotations WHERE book_id = ? ORDER BY page, created_at, id').all(id).map(serialize) });
        return true;
      }
      const annotation = annotationId ? db.prepare('SELECT * FROM book_annotations WHERE id = ? AND book_id = ?').get(annotationId, id) : null;
      if (annotationId && !annotation) throw new HttpError(404, 'PDF note not found.');
      if ((!annotationId && req.method === 'POST') || (annotationId && req.method === 'PATCH')) {
        const body = await readJson(req, 650000);
        const keys = ['page', 'x', 'y', 'markdown'];
        const width = Object.hasOwn(body, 'width') ? body.width : annotation?.width ?? null;
        const height = Object.hasOwn(body, 'height') ? body.height : annotation?.height ?? null;
        if (Object.keys(body).some(key => ![...keys, 'width', 'height'].includes(key)) || keys.some(key => !Object.hasOwn(body, key)) ||
            !((width === null && height === null) || [width, height].every(value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 4)) ||
            !Number.isSafeInteger(body.page) || body.page < 1 || body.page > row.pages ||
            ![body.x, body.y].every(value => typeof value === 'number' && Number.isFinite(value) && value >= -8 && value <= 8) ||
            typeof body.markdown !== 'string' || !body.markdown.trim() || body.markdown.length > MAX_NOTE_LENGTH) {
          throw new HttpError(400, `Choose a PDF page between 1 and ${row.pages}, a position within eight page lengths, and a nonempty Markdown note up to ${MAX_NOTE_LENGTH.toLocaleString('en-US')} characters.`);
        }
        const noteId = annotationId ?? randomUUID(), timestamp = new Date(now()).toISOString();
        if (annotationId) db.prepare('UPDATE book_annotations SET page = ?, x = ?, y = ?, width = ?, height = ?, markdown = ?, updated_at = ? WHERE id = ? AND book_id = ?')
          .run(body.page, body.x, body.y, width, height, body.markdown, timestamp, noteId, id);
        else db.prepare('INSERT INTO book_annotations (id, book_id, page, x, y, width, height, markdown, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(noteId, id, body.page, body.x, body.y, width, height, body.markdown, timestamp, timestamp);
        send(res, annotationId ? 200 : 201, { annotation: serialize(db.prepare('SELECT * FROM book_annotations WHERE id = ? AND book_id = ?').get(noteId, id)), hasNotes: true });
        return true;
      }
      if (annotationId && req.method === 'DELETE') {
        db.prepare('DELETE FROM book_annotations WHERE id = ? AND book_id = ?').run(annotationId, id);
        send(res, 200, { ok: true, hasNotes: Boolean(find(id).has_notes) });
        return true;
      }
      throw new HttpError(405, 'Method not allowed.');
    }
    if (!asset && req.method === 'GET') {
      send(res, 200, { book: metadata(row) });
      return true;
    }
    if (asset === 'completion' && req.method === 'PATCH') {
      const body = await readJson(req);
      if (Object.keys(body).length !== 1 || typeof body.completed !== 'boolean') {
        throw new HttpError(400, 'Choose whether the book is complete.');
      }
      db.prepare('UPDATE book_state SET completed = ? WHERE id = ?').run(Number(body.completed), id);
      send(res, 200, { book: metadata(find(id)) });
      return true;
    }
    if (asset === 'notes' && req.method === 'GET') {
      send(res, 200, { markdown: db.prepare('SELECT markdown FROM book_notes WHERE book_id = ?').get(id)?.markdown ?? '' });
      return true;
    }
    if (asset === 'notes' && req.method === 'PATCH') {
      const markdown = await readNote(req);
      db.prepare(`INSERT INTO book_notes (book_id, markdown) VALUES (?, ?)
        ON CONFLICT(book_id) DO UPDATE SET markdown = excluded.markdown`).run(id, markdown);
      send(res, 200, { hasNotes: Boolean(find(id).has_notes) });
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
      db.prepare('UPDATE book_state SET bookmark_page = ? WHERE id = ?').run(body.page, id);
      send(res, 200, { book: metadata(find(id)) });
      return true;
    }
    if (['pdf', 'thumbnail'].includes(asset) && ['GET', 'HEAD'].includes(req.method)) {
      if (asset === 'thumbnail') {
        const body = db.prepare('SELECT thumbnail AS body FROM books INDEXED BY books_thumbnails WHERE id = ?').get(id).body;
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': body.length });
        res.end(req.method === 'HEAD' ? undefined : body);
        return true;
      }
      const download = url.searchParams.get('download') === '1';
      // As with resumes, CSP sandbox prevents Chromium's native PDF viewer loading.
      if (asset === 'pdf') {
        res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
        res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="book.pdf"; filename*=UTF-8''${encodeURIComponent(row.name + '.pdf').replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16))}`);
        res.setHeader('Accept-Ranges', 'bytes');
      }
      let start = 0, end = row.size - 1, status = 200;
      if (asset === 'pdf' && req.headers.range) {
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (!range || (!range[1] && !range[2])) { res.setHeader('Content-Range', `bytes */${row.size}`); throw new HttpError(416, 'Invalid byte range.'); }
        start = range[1] ? Number(range[1]) : Math.max(0, row.size - Number(range[2]));
        end = range[1] && range[2] ? Math.min(Number(range[2]), end) : end;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= row.size) { res.setHeader('Content-Range', `bytes */${row.size}`); throw new HttpError(416, 'Invalid byte range.'); }
        status = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${row.size}`);
      }
      // HEAD needs metadata only. Slice ranges inside SQLite so Node does not
      // allocate/copy the entire PDF for every small reader request.
      const body = req.method === 'HEAD' ? undefined : status === 206
        ? db.prepare('SELECT substr(pdf, ?, ?) AS body FROM books WHERE id = ?').get(start + 1, end - start + 1, id).body
        : db.prepare('SELECT pdf AS body FROM books WHERE id = ?').get(id).body;
      res.writeHead(status, { 'Content-Type': 'application/pdf', 'Content-Length': end - start + 1 });
      res.end(body);
      return true;
    }
    if (!asset && req.method === 'PATCH') {
      const body = await readJson(req);
      const identity = bookIdentity(body.name, body.tags);
      db.prepare('UPDATE book_state SET name = ?, tags_json = ? WHERE id = ?').run(identity.name, JSON.stringify(canonicalTags(identity.tags)), id);
      send(res, 200, { book: metadata(find(id)) });
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
