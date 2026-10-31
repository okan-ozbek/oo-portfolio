import { readFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, basename } from 'node:path';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { createBooks } from '../server/books.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { manifest: { type: 'string' }, database: { type: 'string', default: './data/admin.sqlite' } } });
const database = resolve(values.database);
await mkdir(dirname(database), { recursive: true });
const entries = values.manifest ? JSON.parse(await readFile(values.manifest, 'utf8')) : positionals.map(file => ({ file, name: basename(file).replace(/\.pdf$/i, ''), tags: [] }));
if (!Array.isArray(entries) || !entries.length) throw new Error('Pass PDF paths or --manifest with a JSON array of { file, name, tags }.');
const db = new DatabaseSync(database);
db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
const library = createBooks({ db });
try {
  for (const entry of entries) {
    try {
      const book = await library.add(await readFile(entry.file), entry.name ?? basename(entry.file).replace(/\.pdf$/i, ''), entry.tags ?? []);
      console.log(`Imported: ${book.name} (${book.pages} pages)`);
    } catch (error) {
      if (error.status === 409) console.log(`Already imported: ${entry.name ?? basename(entry.file)}`);
      else { console.error(`Could not import ${entry.name ?? entry.file}: ${error.message}`); process.exitCode = 1; }
    }
  }
} finally { db.close(); }
