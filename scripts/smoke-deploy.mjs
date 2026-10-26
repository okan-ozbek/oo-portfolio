import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { hashPassword } from "../server/security.mjs";

// This test owns a unique Compose project, image, volume, and temporary directory.
// It never operates on the production project or the local development database.
const project = `pixelware-deploy-test-${randomBytes(6).toString("hex")}`;
const directory = mkdtempSync(join(tmpdir(), "pixelware-deploy-test-"));
const root = fileURLToPath(new URL("../", import.meta.url));
const image = `${project}:test`;
const secret = join(directory, "password-hash");
const password = randomBytes(24).toString("base64url");
writeFileSync(secret, await hashPassword(password), { mode: 0o444 });
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", timeout: 300000 }).trim();
let release;
let started = false;
const compose = (...args) => docker("compose", "-p", project, "-f", release, ...args);

async function request(base, path, options = {}) {
  return fetch(`${base}${path}`, { ...options, redirect: "manual", signal: AbortSignal.timeout(10000) });
}
function container() { return compose("ps", "-q", "admin"); }
function baseUrl() { return `http://127.0.0.1:${compose("port", "admin", "3031").split(":").at(-1)}`; }
function dataVolume(id) {
  const [info] = JSON.parse(docker("inspect", id));
  return info.Mounts.find(mount => mount.Destination === "/data").Name;
}
try {
  const production = JSON.parse(docker("compose", "-f", join(root, "compose.yaml"), "config", "--format", "json"));
  const service = {
    ...production.services.admin,
    image,
    build: { context: root, dockerfile: "deploy/Dockerfile.admin" },
    environment: { ...production.services.admin.environment, APP_ORIGIN: "https://pixelware.test" },
    ports: ["127.0.0.1::3031"],
    restart: "no",
    // The production command probes readiness immediately; shorten only its
    // recurring interval here so the isolated test doesn't wait 30 seconds.
    healthcheck: { ...production.services.admin.healthcheck, interval: "1s", timeout: "3s", start_period: "1s", retries: 30 },
  };
  const configuration = {
    services: { admin: service },
    secrets: { admin_password_hash: { file: secret } },
    volumes: { admin_data: {} },
    networks: { default: {} },
  };
  const releases = ["release-one", "release-two"].map(name => {
    const path = join(directory, name);
    mkdirSync(path);
    const file = join(path, "compose.json");
    writeFileSync(file, JSON.stringify(configuration));
    return file;
  });
  release = releases[0];
  started = true;
  compose("up", "-d", "--build", "--force-recreate", "--wait", "--wait-timeout", "90");
  const originalContainer = container();
  const originalVolume = dataVolume(originalContainer);
  let base = baseUrl();
  const headers = { Origin: "https://pixelware.test", "Content-Type": "application/json" };
  const login = await request(base, "/api/admin/login", { method: "POST", headers, body: JSON.stringify({ password }) });
  assert.equal(login.status, 200);
  headers.Cookie = login.headers.get("set-cookie").split(";")[0];
  headers["X-CSRF-Token"] = (await login.json()).csrf;
  const created = await request(base, "/api/admin/links", {
    method: "POST", headers, body: JSON.stringify({ label: "Preserve across deployments", slug: "deploy-check", destination: "https://example.com/", source: "Isolated deployment test" }),
  });
  assert.equal(created.status, 201);
  const originalLink = (await created.json()).link;
  assert.equal((await request(base, "/r/deploy-check")).status, 302);

  // Match production's new release directory and forced container replacement.
  release = releases[1];
  compose("up", "-d", "--build", "--force-recreate", "--wait", "--wait-timeout", "90");
  const replacementContainer = container();
  assert.notEqual(replacementContainer, originalContainer, "The test must replace the container, not just restart it");
  assert.equal(dataVolume(replacementContainer), originalVolume, "Both releases must mount the same database volume");
  base = baseUrl();
  const response = await request(base, "/api/admin/links", { headers });
  assert.equal(response.status, 200, "The existing session must remain valid");
  const { links } = await response.json();
  assert.equal(links.length, 1);
  assert.equal(links[0].id, originalLink.id);
  assert.equal(links[0].destination, "https://example.com/");
  assert.equal(links[0].clicks, 1, "Existing click counts must survive a rebuilt release");
  assert.equal((await request(base, "/r/deploy-check")).status, 302);
  assert.equal((await (await request(base, "/api/admin/links", { headers })).json()).links[0].clicks, 2);
  console.log("Deployment smoke passed: two built releases, different containers, same volume, saved links, click history, and sessions.");
} catch (error) {
  if (started) {
    try { console.error(compose("logs", "--tail", "30")); } catch { /* Keep the original failure. */ }
  }
  throw error;
} finally {
  // Only dispose of this randomly named test project and its synthetic data.
  try {
    if (started) compose("down", "--volumes", "--rmi", "all");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
