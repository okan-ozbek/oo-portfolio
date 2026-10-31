import { createHash, randomBytes } from 'node:crypto';

export function createViewAnalytics({ db, secureCookies = true, now = Date.now }) {
  db.exec(`CREATE TABLE IF NOT EXISTS content_views (
    kind TEXT NOT NULL, content_id TEXT NOT NULL, device_hash TEXT NOT NULL,
    first_viewed_at TEXT NOT NULL, PRIMARY KEY(kind,content_id,device_hash)
  ) STRICT;`);
  db.exec('CREATE INDEX IF NOT EXISTS content_views_dates ON content_views(kind,first_viewed_at,content_id)');
  const cookieName = secureCookies ? '__Host-pixelware_device' : 'pixelware_device_dev';
  const insert = db.prepare('INSERT OR IGNORE INTO content_views VALUES (?,?,?,?)');
  const count = db.prepare('SELECT COUNT(*) AS total FROM content_views WHERE kind=? AND content_id=?');
  return {
    activity(kind, startDay, endDay) {
      const rows = kind === 'blog'
        ? db.prepare('SELECT id,draft_json AS data,created_at AS createdAt,published_json IS NOT NULL AS published FROM blog_posts ORDER BY created_at,id').all()
        : db.prepare("SELECT id,data_json AS data,updated_at AS createdAt,json_extract(data_json,'$.state')='published' AS published FROM projects ORDER BY position,id").all();
      const daily = db.prepare('SELECT content_id,substr(first_viewed_at,1,10) AS day,COUNT(*) AS views FROM content_views WHERE kind=? AND first_viewed_at>=? AND first_viewed_at<? GROUP BY content_id,day ORDER BY day').all(kind,startDay+'T00:00:00.000Z',new Date(Date.parse(endDay+'T00:00:00Z')+86400000).toISOString());
      return { series: rows.filter(row=>row.published || Number(count.get(kind,row.id).total)>0).map(row=>({id:row.id,title:JSON.parse(row.data).title,createdAt:row.createdAt,daily:daily.filter(day=>day.content_id===row.id).map(({day,views})=>({day,views}))})) };
    },
    count: (kind, id) => Number(count.get(kind, id).total),
    remove: (kind, id) => db.prepare('DELETE FROM content_views WHERE kind=? AND content_id=?').run(kind, id),
    record(req, res, kind, id) {
      if (req.method !== 'GET' || /prefetch|prerender/i.test(`${req.headers.purpose ?? ''} ${req.headers['sec-purpose'] ?? ''}`) || /bot|crawler|spider|slurp/i.test(req.headers['user-agent'] ?? '')) return;
      const existing = (req.headers.cookie ?? '').split(';').map(value => value.trim()).find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
      const token = /^[a-f0-9]{64}$/.test(existing ?? '') ? existing : randomBytes(32).toString('hex');
      // No time-based cooldown: the same token never counts twice for this item.
      insert.run(kind, id, createHash('sha256').update(token).digest('hex'), new Date(now()).toISOString());
      const cookie = `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=34560000${secureCookies ? '; Secure' : ''}`;
      const prior = res.getHeader('Set-Cookie');
      res.setHeader('Set-Cookie', [...(Array.isArray(prior) ? prior : prior ? [prior] : []), cookie]);
    },
  };
}
