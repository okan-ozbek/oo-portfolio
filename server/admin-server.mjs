import { createServer } from "node:http";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { validatePasswordHash, verifyPassword } from "./security.mjs";

const sha256 = value => createHash("sha256").update(value).digest("hex");
const SESSION_SECONDS = 12 * 60 * 60;
const CLICK_COOLDOWN_SECONDS = 60 * 60;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const assets = new Map([
  ["/admin", ["index.html", "text/html; charset=utf-8"]],
  ["/admin/", ["index.html", "text/html; charset=utf-8"]],
  ["/admin/assets/admin.js", ["admin.js", "text/javascript; charset=utf-8"]],
  ["/admin/assets/admin.css", ["admin.css", "text/css; charset=utf-8"]],
]);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function activityWindow(range, timestamp) {
  if (!["7d", "30d", "quarter", "year"].includes(range)) throw new HttpError(400, "Choose 7d, 30d, quarter, or year.");
  const end = new Date(timestamp);
  end.setUTCHours(0, 0, 0, 0);
  let start;
  if (range === "7d" || range === "30d") start = new Date(end.getTime() - (range === "7d" ? 6 : 29) * 86400000);
  else {
    start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (range === "quarter" ? 3 : 12), 1));
    const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
    start.setUTCDate(Math.min(end.getUTCDate(), lastDay));
    // Include today and exclude the same date three/twelve calendar months ago.
    start.setUTCDate(start.getUTCDate() + 1);
  }
  return { startDay: start.toISOString().slice(0, 10), endDay: end.toISOString().slice(0, 10) };
}

async function readJson(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] ?? "")) throw new HttpError(415, "Send JSON.");
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) throw new HttpError(413, "Request is too large.");
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new HttpError(400, "Invalid JSON."); }
}

