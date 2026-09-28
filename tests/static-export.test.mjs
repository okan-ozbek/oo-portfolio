import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateStaticExport } from "../scripts/validate-static-export.mjs";

test("NGINX output contains the page, hydration scripts, and every referenced local asset", async () => {
  const { html, assets } = await validateStaticExport(new URL("../dist/client/", import.meta.url));
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  for (const match of html.matchAll(/(?:href="#|aria-controls=")([^" ]+)"/g)) {
    assert.ok(ids.has(match[1]), `Missing navigation or disclosure target: ${match[1]}`);
  }
  assert.ok([...assets].some(asset => asset.endsWith(".js")));
  assert.ok([...assets].some(asset => asset.endsWith(".css")));
});

test("export advertises only the canonical homepage and links its sitemap from robots.txt", async () => {
  const sitemap = await readFile(new URL("../dist/client/sitemap.xml", import.meta.url), "utf8");
  const robots = await readFile(new URL("../dist/client/robots.txt", import.meta.url), "utf8");
  assert.match(sitemap, /<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
  assert.deepEqual([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]), ["https://pixelware.nl/"]);
  assert.match(robots, /^User-agent: \*\r?\nAllow: \/$/m);
  assert.match(robots, /^Sitemap: https:\/\/pixelware\.nl\/sitemap\.xml$/m);
});
