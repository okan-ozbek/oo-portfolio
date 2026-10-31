import {mountTechnicalArt} from '../../lib/technical-visuals';
export {technicalPresets,projectPresets,artDescriptor} from '../../lib/art-catalog.mjs';
const controllers=new Map<HTMLElement,ReturnType<typeof mountTechnicalArt>>();
const cleanup=new MutationObserver(()=>{for(const [host,controller]of controllers)if(!host.isConnected){controller.dispose();controllers.delete(host);}});
cleanup.observe(document.documentElement,{childList:true,subtree:true});
export function enhanceArtwork(root:ParentNode=document){
  const hosts=[...(root instanceof HTMLElement&&root.matches('[data-art-preset]')?[root]:[]),...root.querySelectorAll<HTMLElement>('[data-art-preset]')];
  for(const host of hosts)if(!controllers.has(host)){if(!host.querySelector('canvas')){const canvas=document.createElement('canvas');canvas.setAttribute('aria-hidden','true');host.append(canvas);}controllers.set(host,mountTechnicalArt(host,host.dataset.artPreset!,host.dataset.artSeed??''));}
}
export function artworkNode(spec:{preset:string;assetId?:string|null;position?:string},seed:string,wide=false,className=''){
  const host=document.createElement('span');host.className=`blog-art ${className}`;
  const img=document.createElement('img');img.alt='';img.loading='lazy';img.src=spec.assetId?`/blog/media/${spec.assetId}?size=${wide?'banner':'thumbnail'}`:`/blog/art/${spec.preset}.svg?seed=${encodeURIComponent(seed)}${wide?'&wide=1':''}`;img.style.objectPosition=spec.position??'center';host.append(img);
  if(!spec.assetId){host.dataset.artPreset=spec.preset;host.dataset.artSeed=seed;host.append(document.createElement('canvas'));}
  return host;
}
export function replaceArtwork(container:HTMLElement,spec:{preset:string;assetId?:string|null;position?:string},seed:string,wide=false){
  container.replaceChildren(artworkNode(spec,seed,wide));enhanceArtwork(container);
}
