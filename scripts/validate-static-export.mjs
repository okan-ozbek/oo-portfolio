import assert from "node:assert/strict";
import { readFile, access, readdir } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

// Fail the Docker build instead of shipping a blank or partially exported site.
export async function validateStaticExport(directory) {
  const root = resolve(directory instanceof URL ? fileURLToPath(directory) : directory);
  const html = await readFile(resolve(root, "index.html"), "utf8");
  assert.match(html, /Pixelware - Complexity under control/);
  assert.match(html, /Complexity\./);
  assert.match(html, /Radish/);
  assert.equal([...html.matchAll(/<canvas\b/g)].length, 2, "Both animated panels must be exported");
  assert.match(html, /<script[^>]*>import\("\/assets\/[^"\s]+\.js"\)<\/script>/, "Client hydration bundle is required");
  const assets = new Set(["/favicon.svg", "/pixelware-logo.svg", "/index.rsc", "/404.html"]);
  for (const match of html.matchAll(/(?:src|href)="(\/[^"#]+)"/g)) assets.add(match[1].split("?")[0]);
  for (const match of html.matchAll(/import\("(\/assets\/[^"\s]+\.js)"\)/g)) assets.add(match[1]);
  for (const url of assets) {
    const file = resolve(root, `.${decodeURIComponent(url)}`);
    const path = relative(root, file);
    assert.ok(!path.startsWith("..") && !isAbsolute(path), "Asset must stay inside the static output");
    await access(file);
  }
  const files = await readdir(root, { recursive: true });
  assert.ok(!files.some(file => /(^|[\\/])(?:\.env|\.openai|server)(?:[.\\/]|$)/.test(file)), "Server configuration must not be in the web root");
  return { html, assets };
}
