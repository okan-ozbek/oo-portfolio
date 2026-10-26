import assert from "node:assert/strict";

const base = new URL(process.env.PIXELWARE_URL ?? "https://pixelware.nl");
async function request(path, headers = {}) {
  return fetch(new URL(path, base), { headers, signal: AbortSignal.timeout(10_000) });
}
if (base.protocol === "https:") {
  const insecure = new URL("/favicon.svg?redirect-check=1", base);
  insecure.protocol = "http:";
  const redirect = await fetch(insecure, {
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(redirect.status, 308, "HTTP must redirect permanently to HTTPS");
  assert.equal(redirect.headers.get("location"), new URL("/favicon.svg?redirect-check=1", base).href);
  await redirect.arrayBuffer();
}
const health = await request("/healthz");
assert.equal(health.status, 200);
assert.equal((await health.text()).trim(), "ok");
const home = await request("/");
assert.equal(home.status, 200);
assert.match(home.headers.get("content-type") ?? "", /text\/html/);
assert.equal(home.headers.get("x-content-type-options"), "nosniff");
assert.match(home.headers.get("cache-control") ?? "", /no-cache/);
const html = await home.text();
assert.match(html, /Pixelware - Complexity under control/);
const script = html.match(/import\("(\/assets\/[^"\s]+\.js)"\)/)?.[1];
assert.ok(script, "Page must load a hydration bundle");
const asset = await request(script);
assert.equal(asset.status, 200);
assert.match(asset.headers.get("content-type") ?? "", /javascript/);
assert.match(asset.headers.get("cache-control") ?? "", /max-age=31536000/);
assert.match(asset.headers.get("cache-control") ?? "", /immutable/);
assert.equal(asset.headers.get("x-content-type-options"), "nosniff");
await asset.arrayBuffer();
// Emulate the Via header Caddy adds, including for cached immutable assets.
for (const path of ["/", script, "/index.rsc"]) {
  const compressed = await request(path, { "Accept-Encoding": "gzip", Via: "1.1 compression-smoke" });
  const identity = await request(path, { "Accept-Encoding": "identity" });
  assert.equal(compressed.status, 200);
  assert.equal(compressed.headers.get("content-encoding"), "gzip", `${path} must compress behind Caddy`);
  assert.match(compressed.headers.get("vary") ?? "", /Accept-Encoding/i);
  assert.equal(identity.headers.get("content-encoding"), null);
  assert.ok(Number(compressed.headers.get("content-length")) < Number(identity.headers.get("content-length")), "NGINX must serve the smaller precompressed file");
  // Fetch decodes gzip automatically.
  assert.deepEqual(new Uint8Array(await compressed.arrayBuffer()), new Uint8Array(await identity.arrayBuffer()));
  const cached = await request(path, { "Accept-Encoding": "identity", "If-None-Match": identity.headers.get("etag") });
  assert.equal(cached.status, 304, `${path} must support conditional cache revalidation`);
}
for (const path of ["/favicon.svg", "/pixelware-logo.svg"]) {
  const icon = await request(path);
  assert.equal(icon.status, 200);
  assert.match(icon.headers.get("content-type") ?? "", /image\/svg\+xml/);
  await icon.arrayBuffer();
}
const rsc = await request("/index.rsc");
assert.equal(rsc.status, 200);
assert.match(rsc.headers.get("content-type") ?? "", /text\/x-component/);
await rsc.arrayBuffer();
const sitemap = await request("/sitemap.xml");
assert.equal(sitemap.status, 200);
assert.match(sitemap.headers.get("content-type") ?? "", /(?:application|text)\/xml/);
assert.match(await sitemap.text(), /<loc>https:\/\/pixelware\.nl\/<\/loc>/);
const robots = await request("/robots.txt");
assert.equal(robots.status, 200);
assert.match(robots.headers.get("content-type") ?? "", /text\/plain/);
assert.match(await robots.text(), /Sitemap: https:\/\/pixelware\.nl\/sitemap\.xml/);
for (const path of ["/missing-page", "/assets/missing.js"]) {
  const missing = await request(path);
  assert.equal(missing.status, 404, `${path} must not silently serve the homepage`);
  assert.doesNotMatch(missing.headers.get("cache-control") ?? "", /immutable/);
  await missing.arrayBuffer();
}
const secret = await request("/.env");
assert.ok([403, 404].includes(secret.status));
await secret.arrayBuffer();
console.log(`NGINX smoke checks passed at ${base.origin}: page, health, hydration bundle, icons, RSC, sitemap, robots, immutable caching, proxied gzip, conditional requests, and 404s.`);
