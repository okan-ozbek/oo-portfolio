export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function readJson(req, maximum = 8192) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'Send JSON.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maximum) throw new HttpError(413, 'Request is too large.');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new HttpError(400, 'Invalid JSON.'); }
}
