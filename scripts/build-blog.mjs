import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
export async function buildBlog() {
  await build({entryPoints:{mermaid:fileURLToPath(new URL('../server/blog/mermaid.js',import.meta.url)),visuals:fileURLToPath(new URL('../server/blog/visuals.ts',import.meta.url)),'markdown-editor':fileURLToPath(new URL('../server/admin/markdown-editor.js',import.meta.url)),'book-reader':fileURLToPath(new URL('../server/admin/book-reader.js',import.meta.url))},outdir:fileURLToPath(new URL('../server/blog/vendor/',import.meta.url)),bundle:true,splitting:true,format:'esm',platform:'browser',target:'es2022',minify:true,logLevel:'warning'});
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])await buildBlog();
