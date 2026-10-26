import { createHash, randomUUID } from 'node:crypto';
import { HttpError, readJson } from './http.mjs';
import { MAX_REQUEST_BYTES, validateProject } from './resume-project.mjs';

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const hash = value => createHash('sha256').update(value).digest('hex');
export function compilerClient(base = process.env.RESUME_COMPILER_URL ?? 'http://127.0.0.1:3032') {
  return async (action, body) => {
    let response;
    try {
      response = await fetch(`${base}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(85000) });
    } catch { throw new HttpError(503, 'The resume compiler is unavailable. Start it with npm run resume:compiler, then try again.'); }
    const result = await response.json();
    if (!response.ok) throw new HttpError(response.status, result.error ?? 'Compilation failed.');
    if (typeof result.pdf !== 'string' || result.pdf.length > 22 * 1024 * 1024 || !Buffer.from(result.pdf, 'base64').subarray(0, 5).equals(Buffer.from('%PDF-')) || !Array.isArray(result.links) || result.links.length > 100) throw new HttpError(502, 'The compiler returned an invalid PDF.');
    return result;
  };
}

export function createResumes({ db, origin, now, send, visitor, compile = compilerClient() }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS resumes (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      main_file TEXT NOT NULL, files_json TEXT NOT NULL, scan_json TEXT NOT NULL,
      original_pdf BLOB NOT NULL, draft_pdf BLOB NOT NULL, published_pdf BLOB,
      pages INTEGER NOT NULL, created_at TEXT NOT NULL, compiled_at TEXT NOT NULL,
      published_at TEXT, draft_version INTEGER NOT NULL DEFAULT 1, published_version INTEGER
    ) STRICT;
    CREATE TABLE IF NOT EXISTS resume_links (
      resume_id TEXT NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
      url_key TEXT NOT NULL, original_url TEXT NOT NULL,
      link_id TEXT UNIQUE REFERENCES links(id) ON DELETE SET NULL,
      tracked INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(resume_id, url_key)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS resume_downloads_daily (
      resume_id TEXT NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
      day TEXT NOT NULL, downloads INTEGER NOT NULL, PRIMARY KEY(resume_id, day)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS resume_download_cooldowns (
      resume_id TEXT NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
      visitor_hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
      PRIMARY KEY(resume_id, visitor_hash)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS resume_cooldown_expiry ON resume_download_cooldowns(expires_at);
    CREATE TABLE IF NOT EXISTS resume_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      default_resume_id TEXT REFERENCES resumes(id) ON DELETE SET NULL
    ) STRICT;
    INSERT OR IGNORE INTO resume_settings(id) VALUES (1);
  `);
  const busy = new Set();
  const transaction = work => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const prune = () => db.prepare('DELETE FROM resume_download_cooldowns WHERE expires_at <= ?').run(now());
  prune();
  const defaultId = () => db.prepare('SELECT default_resume_id FROM resume_settings WHERE id = 1').get().default_resume_id;
  function metadata(row) {
    return { id: row.id, name: row.name, slug: row.slug, mainFile: row.main_file, pages: row.pages,
      createdAt: row.created_at, compiledAt: row.compiled_at, publishedAt: row.published_at,
      published: row.published_at !== null, unpublishedChanges: row.draft_version !== row.published_version,
      isDefault: defaultId() === row.id, url: `${origin}/resumes/${row.slug}.pdf`,
      downloads: db.prepare('SELECT COALESCE(SUM(downloads), 0) AS n FROM resume_downloads_daily WHERE resume_id = ?').get(row.id).n,
      clicks: db.prepare('SELECT COALESCE(SUM(d.clicks), 0) AS n FROM daily_clicks d JOIN resume_links r ON r.link_id = d.link_id WHERE r.resume_id = ?').get(row.id).n,
      trackedLinks: db.prepare('SELECT COUNT(*) AS n FROM resume_links WHERE resume_id = ? AND tracked = 1 AND link_id IS NOT NULL').get(row.id).n };
  }
  function get(id) {
    const row = db.prepare('SELECT * FROM resumes WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, 'Resume not found.');
    return row;
  }
  function trackable(destination) {
    try { const url = new URL(destination); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !(url.origin === origin && /^\/r(?:\/|$)/.test(url.pathname)); }
    catch { return false; }
  }
  function detail(row) {
    const mappings = db.prepare('SELECT r.*, l.slug, l.label, l.enabled FROM resume_links r LEFT JOIN links l ON l.id = r.link_id WHERE resume_id = ?').all(row.id);
    return { ...metadata(row), files: JSON.parse(row.files_json).map(file => file.path), links: JSON.parse(row.scan_json).map((link, index) => {
      const mapping = mappings.find(item => item.url_key === link.key);
      let host = 'link';
      try { host = new URL(link.destination).hostname.replace(/^www\./, '').split('.')[0].replace(/[^a-z0-9]+/g, '-'); } catch { /* non-web URI */ }
      return { ...link, trackable: trackable(link.destination), tracked: Boolean(mapping?.tracked && mapping?.link_id), linkId: mapping?.link_id ?? null,
        slug: mapping?.slug ?? `${row.slug.slice(0, 48)}-${host.slice(0, 16) || 'link'}-${index + 1}`,
        label: mapping?.label ?? host, enabled: mapping?.link_id ? Boolean(mapping.enabled) : true };
    }) };
  }
  function identity(body) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 80) throw new HttpError(400, 'Enter a resume name of 1–80 characters.');
    if (typeof body.slug !== 'string' || !slugPattern.test(body.slug) || body.slug.length > 60) throw new HttpError(400, 'Use a resume slug of 1–60 lowercase letters, numbers, or hyphens.');
    if (db.prepare('SELECT 1 FROM resumes WHERE slug = ?').get(body.slug)) throw new HttpError(409, 'That resume slug is already in use.');
    if (db.prepare('SELECT COUNT(*) AS n FROM resumes').get().n >= 50) throw new HttpError(400, 'Keep at most 50 resume variants.');
    return [body.name.trim(), body.slug];
  }
  function insert(body, project, result) {
    // Recheck uniqueness after the asynchronous compiler returns.
    const [name, slug] = identity(body);
    const id = randomUUID(), timestamp = new Date(now()).toISOString();
    const pdf = Buffer.from(result.pdf, 'base64');
    db.prepare(`INSERT INTO resumes(id,name,slug,main_file,files_json,scan_json,original_pdf,draft_pdf,pages,created_at,compiled_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, name, slug, project.mainFile, JSON.stringify(project.files), JSON.stringify(result.links), pdf, pdf, result.pages, timestamp, timestamp);
    return detail(get(id));
  }
  function pdfResponse(req, res, row, publicDownload) {
    const pdf = publicDownload ? row.published_pdf : row.draft_pdf;
    if (!pdf) throw new HttpError(404, 'This resume has not been published.');
    const preview = /prefetch|prerender/i.test(`${req.headers.purpose ?? ''} ${req.headers['sec-purpose'] ?? ''}`);
    if (publicDownload && req.method === 'GET' && !preview) {
      const token = visitor(req, res);
      transaction(() => {
        prune();
        const result = db.prepare('INSERT INTO resume_download_cooldowns VALUES(?,?,?) ON CONFLICT DO NOTHING').run(row.id, hash(token), now() + 3600000);
        if (result.changes) db.prepare('INSERT INTO resume_downloads_daily VALUES(?,?,1) ON CONFLICT(resume_id,day) DO UPDATE SET downloads = downloads + 1').run(row.id, new Date(now()).toISOString().slice(0,10));
      });
    }
    // CSP sandbox prevents Chromium's native PDF viewer from loading.
    // The compiler strips document scripts and active actions before storage.
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    const attachment = publicDownload || new URL(req.url, 'http://internal').searchParams.get('download') === '1';
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdf.length, 'Content-Disposition': `${attachment ? 'attachment' : 'inline'}; filename="${row.slug}.pdf"` });
    res.end(req.method === 'HEAD' ? undefined : Buffer.from(pdf));
  }
  async function publicRoute(req, res, url) {
    const match = url.pathname.match(/^\/resumes\/([a-z0-9-]+)\.pdf$/);
    if (url.pathname !== '/api/public/resume' && url.pathname !== '/resume.pdf' && !match) return false;
    if (!['GET', 'HEAD'].includes(req.method)) throw new HttpError(405, 'Method not allowed.');
    const row = match ? db.prepare('SELECT * FROM resumes WHERE slug = ? AND published_pdf IS NOT NULL').get(match[1]) : db.prepare('SELECT * FROM resumes WHERE id = ? AND published_pdf IS NOT NULL').get(defaultId());
    if (url.pathname === '/api/public/resume') { send(res, 200, { available: Boolean(row), ...(row ? { name: row.name, url: '/resume.pdf' } : {}) }); return true; }
    if (!row) throw new HttpError(404, 'No published resume is available.');
    pdfResponse(req, res, row, true); return true;
  }
  async function adminRoute(req, res, url) {
    const root = '/api/admin/resumes';
    if (url.pathname !== root && !url.pathname.startsWith(`${root}/`)) return false;
    if (url.pathname === root && req.method === 'GET') { send(res, 200, { resumes: db.prepare('SELECT id,name,slug,main_file,pages,created_at,compiled_at,published_at,draft_version,published_version FROM resumes ORDER BY created_at DESC').all().map(metadata) }); return true; }
    if (url.pathname === root && req.method === 'POST') {
      const body = await readJson(req, MAX_REQUEST_BYTES);
      identity(body);
      const project = validateProject(body);
      const result = await compile('compile', project);
      send(res, 201, { resume: insert(body, project, result) }); return true;
    }
    const match = url.pathname.match(/^\/api\/admin\/resumes\/([a-f0-9-]{36})(?:\/(compile|duplicate|publish|pdf))?$/);
    if (!match) throw new HttpError(404, 'Not found.');
    const [, id, action] = match;
    const row = get(id);
    if (req.method === 'GET' && !action) { send(res, 200, { resume: detail(row) }); return true; }
    if (req.method === 'GET' && action === 'pdf') { pdfResponse(req, res, row, false); return true; }
    if (busy.has(id)) throw new HttpError(409, 'This resume is being built. Try again shortly.');
    if (req.method === 'POST' && action === 'duplicate') {
      const body = await readJson(req);
      send(res, 201, { resume: insert(body, { mainFile: row.main_file, files: JSON.parse(row.files_json) }, { pdf: Buffer.from(row.original_pdf).toString('base64'), links: JSON.parse(row.scan_json), pages: row.pages }) }); return true;
    }
    if (req.method === 'POST' && action === 'compile') {
      const body = await readJson(req, 128 * 1024);
      if (!Array.isArray(body.links) || body.links.length > 100 || new Set(body.links.map(link => link.key)).size !== body.links.length) throw new HttpError(400, 'Invalid link selections.');
      const scan = JSON.parse(row.scan_json);
      const previous = db.prepare('SELECT r.*, l.slug FROM resume_links r LEFT JOIN links l ON l.id = r.link_id WHERE resume_id = ?').all(id);
      const selections = body.links.map(selection => {
        const found = scan.find(link => link.key === selection.key);
        if (!found || typeof selection.tracked !== 'boolean' || (selection.tracked && !trackable(found.destination))) throw new HttpError(400, 'Select only detected HTTP(S) links.');
        const existing = previous.find(link => link.url_key === selection.key && link.link_id);
        if (selection.tracked && (typeof selection.slug !== 'string' || !slugPattern.test(selection.slug) || selection.slug.length > 80 || typeof selection.label !== 'string' || !selection.label.trim() || selection.label.length > 100)) throw new HttpError(400, 'Use a valid tracking slug and a link name of 1–100 characters.');
        if (existing && selection.tracked && existing.slug !== selection.slug) throw new HttpError(400, 'Existing tracking slugs are permanent.');
        return { ...selection, destination: found.destination, linkId: existing?.link_id ?? null };
      });
      const active = selections.filter(link => link.tracked);
      const checkSlugs = () => {
        if (new Set(active.map(link => link.slug)).size !== active.length) throw new HttpError(409, 'Each tracked destination needs a different slug.');
        for (const link of active) {
          const conflict = db.prepare('SELECT id FROM links WHERE slug = ?').get(link.slug);
          if (conflict && conflict.id !== link.linkId) throw new HttpError(409, `The slug ${link.slug} is already in use.`);
        }
      };
      checkSlugs(); busy.add(id);
      try {
        const mappings = active.map(link => ({ from: link.destination, to: `${origin}/r/${link.slug}` }));
        const result = await compile('rewrite', { pdf: Buffer.from(row.original_pdf).toString('base64'), mappings });
        for (const mapping of mappings) if (!result.links.some(link => link.destination === mapping.to)) throw new HttpError(422, 'A selected hyperlink could not be replaced. The previous draft was kept.');
        transaction(() => {
          get(id); checkSlugs();
          db.prepare('UPDATE resume_links SET tracked = 0 WHERE resume_id = ?').run(id);
          for (const link of active) {
            const linkId = link.linkId ?? randomUUID();
            if (!link.linkId) db.prepare('INSERT INTO links(id,slug,label,destination,source,enabled,created_at) VALUES(?,?,?,?,?,1,?)').run(linkId, link.slug, link.label.trim(), link.destination, `Resume: ${row.name}`.slice(0,100), new Date(now()).toISOString());
            db.prepare('INSERT INTO resume_links VALUES(?,?,?,?,1) ON CONFLICT(resume_id,url_key) DO UPDATE SET link_id=excluded.link_id, tracked=1').run(id, link.key, link.destination, linkId);
          }
          db.prepare('UPDATE resumes SET draft_pdf = ?, compiled_at = ?, draft_version = draft_version + 1 WHERE id = ?').run(Buffer.from(result.pdf, 'base64'), new Date(now()).toISOString(), id);
        });
        send(res, 200, { resume: detail(get(id)) }); return true;
      } finally { busy.delete(id); }
    }
    if (req.method === 'POST' && action === 'publish') {
      const body = await readJson(req);
      if (typeof body.makeDefault !== 'boolean') throw new HttpError(400, 'Choose whether this is the website resume.');
      transaction(() => {
        db.prepare('UPDATE resumes SET published_pdf = draft_pdf, published_at = ?, published_version = draft_version WHERE id = ?').run(new Date(now()).toISOString(), id);
        if (body.makeDefault) db.prepare('UPDATE resume_settings SET default_resume_id = ? WHERE id = 1').run(id);
        else db.prepare('UPDATE resume_settings SET default_resume_id = NULL WHERE default_resume_id = ?').run(id);
      });
      send(res, 200, { resume: detail(get(id)) }); return true;
    }
    if (req.method === 'PATCH' && !action) {
      const body = await readJson(req);
      if (body.published !== false || Object.keys(body).length !== 1) throw new HttpError(400, 'Send published: false to unpublish.');
      transaction(() => {
        db.prepare('UPDATE resumes SET published_pdf = NULL, published_at = NULL, published_version = NULL WHERE id = ?').run(id);
        db.prepare('UPDATE resume_settings SET default_resume_id = NULL WHERE default_resume_id = ?').run(id);
      });
      send(res, 200, { resume: detail(get(id)) }); return true;
    }
    if (req.method === 'DELETE' && !action) {
      transaction(() => {
        db.prepare('DELETE FROM links WHERE id IN (SELECT link_id FROM resume_links WHERE resume_id = ?)').run(id);
        db.prepare('DELETE FROM resumes WHERE id = ?').run(id);
      });
      send(res, 200, { ok: true }); return true;
    }
    throw new HttpError(405, 'Method not allowed.');
  }
  return { publicRoute, adminRoute, prune };
}
