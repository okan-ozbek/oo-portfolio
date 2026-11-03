import { statSync } from 'node:fs';
import { createAssetServer } from './assets.mjs';
import { createHash } from 'node:crypto';
import { blogCsp } from './blog-pages.mjs';
import { artDescriptor } from '../lib/art-catalog.mjs';
import { HttpError } from './http.mjs';

export function createHome({origin,projects,blogs,resumes,development=false,serveAsset=createAssetServer({development})}){
  return async(req,res,url)=>{
    const assets={'/blog/assets/home-client.js':['client.js','text/javascript'],'/blog/assets/home.css':['home.css','text/css']};
    if(assets[url.pathname]){
      if(!['GET','HEAD'].includes(req.method))throw new HttpError(405,'Method not allowed.');
      const [file,type]=assets[url.pathname];
      res.removeHeader('X-Robots-Tag');return await serveAsset(req,res,new URL('./home/vendor/'+file,import.meta.url),type+'; charset=utf-8');
    }
    if(url.pathname!=='/')return false;
    if(!['GET','HEAD'].includes(req.method))throw new HttpError(405,'Method not allowed.');
    const data={projects:projects.visible().map(project=>({id:project.id,name:project.title,category:project.caption,description:project.description,href:project.state==='published'?project.url:undefined,thumbnail:project.thumbnail,code:artDescriptor(project.thumbnail).code})),blogPage:blogs.listPublic(),resumeAvailable:resumes.websiteAvailable()};
    const rendererUrl=new URL('./home/vendor/renderer.js',import.meta.url);
    if(development)rendererUrl.searchParams.set('v',String(statSync(rendererUrl).mtimeMs));
    const {renderHome}=await import(rendererUrl.href);
    const json=JSON.stringify(data).replace(/[<>&\u2028\u2029]/g,char=>`\\u${char.charCodeAt(0).toString(16).padStart(4,'0')}`);
    const hash=createHash('sha256').update(json).digest('base64');
    const canonical=new URL('/',origin).href;
    const body=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pixelware - Complexity under control</title><meta name="description" content="Pixelware — independent software, systems, and experiments. Explore a growing collection of projects built with precision."><link rel="canonical" href="${canonical}"><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="${development?'/app/globals.css':'/blog/assets/home.css'}"></head><body><div id="homepage-root">${renderHome(data)}</div><script id="home-data" type="application/json">${json}</script><script type="module" src="/blog/assets/home-client.js"></script></body></html>`;
    res.removeHeader('X-Robots-Tag');res.setHeader('Content-Security-Policy',blogCsp.replace("script-src 'self'",`script-src 'self' 'sha256-${hash}'`));
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Length':Buffer.byteLength(body)});res.end(req.method==='HEAD'?undefined:body);return true;
  };
}
