import test from "node:test";
import assert from "node:assert/strict";
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
