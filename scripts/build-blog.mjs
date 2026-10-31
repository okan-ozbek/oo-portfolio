import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
export async function buildBlog() {
  await build({entryPoints:[fileURLToPath(new URL('../server/blog/mermaid.js',import.meta.url)),fileURLToPath(new URL('../server/blog/visuals.ts',import.meta.url))],outdir:fileURLToPath(new URL('../server/blog/vendor/',import.meta.url)),bundle:true,splitting:true,format:'esm',platform:'browser',target:'es2022',minify:true,logLevel:'warning'});
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])await buildBlog();
