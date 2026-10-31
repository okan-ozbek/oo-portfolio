import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { HttpError, readJson } from './http.mjs';
import { presets } from '../lib/art-catalog.mjs';

export function createProjects({ db, send, analytics, onPublicChange=()=>{}, now = Date.now }) {
  // A migration marker prevents deleted seed projects reappearing on restart.
  db.exec(`CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data_json TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL, updated_at TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS project_migrations (name TEXT PRIMARY KEY) STRICT;`);
  if (!db.prepare('SELECT 1 FROM project_migrations WHERE name=?').get('initial-six')) {
    const seeds = JSON.parse(readFileSync(new URL('./project-seed.json', import.meta.url), 'utf8'));
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const [position, seed] of seeds.entries()) db.prepare('INSERT INTO projects (id,data_json,position,updated_at) VALUES (?,?,?,?)').run(seed.id, JSON.stringify({ title: seed.name, caption: seed.category, description: seed.description, url: seed.href ?? '', state: seed.href ? 'published' : 'teaser', thumbnail: `project-${seed.visual}` }), position, new Date(now()).toISOString());
      db.prepare('INSERT INTO project_migrations VALUES (?)').run('initial-six');
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const entry = row => ({ id: row.id, uniqueViews: analytics?.count('project', row.id) ?? 0, ...JSON.parse(row.data_json), version: row.version, position: row.position, updatedAt: row.updated_at });
  const list = () => db.prepare('SELECT * FROM projects ORDER BY position,id').all().map(entry);
  function validate(value) {
    if (!value || typeof value !== 'object') throw new HttpError(400, 'Enter project details.');
    const result = {};
    for (const [key, maximum] of [['title', 120], ['caption', 120], ['description', 600], ['url', 2048]]) {
      if (typeof value[key] !== 'string' || value[key].length > maximum) throw new HttpError(400, `${key} must be text up to ${maximum} characters.`);
      result[key] = value[key].trim();
    }
    if (!result.title) throw new HttpError(400, 'Enter a project title.');
    if (!['draft', 'teaser', 'published'].includes(value.state)) throw new HttpError(400, 'Choose draft, teaser, or published.');
    if (!presets.includes(value.thumbnail)) throw new HttpError(400, 'Choose a thumbnail from the collection.');
    if (result.url) {
      let target;
      try { target = new URL(result.url, 'https://pixelware.nl'); } catch { throw new HttpError(400, 'Enter an HTTP(S) URL or a local path such as /blog/my-post.'); }
      if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || (!/^https?:\/\//i.test(result.url) && !/^\/(?!\/)/.test(result.url))) throw new HttpError(400, 'Use an HTTP(S) URL or a local path without embedded credentials.');
    }
    if (value.state === 'published' && !result.url) throw new HttpError(400, 'Published projects need a destination URL.');
    return { ...result, state: value.state, thumbnail: value.thumbnail };
  }
  return {
    async publicRoute(req, res, url) {
      const visit = /^\/api\/public\/projects\/([a-zA-Z0-9-]+)\/visit$/.exec(url.pathname);
      if (visit) {
        if (!['GET','HEAD'].includes(req.method)) throw new HttpError(405, 'Method not allowed.');
        const row=db.prepare('SELECT * FROM projects WHERE id=?').get(visit[1]);
        const project=row ? entry(row) : null;
        if (!project || project.state !== 'published') throw new HttpError(404, 'Project not found.');
        analytics?.record(req,res,'project',project.id);
        res.writeHead(302, { Location: project.url });res.end();return true;
      }
      if (url.pathname !== '/api/public/projects') return false;
      if (!['GET', 'HEAD'].includes(req.method)) throw new HttpError(405, 'Method not allowed.');
      const projects = list().filter(project => project.state !== 'draft').map(project => ({id:project.id,title:project.title,caption:project.caption,description:project.description,state:project.state,thumbnail:project.thumbnail,url:project.state === 'published' ? project.url : ''}));
      send(res, 200, { projects }); return true;
    },
    async adminRoute(req, res, url) {
      if (url.pathname === '/api/admin/projects') {
        if (req.method === 'GET') { send(res, 200, { projects: list() }); return true; }
        if (req.method === 'POST') {
          const { project } = await readJson(req); const data = validate(project);
          const id = randomUUID(), position = Number(db.prepare('SELECT COALESCE(MAX(position),-1)+1 AS next FROM projects').get().next);
          db.prepare('INSERT INTO projects (id,data_json,position,updated_at) VALUES (?,?,?,?)').run(id, JSON.stringify(data), position, new Date(now()).toISOString());
          if(data.state!=='draft')onPublicChange();
          send(res, 201, { project: entry(db.prepare('SELECT * FROM projects WHERE id=?').get(id)) }); return true;
        }
        throw new HttpError(405, 'Method not allowed.');
      }
      const match = /^\/api\/admin\/projects\/([a-zA-Z0-9-]+)$/.exec(url.pathname);
      if (!match) return false;
      const row = db.prepare('SELECT * FROM projects WHERE id=?').get(match[1]);
      if (!row) throw new HttpError(404, 'Project not found.');
      if (req.method === 'GET') { send(res, 200, { project: entry(row) }); return true; }
      if (!['PUT', 'DELETE'].includes(req.method)) throw new HttpError(405, 'Method not allowed.');
      const body = await readJson(req);
      if (body.version !== row.version) throw new HttpError(409, 'This project changed in another window. Reopen it before saving.');
      if (req.method === 'DELETE') { if(JSON.parse(row.data_json).state!=='draft')onPublicChange();analytics?.remove('project', row.id); db.prepare('DELETE FROM projects WHERE id=?').run(row.id); send(res, 200, { ok: true }); return true; }
      const data = validate(body.project);
      db.prepare('UPDATE projects SET data_json=?,version=version+1,updated_at=? WHERE id=?').run(JSON.stringify(data), new Date(now()).toISOString(), row.id);
      if(JSON.stringify(data)!==row.data_json&&(data.state!=='draft'||JSON.parse(row.data_json).state!=='draft'))onPublicChange();
      send(res, 200, { project: entry(db.prepare('SELECT * FROM projects WHERE id=?').get(row.id)) }); return true;
    },
  };
}
