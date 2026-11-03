import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
const posix = path => path.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);

for (const valid of [true, false]) test(`image promotion ${valid ? 'records tested digests without rebuilding' : 'rejects a missing registry digest'}`, async t => {
  if (!existsSync(bash)) { t.skip('Bash is required for deployment script checks'); return; }
  const directory = await mkdtemp(join(tmpdir(), 'pixelware-image-test-'));
  try {
    const bin = join(directory, 'bin'), trace = join(directory, 'trace'); await mkdir(bin);
    await writeFile(join(bin, 'docker'), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$TRACE"
if [[ "$1" == login ]]; then cat >/dev/null; fi
if [[ "$1 $2" == 'image inspect' ]]; then printf '%s@sha256:%s\\n' "\${3%:*}" "$FAKE_DIGEST"; fi
`, { mode: 0o755 });
    const script = posix(fileURLToPath(new URL('../scripts/publish-images.sh', import.meta.url)));
    const options = { cwd: directory, env: { ...process.env, GITHUB_REPOSITORY: 'Example/Portfolio', GITHUB_SHA: 'a'.repeat(40), GITHUB_ACTOR: 'example', REGISTRY_TOKEN: 'temporary-test-token', TRACE: posix(trace), FAKE_DIGEST: valid ? 'b'.repeat(64) : 'invalid' } };
    const command = run(bash, ['-c', 'export PATH="$1:$PATH"; [[ "$(command -v docker)" == "$1/docker" ]] || exit 1; exec bash "$2"', '_', posix(bin), script], options);
    if (!valid) { await assert.rejects(command, /No registry digest found/); return; }
    await command;
    const manifest = await readFile(join(directory, 'compose.images.yaml'), 'utf8');
    for (const service of ['admin', 'compiler', 'portfolio']) assert.match(manifest, new RegExp(`${service}:\\n    image: ghcr.io/example/portfolio-${service}@sha256:${'b'.repeat(64)}`));
    const calls = await readFile(trace, 'utf8');
    assert.equal(calls.includes('temporary-test-token'), false); assert.doesNotMatch(calls, /build/);
    assert.equal(calls.split('\n').filter(line => line.startsWith('image push')).length, 3);
    assert.match(calls, /logout ghcr.io/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
