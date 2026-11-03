import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
export async function buildBlog({clean=true}={}) {
  const outdir=resolve(fileURLToPath(new URL('../server/blog/vendor/',import.meta.url)));
  const result=await build({entryPoints:{mermaid:fileURLToPath(new URL('../server/blog/mermaid.js',import.meta.url)),visuals:fileURLToPath(new URL('../server/blog/visuals.ts',import.meta.url)),'markdown-editor':fileURLToPath(new URL('../server/admin/markdown-editor.js',import.meta.url)),'book-reader':fileURLToPath(new URL('../server/admin/book-reader.js',import.meta.url))},outdir,bundle:true,splitting:true,format:'esm',platform:'browser',target:'es2022',minify:true,write:false,logLevel:'warning'});
  await mkdir(outdir,{recursive:true});
  const manifest=join(outdir,'.build-manifest.json');
  let previous=[];
  try{previous=JSON.parse(await readFile(manifest,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const parent=dirname(outdir),stage=await mkdtemp(join(parent,'.vendor-build-'));
  // Resolve/check every target before moving or recursively removing anything.
  if(dirname(stage)!==parent||!basename(stage).startsWith('.vendor-build-'))throw new Error('Invalid bundle staging directory');
  try{
    const files=result.outputFiles.map(file=>{
      if(dirname(resolve(file.path))!==outdir)throw new Error('Bundle escaped output directory');
      return {name:basename(file.path),contents:file.contents};
    });
    for(const file of files)await writeFile(join(stage,file.name),file.contents);
    const entry=name=>['mermaid.js','visuals.js','markdown-editor.js','book-reader.js'].includes(name);
    // Publish dependencies first, then atomically replace entry files. A failed
    // compile never touches the live build. Keep the preceding generation too.
    files.sort((a,b)=>Number(entry(a.name))-Number(entry(b.name)));
    for(const file of files)await rename(join(stage,file.name),join(outdir,file.name));
    const names=files.map(file=>file.name),keep=new Set([...names,...previous]);
    if(clean)for(const file of await readdir(outdir,{withFileTypes:true})){
      if(file.isFile()&&file.name.endsWith('.js')&&!keep.has(file.name))await rm(join(outdir,file.name));
    }
    await writeFile(join(stage,'.build-manifest.json'),JSON.stringify(names));
    await rename(join(stage,'.build-manifest.json'),manifest);
  }finally{await rm(stage,{recursive:true,force:true});}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])await buildBlog();
