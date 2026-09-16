import assert from "node:assert/strict";

const base = new URL(process.env.PIXELWARE_URL ?? "https://pixelware.nl");
async function request(path) {
  return fetch(new URL(path, base), { signal: AbortSignal.timeout(10_000) });
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
await asset.arrayBuffer();
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
for (const path of ["/missing-page", "/assets/missing.js"]) {
  const missing = await request(path);
  assert.equal(missing.status, 404, `${path} must not silently serve the homepage`);
  await missing.arrayBuffer();
}
const secret = await request("/.env");
assert.ok([403, 404].includes(secret.status));
await secret.arrayBuffer();
console.log(`NGINX smoke checks passed at ${base.origin}: page, health, hydration bundle, icons, RSC, caching, and 404s.`);
