import { animate } from '../app/animation-clock';
import { createMarketFeed } from '../app/market-feed';
import { drawProjectVisual, type ProjectVisualKind } from './project-visuals';
import { artDescriptor, projectPresets, legacyPresets } from './art-catalog.mjs';

const TAU=Math.PI*2, red='#ff3838', white='#d0d0d0';
const noise=(n:number)=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v);};
function line(ctx:CanvasRenderingContext2D,points:number[][],color:string,width=1){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke();}
function dot(ctx:CanvasRenderingContext2D,x:number,y:number,r:number,color=red,glow=0){ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=glow;ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fill();ctx.shadowBlur=0;}
function label(ctx:CanvasRenderingContext2D,text:string,x:number,y:number,color='#939393',size=10){ctx.fillStyle=color;ctx.font=`${size}px Consolas,monospace`;ctx.textAlign='center';ctx.fillText(text,x,y);}
function grid(ctx:CanvasRenderingContext2D,w:number,h:number){for(let x=30;x<w;x+=35)line(ctx,[[x,48],[x,h-34]],'#8a8a8a0a');for(let y=55;y<h-30;y+=35)line(ctx,[[25,y],[w-25,y]],'#8a8a8a0a');}
function fluid(ctx:CanvasRenderingContext2D,w:number,h:number,t:number,pointer:number){
  const centers=[[w*.36+pointer*30,h*.48],[w*.65-pointer*20,h*.57]];
  for(let row=0;row<19;row++){
    const points=[];for(let i=0;i<75;i++){const x=w*(.05+i/74*.9),base=55+row*(h-110)/18;let y=base;for(const [cx,cy]of centers){const dx=(x-cx)/130,dy=(base-cy)/95;y+=Math.sin(dx*2.2+t*.7+row*.14)*Math.exp(-(dx*dx+dy*dy)*.32)*42;}points.push([x,y]);}
    line(ctx,points,row%5===0?'#ff4545b8':'#acb9d13d',row%5===0?1.7:.8);
    const index=Math.floor(((t*.13+row*.077)%1)*74),[x,y]=points[index];dot(ctx,x,y,row%5===0?3:1.6,row%5===0?red:'#b7c5d9',row%5===0?10:0);
  }
  for(const [cx,cy]of centers){ctx.strokeStyle='#ff39392b';ctx.beginPath();ctx.ellipse(cx,cy,22,12,t*.15,0,TAU);ctx.stroke();}
}
type Ball={x:number;y:number;vx:number;vy:number;radius:number};
const playgrounds=new WeakMap<CanvasRenderingContext2D,{w:number;h:number;time:number;items:Ball[]}>();
function ballPhysics(ctx:CanvasRenderingContext2D,w:number,h:number,t:number,pointer:number){
  let state=playgrounds.get(ctx);
  if(!state||state.w!==w||state.h!==h||t<state.time){
    state={w,h,time:t,items:Array.from({length:9},(_,i)=>({x:70+(i%5)*(w-140)/4,y:85+Math.floor(i/5)*95,radius:13+noise(i+11)*15,vx:(noise(i+31)-.5)*180,vy:-40-noise(i+53)*80}))};playgrounds.set(ctx,state);
  }
  const elapsed=Math.min(.1,Math.max(0,t-state.time)),steps=Math.ceil(elapsed/(1/120)),dt=steps?elapsed/steps:0,floor=h-45,left=30,right=w-30;
  for(let step=0;step<steps;step++){
    for(const b of state.items){
      b.vx+=pointer*80*dt;b.vy+=600*dt;b.x+=b.vx*dt;b.y+=b.vy*dt;
      if(b.x<left+b.radius){b.x=left+b.radius;b.vx=Math.abs(b.vx)*.96;}
      if(b.x>right-b.radius){b.x=right-b.radius;b.vx=-Math.abs(b.vx)*.96;}
      if(b.y<52+b.radius){b.y=52+b.radius;b.vy=Math.abs(b.vy)*.92;}
      if(b.y>floor-b.radius){b.y=floor-b.radius;b.vy=-Math.max(170,Math.abs(b.vy)*.94);}
    }
    for(let i=0;i<state.items.length;i++)for(let j=i+1;j<state.items.length;j++){
      const a=state.items[i],b=state.items[j],dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1,min=a.radius+b.radius;
      if(d>=min)continue;
      const nx=dx/d,ny=dy/d,ma=a.radius*a.radius,mb=b.radius*b.radius,overlap=min-d;
      a.x-=nx*overlap*mb/(ma+mb);a.y-=ny*overlap*mb/(ma+mb);b.x+=nx*overlap*ma/(ma+mb);b.y+=ny*overlap*ma/(ma+mb);
      const velocity=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
      if(velocity<0){const impulse=-(1+.94)*velocity/(1/ma+1/mb);a.vx-=impulse*nx/ma;a.vy-=impulse*ny/ma;b.vx+=impulse*nx/mb;b.vy+=impulse*ny/mb;}
    }
  }
  state.time=t;
  line(ctx,[[left,55],[left,floor],[right,floor],[right,55]],'#77777755',1.5);
  for(const [i,b]of state.items.entries()){
    const color=i%3===0?red:'#b7b7b7';
    ctx.save();ctx.translate(b.x,b.y);ctx.scale(1,.2);dot(ctx,0,(floor-b.y)/.2,b.radius*.8,'#00000044');ctx.restore();
    const fill=ctx.createRadialGradient(b.x-b.radius*.35,b.y-b.radius*.4,1,b.x,b.y,b.radius);fill.addColorStop(0,i%3===0?'#ff9b9b':'#d0d0d0');fill.addColorStop(.5,i%3===0?'#b93232':'#686868');fill.addColorStop(1,i%3===0?'#521a1a':'#292929');
    ctx.fillStyle=fill;ctx.beginPath();ctx.arc(b.x,b.y,b.radius,0,TAU);ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=1;ctx.stroke();
    line(ctx,[[b.x-b.vx*.035,b.y-b.vy*.035],[b.x,b.y]],i%3===0?'#ff888860':'#ffffff25',1);
  }
}
function cpu(ctx:CanvasRenderingContext2D,w:number,h:number,t:number){
  const cx=w/2,cy=h*.52,size=115,step=Math.floor(t*1.8)%4,registers=['PC','ACC','R0','R1'];
  for(const side of [-1,1])for(let i=0;i<4;i++){
    const x=cx+side*(size/2+115),y=100+i*(h-170)/3,active=i===step;ctx.fillStyle=active?'#382027':'#191919';ctx.strokeStyle=active?red:'#494949';ctx.lineWidth=1.2;ctx.fillRect(x-45,y-16,90,32);ctx.strokeRect(x-45,y-16,90,32);label(ctx,side<0?registers[i]:`0x${((Math.floor(t*4)+i*37)%256).toString(16).padStart(2,'0').toUpperCase()}`,x,y+4,active?'#ffabab':'#a5a5a5',11);
    const edge=cx+side*size/2,from=x-side*45,via=cx+side*95,path=[[from,y],[via,y],[via,cy-35+i*23],[edge,cy-35+i*23]];line(ctx,path,active?'#ff3939ad':'#77777745',1.5);const progress=(t*.65+i*.21)%1;const segment=Math.min(2,Math.floor(progress*3)),mix=progress*3-segment;dot(ctx,path[segment][0]*(1-mix)+path[segment+1][0]*mix,path[segment][1]*(1-mix)+path[segment+1][1]*mix,2.5,active?red:'#aaaaaa',active?10:0);
  }
  ctx.fillStyle='#202020';ctx.fillRect(cx-size/2,cy-size/2,size,size);ctx.strokeStyle='#ff4b4b';ctx.lineWidth=2;ctx.strokeRect(cx-size/2,cy-size/2,size,size);
  for(let i=0;i<8;i++){const p=-43+i*12;for(const side of [-1,1])line(ctx,[[cx+p,cy+side*size/2],[cx+p,cy+side*(size/2+10)]],'#a3a3a3',2);}
  label(ctx,'CPU',cx,cy-12,'#eeeeee',24);label(ctx,['FETCH','DECODE','EXECUTE','WRITE'][step],cx,cy+14,'#ff7777',9);
  for(let i=0;i<4;i++){ctx.fillStyle=i===step?red:'#3c3c3c';ctx.fillRect(cx-33+i*19,cy+31,10,4);}
}
function neural(ctx:CanvasRenderingContext2D,w:number,h:number,t:number){
  const counts=[4,6,5,4,2],layers=counts.map((count,i)=>Array.from({length:count},(_,j)=>[w*.12+i*w*.19,h*.5+(j-(count-1)/2)*(h-120)/6]));
  const wave=(t*.65)%5;
  layers.slice(0,-1).forEach((layer,i)=>layer.forEach(([x,y],a)=>layers[i+1].forEach(([u,v],b)=>{const weight=noise(i*77+a*13+b);line(ctx,[[x,y],[u,v]],weight>.74?'#ff494952':'#9c9c9c21',weight>.74?1.3:.65);if(weight>.78){const p=(t*.5+weight)%1;dot(ctx,x+(u-x)*p,y+(v-y)*p,1.8,'#ff5555',6);}})));
  layers.forEach((layer,i)=>layer.forEach(([x,y],j)=>{const activation=Math.max(0,1-Math.abs(wave-i));dot(ctx,x,y,7+activation*2,'#222222');ctx.strokeStyle=activation>.3?red:'#8b8b8b';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x,y,7+activation*2,0,TAU);ctx.stroke();if(activation>.3)dot(ctx,x,y,3+noise(j)*2,'#ff7373',10);}));
  label(ctx,'INPUT',w*.12,h-48);label(ctx,'HIDDEN LAYERS',w*.5,h-48);label(ctx,'OUTPUT',w*.88,h-48);
}
function orbital(ctx:CanvasRenderingContext2D,w:number,h:number,t:number,pointer:number){
  const cx=w*.5,cy=h*.52,r=Math.min(w*.38,h*.38);const halo=ctx.createRadialGradient(cx,cy,2,cx,cy,r*.55);halo.addColorStop(0,'#ff38384f');halo.addColorStop(1,'#ff383800');ctx.fillStyle=halo;ctx.fillRect(0,0,w,h);
  for(let i=0;i<5;i++){const radius=r*(.34+i*.16),tilt=-.4+i*.18+pointer*.2;ctx.strokeStyle='#a4a4a432';ctx.lineWidth=1;ctx.beginPath();ctx.ellipse(cx,cy,radius,radius*.63,tilt,0,TAU);ctx.stroke();const angle=t*(.55-i*.065)+i*1.7;const point=(a:number)=>[cx+Math.cos(a)*radius*Math.cos(tilt)-Math.sin(a)*radius*.63*Math.sin(tilt),cy+Math.cos(a)*radius*Math.sin(tilt)+Math.sin(a)*radius*.63*Math.cos(tilt)];for(let j=10;j>0;j--){const [x,y]=point(angle-j*.035);dot(ctx,x,y,i===2?3:2,`rgba(255,${i===2?80:170},${i===2?80:180},${(1-j/11)*.5})`);}const [x,y]=point(angle);dot(ctx,x,y,4+i*.5,i===2?red:white,9);}
  dot(ctx,cx,cy,10,'#ff6666',22);ctx.strokeStyle='#ff494959';ctx.beginPath();ctx.arc(cx,cy,18+Math.sin(t)*2,0,TAU);ctx.stroke();
}
function reaction(ctx:CanvasRenderingContext2D,w:number,h:number,t:number){
  const cols=64,rows=32,sx=(w-70)/cols,sy=(h-110)/rows;
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
    const dx=(x-cols*.5)/cols*8,dy=(y-rows*.5)/rows*7;
    const value=Math.sin(dx*3+Math.sin(dy*2+t*.3)*2)+Math.cos(dy*4+Math.sin(dx*1.7-t*.2)*2)+Math.sin(Math.hypot(dx+Math.sin(t*.2),dy)*4-t*.5);
    const hot=Math.max(0,Math.min(1,(value+.45)*.65));if(hot<.12)continue;ctx.fillStyle=hot>.68?`rgba(255,${45+hot*65},${45+hot*55},${hot*.8})`:`rgba(159,159,185,${hot*.52})`;ctx.fillRect(35+x*sx,55+y*sy,Math.max(1,sx-1),Math.max(1,sy-1));
  }
}
function particles(ctx:CanvasRenderingContext2D,w:number,h:number,t:number,pointer:number){
  for(let i=0;i<130;i++){const phase=(t*.12+noise(i)*2)%1,x=35+phase*(w-70),base=h*.5+(noise(i+200)-.5)*(h-140);const path=[];for(let j=0;j<6;j++){const p=phase-j*.004,u=35+p*(w-70),y=base+Math.sin(p*9+t*.3+i*.02)*35*Math.sin(p*Math.PI)+pointer*20*Math.sin(p*5);path.push([u,y]);}line(ctx,path,i%5===0?'#ff4848a0':'#b9b9b94a',i%5===0?1.6:.8);dot(ctx,x,path[0][1],i%5===0?2.7:1,i%5===0?red:white,i%5===0?8:0);}
  for(const x of [w*.2,w*.8]){ctx.strokeStyle='#ff39393d';ctx.beginPath();ctx.ellipse(x,h*.5,16,(h-120)*.5,0,0,TAU);ctx.stroke();}
}
function raytrace(ctx:CanvasRenderingContext2D,w:number,h:number,t:number,pointer:number){
  const spheres=[[w*.46,h*.55,55],[w*.7,h*.42,35],[w*.76,h*.72,25]];
  for(let i=0;i<9;i++)line(ctx,[[w*.1+i*w*.1,h-45],[w*.5+(i-4)*w*.035,h*.43]],'#85858520');
  for(const [x,y,r]of spheres){const g=ctx.createRadialGradient(x-r*.35,y-r*.4,2,x,y,r);g.addColorStop(0,'#b0b0b0');g.addColorStop(.5,'#454545');g.addColorStop(1,'#191919');ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fill();ctx.strokeStyle='#b5b5b54f';ctx.stroke();}
  const camera=[w*.13,h*.4],sphere=spheres[0],angle=-2.8+Math.sin(t*.7)*.45+pointer*.3,hit=[sphere[0]+Math.cos(angle)*sphere[2],sphere[1]+Math.sin(angle)*sphere[2]],normal=[Math.cos(angle),Math.sin(angle)];
  line(ctx,[camera,hit],'#ff4646',2);dot(ctx,hit[0],hit[1],4,'#ff8b8b',16);line(ctx,[hit,[hit[0]+normal[0]*65,hit[1]+normal[1]*65]],'#d6d6d680',1);const incoming=[hit[0]-camera[0],hit[1]-camera[1]],length=Math.hypot(...incoming),v=incoming.map(x=>x/length),dp=v[0]*normal[0]+v[1]*normal[1];line(ctx,[hit,[hit[0]+(v[0]-2*dp*normal[0])*160,hit[1]+(v[1]-2*dp*normal[1])*160]],'#ff55554d',1.5);
  ctx.strokeStyle='#bcbcbc';ctx.strokeRect(camera[0]-15,camera[1]-10,24,20);label(ctx,'RAY',camera[0],camera[1]-22,'#929292',9);
}
function circuitry(ctx:CanvasRenderingContext2D,w:number,h:number,t:number){
  const gateX=[w*.31,w*.56,w*.79],ys=[h*.35,h*.65],phase=Math.floor(t*2)%8;
  for(let i=0;i<3;i++)for(let j=0;j<2;j++){
    const x=gateX[i],y=ys[j],active=((phase+i+j)%3)!==0;
    ctx.fillStyle=active?'#332026':'#1c1c1c';ctx.strokeStyle=active?'#ff5353':'#777777';ctx.lineWidth=1.4;ctx.beginPath();ctx.roundRect(x-28,y-22,56,44,5);ctx.fill();ctx.stroke();label(ctx,[['AND','XOR'],['NOT','OR'],['D','Q']][i][j],x,y+4,active?'#ffaaaa':'#c4c4c4',12);
    const from=i?gateX[i-1]+28:w*.09,mid=(from+x-28)/2,path=[[from,ys[(j+(i===1?1:0))%2]],[mid,ys[(j+(i===1?1:0))%2]],[mid,y],[x-28,y]];line(ctx,path,active?'#ff494978':'#7777773f',1.5);const p=(t*.55+i*.21+j*.4)%1,s=Math.min(2,Math.floor(p*3)),f=p*3-s;dot(ctx,path[s][0]*(1-f)+path[s+1][0]*f,path[s][1]*(1-f)+path[s+1][1]*f,2.5,active?red:white,7);
    if(i===2){line(ctx,[[x+28,y],[w*.93,y]],active?'#ff6565':'#777777',1.4);dot(ctx,w*.93,y,5,active?red:'#464646',active?12:0);}
  }
}

