import { cp, mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Trace installed runtime dependencies after compiling browser assets. Copying
// their existing files avoids a second npm resolution/prune/install phase.
const root = fileURLToPath(new URL('../', import.meta.url));
const modules = resolve(root, 'node_modules'), target = resolve(root, '.admin-runtime/node_modules');
const runtime = ['react', 'react-dom', 'lucide-react', 'markdown-it', 'highlight.js', 'sharp', 'jose', 'pdfjs-dist'];
const packages = new Set();
async function visit(name, issuer, optional = false) {
  const require = createRequire(issuer);
  let directory, manifest;
  for (const search of require.resolve.paths(name) ?? []) {
    try { directory = join(search, name); manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!manifest) { if (optional) return; throw new Error(`Missing runtime dependency ${name} from ${issuer}`); }
  const path = relative(modules, directory);
  if (path.startsWith('..') || resolve(modules, path) !== directory) throw new Error(`Runtime package outside node_modules: ${name}`);
  if (packages.has(directory)) return;
  packages.add(directory);
  const from = join(directory, 'package.json');
  for (const dependency of Object.keys(manifest.dependencies ?? {})) await visit(dependency, from, Boolean(manifest.optionalDependencies?.[dependency]));
  for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) await visit(dependency, from, true);
  for (const dependency of Object.keys(manifest.peerDependencies ?? {})) await visit(dependency, from, Boolean(manifest.peerDependenciesMeta?.[dependency]?.optional));
}
for (const name of runtime) await visit(name, join(root, 'package.json'));
await mkdir(target, { recursive: true });
// Copy parents before nested dependencies: parallel mkdir/copy operations for
// those overlapping targets can race on Node 22's fs.cp implementation.
for (const directory of [...packages].sort((a, b) => a.length - b.length)) await cp(directory, join(target, relative(modules, directory)), {
  recursive: true,
  // Nested dependencies are traced and copied into their original resolution
  // paths separately, without bringing unrelated package trees along.
  filter: path => path === directory || !relative(directory, path).split(sep).includes('node_modules'),
});
console.log(`Prepared ${packages.size} admin runtime packages in ${dirname(target)}.`);
