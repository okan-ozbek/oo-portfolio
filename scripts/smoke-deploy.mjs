import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
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
  const production = JSON.parse(docker("compose", "-f", join(root, "compose.vps.yaml"), "config", "--format", "json"));
  assert.deepEqual(Object.keys(production.services).sort(), ["admin", "compiler", "portfolio"], "The VPS deployment must reuse its external HTTPS proxy");
  assert.equal(production.networks.compilation.internal, true);
  assert.equal(production.services.compiler.read_only, true);
  assert.equal(production.services.compiler.ports, undefined);
  assert.equal(production.services.compiler.secrets, undefined);
  assert.equal(production.services.compiler.volumes, undefined);
  assert.equal(production.networks.proxy.external, true);
  assert.equal(production.networks.proxy.name, "pixelware-proxy");
  assert.ok(production.services.portfolio.networks.proxy.aliases.includes("portfolio-web"));
  const service = {
    ...production.services.admin,
    image,
    build: { context: root, dockerfile: "deploy/Dockerfile.admin" },
    environment: { ...production.services.admin.environment, APP_ORIGIN: "https://pixelware.test" },
    ports: ["127.0.0.1::3031"],
    restart: "no",
    networks: { default: {} },
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
  const firstClick = await request(base, "/r/deploy-check");
  assert.equal(firstClick.status, 302);
  headers.Cookie += `; ${firstClick.headers.get("set-cookie").split(";")[0]}`;
  // Seed one synthetic compiled resume without making this persistence check
  // depend on TeX. Real compilation is covered by the dedicated compiler smoke.
  const resumeId = randomUUID();
  const pdf = Buffer.from('%PDF-1.7\nDeployment persistence fixture');
  const seed = `import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync('/data/admin.sqlite'); db.exec('PRAGMA foreign_keys=ON');
    const pdf = Buffer.from('${pdf.toString('base64')}', 'base64');
    db.prepare('INSERT INTO resumes(id,name,slug,main_file,files_json,scan_json,original_pdf,draft_pdf,published_pdf,pages,created_at,compiled_at,published_at,published_version) VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?,1)')
      .run('${resumeId}', 'Deployment resume', 'deploy-resume', 'main.tex', '[]', '[]', pdf, pdf, pdf, '2026-10-26', '2026-10-26', '2026-10-26');
    db.prepare('UPDATE resume_settings SET default_resume_id = ? WHERE id = 1').run('${resumeId}');
    db.prepare('INSERT INTO resume_links VALUES(?,?,?,?,1)').run('${resumeId}', 'fixture', 'https://example.com/', '${originalLink.id}');
    db.close();`;
  docker('exec', originalContainer, 'node', '--input-type=module', '-e', seed);
  assert.deepEqual(Buffer.from(await (await request(base, '/resume.pdf', { headers })).arrayBuffer()), pdf);
  assert.equal((await (await request(base, `/api/admin/resumes/${resumeId}`, { headers })).json()).resume.downloads, 1);

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
  assert.equal((await request(base, "/r/deploy-check", { headers })).status, 302);
  assert.equal((await (await request(base, "/api/admin/links", { headers })).json()).links[0].clicks, 1, "The browser cooldown must survive container replacement");
  assert.deepEqual(Buffer.from(await (await request(base, '/resume.pdf', { headers })).arrayBuffer()), pdf, 'The published PDF must survive a rebuilt release');
  const savedResume = (await (await request(base, `/api/admin/resumes/${resumeId}`, { headers })).json()).resume;
  assert.equal(savedResume.downloads, 1, 'Download history and browser cooldown must survive replacement');
  assert.equal(savedResume.isDefault, true);
  assert.equal(savedResume.clicks, 1, 'Resume ownership of click history must survive replacement');
  assert.equal((await request(base, "/r/deploy-check")).status, 302); // New browser.
  assert.equal((await (await request(base, "/api/admin/links", { headers })).json()).links[0].clicks, 2);
  console.log("Deployment smoke passed: two rebuilt releases, same volume, links, published PDF, resume mappings, download/click history, sessions, and browser cooldowns.");
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
