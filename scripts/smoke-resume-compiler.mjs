import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const name = `pixelware-compiler-test-${randomBytes(6).toString('hex')}`;
const directory = await mkdtemp(join(tmpdir(), name));
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 300000 }).trim();
const image = 'pixelware-resume-compiler:local';
const project = { mainFile: 'main.tex', files: await Promise.all(['main.tex', 'styles/resume.sty'].map(async path => ({ path, content: (await readFile(new URL(`../tests/fixtures/resume/${path}`, import.meta.url))).toString('base64') }))) };
let started = false;
try {
  docker('build', '-f', 'deploy/Dockerfile.compiler', '-t', image, root);
  docker('network', 'create', '--internal', name);
  started = true;
  docker('run', '-d', '--name', name, '--network', name, '--read-only', '--tmpfs', '/tmp:size=128m,mode=1777', '--memory', '768m', '--cpus', '1', '--pids-limit', '64', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', image);
  // An internal Docker network deliberately has no published host ports.
  // Exercise the real HTTP API from within the isolated worker instead.
  const request = (path, body) => JSON.parse(execFileSync('docker', ['exec', '-i', name, 'node', '-e', `let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',async()=>{const b=JSON.parse(input);const r=await fetch('http://127.0.0.1:3032/'+b.path,{method:b.body?'POST':'GET',headers:{'Content-Type':'application/json'},body:b.body?JSON.stringify(b.body):undefined});console.log(JSON.stringify({status:r.status,result:await r.json()}))});`], { input: JSON.stringify({ path, body }), encoding: 'utf8', timeout: 85000, maxBuffer: 40 * 1024 * 1024 }));
  for (let attempt = 0; attempt < 30; attempt++) {
    try { if (request('healthz').status === 200) break; } catch { /* startup */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const call = async (path, body) => {
    const { status, result } = request(path, body);
    assert.equal(status, 200, JSON.stringify(result)); return result;
  };
  // Exercise uploaded fonts and images as well as a custom style in a subfolder.
  for (const file of ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf']) project.files.push({ path: `fonts/${file}`, content: execFileSync('docker', ['exec', name, 'cat', `/usr/share/fonts/truetype/dejavu/${file}`]).toString('base64') });
  const pngChunk = (type, data) => {
    const chunk = Buffer.concat([Buffer.from(type), data]); let crc = 0xffffffff;
    for (const byte of chunk) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4); length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, chunk, checksum]);
  };
  const header = Buffer.from([0,0,0,1,0,0,0,1,8,2,0,0,0]);
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(Buffer.from([0,163,35,53]))), pngChunk('IEND', Buffer.alloc(0))]);
  project.files.push({ path: 'images/mark.png', content: png.toString('base64') });
  const main = project.files[0];
  main.content = Buffer.from(Buffer.from(main.content, 'base64').toString('utf8').replace('\\setmainfont{TeX Gyre Heros}', '\\setmainfont[Path=fonts/,BoldFont=DejaVuSans-Bold.ttf]{DejaVuSans.ttf}').replace('\\end{document}', '\\vfill\\includegraphics[width=1mm]{images/mark.png}\n\\end{document}')).toString('base64');
  const original = await call('compile', project);
  assert.equal(original.pages, 1);
  const github = original.links.find(link => link.destination === 'https://github.com/example');
  assert.equal(github.occurrences, 2, 'Macro-generated links and repeated URLs must be discovered');
  assert.equal(original.links.length, 3);
  const mappings = original.links.filter(link => link.destination.startsWith('https://')).map((link, index) => ({ from: link.destination, to: `https://pixelware.test/r/resume-test-${index + 1}` }));
  const rewritten = await call('rewrite', { pdf: original.pdf, mappings });
  assert.equal(rewritten.pages, 1);
  for (const mapping of mappings) assert.ok(rewritten.links.some(link => link.destination === mapping.to));
  assert.ok(rewritten.links.some(link => link.destination === 'mailto:alex@example.com'));
  await writeFile(join(directory, 'original.pdf'), Buffer.from(original.pdf, 'base64'));
  await writeFile(join(directory, 'tracked.pdf'), Buffer.from(rewritten.pdf, 'base64'));
  for (const variant of ['original', 'tracked']) execFileSync('docker', ['exec', '-i', name, 'node', '-e', `const fs=require('fs');const chunks=[];process.stdin.on('data',c=>chunks.push(c));process.stdin.on('end',()=>fs.writeFileSync('/tmp/check-${variant}.pdf',Buffer.concat(chunks)));`], { input: await readFile(join(directory, `${variant}.pdf`)) });
  const text = path => docker('exec', name, 'pdftotext', path, '-');
  assert.equal(text('/tmp/check-original.pdf'), text('/tmp/check-tracked.pdf'), 'Tracking replacement must preserve document text');
  for (const variant of ['original', 'tracked']) docker('exec', name, 'pdftoppm', '-r', '90', '-singlefile', '-png', `/tmp/check-${variant}.pdf`, `/tmp/check-${variant}`);
  for (const variant of ['original', 'tracked']) await writeFile(join(directory, `${variant}.png`), execFileSync('docker', ['exec', name, 'cat', `/tmp/check-${variant}.png`], { maxBuffer: 10 * 1024 * 1024 }));
  const [before, after] = await Promise.all(['original', 'tracked'].map(variant => readFile(join(directory, `${variant}.png`))));
  assert.deepEqual(before, after, 'Rendered pixels must remain identical after changing hyperlink destinations');
  const output = join(root, 'outputs/resume-compiler'); await mkdir(output, { recursive: true });
  for (const file of ['original.pdf', 'tracked.pdf', 'original.png', 'tracked.png']) await writeFile(join(output, file), await readFile(join(directory, file)));
  // Reject unsafe paths before any filesystem writes.
  const traversal = request('compile', { ...project, files: [{ path: '../escape.tex', content: '' }] });
  assert.equal(traversal.status, 400);
  const stuck = String.raw`\documentclass{article}\begin{document}\def\forever{\forever}\forever\end{document}`;
  const timeoutStarted = Date.now();
  const timedOut = request('compile', { mainFile: 'main.tex', files: [{ path: 'main.tex', content: Buffer.from(stuck).toString('base64') }] });
  assert.equal(timedOut.status, 422); assert.match(timedOut.result.error, /timed out/);
  assert.ok(Date.now() - timeoutStarted < 35000, 'An infinite macro must be stopped within the process deadline');
  const malicious = String.raw`\documentclass{article}\begin{document}\immediate\write18{touch /tmp/SHELL_ESCAPE_EXECUTED}Safe\end{document}`;
  await call('compile', { mainFile: 'main.tex', files: [{ path: 'main.tex', content: Buffer.from(malicious).toString('base64') }] });
  assert.equal(docker('exec', name, 'sh', '-c', 'test ! -e /tmp/SHELL_ESCAPE_EXECUTED && echo blocked'), 'blocked');
  const [config] = JSON.parse(docker('inspect', name));
  assert.equal(config.Config.User, 'node'); assert.equal(config.HostConfig.ReadonlyRootfs, true); assert.equal(config.Mounts.some(mount => mount.Destination === '/data'), false);
  console.log('Compiler smoke passed: uploaded fonts/image/style, macro and repeated links, preserved PDF text/pixels and email, safe paths, timeout recovery, shell escape disabled, isolated worker.');
} finally {
  if (started) { docker('rm', '-f', name); docker('network', 'rm', name); }
  await rm(directory, { recursive: true, force: true });
}
