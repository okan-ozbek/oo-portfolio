"use client";
/* eslint-disable @next/next/no-img-element */
import {useEffect,useRef} from 'react';
import {mountTechnicalArt} from '../lib/technical-visuals';
export function BlogArtwork({preset,seed,src,position='center',playing=true}:{preset:string|null;seed:string;src:string;position?:string;playing?:boolean}){
  const host=useRef<HTMLDivElement>(null),controller=useRef<ReturnType<typeof mountTechnicalArt>|null>(null);
  useEffect(()=>{if(!preset||!host.current)return;const instance=mountTechnicalArt(host.current,preset,seed);controller.current=instance;return()=>{instance.dispose();controller.current=null;};},[preset,seed]);
  useEffect(()=>{controller.current?.setPlaying(playing);},[playing,preset,seed]);
  return <div ref={host} className="blog-art"><img src={src} alt="" loading="lazy" style={{objectPosition:position}}/>{preset&&<canvas aria-hidden="true"/>}</div>;
}
