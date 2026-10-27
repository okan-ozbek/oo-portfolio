import { HttpError } from './http.mjs';

export const MAX_PROJECT_BYTES = 10 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const extensions = /\.(tex|sty|cls|clo|bib|bst|bbx|cbx|lbx|def|cfg|fd|enc|map|ttf|otf|woff|png|jpg|jpeg|pdf|eps)$/i;

export function validateProject(body) {
  if (!Array.isArray(body.files) || !body.files.length || body.files.length > 80) throw new HttpError(400, 'Upload 1–80 source and supporting files.');
  let bytes = 0;
  const paths = new Set();
  const files = body.files.map(file => {
    if (!file || typeof file !== 'object' || Array.isArray(file)) throw new HttpError(400, 'Invalid project file.');
    if (typeof file.path !== 'string' || file.path.length > 200 || !file.path.split('/').every(part => /^[a-zA-Z0-9][a-zA-Z0-9 _.()-]*$/.test(part)) || !extensions.test(file.path) || file.path.split('/')[0] === 'build') throw new HttpError(400, 'Use safe relative file paths and supported LaTeX, font, or image files.');
    if (paths.has(file.path.toLowerCase())) throw new HttpError(400, 'Duplicate project file paths.');
    paths.add(file.path.toLowerCase());
    if (typeof file.content !== 'string' || file.content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.content)) throw new HttpError(400, 'Invalid file encoding.');
    const data = Buffer.from(file.content, 'base64');
    if (data.toString('base64') !== file.content) throw new HttpError(400, 'Invalid file encoding.');
    bytes += data.length;
    if (bytes > MAX_PROJECT_BYTES) throw new HttpError(413, 'The project must be 10 MB or smaller.');
    return { path: file.path, content: data.toString('base64') };
  });
  if (typeof body.mainFile !== 'string' || !/\.tex$/i.test(body.mainFile) || !files.some(file => file.path === body.mainFile)) throw new HttpError(400, 'Select a main .tex file included in the project.');
  return { mainFile: body.mainFile, files };
}
