/* eslint-disable @next/next/no-img-element */
import {useEffect,useRef} from 'react';
export function BlogArtwork({src,position='center',preset,seed='',playing=true}:{preset?:string|null;seed?:string;src:string;position?:string;playing?:boolean}){
  const host=useRef<HTMLDivElement>(null);
  const controller=useRef<{dispose:()=>void;setPlaying:(value:boolean)=>void}|null>(null);
  const motion=useRef(playing);
  useEffect(()=>{motion.current=playing;controller.current?.setPlaying(playing);},[playing]);
  useEffect(()=>{
    const element=host.current;if(!element||!preset)return;
    let cancelled=false,canvas:HTMLCanvasElement|undefined,instance:typeof controller.current=null;
    void import('../lib/technical-visuals').then(({mountTechnicalArt})=>{
      if(cancelled)return;
      canvas=document.createElement('canvas');canvas.setAttribute('aria-hidden','true');element.append(canvas);
      instance=mountTechnicalArt(element,preset,seed,motion.current);controller.current=instance;
    }).catch(()=>{instance?.dispose();canvas?.remove();});
    return()=>{cancelled=true;instance?.dispose();canvas?.remove();if(controller.current===instance)controller.current=null;};
  },[preset,seed]);
  // This image is present in server HTML and remains visible if JS fails.
  return <div className="blog-art" ref={host}><img src={src} alt="" loading="lazy" style={{objectPosition:position}}/></div>;
}
