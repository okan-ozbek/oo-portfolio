import { readdir, readFile, writeFile, stat, utimes } from "node:fs/promises";
import { gzip } from "node:zlib";
import { promisify } from "node:util";

const compress = promisify(gzip);

// Compress once at build time, rather than spending VPS CPU on every request.
export async function compressStatic(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) {
      await compressStatic(path);
    } else if (/\.(?:js|css|html|rsc|svg|xml|txt|json)$/.test(entry.name)) {
      const original = await readFile(path);
      if (original.length < 1024) continue;
      const compressed = await compress(original, { level: 9 });
      if (compressed.length >= original.length) continue;
      const output = new URL(`${entry.name}.gz`, directory);
      await writeFile(output, compressed);
      const { atime, mtime } = await stat(path);
      await utimes(output, atime, mtime);
    }
  }
}
