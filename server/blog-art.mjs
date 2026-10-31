export const presets = ['network', 'binary', 'stack', 'terrain', 'latency'];
export function artwork(preset, seed = '', wide = false) {
  const w = 1200, h = wide ? 400 : 680;
  let hash = [...seed].reduce((n, ch) => ((n * 31 + ch.charCodeAt(0)) >>> 0), 17);
  const random = () => { hash = (Math.imul(hash, 1664525) + 1013904223) >>> 0; return hash / 4294967296; };
  let shapes = '';
  const line = (x1,y1,x2,y2,red=false) => `<path d="M${x1},${y1}L${x2},${y2}" stroke="${red ? '#ff3939' : '#858590'}" stroke-opacity="${red ? '.9' : '.24'}" fill="none" stroke-width="${red ? 2 : 1}"/>`;
  if (preset === 'network') {
    const points = Array.from({length:22},()=>[100+random()*1000,70+random()*(h-140)]);
    points.forEach(([x,y],i)=>{ points.slice(i+1).forEach(([a,b])=>{if(Math.hypot(a-x,b-y)<270)shapes+=line(x,y,a,b,i%6===0);}); shapes+=`<circle cx="${x}" cy="${y}" r="${i%6===0 ? 5 : 3}" fill="${i%6===0 ? '#ff3939' : '#9393a1'}"/>`; });
  } else if (preset === 'binary') {
    for(let y=80;y<h-40;y+=25)for(let x=80;x<1150;x+=24)shapes+=`<text x="${x}" y="${y}" fill="${random()>.95?'#ff3939':'#72727f'}" opacity="${.15+random()*.6}" font-family="monospace" font-size="13">${random()>.5?1:0}</text>`;
  } else if (preset === 'stack') {
    for(let i=0;i<7;i++){const y=h*.15+i*h*.1;shapes+=`<path d="M360,${y}l240,-65 240,65 -240,65Z" fill="#17171d" stroke="${i===3?'#ff3939':'#555561'}" stroke-width="${i===3?2:1}"/>`;}
  } else if (preset === 'terrain') {
    const point=(x,z)=>[180+x*34+z*12,h*.2+z*10+x*3-Math.sin(x*.24+z*.22)*45];
    for(let z=0;z<22;z++)for(let x=0;x<24;x++){const p=point(x,z),q=point(x+1,z);shapes+=line(...p,...q,z===10);if(z<21){const r=point(x,z+1);shapes+=line(...p,...r);}}
  } else {
    for(let i=0;i<6;i++)shapes+=line(70,80+i*(h-140)/5,1130,80+i*(h-140)/5);
    for(let n=0;n<3;n++){let d='';for(let i=0;i<70;i++){const x=70+i*15,y=h*.7-n*50-Math.sin(i*.12)*35-random()*(n===2?100:25);d+=`${i?'L':'M'}${x},${y}`;}shapes+=`<path d="${d}" fill="none" stroke="${n===2?'#ff3939':n===1?'#8b8b98':'#535360'}" stroke-width="2"/>`;}
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><radialGradient id="g"><stop stop-color="#25252d"/><stop offset="1" stop-color="#111114"/></radialGradient></defs><rect width="1200" height="${h}" fill="url(#g)"/>${shapes}<g fill="#888894" font-family="monospace" font-size="12" letter-spacing="2"><text x="30" y="35">PXW / ${preset.toUpperCase()}</text><text x="30" y="${h-25}">SYSTEMS · IDEAS · EXPERIMENTS</text></g><path d="M1170 25h-25m25 0v25M30 ${h-25}v-15" stroke="#ff3939" fill="none"/></svg>`;
}
export function artUrl(spec, seed, wide = false) {
  if (spec?.assetId) return `/blog/media/${spec.assetId}?size=${wide?'banner':'thumbnail'}`;
  return `/blog/art/${presets.includes(spec?.preset) ? spec.preset : 'network'}.svg?seed=${encodeURIComponent(seed)}${wide ? '&wide=1' : ''}`;
}
