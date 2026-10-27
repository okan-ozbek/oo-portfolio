import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { hashPassword } from "../server/security.mjs";

// Isolated resources only; no production Compose project, ports, or volumes.
const id = `pixelware-smoke-${randomBytes(6).toString("hex")}`;
const directory = mkdtempSync(join(tmpdir(), "pixelware-container-"));
const root = fileURLToPath(new URL("../", import.meta.url));
const password = randomBytes(24).toString("base64url");
const secret = join(directory, "password-hash");
writeFileSync(secret, await hashPassword(password));
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", timeout: 180000 }).trim();
const created = [];
let networkCreated = false;
let volumeCreated = false;
try {
  docker('build', '-f', 'deploy/Dockerfile.admin', '-t', `${id}:admin`, root);
  docker('build', '-f', 'deploy/Dockerfile.compiler', '-t', `${id}:compiler`, root);
  docker("network", "create", id);
  networkCreated = true;
  docker("volume", "create", `${id}-data`);
  volumeCreated = true;
  docker('run', '-d', '--name', `${id}-compiler`, '--network', id, '--network-alias', 'compiler', '--read-only', '--tmpfs', '/tmp:size=128m,mode=1777', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--memory', '768m', '--pids-limit', '64', `${id}:compiler`);
  created.push(`${id}-compiler`);
  docker("run", "-d", "--name", `${id}-admin`, "--network", id, "--network-alias", "admin",
    "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--tmpfs", "/tmp",
    "--mount", `type=volume,source=${id}-data,target=/data`,
    "--mount", `type=bind,source=${secret},target=/run/secrets/admin_password_hash,readonly`,
    "-e", "ADMIN_PASSWORD_HASH_FILE=/run/secrets/admin_password_hash", "-e", "APP_ORIGIN=https://pixelware.test", '-e', 'RESUME_COMPILER_URL=http://compiler:3032', `${id}:admin`);
  created.push(`${id}-admin`);
  docker("run", "-d", "--name", `${id}-nginx`, "--network", id,
    "--read-only", "--user", "nginx", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--tmpfs", "/tmp",
    "-p", "127.0.0.1::8080", "--mount", `type=bind,source=${join(root, "deploy", "nginx.conf")},target=/etc/nginx/nginx.conf,readonly`,
    "--mount", `type=bind,source=${join(root, "dist", "client")},target=/usr/share/nginx/html,readonly`,
    "--entrypoint", "nginx", "nginx:stable-alpine", "-g", "daemon off;");
  created.push(`${id}-nginx`);
  const port = docker("port", `${id}-nginx`, "8080/tcp").split(":").at(-1);
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { if ((await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch { /* Startup race. */ }
    await setTimeout(200);
  }
  assert.ok(ready, "NGINX must become ready");
  assert.equal((await fetch(`${base}/`)).status, 200);
  const page = await fetch(`${base}/admin`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Analytics · Pixelware<\/title>/);
  assert.equal((await fetch(`${base}/admin/assets/admin.js`)).status, 200);
  assert.equal((await fetch(`${base}/admin/assets/resumes.js`)).status, 200);
  assert.equal((await fetch(`${base}/api/admin/links`)).status, 401);
  const headers = { Origin: "https://pixelware.test", "Content-Type": "application/json" };
  const login = await fetch(`${base}/api/admin/login`, { method: "POST", headers, body: JSON.stringify({ password }) });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /Secure/);
  headers.Cookie = login.headers.get("set-cookie").split(";")[0];
  headers["X-CSRF-Token"] = (await login.json()).csrf;
  const response = await fetch(`${base}/api/admin/links`, {
    method: "POST", headers,
    body: JSON.stringify({ label: "Container smoke test", slug: "container-smoke", destination: "https://github.com/okan-ozbek", source: "Disposable container test" }),
  });
  assert.equal(response.status, 201);
  const redirect = await fetch(`${base}/r/container-smoke`, { redirect: "manual" });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), "https://github.com/okan-ozbek");
  assert.equal(redirect.headers.get("cache-control"), "no-store");
  const visitorCookie = redirect.headers.get("set-cookie");
  assert.match(visitorCookie, /SameSite=Lax/);
  assert.match(visitorCookie, /Max-Age=3600/);
  headers.Cookie += `; ${visitorCookie.split(";")[0]}`;
  assert.equal((await fetch(`${base}/r/container-smoke`, { headers, redirect: "manual" })).status, 302);
  const stats = await (await fetch(`${base}/api/admin/links`, { headers })).json();
  assert.equal(stats.links[0].clicks, 1);
  const upload = { name: 'Container resume', slug: 'container-resume', mainFile: 'main.tex', files: ['main.tex', 'styles/resume.sty'].map(path => ({ path, content: readFileSync(join(root, 'tests/fixtures/resume', path)).toString('base64') })) };
  // The request is deliberately larger than the normal 8 KB admin body limit.
  upload.files[0].content = Buffer.from(readFileSync(join(root, 'tests/fixtures/resume/main.tex'), 'utf8') + '\n%' + ' supporting project upload '.repeat(500)).toString('base64');
  const uploaded = await fetch(`${base}/api/admin/resumes`, { method: 'POST', headers, body: JSON.stringify(upload) });
  const uploadedBody = await uploaded.json(); assert.equal(uploaded.status, 201, JSON.stringify(uploadedBody));
  const resumePath = `/api/admin/resumes/${uploadedBody.resume.id}`;
  const selected = uploadedBody.resume.links.filter(link => link.trackable).map((link, index) => ({ key: link.key, tracked: true, slug: `container-resume-${index}`, label: `Resume link ${index}` }));
  assert.equal((await fetch(`${base}${resumePath}/compile`, { method: 'POST', headers, body: JSON.stringify({ links: selected }) })).status, 200);
  assert.equal((await fetch(`${base}/resumes/container-resume.pdf`, { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(`${base}${resumePath}`, { method: 'PATCH', headers, body: JSON.stringify({ isDefault: true }) })).status, 200);
  assert.equal((await (await fetch(`${base}/api/public/resume`)).json()).available, true);
  const downloaded = await fetch(`${base}/resume.pdf`, { headers });
  assert.equal(downloaded.status, 200); assert.equal(downloaded.headers.get('content-type'), 'application/pdf');
  const publishedBytes = Buffer.from(await downloaded.arrayBuffer()); assert.equal(publishedBytes.subarray(0,5).toString(), '%PDF-');
  assert.equal((await fetch(`${base}/resumes/container-resume.pdf`, { headers })).status, 200);
  assert.equal((await (await fetch(`${base}${resumePath}`, { headers })).json()).resume.downloads, 1);
  docker("restart", `${id}-admin`);
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const result = await fetch(`${base}/api/admin/links`, { headers, signal: AbortSignal.timeout(1000) });
      if (result.ok) { assert.equal((await result.json()).links.find(link => link.slug === 'container-smoke').clicks, 1); ready = true; break; }
    } catch { /* Restart race. */ }
    ready = false;
    await setTimeout(200);
  }
  assert.ok(ready, "Sessions and counts must survive a container restart");
  assert.deepEqual(Buffer.from(await (await fetch(`${base}/resume.pdf`, { headers })).arrayBuffer()), publishedBytes);
  assert.equal((await (await fetch(`${base}${resumePath}`, { headers })).json()).resume.downloads, 1, 'PDF and download cooldown survive restart');
  console.log("Container smoke passed: NGINX + admin + real compiler, large project upload, immediate PDF updates/downloads, auth, redirects, and restart persistence.");
} catch (error) {
  for (const name of created) console.error(docker("logs", "--tail", "30", name));
  throw error;
} finally {
  for (const name of created.reverse()) docker("rm", "-f", name);
  if (volumeCreated) docker("volume", "rm", `${id}-data`);
  if (networkCreated) docker("network", "rm", id);
  for (const image of [`${id}:admin`, `${id}:compiler`]) { try { docker('image', 'rm', image); } catch { /* build may have failed */ } }
  // mkdtemp creates this exact task-owned directory, not an inferred user path.
  rmSync(directory, { recursive: true, force: true });
}
