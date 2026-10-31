import { build, context } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export async function buildHome({watch=false,staticCss=false}={}){
  const directory=new URL('../server/home/vendor/',import.meta.url);await mkdir(directory,{recursive:true});
  const options=name=>({entryPoints:[fileURLToPath(new URL(`../server/home/${name}.tsx`,import.meta.url))],outfile:fileURLToPath(new URL(`${name}.js`,directory)),bundle:true,format:'esm',platform:name==='renderer'?'node':'browser',target:'es2022',jsx:'automatic',minify:true,...(name==='renderer'?{packages:'external'}:{define:{'process.env.NODE_ENV':'"production"'}})});
  const contexts=[];
  for(const name of ['renderer','client']){if(watch){const value=await context(options(name));await value.rebuild();await value.watch();contexts.push(value);}else await build(options(name));}
  if(staticCss){const html=await readFile(new URL('../dist/client/index.html',import.meta.url),'utf8');const path=/href="(\/assets\/[^"?]+\.css)"/.exec(html)?.[1];if(!path)throw new Error('Homepage stylesheet was not emitted.');await writeFile(new URL('home.css',directory),await readFile(new URL('../dist/client'+path,import.meta.url)));}
  return ()=>Promise.all(contexts.map(value=>value.dispose()));
}

if(process.argv[1]===fileURLToPath(import.meta.url))await buildHome();
