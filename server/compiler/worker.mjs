import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { HttpError, readJson } from '../http.mjs';
import { MAX_REQUEST_BYTES, validateProject } from '../resume-project.mjs';

const pdfTool = resolve('server/compiler/pdf.py');
let busy = false;
function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, detached: true, env: {
      PATH: '/usr/local/bin:/usr/bin:/bin', HOME: cwd, TMPDIR: cwd,
      openin_any: 'p', openout_any: 'p', shell_escape: 'f', TEXMFOUTPUT: cwd,
      SOURCE_DATE_EPOCH: '1704067200', FORCE_SOURCE_DATE: '1',
    } });
    let log = '', stdout = '';
    let finished = false;
    const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ } };
    const timeout = setTimeout(() => { kill(); finish(new HttpError(422, 'Compilation timed out (25 seconds per pass).')); }, 25000);
    function finish(error) { if (finished) return; finished = true; clearTimeout(timeout); if (error) reject(error); else resolve(stdout); }
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      if (stdout.length > 1024 * 1024) { kill(); finish(new HttpError(422, 'Compiler output exceeded its limit.')); }
    });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
      log = (log + chunk.toString()).slice(-12000);
    });
    child.on('error', () => finish(new HttpError(503, 'Compiler executable is unavailable.')));
    child.on('exit', code => finish(code === 0 ? undefined : new HttpError(422, `Compilation failed.\n${log.slice(-4000)}`)));
  });
}
const server = createServer(async (req, res) => {
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.url === '/healthz' && req.method === 'GET') return send(200, { ok: true });
  if (!['/compile', '/rewrite'].includes(req.url) || req.method !== 'POST') return send(404, { error: 'Not found.' });
  if (busy) return send(503, { error: 'The compiler is busy. Try again shortly.' });
  busy = true;
  let directory;
  try {
    const body = await readJson(req, MAX_REQUEST_BYTES * 2);
    directory = await mkdtemp(join(tmpdir(), 'resume-'));
    let source;
    if (req.url === '/compile') {
      const project = validateProject(body);
      for (const file of project.files) {
        const path = join(directory, file.path);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, Buffer.from(file.content, 'base64'));
      }
      await mkdir(join(directory, 'build'));
      const args = ['-no-shell-escape', '-halt-on-error', '-interaction=nonstopmode', '-jobname=resume', '-output-directory=build', project.mainFile];
      await run('xelatex', args, directory);
      await run('xelatex', args, directory);
      source = join(directory, 'build/resume.pdf');
    } else {
      if (typeof body.pdf !== 'string' || body.pdf.length > 22 * 1024 * 1024 || !Array.isArray(body.mappings) || body.mappings.length > 100) throw new HttpError(400, 'Invalid PDF rewrite request.');
      source = join(directory, 'original.pdf');
      await writeFile(source, Buffer.from(body.pdf, 'base64'));
    }
    // Always sanitize the compiled PDF, even when no tracking URLs are selected.
    const mappings = Object.fromEntries((body.mappings ?? []).map(item => {
      if (typeof item.from !== 'string' || typeof item.to !== 'string' || !/^https?:\/\//.test(item.to) || item.to.length > 2048) throw new HttpError(400, 'Invalid hyperlink mapping.');
      return [item.from, item.to];
    }));
    await writeFile(join(directory, 'mapping.json'), JSON.stringify(mappings));
    const output = join(directory, 'resume.pdf');
    const inspected = JSON.parse(await run('python3', [pdfTool, 'rewrite', source, output, join(directory, 'mapping.json')], directory));
    const pdf = await readFile(output);
    if (pdf.length > 15 * 1024 * 1024) throw new HttpError(413, 'The compiled PDF must be 15 MB or smaller.');
    send(200, { ...inspected, pdf: pdf.toString('base64') });
  } catch (error) { send(error.status ?? 500, { error: error.status ? error.message : 'The resume could not be compiled.' }); }
  finally { if (directory) await rm(directory, { recursive: true, force: true }); busy = false; }
});
server.requestTimeout = 10000;
server.listen(3032, '0.0.0.0', () => console.log('Isolated resume compiler ready.'));
