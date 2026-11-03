import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Cache public release files, not private API responses. Development always
// rereads files so rebuilt entries and edited styles are visible immediately.
export function createAssetServer({ development = false, maxBytes = 32 * 1024 * 1024 } = {}) {
  const cache = new Map(), pending = new Map();
  let bytes = 0;
  async function load(file) {
    const key = file.href;
    if (!development && cache.has(key)) { const value = cache.get(key); cache.delete(key); cache.set(key, value); return value; }
    if (pending.has(key)) return pending.get(key);
    const task = readFile(file).then(body => {
      const value = { body, etag: `"${createHash('sha256').update(body).digest('hex')}"` };
      if (!development && body.length <= maxBytes) {
        while (bytes + body.length > maxBytes && cache.size) {
          const oldest = cache.keys().next().value; bytes -= cache.get(oldest).body.length; cache.delete(oldest);
        }
        cache.set(key, value); bytes += body.length;
      }
      return value;
    }).finally(() => pending.delete(key));
    pending.set(key, task); return task;
  }
  return async (req, res, file, type) => {
    const { body, etag } = await load(file);
    const immutable = /-[A-Z0-9]{8}\.js$/.test(file.pathname);
    res.setHeader('Cache-Control', !development && immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate');
    res.setHeader('ETag', etag);
    if ((req.headers['if-none-match'] ?? '').split(',').some(value => value.trim().replace(/^W\//, '') === etag || value.trim() === '*')) {
      res.writeHead(304); res.end(); return true;
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body); return true;
  };
}