export function createAdminServer({ passwordHash, origin, databasePath, secureCookies = true, now = Date.now }) {
  validatePasswordHash(passwordHash);
  const publicUrl = new URL(origin);
  if (publicUrl.origin !== origin || !["http:", "https:"].includes(publicUrl.protocol)) throw new Error("APP_ORIGIN must be an origin without a trailing slash.");
  if (secureCookies && publicUrl.protocol !== "https:") throw new Error("Production APP_ORIGIN requires HTTPS.");
  if (databasePath !== ":memory:") mkdirSync(dirname(resolve(databasePath)), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS links (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
      destination TEXT NOT NULL, source TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, last_clicked_at TEXT
    ) STRICT;
    CREATE TABLE IF NOT EXISTS daily_clicks (
      link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
      day TEXT NOT NULL, clicks INTEGER NOT NULL,
      PRIMARY KEY (link_id, day)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL,
      password_version TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS login_limit (
      id INTEGER PRIMARY KEY CHECK(id = 1), attempts INTEGER NOT NULL, resets_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS click_cooldowns (
      link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
      visitor_hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
      PRIMARY KEY (link_id, visitor_hash)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS click_cooldowns_expiry ON click_cooldowns(expires_at);
  `);
  const pruneCooldowns = db.prepare("DELETE FROM click_cooldowns WHERE expires_at <= ?");
  pruneCooldowns.run(now());
  const passwordVersion = sha256(passwordHash);
  db.prepare("DELETE FROM sessions WHERE expires_at <= ? OR password_version != ?").run(now(), passwordVersion);
  const cookieName = secureCookies ? "__Host-pixelware_admin" : "pixelware_admin_dev";
  const visitorCookieName = secureCookies ? "__Host-pixelware_click" : "pixelware_click_dev";
  const cookie = (token, maxAge) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookies ? "; Secure" : ""}`;
  let loginsInFlight = 0;
  function readCookie(req, name) {
    return (req.headers.cookie ?? "").split(";").map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
  }
  function session(req) {
    const token = readCookie(req, cookieName);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return db.prepare("SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ? AND password_version = ?").get(sha256(token), now(), passwordVersion) ?? null;
  }
  const send = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
  };
  function validateLink(body) {
    const { label, slug, destination, source = "", enabled = true } = body;
    if (typeof label !== "string" || !label.trim() || label.length > 100) throw new HttpError(400, "Enter a label of 1–100 characters.");
    if (typeof slug !== "string" || !SLUG.test(slug) || slug.length > 80) throw new HttpError(400, "Use a slug of 1–80 lowercase letters, numbers, or single hyphens.");
    if (typeof source !== "string" || source.length > 100) throw new HttpError(400, "Source must be 100 characters or fewer.");
    if (typeof enabled !== "boolean") throw new HttpError(400, "Enabled must be true or false.");
    let target;
    try { target = new URL(destination); } catch { throw new HttpError(400, "Enter a complete http:// or https:// destination."); }
    if (typeof destination !== "string" || destination.length > 2048 || !["http:", "https:"].includes(target.protocol) || target.username || target.password) {
      throw new HttpError(400, "Use an HTTP(S) destination without embedded credentials.");
    }
    if (target.origin === origin && /^\/r(?:\/|$)/.test(target.pathname)) throw new HttpError(400, "A tracking link cannot redirect to another tracking link on this site.");
    return [slug, label.trim(), target.href, source.trim(), Number(enabled)];
  }
  function linkList() {
    const today = new Date(now()).toISOString().slice(0, 10);
    const since = new Date(now() - 29 * 86400000).toISOString().slice(0, 10);
    return db.prepare(`SELECT l.*,
      COALESCE(SUM(d.clicks), 0) AS clicks,
      COALESCE(SUM(CASE WHEN d.day = ? THEN d.clicks ELSE 0 END), 0) AS today,
      COALESCE(SUM(CASE WHEN d.day >= ? THEN d.clicks ELSE 0 END), 0) AS last30Days
      FROM links l LEFT JOIN daily_clicks d ON d.link_id = l.id
      GROUP BY l.id ORDER BY l.created_at DESC, l.slug`).all(today, since).map(row => ({
        id: row.id, slug: row.slug, label: row.label, destination: row.destination, source: row.source,
        enabled: Boolean(row.enabled), createdAt: row.created_at, lastClickedAt: row.last_clicked_at,
        clicks: row.clicks, today: row.today, last30Days: row.last30Days, url: `${origin}/r/${row.slug}`,
      }));
  }

  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const requestUrl = new URL(req.url, "http://internal");
      const path = requestUrl.pathname;
      if (path === "/healthz" && req.method === "GET") return send(res, 200, { ok: Boolean(db.prepare("SELECT 1").get()) });
      if (assets.has(path) && ["GET", "HEAD"].includes(req.method)) {
        const [file, type] = assets.get(path);
        const body = readFileSync(new URL(`./admin/${file}`, import.meta.url));
        res.writeHead(200, { "Content-Type": type });
        return res.end(req.method === "HEAD" ? undefined : body);
      }
      if (path.startsWith("/r/")) {
        if (!["GET", "HEAD"].includes(req.method)) throw new HttpError(405, "Method not allowed.");
        const slug = path.slice(3);
        const link = SLUG.test(slug) && db.prepare("SELECT * FROM links WHERE slug = ? AND enabled = 1").get(slug);
        if (!link) throw new HttpError(404, "Link not found or paused.");
        const preview = /prefetch|prerender/i.test(`${req.headers.purpose ?? ""} ${req.headers["sec-purpose"] ?? ""}`);
        // Lax cookies accompany external top-level navigations from resumes.
        // One count per browser/link/hour; HEAD and prefetches do not count.
        if (req.method === "GET" && !preview) {
          const currentTime = now();
          const timestamp = new Date(currentTime).toISOString();
          const existingVisitor = readCookie(req, visitorCookieName);
          const visitor = /^[a-f0-9]{64}$/.test(existingVisitor ?? "") ? existingVisitor : randomBytes(32).toString("hex");
          db.exec("BEGIN IMMEDIATE");
          try {
            pruneCooldowns.run(currentTime);
            const accepted = db.prepare(`INSERT INTO click_cooldowns (link_id, visitor_hash, expires_at)
              VALUES (?, ?, ?) ON CONFLICT(link_id, visitor_hash) DO NOTHING`)
              .run(link.id, sha256(visitor), currentTime + CLICK_COOLDOWN_SECONDS * 1000);
            if (accepted.changes === 1) {
              db.prepare(`INSERT INTO daily_clicks (link_id, day, clicks) VALUES (?, ?, 1)
                ON CONFLICT(link_id, day) DO UPDATE SET clicks = clicks + 1`).run(link.id, timestamp.slice(0, 10));
              db.prepare("UPDATE links SET last_clicked_at = ? WHERE id = ?").run(timestamp, link.id);
            }
            db.exec("COMMIT");
          } catch (error) { db.exec("ROLLBACK"); throw error; }
          // Refresh browser recognition, not the per-link cooldown. This also
          // preserves an hour's protection for links clicked later in a visit.
          res.setHeader("Set-Cookie", `${visitorCookieName}=${visitor}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${CLICK_COOLDOWN_SECONDS}${secureCookies ? "; Secure" : ""}`);
        }
        res.writeHead(302, { Location: link.destination });
        return res.end();
      }
      if (!path.startsWith("/api/admin/")) throw new HttpError(404, "Not found.");
      if (req.method !== "GET") {
        if (req.headers.origin !== origin) throw new HttpError(403, "Request origin is not allowed.");
        if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] ?? "")) throw new HttpError(415, "Send JSON.");
      }
      if (path === "/api/admin/login" && req.method === "POST") {
        const body = await readJson(req);
        const limit = db.prepare("SELECT * FROM login_limit WHERE id = 1").get();
        if (loginsInFlight >= 2 || (limit && limit.resets_at > now() && limit.attempts >= 10)) {
          res.setHeader("Retry-After", String(Math.max(1, Math.ceil(((limit?.resets_at ?? now() + 1000) - now()) / 1000))));
          throw new HttpError(429, "Too many sign-in attempts. Please try again later.");
        }
        if (!limit || limit.resets_at <= now()) db.prepare("INSERT OR REPLACE INTO login_limit VALUES (1, 1, ?)").run(now() + 15 * 60000);
        else db.prepare("UPDATE login_limit SET attempts = attempts + 1 WHERE id = 1").run();
        loginsInFlight++;
        let valid;
        try { valid = await verifyPassword(body.password, passwordHash); } finally { loginsInFlight--; }
        if (!valid) throw new HttpError(401, "Incorrect password.");
        db.prepare("UPDATE login_limit SET attempts = MAX(0, attempts - 1) WHERE id = 1").run();
        const previous = session(req);
        if (previous) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(previous.token_hash);
        db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now());
        const token = randomBytes(32).toString("hex");
        const csrf = randomBytes(32).toString("hex");
        db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?)").run(sha256(token), csrf, now() + SESSION_SECONDS * 1000, passwordVersion);
        res.setHeader("Set-Cookie", cookie(token, SESSION_SECONDS));
        return send(res, 200, { csrf });
      }
      const current = session(req);
      if (!current) throw new HttpError(401, "Sign in to continue.");
      if (req.method !== "GET") {
        const csrf = req.headers["x-csrf-token"];
        if (typeof csrf !== "string" || !/^[a-f0-9]{64}$/.test(csrf) || !timingSafeEqual(Buffer.from(csrf), Buffer.from(current.csrf))) {
          throw new HttpError(403, "Session verification failed. Refresh and try again.");
        }
      }
      if (path === "/api/admin/session" && req.method === "GET") return send(res, 200, { csrf: current.csrf });
      if (path === "/api/admin/logout" && req.method === "POST") {
        db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(current.token_hash);
        res.setHeader("Set-Cookie", cookie("", 0));
        return send(res, 200, { ok: true });
      }
      if (path === "/api/admin/links" && req.method === "GET") {
        const range = requestUrl.searchParams.get("range") ?? "30d";
        const { startDay, endDay } = activityWindow(range, now());
        const daily = db.prepare("SELECT day, SUM(clicks) AS clicks FROM daily_clicks WHERE day >= ? AND day <= ? GROUP BY day ORDER BY day").all(startDay, endDay);
        const links = linkList();
        const perLink = new Map();
        for (const row of db.prepare(`SELECT d.link_id, d.day, d.clicks FROM daily_clicks d
          JOIN links l ON l.id = d.link_id WHERE l.enabled = 1 AND d.day >= ? AND d.day <= ? ORDER BY d.day`).all(startDay, endDay)) {
          if (!perLink.has(row.link_id)) perLink.set(row.link_id, []);
          perLink.get(row.link_id).push({ day: row.day, clicks: row.clicks });
        }
        const series = links.filter(link => link.enabled).map(link => ({
          id: link.id, label: link.label, slug: link.slug, daily: perLink.get(link.id) ?? [],
        }));
        return send(res, 200, { links, daily, series, chartStartDay: startDay, chartEndDay: endDay, range, origin });
      }
      if (path === "/api/admin/links" && req.method === "POST") {
        const values = validateLink(await readJson(req));
        if (db.prepare("SELECT 1 FROM links WHERE slug = ?").get(values[0])) throw new HttpError(409, "That slug is already in use.");
        const id = randomUUID();
        db.prepare("INSERT INTO links (id, slug, label, destination, source, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, ...values, new Date(now()).toISOString());
        return send(res, 201, { link: linkList().find(link => link.id === id) });
      }
      const match = path.match(/^\/api\/admin\/links\/([a-f0-9-]{36})$/);
      if (match && req.method === "PUT") {
        const existing = db.prepare("SELECT * FROM links WHERE id = ?").get(match[1]);
        if (!existing) throw new HttpError(404, "Link not found.");
        const values = validateLink(await readJson(req));
        if (values[0] !== existing.slug) throw new HttpError(400, "Slugs are permanent so published resume links keep working. Create a new link for a new slug.");
        db.prepare("UPDATE links SET slug = ?, label = ?, destination = ?, source = ?, enabled = ? WHERE id = ?").run(...values, existing.id);
        return send(res, 200, { link: linkList().find(link => link.id === existing.id) });
      }
      throw new HttpError(404, "Not found.");
    } catch (error) {
      if (res.destroyed) return;
      if (!(error instanceof HttpError)) console.error("Admin request failed:", error.message);
      send(res, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : "Something went wrong. Please try again." });
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  const cleanup = setInterval(() => {
    try { pruneCooldowns.run(now()); }
    catch (error) { console.error("Click cooldown cleanup failed:", error.message); }
  }, 60000);
  cleanup.unref();
  server.on("close", () => { clearInterval(cleanup); db.close(); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const passwordHash = process.env.ADMIN_PASSWORD_HASH_FILE
    ? readFileSync(process.env.ADMIN_PASSWORD_HASH_FILE, "utf8").trim()
    : process.env.ADMIN_PASSWORD_HASH;
  const server = createAdminServer({
    passwordHash, origin: process.env.APP_ORIGIN ?? "https://pixelware.nl",
    databasePath: process.env.ADMIN_DB_PATH ?? "./data/admin.sqlite",
    secureCookies: process.env.NODE_ENV !== "development",
  });
  server.listen(Number(process.env.PORT ?? 3031), process.env.HOST ?? "127.0.0.1", () => console.log("Admin service ready."));
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close());
}