export function mountTechnicalArt(host:HTMLElement,preset:string,seed='',playing=true){
  const canvas=host.querySelector('canvas'),ctx=canvas?.getContext('2d');if(!canvas||!ctx)return{dispose(){},setPlaying(_value:boolean){void _value;}};
  const descriptor=artDescriptor(preset),project=projectPresets.find(item=>item.id===preset),projectKind=(project?.kind??(legacyPresets.includes(preset)?preset:null)) as ProjectVisualKind|null;
  const feed=projectKind==='market'?createMarketFeed():null;
  let w=0,h=0,time=0,pointer=0,visible=false,stop:(()=>void)|undefined,enabled=playing;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  const offset=[...seed].reduce((n,c)=>(n+c.charCodeAt(0))%73,0)*.13;
  const draw=()=>{
    if(!w||!h)return;const logicalH=390,logicalW=Math.max(520,w/h*logicalH),scale=h/logicalH;
    ctx.save();ctx.scale(scale,scale);ctx.clearRect(0,0,logicalW,logicalH);
    const bg=ctx.createRadialGradient(logicalW*.5,logicalH*.45,10,logicalW*.5,logicalH*.5,Math.max(logicalW*.55,260));bg.addColorStop(0,'#181818');bg.addColorStop(1,'#0c0c0c');ctx.fillStyle=bg;ctx.fillRect(0,0,logicalW,logicalH);grid(ctx,logicalW,logicalH);
    const t=time+offset;
    if(projectKind)drawProjectVisual(ctx,logicalW,logicalH,t,pointer,projectKind,feed?.(t));
    else if(preset==='terrain')drawProjectVisual(ctx,logicalW,logicalH,t,pointer,'terrain');
    else if(preset==='fluid')fluid(ctx,logicalW,logicalH,t,pointer);
    else if(preset==='ragdoll')ballPhysics(ctx,logicalW,logicalH,t,pointer);
    else if(preset==='cpu')cpu(ctx,logicalW,logicalH,t);
    else if(preset==='neural')neural(ctx,logicalW,logicalH,t);
    else if(preset==='orbital')orbital(ctx,logicalW,logicalH,t,pointer);
    else if(preset==='reaction')reaction(ctx,logicalW,logicalH,t);
    else if(preset==='particles')particles(ctx,logicalW,logicalH,t,pointer);
    else if(preset==='raytrace')raytrace(ctx,logicalW,logicalH,t,pointer);
    else circuitry(ctx,logicalW,logicalH,t);
    ctx.textAlign='left';ctx.font='9px Consolas,monospace';ctx.fillStyle='#858585';ctx.fillText(descriptor.code,23,27);
    ctx.textAlign='right';ctx.fillStyle='#626262';ctx.fillText('PXW / '+String(Math.floor(t*10)).padStart(5,'0'),logicalW-23,logicalH-18);
    line(ctx,[[logicalW-40,19],[logicalW-21,19],[logicalW-21,38]],'#ff4c4c',1.3);line(ctx,[[21,logicalH-38],[21,logicalH-19],[40,logicalH-19]],'#ff4c4c66',1);
    ctx.restore();host.classList.add('art-ready');
  };
  const refresh=()=>{stop?.();stop=undefined;draw();if(enabled&&!reduced.matches&&visible&&document.visibilityState==='visible')stop=animate(delta=>{time+=delta;draw();},projectKind==='market'?3:preset==='reaction'?12:20);};
  const resize=()=>{w=host.clientWidth;h=host.clientHeight;const ratio=Math.min(window.devicePixelRatio||1,1.5);canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);ctx.setTransform(ratio,0,0,ratio,0,0);refresh();};
  const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;refresh();},{rootMargin:'30px'}),sizing=new ResizeObserver(resize);
  const move=(event:PointerEvent)=>{if(reduced.matches)return;pointer=(event.clientX-host.getBoundingClientRect().left)/Math.max(w,1)-.5;if(!enabled&&visible)draw();};
  observer.observe(host);sizing.observe(host);host.addEventListener('pointermove',move,{passive:true});document.addEventListener('visibilitychange',refresh);reduced.addEventListener('change',refresh);resize();
  return{setPlaying(value:boolean){enabled=value;refresh();},dispose(){stop?.();observer.disconnect();sizing.disconnect();host.removeEventListener('pointermove',move);document.removeEventListener('visibilitychange',refresh);reduced.removeEventListener('change',refresh);host.classList.remove('art-ready');}};
}
