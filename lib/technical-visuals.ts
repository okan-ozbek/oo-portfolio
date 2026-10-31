import { animate } from '../app/animation-clock';
import { createMarketFeed } from '../app/market-feed';
import { drawProjectVisual, type ProjectVisualKind } from './project-visuals';
import { artDescriptor, projectPresets, legacyPresets } from './art-catalog.mjs';

const TAU=Math.PI*2, red='#ff3838', white='#d0d0dc';
const noise=(n:number)=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v);};
function line(ctx:CanvasRenderingContext2D,points:number[][],color:string,width=1){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke();}
function dot(ctx:CanvasRenderingContext2D,x:number,y:number,r:number,color=red,glow=0){ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=glow;ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fill();ctx.shadowBlur=0;}
function label(ctx:CanvasRenderingContext2D,text:string,x:number,y:number,color='#9393a5',size=10){ctx.fillStyle=color;ctx.font=`${size}px Consolas,monospace`;ctx.textAlign='center';ctx.fillText(text,x,y);}
function grid(ctx:CanvasRenderingContext2D,w:number,h:number){for(let x=30;x<w;x+=35)line(ctx,[[x,48],[x,h-34]],'#8a8aab0a');for(let y=55;y<h-30;y+=35)line(ctx,[[25,y],[w-25,y]],'#8a8aab0a');}
function fluid(ctx:CanvasRenderingContext2D,w:number,h:number,t:number,pointer:number){
  const centers=[[w*.36+pointer*30,h*.48],[w*.65-pointer*20,h*.57]];
  for(let row=0;row<19;row++){
    const points=[];for(let i=0;i<75;i++){const x=w*(.05+i/74*.9),base=55+row*(h-110)/18;let y=base;for(const [cx,cy]of centers){const dx=(x-cx)/130,dy=(base-cy)/95;y+=Math.sin(dx*2.2+t*.7+row*.14)*Math.exp(-(dx*dx+dy*dy)*.32)*42;}points.push([x,y]);}
    line(ctx,points,row%5===0?'#ff4545b8':'#acb9d13d',row%5===0?1.7:.8);
    const index=Math.floor(((t*.13+row*.077)%1)*74),[x,y]=points[index];dot(ctx,x,y,row%5===0?3:1.6,row%5===0?red:'#b7c5d9',row%5===0?10:0);
  }
  for(const [cx,cy]of centers){ctx.strokeStyle='#ff39392b';ctx.beginPath();ctx.ellipse(cx,cy,22,12,t*.15,0,TAU);ctx.stroke();}
}
type Particle={x:number;y:number;px:number;py:number;radius:number};
type Rig={nodes:Particle[];links:[number,number,number][]};
const rigs=new WeakMap<CanvasRenderingContext2D,{w:number;h:number;time:number;items:Rig[]}>();
function makeRig(x:number,y:number,scale:number):Rig{
  const points=[[0,0],[0,25],[-17,27],[17,27],[-30,55],[30,55],[-28,80],[29,80],[-13,65],[13,65],[-17,100],[20,100],[-22,133],[25,133]];
  const nodes=points.map(([a,b],i)=>({x:x+a*scale,y:y+b*scale,px:x+a*scale+(i%2?1:-1),py:y+b*scale,radius:i===0?10*scale:3*scale}));
  const pairs=[[0,1],[1,2],[1,3],[2,4],[3,5],[4,6],[5,7],[1,8],[1,9],[8,9],[2,9],[3,8],[8,10],[9,11],[10,12],[11,13]];
  return{nodes,links:pairs.map(([a,b])=>[a,b,Math.hypot(nodes[a].x-nodes[b].x,nodes[a].y-nodes[b].y)])};
}
function ragdoll(ctx:CanvasRenderingContext2D,w:number,h:number,t:number,pointer:number){
  let state=rigs.get(ctx);if(!state||state.w!==w||state.h!==h||t<state.time){state={w,h,time:t,items:[makeRig(w*.27,70,.9),makeRig(w*.51,48,1.1),makeRig(w*.74,90,.8)]};rigs.set(ctx,state);}
  const dt=Math.min(.04,Math.max(0,t-state.time));state.time=t;
  const floor=h-48;
  if(dt>0)for(const [i,rig]of state.items.entries()){
    for(const p of rig.nodes){const vx=(p.x-p.px)*.985,vy=(p.y-p.py)*.985;p.px=p.x;p.py=p.y;p.x+=vx+Math.sin(t*1.5+i)*.12+pointer*.09;p.y+=vy+780*dt*dt;}
    for(let iteration=0;iteration<9;iteration++){
      for(const [a,b,length]of rig.links){const p=rig.nodes[a],q=rig.nodes[b],dx=q.x-p.x,dy=q.y-p.y,d=Math.hypot(dx,dy)||1,force=(d-length)/d*.5;p.x+=dx*force;p.y+=dy*force;q.x-=dx*force;q.y-=dy*force;}
      for(const p of rig.nodes){p.x=Math.max(38,Math.min(w-38,p.x));if(p.y>floor-p.radius){p.y=floor-p.radius;p.py=p.y+(p.y-p.py)*.65;}}
    }
    // A repeating impulse makes the bodies tumble rather than settle forever.
    if(Math.floor(t*1.05+i*.33)!==Math.floor((t-dt)*1.05+i*.33)&&Math.floor(t+i)%4===0){const head=rig.nodes[0];head.py+=26;head.px-=18*(i%2?1:-1);}
  }
  line(ctx,[[30,floor+12],[w-30,floor+12]],'#a6a6bd45',1.5);
  for(const [i,rig]of state.items.entries()){for(const [a,b]of rig.links)line(ctx,[[rig.nodes[a].x,rig.nodes[a].y],[rig.nodes[b].x,rig.nodes[b].y]],i===1?'#ff6262':'#b8b8cd',2.5);for(const [n,p]of rig.nodes.entries())dot(ctx,p.x,p.y,p.radius,n===0?'#20202b':i===1?red:'#c0c0d4',n===0?0:5);const head=rig.nodes[0];ctx.strokeStyle=i===1?red:'#8b8b9f';ctx.lineWidth=2;ctx.beginPath();ctx.arc(head.x,head.y,head.radius,0,TAU);ctx.stroke();}
}
function cpu(ctx:CanvasRenderingContext2D,w:number,h:number,t:number){
  const cx=w/2,cy=h*.52,size=115,step=Math.floor(t*1.8)%4,registers=['PC','ACC','R0','R1'];
  for(const side of [-1,1])for(let i=0;i<4;i++){
    const x=cx+side*(size/2+115),y=100+i*(h-170)/3,active=i===step;ctx.fillStyle=active?'#382027':'#19191f';ctx.strokeStyle=active?red:'#494956';ctx.lineWidth=1.2;ctx.fillRect(x-45,y-16,90,32);ctx.strokeRect(x-45,y-16,90,32);label(ctx,side<0?registers[i]:`0x${((Math.floor(t*4)+i*37)%256).toString(16).padStart(2,'0').toUpperCase()}`,x,y+4,active?'#ffabab':'#a5a5b4',11);
    const edge=cx+side*size/2,from=x-side*45,via=cx+side*95,path=[[from,y],[via,y],[via,cy-35+i*23],[edge,cy-35+i*23]];line(ctx,path,active?'#ff3939ad':'#77778a45',1.5);const progress=(t*.65+i*.21)%1;const segment=Math.min(2,Math.floor(progress*3)),mix=progress*3-segment;dot(ctx,path[segment][0]*(1-mix)+path[segment+1][0]*mix,path[segment][1]*(1-mix)+path[segment+1][1]*mix,2.5,active?red:'#aaaabb',active?10:0);
  }
  ctx.fillStyle='#202026';ctx.fillRect(cx-size/2,cy-size/2,size,size);ctx.strokeStyle='#ff4b4b';ctx.lineWidth=2;ctx.strokeRect(cx-size/2,cy-size/2,size,size);
  for(let i=0;i<8;i++){const p=-43+i*12;for(const side of [-1,1])line(ctx,[[cx+p,cy+side*size/2],[cx+p,cy+side*(size/2+10)]],'#a3a3b7',2);}
  label(ctx,'CPU',cx,cy-12,'#eeeef4',24);label(ctx,['FETCH','DECODE','EXECUTE','WRITE'][step],cx,cy+14,'#ff7777',9);
  for(let i=0;i<4;i++){ctx.fillStyle=i===step?red:'#3c3c48';ctx.fillRect(cx-33+i*19,cy+31,10,4);}
}
function neural(ctx:CanvasRenderingContext2D,w:number,h:number,t:number){
  const counts=[4,6,5,4,2],layers=counts.map((count,i)=>Array.from({length:count},(_,j)=>[w*.12+i*w*.19,h*.5+(j-(count-1)/2)*(h-120)/6]));
  const wave=(t*.65)%5;
  layers.slice(0,-1).forEach((layer,i)=>layer.forEach(([x,y],a)=>layers[i+1].forEach(([u,v],b)=>{const weight=noise(i*77+a*13+b);line(ctx,[[x,y],[u,v]],weight>.74?'#ff494952':'#9c9cb321',weight>.74?1.3:.65);if(weight>.78){const p=(t*.5+weight)%1;dot(ctx,x+(u-x)*p,y+(v-y)*p,1.8,'#ff5555',6);}})));
  layers.forEach((layer,i)=>layer.forEach(([x,y],j)=>{const activation=Math.max(0,1-Math.abs(wave-i));dot(ctx,x,y,7+activation*2,'#22222b');ctx.strokeStyle=activation>.3?red:'#8b8ba7';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x,y,7+activation*2,0,TAU);ctx.stroke();if(activation>.3)dot(ctx,x,y,3+noise(j)*2,'#ff7373',10);}));
  label(ctx,'INPUT',w*.12,h-48);label(ctx,'HIDDEN LAYERS',w*.5,h-48);label(ctx,'OUTPUT',w*.88,h-48);
}
function orbital(ctx:CanvasRenderingContext2D,w:number,h:number,t:number,pointer:number){
  const cx=w*.5,cy=h*.52,r=Math.min(w*.38,h*.38);const halo=ctx.createRadialGradient(cx,cy,2,cx,cy,r*.55);halo.addColorStop(0,'#ff38384f');halo.addColorStop(1,'#ff383800');ctx.fillStyle=halo;ctx.fillRect(0,0,w,h);
  for(let i=0;i<5;i++){const radius=r*(.34+i*.16),tilt=-.4+i*.18+pointer*.2;ctx.strokeStyle='#a4a4bc32';ctx.lineWidth=1;ctx.beginPath();ctx.ellipse(cx,cy,radius,radius*.63,tilt,0,TAU);ctx.stroke();const angle=t*(.55-i*.065)+i*1.7;const point=(a:number)=>[cx+Math.cos(a)*radius*Math.cos(tilt)-Math.sin(a)*radius*.63*Math.sin(tilt),cy+Math.cos(a)*radius*Math.sin(tilt)+Math.sin(a)*radius*.63*Math.cos(tilt)];for(let j=10;j>0;j--){const [x,y]=point(angle-j*.035);dot(ctx,x,y,i===2?3:2,`rgba(255,${i===2?80:170},${i===2?80:180},${(1-j/11)*.5})`);}const [x,y]=point(angle);dot(ctx,x,y,4+i*.5,i===2?red:white,9);}
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
  for(let i=0;i<130;i++){const phase=(t*.12+noise(i)*2)%1,x=35+phase*(w-70),base=h*.5+(noise(i+200)-.5)*(h-140);const path=[];for(let j=0;j<6;j++){const p=phase-j*.004,u=35+p*(w-70),y=base+Math.sin(p*9+t*.3+i*.02)*35*Math.sin(p*Math.PI)+pointer*20*Math.sin(p*5);path.push([u,y]);}line(ctx,path,i%5===0?'#ff4848a0':'#b9b9d04a',i%5===0?1.6:.8);dot(ctx,x,path[0][1],i%5===0?2.7:1,i%5===0?red:white,i%5===0?8:0);}
  for(const x of [w*.2,w*.8]){ctx.strokeStyle='#ff39393d';ctx.beginPath();ctx.ellipse(x,h*.5,16,(h-120)*.5,0,0,TAU);ctx.stroke();}
}
function raytrace(ctx:CanvasRenderingContext2D,w:number,h:number,t:number,pointer:number){
  const spheres=[[w*.46,h*.55,55],[w*.7,h*.42,35],[w*.76,h*.72,25]];
  for(let i=0;i<9;i++)line(ctx,[[w*.1+i*w*.1,h-45],[w*.5+(i-4)*w*.035,h*.43]],'#85859e20');
  for(const [x,y,r]of spheres){const g=ctx.createRadialGradient(x-r*.35,y-r*.4,2,x,y,r);g.addColorStop(0,'#b0b0c5');g.addColorStop(.5,'#454554');g.addColorStop(1,'#19191f');ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fill();ctx.strokeStyle='#b5b5cb4f';ctx.stroke();}
  const camera=[w*.13,h*.4],sphere=spheres[0],angle=-2.8+Math.sin(t*.7)*.45+pointer*.3,hit=[sphere[0]+Math.cos(angle)*sphere[2],sphere[1]+Math.sin(angle)*sphere[2]],normal=[Math.cos(angle),Math.sin(angle)];
  line(ctx,[camera,hit],'#ff4646',2);dot(ctx,hit[0],hit[1],4,'#ff8b8b',16);line(ctx,[hit,[hit[0]+normal[0]*65,hit[1]+normal[1]*65]],'#d6d6e080',1);const incoming=[hit[0]-camera[0],hit[1]-camera[1]],length=Math.hypot(...incoming),v=incoming.map(x=>x/length),dp=v[0]*normal[0]+v[1]*normal[1];line(ctx,[hit,[hit[0]+(v[0]-2*dp*normal[0])*160,hit[1]+(v[1]-2*dp*normal[1])*160]],'#ff55554d',1.5);
  ctx.strokeStyle='#bcbcd1';ctx.strokeRect(camera[0]-15,camera[1]-10,24,20);label(ctx,'RAY',camera[0],camera[1]-22,'#9292a6',9);
}
function circuitry(ctx:CanvasRenderingContext2D,w:number,h:number,t:number){
  const gateX=[w*.31,w*.56,w*.79],ys=[h*.35,h*.65],phase=Math.floor(t*2)%8;
  for(let i=0;i<3;i++)for(let j=0;j<2;j++){
    const x=gateX[i],y=ys[j],active=((phase+i+j)%3)!==0;
    ctx.fillStyle=active?'#332026':'#1c1c24';ctx.strokeStyle=active?'#ff5353':'#77778f';ctx.lineWidth=1.4;ctx.beginPath();ctx.roundRect(x-28,y-22,56,44,5);ctx.fill();ctx.stroke();label(ctx,[['AND','XOR'],['NOT','OR'],['D','Q']][i][j],x,y+4,active?'#ffaaaa':'#c4c4d5',12);
    const from=i?gateX[i-1]+28:w*.09,mid=(from+x-28)/2,path=[[from,ys[(j+(i===1?1:0))%2]],[mid,ys[(j+(i===1?1:0))%2]],[mid,y],[x-28,y]];line(ctx,path,active?'#ff494978':'#77778a3f',1.5);const p=(t*.55+i*.21+j*.4)%1,s=Math.min(2,Math.floor(p*3)),f=p*3-s;dot(ctx,path[s][0]*(1-f)+path[s+1][0]*f,path[s][1]*(1-f)+path[s+1][1]*f,2.5,active?red:white,7);
    if(i===2){line(ctx,[[x+28,y],[w*.93,y]],active?'#ff6565':'#77778b',1.4);dot(ctx,w*.93,y,5,active?red:'#464653',active?12:0);}
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
    const bg=ctx.createRadialGradient(logicalW*.5,logicalH*.45,10,logicalW*.5,logicalH*.5,Math.max(logicalW*.55,260));bg.addColorStop(0,'#22222c');bg.addColorStop(1,'#101014');ctx.fillStyle=bg;ctx.fillRect(0,0,logicalW,logicalH);grid(ctx,logicalW,logicalH);
    const t=time+offset;
    if(projectKind)drawProjectVisual(ctx,logicalW,logicalH,t,pointer,projectKind,feed?.(t));
    else if(preset==='terrain')drawProjectVisual(ctx,logicalW,logicalH,t,pointer,'terrain');
    else if(preset==='fluid')fluid(ctx,logicalW,logicalH,t,pointer);
    else if(preset==='ragdoll')ragdoll(ctx,logicalW,logicalH,t,pointer);
    else if(preset==='cpu')cpu(ctx,logicalW,logicalH,t);
    else if(preset==='neural')neural(ctx,logicalW,logicalH,t);
    else if(preset==='orbital')orbital(ctx,logicalW,logicalH,t,pointer);
    else if(preset==='reaction')reaction(ctx,logicalW,logicalH,t);
    else if(preset==='particles')particles(ctx,logicalW,logicalH,t,pointer);
    else if(preset==='raytrace')raytrace(ctx,logicalW,logicalH,t,pointer);
    else circuitry(ctx,logicalW,logicalH,t);
    ctx.textAlign='left';ctx.font='9px Consolas,monospace';ctx.fillStyle='#858596';ctx.fillText(descriptor.code,23,27);
    ctx.textAlign='right';ctx.fillStyle='#626274';ctx.fillText('PXW / '+String(Math.floor(t*10)).padStart(5,'0'),logicalW-23,logicalH-18);
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
