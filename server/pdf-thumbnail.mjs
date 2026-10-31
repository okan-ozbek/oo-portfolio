import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { HttpError } from './http.mjs';

const run = promisify(execFile);
export async function pdfThumbnail(pdf) {
  const directory = await mkdtemp(join(tmpdir(), 'pixelware-preview-'));
  try {
    const input = join(directory, 'document.pdf');
    await writeFile(input, pdf, { mode: 0o600 });
    await run('pdftoppm', ['-f', '1', '-singlefile', '-scale-to', '480', '-png', input, join(directory, 'cover')], { timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true });
    return await readFile(join(directory, 'cover.png'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new HttpError(503, 'PDF previews require Poppler (pdftoppm) on the admin server.');
    throw new HttpError(422, 'A preview could not be created for this PDF.');
  } finally { await rm(directory, { recursive: true, force: true }); }
}
