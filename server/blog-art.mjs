import {presets,artDescriptor} from '../lib/art-catalog.mjs';
export {presets};
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function artwork(preset, seed = '', wide = false) {
  const descriptor=artDescriptor(preset),kind=preset.replace(/^project-/,'');
  const w = 1200, h = wide ? 400 : 675;
  let hash = [...seed].reduce((n, ch) => ((n * 31 + ch.charCodeAt(0)) >>> 0), 17);
  const random = () => { hash = (Math.imul(hash, 1664525) + 1013904223) >>> 0; return hash / 4294967296; };
  let shapes = '';
  const line = (x1,y1,x2,y2,red=false) => `<path d="M${x1},${y1}L${x2},${y2}" stroke="${red ? '#ff3939' : '#858585'}" stroke-opacity="${red ? '.9' : '.24'}" fill="none" stroke-width="${red ? 2 : 1}"/>`;
  if (kind === 'network' || kind === 'neural') {
    if(kind==='neural'){
      const layers=[4,6,5,3,2].map((n,i)=>Array.from({length:n},(_,j)=>[120+i*240,h*.5+(j-(n-1)/2)*(h-120)/6]));
      layers.slice(0,-1).forEach((layer,i)=>layer.forEach(([x,y])=>layers[i+1].forEach(([a,b])=>{shapes+=line(x,y,a,b,random()>.85);})));layers.flat().forEach(([x,y])=>{shapes+=`<circle cx="${x}" cy="${y}" r="9" fill="#202020" stroke="#f47171" stroke-width="2"/>`;});
    }else{
    const points = Array.from({length:22},()=>[100+random()*1000,70+random()*(h-140)]);
    points.forEach(([x,y],i)=>{ points.slice(i+1).forEach(([a,b])=>{if(Math.hypot(a-x,b-y)<270)shapes+=line(x,y,a,b,i%6===0);}); shapes+=`<circle cx="${x}" cy="${y}" r="${i%6===0 ? 5 : 3}" fill="${i%6===0 ? '#ff3939' : '#939393'}"/>`; });
    }
  } else if (kind === 'binary' || kind==='reaction') {
    if(kind==='reaction'){
      for(let y=60;y<h-35;y+=12)for(let x=45;x<1160;x+=12){const v=Math.sin(x*.025+Math.cos(y*.03)*2)+Math.cos(y*.04+Math.sin(x*.02)*2);if(v>.1)shapes+=`<rect x="${x}" y="${y}" width="9" height="9" fill="${v>1?'#ff5050':'#969696'}" opacity="${Math.min(.85,v*.4)}"/>`;}
    }else{
    for(let y=80;y<h-40;y+=25)for(let x=80;x<1150;x+=24)shapes+=`<text x="${x}" y="${y}" fill="${random()>.95?'#ff3939':'#727272'}" opacity="${.15+random()*.6}" font-family="monospace" font-size="13">${random()>.5?1:0}</text>`;
    }
  } else if (kind === 'stack') {
    for(let i=0;i<7;i++){const y=h*.15+i*h*.1;shapes+=`<path d="M360,${y}l240,-65 240,65 -240,65Z" fill="#171717" stroke="${i===3?'#ff3939':'#555555'}" stroke-width="${i===3?2:1}"/>`;}
  } else if (kind === 'terrain') {
    const point=(x,z)=>[180+x*34+z*12,h*.2+z*10+x*3-Math.sin(x*.24+z*.22)*45];
    for(let z=0;z<22;z++)for(let x=0;x<24;x++){const p=point(x,z),q=point(x+1,z);shapes+=line(...p,...q,z===10);if(z<21){const r=point(x,z+1);shapes+=line(...p,...r);}}
  } else if(kind==='cpu'||kind==='circuitry'){
    for(let i=0;i<4;i++){const y=h*.2+i*h*.19;for(const side of [-1,1]){const x=600+side*350;shapes+=`<rect x="${x-70}" y="${y-22}" width="140" height="44" rx="4" fill="#222222" stroke="${i===1?'#ff3939':'#666666'}"/><text x="${x}" y="${y+5}" fill="#b9b9b9" text-anchor="middle" font-family="monospace" font-size="15">${side<0?['PC','ACC','R0','R1'][i]:['FETCH','DECODE','ALU','WRITE'][i]}</text>`;shapes+=line(x-side*70,y,600+side*95,y,i===1);shapes+=line(600+side*95,y,600+side*95,h*.5,i===1);}}
    shapes+=`<rect x="505" y="${h*.5-80}" width="190" height="160" rx="8" fill="#252525" stroke="#ff4444" stroke-width="3"/><text x="600" y="${h*.5+10}" text-anchor="middle" fill="#e1e1e1" font-family="monospace" font-size="34">${kind==='cpu'?'CPU':'XOR'}</text>`;
  } else if(kind==='fluid'||kind==='particles'){
    for(let j=0;j<28;j++){let d='';for(let i=0;i<85;i++){const x=45+i*13,y=60+j*(h-110)/28+Math.sin(i*.11+j*.17)*Math.exp(-Math.pow((i-43)/30,2))*h*.1;d+=`${i?'L':'M'}${x},${y}`;}shapes+=`<path d="${d}" fill="none" stroke="${j%5===0?'#ff5959':'#9baccb'}" stroke-opacity="${j%5===0?.85:.25}" stroke-width="${j%5===0?2:1}"/>`;}
  } else if(kind==='orbital'||kind==='blackhole'){
    for(let i=0;i<8;i++){shapes+=`<ellipse cx="600" cy="${h*.5}" rx="${90+i*35}" ry="${20+i*14}" fill="none" stroke="${i<3?'#ff6464':'#a4a4a4'}" stroke-opacity="${i<3?.75:.25}" transform="rotate(${kind==='orbital'?-18:0} 600 ${h*.5})"/>`;}
    shapes+=`<circle cx="600" cy="${h*.5}" r="${kind==='blackhole'?60:20}" fill="${kind==='blackhole'?'#080808':'#ff6b6b'}" stroke="#ff5555" stroke-width="3"/>`;
  } else if(kind==='ragdoll'){
    for(let i=0;i<9;i++){const r=22+random()*25,x=100+i*125,y=h*.3+random()*h*.45;shapes+=`<circle cx="${x}" cy="${y}" r="${r}" fill="${i%3===0?'#9f3030':'#474747'}" stroke="${i%3===0?'#ff6868':'#b6b6b6'}" stroke-width="2"/>`;shapes+=line(x-8,y-10,x+4,y-16);}shapes+=line(60,h-45,1140,h-45);
  } else if(kind==='raytrace'){
    for(const [x,y,r]of [[580,h*.54,90],[850,h*.42,60],[900,h*.75,40]])shapes+=`<circle cx="${x}" cy="${y}" r="${r}" fill="#363636" stroke="#a2a2a2" stroke-opacity=".6"/>`;
    shapes+=line(160,h*.35,500,h*.46,true);shapes+=line(500,h*.46,360,60,true);shapes+=`<rect x="125" y="${h*.35-20}" width="35" height="40" fill="none" stroke="#bbb"/>`;
  } else if(kind==='market'){
    for(let i=0;i<45;i++){const x=85+i*23,y=h*.48+Math.sin(i*.25)*h*.13+(random()-.5)*45,height=12+random()*30;shapes+=line(x,y-height*1.5,x,y+height*1.5,i%3===0);shapes+=`<rect x="${x-5}" y="${y-height*.5}" width="10" height="${height}" fill="${i%3===0?'#ff5050':'#aaaaaa'}"/>`;}
  } else {
    for(let i=0;i<6;i++)shapes+=line(70,80+i*(h-140)/5,1130,80+i*(h-140)/5);
    for(let n=0;n<3;n++){let d='';for(let i=0;i<70;i++){const x=70+i*15,y=h*.7-n*50-Math.sin(i*.12)*35-random()*(n===2?100:25);d+=`${i?'L':'M'}${x},${y}`;}shapes+=`<path d="${d}" fill="none" stroke="${n===2?'#ff3939':n===1?'#8b8b8b':'#535353'}" stroke-width="2"/>`;}
  }
  const angle=145*Math.PI/180,dx=Math.sin(angle),dy=-Math.cos(angle),length=w*dx+h*dy;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="${(w-dx*length)/2}" y1="${(h-dy*length)/2}" x2="${(w+dx*length)/2}" y2="${(h+dy*length)/2}"><stop stop-color="#202024"/><stop offset="1" stop-color="#161619"/></linearGradient></defs><rect width="1200" height="${h}" fill="url(#g)"/>${shapes}<g fill="#888888" font-family="monospace" font-size="12" letter-spacing="2"><text x="30" y="35">${descriptor.code}</text></g><path d="M1170 25h-25m25 0v25M30 ${h-25}v-15" stroke="#ff3939" fill="none"/></svg>`;
}
export function artHtml(spec,seed,{wide=false,className='',priority=false}={}){

  return `<span class="blog-art ${escape(className)}"${!spec?.assetId?` data-art-preset="${presets.includes(spec?.preset)?spec.preset:'terrain'}" data-art-seed="${escape(seed)}"`:''}><img src="${escape(artUrl(spec,seed,wide))}" style="object-position:${escape(spec?.position??'center')}" alt="" ${priority?'fetchpriority="high"':'loading="lazy"'}></span>`;
}
export function artUrl(spec, seed, wide = false) {
  if (spec?.assetId) return `/blog/media/${spec.assetId}?size=${wide?'banner':'thumbnail'}`;
  return `/blog/art/${presets.includes(spec?.preset) ? spec.preset : 'network'}.svg?seed=${encodeURIComponent(seed)}${wide ? '&wide=1' : ''}`;
}
