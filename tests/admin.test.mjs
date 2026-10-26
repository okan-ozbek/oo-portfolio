import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createAdminServer } from "../server/admin-server.mjs";
import { hashPassword, verifyPassword } from "../server/security.mjs";

const origin = "https://pixelware.test";
const password = "test-only long admin password!";
const passwordHash = await hashPassword(password);

async function fixture(t, options = {}) {
  const server = createAdminServer({ origin, passwordHash, databasePath: ":memory:", ...options });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const close = () => new Promise((resolve, reject) => {
    if (!server.listening) return resolve();
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
  t.after(close);
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = "";
  let visitorCookie = "";
  let csrf = "";
  async function request(path, options = {}) {
    const method = options.method ?? "GET";
    const response = await fetch(`${base}${path}`, {
      ...options, redirect: "manual", signal: AbortSignal.timeout(10000),
      headers: {
        ...((cookie || visitorCookie) ? { Cookie: [cookie, visitorCookie].filter(Boolean).join("; ") } : {}),
        ...(method !== "GET" && method !== "HEAD" ? { Origin: origin, "Content-Type": "application/json", "X-CSRF-Token": csrf } : {}),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const visitor = response.headers.getSetCookie().find(value => /^(?:__Host-pixelware_click|pixelware_click_dev)=/.test(value));
    if (visitor) visitorCookie = visitor.split(";")[0];
    return response;
  }
  async function login() {
    const response = await request("/api/admin/login", { method: "POST", body: { password } });
    assert.equal(response.status, 200);
    cookie = response.headers.get("set-cookie").split(";")[0];
    csrf = (await response.json()).csrf;
    return { cookie, csrf, response };
  }
  return { request, login, close };
}

const linkBody = { label: "LinkedIn on resume", slug: "resume-linkedin", source: "Resume", destination: "https://www.linkedin.com/in/example?source=resume", enabled: true };

test("scrypt hashes differ, verify safely, and reject weak passwords/configuration", async () => {
  assert.equal(await verifyPassword(password, passwordHash), true);
  assert.equal(await verifyPassword("wrong password", passwordHash), false);
  assert.equal(await verifyPassword(null, passwordHash), false);
  assert.notEqual(await hashPassword(password), passwordHash);
  await assert.rejects(hashPassword("short"), /16 and 256/);
  assert.throws(() => createAdminServer({ origin, passwordHash: "plaintext", databasePath: ":memory:" }), /ADMIN_PASSWORD_HASH/);
  assert.throws(() => createAdminServer({ origin: "http://pixelware.test", passwordHash, databasePath: ":memory:" }), /HTTPS/);
});

test("private APIs require authentication; production session cookies and logout work", async t => {
  const app = await fixture(t);
  for (const path of ["/api/admin/links", "/api/admin/session"]) assert.equal((await app.request(path)).status, 401);
  const loginPage = await app.request("/admin");
  assert.equal(loginPage.status, 200);
  assert.equal(loginPage.headers.get("cache-control"), "no-store");
  assert.match(loginPage.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.doesNotMatch(await loginPage.text(), /scrypt-v1:/);
  assert.equal((await app.request("/api/admin/login", { method: "POST", body: { password: "wrong" } })).status, 401);
  const auth = await app.login();
  const cookie = auth.response.headers.get("set-cookie");
  for (const flag of ["__Host-pixelware_admin=", "Secure", "HttpOnly", "SameSite=Strict", "Path=/", "Max-Age=43200"]) assert.ok(cookie.includes(flag));
  assert.equal((await app.request("/api/admin/session")).status, 200);
  assert.equal((await app.request("/api/admin/links")).status, 200);
  assert.equal((await app.request("/api/admin/logout", { method: "POST", body: {} })).status, 200);
  assert.equal((await app.request("/api/admin/links")).status, 401);
});

test("origin, CSRF, JSON, and request-size checks reject unsafe mutations", async t => {
  const app = await fixture(t);
  assert.equal((await app.request("/api/admin/login", { method: "POST", headers: { Origin: "https://evil.test" }, body: { password } })).status, 403);
  await app.login();
  for (const token of ["", "wrong", "é".repeat(64)]) {
    assert.equal((await app.request("/api/admin/links", { method: "POST", headers: { "X-CSRF-Token": token }, body: linkBody })).status, 403);
  }
  assert.equal((await app.request("/api/admin/links", { method: "POST", headers: { Origin: "https://evil.test" }, body: linkBody })).status, 403);
  assert.equal((await app.request("/api/admin/links", { method: "POST", headers: { "Content-Type": "text/plain" }, body: linkBody })).status, 415);
  assert.equal((await app.request("/api/admin/links", { method: "POST", body: { ...linkBody, label: "a".repeat(9000) } })).status, 413);
  assert.equal((await app.request("/api/admin/links", { method: "POST", body: null })).status, 400);
});

test("create, edit, pause, and persist redirects with accurate UTC aggregate counts", async t => {
  const dir = await mkdtemp(join(tmpdir(), "pixelware-admin-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const databasePath = join(dir, "admin.sqlite");
  let clock = Date.parse("2026-10-25T23:59:59Z");
  const app = await fixture(t, { databasePath, now: () => clock });
  const auth = await app.login();
  const created = await app.request("/api/admin/links", { method: "POST", body: linkBody });
  assert.equal(created.status, 201);
  const { link } = await created.json();
  assert.equal(link.url, `${origin}/r/resume-linkedin`);
  assert.equal(link.clicks, 0);
  assert.equal((await app.request("/api/admin/links", { method: "POST", body: linkBody })).status, 409);
  for (const options of [{ method: "HEAD" }, { headers: { Purpose: "prefetch" } }, { headers: { "Sec-Purpose": "prefetch;prerender" } }]) {
    const response = await app.request("/r/resume-linkedin", options);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("set-cookie"), null);
  }
  const redirect = await app.request("/r/resume-linkedin?override=https://evil.test");
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), linkBody.destination);
  assert.equal(redirect.headers.get("cache-control"), "no-store");
  clock += 3600000;
  await app.request("/r/resume-linkedin");
  let data = await (await app.request("/api/admin/links")).json();
  assert.equal(data.links[0].clicks, 2);
  assert.equal(data.links[0].today, 1);
  assert.equal(data.links[0].last30Days, 2);
  assert.deepEqual(data.daily, [{ day: "2026-10-25", clicks: 1 }, { day: "2026-10-26", clicks: 1 }]);
  assert.equal((await app.request("/r/missing")).status, 404);
  assert.equal((await app.request("/r/resume-linkedin", { method: "POST", body: {} })).status, 405);
  const updatedBody = { ...linkBody, destination: "https://github.com/example", enabled: false };
  assert.equal((await app.request(`/api/admin/links/${link.id}`, { method: "PUT", body: updatedBody })).status, 200);
  assert.equal((await app.request("/r/resume-linkedin")).status, 404);
  assert.equal((await app.request(`/api/admin/links/${link.id}`, { method: "PUT", body: { ...updatedBody, enabled: true } })).status, 200);
  assert.equal((await app.request(`/api/admin/links/${link.id}`, { method: "PUT", body: { ...updatedBody, slug: "new-slug" } })).status, 400);
  assert.equal((await app.request("/r/resume-linkedin", { method: "HEAD" })).headers.get("location"), updatedBody.destination);
  await app.close();
  const inspect = new DatabaseSync(databasePath);
  const session = inspect.prepare("SELECT token_hash FROM sessions").get();
  const rawToken = auth.cookie.split("=")[1];
  assert.equal(session.token_hash, createHash("sha256").update(rawToken).digest("hex"));
  assert.notEqual(session.token_hash, rawToken);
  assert.deepEqual(inspect.prepare("PRAGMA table_info(daily_clicks)").all().map(row => row.name), ["link_id", "day", "clicks"]);
  inspect.close();
  const restarted = await fixture(t, { databasePath, now: () => clock });
  await restarted.login();
  data = await (await restarted.request("/api/admin/links")).json();
  assert.equal(data.links[0].clicks, 2);
  assert.equal(data.links[0].destination, updatedBody.destination);
  await restarted.close();
  assert.equal((await readFile(databasePath)).includes(Buffer.from(password)), false);
});

test("invalid destinations, credentials, looping targets, slugs, and fields are rejected", async t => {
  const app = await fixture(t);
  await app.login();
  for (const invalid of [
    { destination: "javascript:alert(1)" }, { destination: "data:text/html,hello" },
    { destination: "https://user:password@example.com" }, { destination: `${origin}/r/loop` },
    { destination: "/relative" }, { slug: "../admin" }, { slug: "Uppercase" },
    { slug: "double--hyphen" }, { slug: "a".repeat(81) }, { label: " " },
    { enabled: "true" }, { source: "a".repeat(101) },
  ]) {
    assert.equal((await app.request("/api/admin/links", { method: "POST", body: { ...linkBody, ...invalid } })).status, 400);
  }
});

test("one-hour cooldown is per browser/link, spans midnight, and is not extended by repeats", async t => {
  const started = Date.parse("2026-10-25T23:50:00Z");
  let clock = started;
  const app = await fixture(t, { now: () => clock });
  await app.login();
  await app.request("/api/admin/links", { method: "POST", body: linkBody });
  await app.request("/api/admin/links", { method: "POST", body: { ...linkBody, slug: "other-link" } });
  const first = await app.request(`/r/${linkBody.slug}`);
  const browser = first.headers.get("set-cookie").split(";")[0];
  for (const flag of ["__Host-pixelware_click=", "Secure", "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=3600"]) assert.ok(first.headers.get("set-cookie").includes(flag));
  clock += 10 * 60000;
  const repeated = await app.request(`/r/${linkBody.slug}?source=changed`, { headers: { Cookie: browser } });
  assert.equal(repeated.status, 302);
  assert.equal(repeated.headers.get("location"), linkBody.destination);
  let data = await (await app.request("/api/admin/links")).json();
  let link = data.links.find(link => link.slug === linkBody.slug);
  assert.equal(link.clicks, 1);
  assert.equal(link.today, 0, "Midnight must not reset a still-active cooldown");
  assert.equal(link.lastClickedAt, new Date(started).toISOString());
  await app.request("/r/other-link", { headers: { Cookie: browser } });
  await app.request(`/r/${linkBody.slug}`, { headers: { Cookie: "" } }); // Another browser counts independently.
  clock = started + 3600000 - 1;
  await app.request(`/r/${linkBody.slug}`, { headers: { Cookie: browser } });
  data = await (await app.request("/api/admin/links")).json();
  assert.equal(data.links.find(link => link.slug === linkBody.slug).clicks, 2);
  clock++;
  await app.request(`/r/${linkBody.slug}`, { headers: { Cookie: browser } });
  data = await (await app.request("/api/admin/links")).json();
  link = data.links.find(link => link.slug === linkBody.slug);
  assert.equal(link.clicks, 3, "The original browser counts again exactly one hour after its first counted click");
  assert.equal(link.today, 2);
  assert.equal(data.links.find(link => link.slug === "other-link").clicks, 1);
});

test("parallel clicks with the same browser cookie count only once", async t => {
  const app = await fixture(t);
  await app.login();
  await app.request("/api/admin/links", { method: "POST", body: linkBody });
  await app.request("/api/admin/links", { method: "POST", body: { ...linkBody, slug: "parallel-link" } });
  const first = await app.request(`/r/${linkBody.slug}`);
  const browser = first.headers.get("set-cookie").split(";")[0];
  const responses = await Promise.all(Array.from({ length: 12 }, () => app.request("/r/parallel-link", { headers: { Cookie: browser } })));
  for (const response of responses) assert.equal(response.status, 302);
  const data = await (await app.request("/api/admin/links")).json();
  assert.equal(data.links.find(link => link.slug === "parallel-link").clicks, 1);
});

test("cooldowns survive restarts, store only token hashes, and expire without losing click history", async t => {
  const dir = await mkdtemp(join(tmpdir(), "pixelware-cooldown-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const databasePath = join(dir, "admin.sqlite");
  const started = Date.parse("2026-10-26T10:00:00Z");
  let clock = started;
  const app = await fixture(t, { databasePath, now: () => clock });
  await app.login();
  await app.request("/api/admin/links", { method: "POST", body: linkBody });
  await app.request("/api/admin/links", { method: "POST", body: { ...linkBody, slug: "expiry-check" } });
  const response = await app.request(`/r/${linkBody.slug}`);
  const browser = response.headers.get("set-cookie").split(";")[0];
  const rawToken = browser.split("=")[1];
  await app.request("/r/expiry-check", { headers: { Cookie: browser } });
  await app.close();
  const inspect = new DatabaseSync(databasePath);
  const records = inspect.prepare("SELECT * FROM click_cooldowns").all();
  assert.equal(records.length, 2);
  assert.ok(records.every(row => row.visitor_hash === createHash("sha256").update(rawToken).digest("hex")));
  assert.ok(records.every(row => row.expires_at === started + 3600000));
  assert.deepEqual(inspect.prepare("PRAGMA table_info(click_cooldowns)").all().map(row => row.name), ["link_id", "visitor_hash", "expires_at"]);
  inspect.close();
  assert.equal((await readFile(databasePath)).includes(Buffer.from(rawToken)), false);
  clock += 30 * 60000;
  const restarted = await fixture(t, { databasePath, now: () => clock });
  await restarted.login();
  await restarted.request(`/r/${linkBody.slug}`, { headers: { Cookie: browser } });
  let data = await (await restarted.request("/api/admin/links")).json();
  assert.equal(data.links.find(link => link.slug === linkBody.slug).clicks, 1);
  clock += 30 * 60000;
  await restarted.request(`/r/${linkBody.slug}`, { headers: { Cookie: browser } });
  data = await (await restarted.request("/api/admin/links")).json();
  assert.equal(data.links.find(link => link.slug === linkBody.slug).clicks, 2);
  assert.equal(data.links.find(link => link.slug === "expiry-check").clicks, 1);
  await restarted.close();
  const afterExpiry = new DatabaseSync(databasePath);
  assert.equal(afterExpiry.prepare("SELECT COUNT(*) AS count FROM click_cooldowns").get().count, 1);
  afterExpiry.close();
});

test("invalid visitor cookies are replaced; preview and missing routes never set one", async t => {
  const app = await fixture(t, { secureCookies: false });
  await app.login();
  await app.request("/api/admin/links", { method: "POST", body: linkBody });
  for (const options of [{ method: "HEAD" }, { headers: { Purpose: "prefetch" } }, { headers: { "Sec-Purpose": "prerender" } }]) {
    const response = await app.request(`/r/${linkBody.slug}`, options);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("set-cookie"), null);
  }
  assert.equal((await app.request("/r/not-found")).headers.get("set-cookie"), null);
  const first = await app.request(`/r/${linkBody.slug}`, { headers: { Cookie: "pixelware_click_dev=invalid" } });
  const cookie = first.headers.get("set-cookie");
  assert.match(cookie, /^pixelware_click_dev=[a-f0-9]{64};/);
  assert.doesNotMatch(cookie, /Secure/);
  await app.request(`/r/${linkBody.slug}`, { headers: { Cookie: cookie.split(";")[0], "Sec-Fetch-Site": "cross-site" } });
  const data = await (await app.request("/api/admin/links")).json();
  assert.equal(data.links[0].clicks, 1);
});

test("activity separates active links, includes zero-click links, and restores paused history", async t => {
  const app = await fixture(t, { now: () => Date.parse("2026-10-26T12:00:00Z") });
  await app.login();
  const create = async slug => {
    const response = await app.request("/api/admin/links", { method: "POST", body: { ...linkBody, slug, label: slug } });
    assert.equal(response.status, 201);
    return (await response.json()).link;
  };
  const first = await create("resume-first");
  const second = await create("resume-second");
  const empty = await create("resume-zero");
  await app.request("/r/resume-first");
  await app.request("/r/resume-first", { headers: { Cookie: "" } }); // A second browser.
  await app.request("/r/resume-second");
  const activity = async () => (await app.request("/api/admin/links")).json();
  let data = await activity();
  assert.equal(data.chartEndDay, "2026-10-26");
  assert.deepEqual(data.series.find(link => link.id === first.id).daily, [{ day: "2026-10-26", clicks: 2 }]);
  assert.deepEqual(data.series.find(link => link.id === second.id).daily, [{ day: "2026-10-26", clicks: 1 }]);
  assert.deepEqual(data.series.find(link => link.id === empty.id).daily, []);
  const update = enabled => app.request(`/api/admin/links/${first.id}`, {
    method: "PUT", body: { ...linkBody, slug: first.slug, label: first.label, enabled },
  });
  assert.equal((await update(false)).status, 200);
  data = await activity();
  assert.equal(data.series.some(link => link.id === first.id), false);
  assert.equal(data.links.find(link => link.id === first.id).clicks, 2);
  assert.equal(data.series.length, 2);
  assert.equal((await update(true)).status, 200);
  data = await activity();
  assert.deepEqual(data.series.find(link => link.id === first.id).daily, [{ day: "2026-10-26", clicks: 2 }]);
});

test("quick activation changes only status and preserves redirect settings, history, and cooldown", async t => {
  const app = await fixture(t);
  await app.login();
  const link = (await (await app.request("/api/admin/links", { method: "POST", body: linkBody })).json()).link;
  await app.request(`/r/${link.slug}`);
  const patch = body => app.request(`/api/admin/links/${link.id}`, { method: "PATCH", body });
  for (const body of [{ enabled: "false" }, {}, { enabled: false, destination: "https://example.com/" }]) assert.equal((await patch(body)).status, 400);
  const paused = await patch({ enabled: false });
  assert.equal(paused.status, 200);
  assert.equal((await paused.json()).link.enabled, false);
  assert.equal((await app.request(`/r/${link.slug}`)).status, 404);
  let data = await (await app.request("/api/admin/links")).json();
  assert.equal(data.links[0].clicks, 1);
  assert.equal(data.series.length, 0);
  const activated = await patch({ enabled: true });
  assert.equal(activated.status, 200);
  const active = (await activated.json()).link;
  assert.equal(active.enabled, true);
  for (const field of ["label", "slug", "source", "destination"]) assert.equal(active[field], link[field]);
  assert.equal((await app.request(`/r/${link.slug}`)).status, 302);
  data = await (await app.request("/api/admin/links")).json();
  assert.equal(data.links[0].clicks, 1, "Reactivating must not reset the existing browser cooldown");
  assert.equal(data.series.length, 1);
});

test("permanent deletion removes redirects, all link history and cooldowns, while preserving other links", async t => {
  const dir = await mkdtemp(join(tmpdir(), "pixelware-delete-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const databasePath = join(dir, "admin.sqlite");
  const app = await fixture(t, { databasePath });
  await app.login();
  const create = async slug => (await (await app.request("/api/admin/links", { method: "POST", body: { ...linkBody, slug } })).json()).link;
  const removed = await create("delete-this-link");
  const kept = await create("keep-this-link");
  const firstClick = await app.request(`/r/${removed.slug}`);
  const browser = firstClick.headers.get("set-cookie").split(";")[0];
  await app.request(`/r/${kept.slug}`);
  const deletion = await app.request(`/api/admin/links/${removed.id}`, { method: "DELETE", body: {} });
  assert.equal(deletion.status, 200);
  assert.deepEqual(await deletion.json(), { ok: true });
  for (const method of ["GET", "HEAD"]) assert.equal((await app.request(`/r/${removed.slug}`, { method })).status, 404);
  assert.equal((await app.request(`/api/admin/links/${removed.id}`, { method: "DELETE", body: {} })).status, 404);
  assert.equal((await app.request(`/api/admin/links/${removed.id}`, { method: "PATCH", body: { enabled: true } })).status, 404);
  const data = await (await app.request("/api/admin/links?range=year")).json();
  assert.equal(data.links.length, 1);
  assert.equal(data.links[0].id, kept.id);
  assert.equal(data.links[0].clicks, 1);
  assert.equal(data.series.length, 1);
  assert.equal(data.series[0].id, kept.id);
  assert.equal(data.daily.reduce((sum, day) => sum + day.clicks, 0), 1);
  const inspect = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(inspect.prepare("SELECT COUNT(*) AS n FROM links WHERE id = ?").get(removed.id).n, 0);
  for (const table of ["daily_clicks", "click_cooldowns"]) {
    assert.equal(inspect.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE link_id = ?`).get(removed.id).n, 0);
    assert.equal(inspect.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE link_id = ?`).get(kept.id).n, 1);
  }
  inspect.close();
  await app.close();
  const restarted = await fixture(t, { databasePath });
  await restarted.login();
  assert.equal((await restarted.request(`/r/${removed.slug}`)).status, 404);
  const recreated = (await (await restarted.request("/api/admin/links", { method: "POST", body: { ...linkBody, slug: removed.slug } })).json()).link;
  assert.notEqual(recreated.id, removed.id);
  assert.equal(recreated.clicks, 0);
  await restarted.request(`/r/${recreated.slug}`, { headers: { Cookie: browser } });
  const after = await (await restarted.request("/api/admin/links")).json();
  assert.equal(after.links.find(link => link.id === recreated.id).clicks, 1, "A recreated slug must not inherit the deleted link's cooldown or history");
  await restarted.close();
});

test("deletion and quick activation require authentication, same-origin requests, and CSRF", async t => {
  const app = await fixture(t);
  const missing = "/api/admin/links/00000000-0000-0000-0000-000000000000";
  for (const method of ["PATCH", "DELETE"]) assert.equal((await app.request(missing, { method, body: { enabled: true } })).status, 401);
  await app.login();
  const link = (await (await app.request("/api/admin/links", { method: "POST", body: linkBody })).json()).link;
  for (const method of ["PATCH", "DELETE"]) {
    const path = `/api/admin/links/${link.id}`;
    assert.equal((await app.request(path, { method, headers: { "X-CSRF-Token": "" }, body: { enabled: false } })).status, 403);
    assert.equal((await app.request(path, { method, headers: { Origin: "https://evil.test" }, body: { enabled: false } })).status, 403);
    assert.equal((await app.request(path, { method, headers: { "Content-Type": "text/plain" }, body: { enabled: false } })).status, 415);
    assert.equal((await app.request(missing, { method, body: { enabled: false } })).status, 404);
  }
  const data = await (await app.request("/api/admin/links")).json();
  assert.equal(data.links.length, 1);
  assert.equal(data.links[0].enabled, true);
});

test("sessions expire and password rotation invalidates previous cookies", async t => {
  const dir = await mkdtemp(join(tmpdir(), "pixelware-session-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const databasePath = join(dir, "admin.sqlite");
  let clock = Date.now();
  const app = await fixture(t, { databasePath, now: () => clock });
  const auth = await app.login();
  clock += 12 * 60 * 60 * 1000;
  assert.equal((await app.request("/api/admin/links")).status, 401);
  await app.close();
  const rotated = await fixture(t, { databasePath, passwordHash: await hashPassword("a different long password!"), now: () => clock - 1000 });
  assert.equal((await rotated.request("/api/admin/links", { headers: { Cookie: auth.cookie } })).status, 401);
  await rotated.close();
});

test("activity ranges filter historical clicks without changing the summary cards", async t => {
  let clock = Date.parse("2025-10-26T12:00:00Z");
  const app = await fixture(t, { now: () => clock });
  await app.login();
  assert.equal((await app.request("/api/admin/links", { method: "POST", body: linkBody })).status, 201);
  for (const day of ["2025-10-26", "2025-10-27", "2026-07-26", "2026-07-27", "2026-09-26", "2026-09-27", "2026-10-19", "2026-10-20", "2026-10-26"]) {
    clock = Date.parse(`${day}T12:00:00Z`);
    assert.equal((await app.request(`/r/${linkBody.slug}`)).status, 302);
  }
  await app.login();
  for (const [range, start, clicks] of [["7d", "2026-10-20", 2], ["30d", "2026-09-27", 4], ["quarter", "2026-07-27", 6], ["year", "2025-10-27", 8]]) {
    const response = await app.request(`/api/admin/links?range=${range}`);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.range, range);
    assert.equal(data.chartStartDay, start);
    assert.equal(data.chartEndDay, "2026-10-26");
    assert.equal(data.series[0].daily.reduce((sum, day) => sum + day.clicks, 0), clicks);
    assert.equal(data.links[0].clicks, 9);
    assert.equal(data.links[0].last30Days, 4);
    assert.equal(data.links[0].today, 1);
  }
  assert.equal((await app.request("/api/admin/links?range=all-time")).status, 400);
  assert.equal((await (await app.request("/api/admin/links")).json()).range, "30d");
});

test("rolling calendar ranges clamp month ends and handle leap years in UTC", async t => {
  let clock = Date.parse("2025-05-31T23:59:59Z");
  const app = await fixture(t, { now: () => clock });
  await app.login();
  for (const [end, range, start] of [
    ["2025-01-03", "7d", "2024-12-28"],
    ["2024-03-01", "7d", "2024-02-24"],
    ["2025-05-31", "quarter", "2025-03-01"],
    ["2024-05-31", "quarter", "2024-03-01"],
    ["2024-02-29", "year", "2023-03-01"],
    ["2025-02-28", "year", "2024-02-29"],
  ]) {
    clock = Date.parse(`${end}T23:59:59Z`);
    const data = await (await app.request(`/api/admin/links?range=${range}`)).json();
    assert.equal(data.chartStartDay, start);
    assert.equal(data.chartEndDay, end);
  }
});

test("login failure limits survive restart and reset after their window", async t => {
  const dir = await mkdtemp(join(tmpdir(), "pixelware-limit-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const databasePath = join(dir, "admin.sqlite");
  let clock = Date.now();
  const app = await fixture(t, { databasePath, now: () => clock });
  for (let index = 0; index < 10; index++) {
    assert.equal((await app.request("/api/admin/login", { method: "POST", body: { password: "wrong" } })).status, 401);
  }
  await app.close();
  const restarted = await fixture(t, { databasePath, now: () => clock });
  const limited = await restarted.request("/api/admin/login", { method: "POST", body: { password } });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "900");
  clock += 15 * 60000;
  await restarted.login();
  await restarted.close();
});
