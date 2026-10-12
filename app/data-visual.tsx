"use client";

import { useEffect, useRef } from "react";

type VisualKind = "terrain" | "market" | "network" | "binary" | "stack" | "blackhole" | "latency";
const TAU = Math.PI * 2;
const noise = (n: number) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };

function line(ctx: CanvasRenderingContext2D, points: number[][], color: string, width = 1) {
  ctx.beginPath();
  points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function grid(ctx: CanvasRenderingContext2D, w: number, h: number, step = 42) {
  ctx.strokeStyle = "rgba(210,210,218,.055)";
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
}

function terrain(ctx: CanvasRenderingContext2D, w: number, h: number, time: number, pointer: number) {
  const cols = 31, rows = 20;
  const scale = Math.min(w / 600, h / 390);
  const point = (x: number, z: number) => {
    const u = (x / (cols - 1) - .5) * 440;
    const v = (z / (rows - 1) - .5) * 300;
    const swell = Math.sin(x * .21 + time * .26) * Math.cos(z * .24 - time * .2) * 48;
    const crest = Math.exp(-Math.pow((x - 18 - Math.sin(time * .18) * 2) / 7, 2)) * 54;
    return [w * .5 + (u * .85 + v * .75) * scale, h * .58 + (v * .36 - u * .19 - swell - crest + pointer * v * .035) * scale];
  };
  for (let z = 0; z < rows; z++) line(ctx, Array.from({length: cols}, (_, x) => point(x, z)), `rgba(190,190,201,${.09 + (z / rows) * .15})`);
  for (let x = 0; x < cols; x++) line(ctx, Array.from({length: rows}, (_, z) => point(x, z)), "rgba(160,160,174,.15)");
  for (const z of [8, 9, 10]) {
    ctx.shadowColor = "#ff0000"; ctx.shadowBlur = z === 9 ? 13 : 0;
    line(ctx, Array.from({length: cols}, (_, x) => point(x, z)), z === 9 ? "#ff2424" : "rgba(255,0,0,.25)", z === 9 ? 1.7 : 1);
  }
  ctx.shadowBlur = 0;
  const cursor = (time * 1.6) % (cols - 1);
  const [px, py] = point(cursor, 9);
  ctx.fillStyle = "#ff4444"; ctx.beginPath(); ctx.arc(px, py, 3, 0, TAU); ctx.fill();
  ctx.strokeStyle = "rgba(255,0,0,.3)"; ctx.beginPath(); ctx.arc(px, py, 8 + Math.sin(time * 2) * 2, 0, TAU); ctx.stroke();
}

function market(ctx: CanvasRenderingContext2D, w: number, h: number, time: number) {
  grid(ctx, w, h, 40);
  const count = 27, left = 25, usable = w - 53, step = usable / count;
  const value = (i: number) => .64 - i * .013 + Math.sin(i * .64) * .13 + Math.sin(i * 1.6) * .045;
  const points: number[][] = [];
  for (let i = 0; i < count; i++) {
    const x = left + i * step, v = value(i), y = h * (.2 + v * .62);
    const delta = (noise(i + 42) - .46) * h * .13;
    const open = y + delta, close = y;
    const high = Math.min(open, close) - 5 - noise(i + 61) * 13;
    const low = Math.max(open, close) + 5 + noise(i + 80) * 12;
    const rising = delta > 0;
    ctx.fillStyle = rising ? "rgba(255,38,38,.86)" : "rgba(181,181,193,.45)";
    ctx.strokeStyle = rising ? "rgba(255,38,38,.6)" : "rgba(181,181,193,.4)";
    ctx.beginPath(); ctx.moveTo(x, high); ctx.lineTo(x, low); ctx.stroke();
    ctx.fillRect(x - step * .24, Math.min(open, close), step * .48, Math.max(Math.abs(delta), 3));
    ctx.fillStyle = rising ? "rgba(255,0,0,.16)" : "rgba(180,180,190,.1)";
    ctx.fillRect(x - step * .26, h - 34 - noise(i + 20) * 31, step * .52, 20 + noise(i + 20) * 31);
    points.push([x, y + 23]);
  }
  line(ctx, points, "rgba(215,215,227,.25)");
  const scanX = left + ((time * 12) % usable);
  ctx.setLineDash([3, 5]);
  line(ctx, [[scanX, 86], [scanX, h - 29]], "rgba(255,58,58,.38)");
  ctx.setLineDash([]);
  const pulse = .35 + Math.sin(time * 1.5) * .12;
  const glow = ctx.createRadialGradient(w * .77, h * .5, 0, w * .77, h * .5, w * .5);
  glow.addColorStop(0, `rgba(255,0,0,${pulse * .08})`); glow.addColorStop(1, "rgba(255,0,0,0)");
  ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
}

function network(ctx: CanvasRenderingContext2D, w: number, h: number, time: number, pointer: number) {
  const angle = time * .07 + .5 + pointer * .1;
  const size = Math.min(w, h) * .26;
  const vertices = Array.from({length: 8}, (_, n) => [n & 1 ? 1 : -1, n & 2 ? 1 : -1, n & 4 ? 1 : -1]);
  const project = ([x, y, z]: number[]) => {
    const rx = x * Math.cos(angle) + z * Math.sin(angle);
    const rz = z * Math.cos(angle) - x * Math.sin(angle);
    return [w / 2 + rx * size, h * .53 + (y * .84 + rz * .46) * size];
  };
  const points = vertices.map(project);
  // Fine construction rings sit beneath the slowly rotating data cube.
  ctx.save(); ctx.translate(w / 2, h * .79); ctx.scale(1, .3);
  for (const radius of [size * .75, size * 1.4, size * 1.8]) { ctx.beginPath(); ctx.arc(0, 0, radius, 0, TAU); ctx.strokeStyle = "rgba(186,186,198,.12)"; ctx.stroke(); }
  ctx.restore();
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
    const diff = i ^ j;
    if (diff !== 1 && diff !== 2 && diff !== 4) continue;
    const red = i === 1 || j === 1;
    line(ctx, [points[i], points[j]], red ? "rgba(255,38,38,.8)" : "rgba(195,195,207,.32)", red ? 1.5 : 1);
    const p = (time * .22 + i * .15 + j * .07) % 1;
    const x = points[i][0] + (points[j][0] - points[i][0]) * p;
    const y = points[i][1] + (points[j][1] - points[i][1]) * p;
    ctx.fillStyle = red ? "#ff3333" : "#b8b8c2"; ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
  }
  points.forEach(([x, y], n) => { ctx.fillStyle = n === 1 ? "#ff2424" : "#c7c7d1"; ctx.fillRect(x - 2.5, y - 2.5, 5, 5); });
  ctx.setLineDash([2, 5]); line(ctx, [points[0], points[7]], "rgba(190,190,202,.22)"); ctx.setLineDash([]);
}

function binary(ctx: CanvasRenderingContext2D, w: number, h: number, time: number) {
  const scale = Math.min(w / 360, h / 265);
  ctx.save(); ctx.translate((w - 360 * scale) / 2, (h - 265 * scale) / 2); ctx.scale(scale, scale);
  ctx.textAlign = "left"; ctx.font = "9px monospace";
  ctx.fillStyle = "#727280"; ctx.fillText("INSTRUCTIONS", 20, 63); ctx.fillText("REGISTERS", 242, 63);
  line(ctx, [[226, 55], [226, 233]], "rgba(180,180,200,.12)");
  const instructions = [
    ["mov", "rax, [rdi]"], ["xor", "rcx, rcx"], ["test", "rax, rax"], ["je", "0x004020"],
    ["add", "rcx, rax"], ["shr", "rax, 1"], ["cmp", "rcx, 0x20"], ["jne", "0x004010"],
    ["lea", "rsi, [rsp+8]"], ["call", "0x004080"], ["inc", "rdx"], ["ret", ""],
  ];
  // An instruction stream passes a fixed execution cursor; all data is illustrative.
  const rowHeight = 21, scroll = time * 10, first = Math.floor(scroll / rowHeight), offset = scroll % rowHeight;
  ctx.save(); ctx.beginPath(); ctx.rect(15, 76, 206, 157); ctx.clip();
  ctx.fillStyle = "rgba(255,0,0,.065)"; ctx.fillRect(15, 139, 202, rowHeight);
  ctx.fillStyle = "#ff3434"; ctx.fillRect(15, 139, 2, rowHeight);
  for (let row = -1; row < 9; row++) {
    const index = first + row + 1, y = 90 + row * rowHeight - offset;
    const [op, operand] = instructions[index % instructions.length];
    const active = y >= 139 && y < 160;
    ctx.font = "9px monospace"; ctx.fillStyle = "#595965";
    ctx.fillText((0x4010 + index * 4).toString(16).padStart(6, "0"), 24, y);
    ctx.font = "11px monospace"; ctx.fillStyle = active ? "#ff4b4b" : "#b4b4c1"; ctx.fillText(op, 75, y);
    ctx.fillStyle = active ? "#e1e1e9" : "#80808f"; ctx.fillText(operand, 110, y);
  }
  ctx.restore();
  const cycle = Math.floor(time * .8);
  for (const [index, register] of ["RAX", "RBX", "RCX", "RDX"].entries()) {
    const y = 87 + index * 37;
    const value = Math.floor(noise(index * 17 + cycle) * 65536);
    ctx.font = "9px monospace"; ctx.fillStyle = "#777785"; ctx.fillText(register, 242, y);
    ctx.fillStyle = index === cycle % 4 ? "#ff5353" : "#c3c3cf";
    ctx.fillText(`0x${value.toString(16).padStart(4, "0").toUpperCase()}`, 278, y);
    ctx.font = "8px monospace"; ctx.fillStyle = "#61616e";
    ctx.fillText(value.toString(2).padStart(16, "0"), 242, y + 13);
  }
  line(ctx, [[20, 240], [340, 240]], "rgba(180,180,200,.1)");
  ctx.font = "8px monospace"; ctx.fillStyle = "#555563";
  const bits = Array.from({length: 52}, (_, i) => noise(i + first * 5) > .5 ? "1" : "0").join("");
  ctx.fillText(bits, 20, 252);
  ctx.restore();
}

function stack(ctx: CanvasRenderingContext2D, w: number, h: number, time: number, pointer: number) {
  const scale = Math.min(w / 400, (h - 55) / 235), cx = w / 2, cy = h * .58;
  const angle = time * .13 + .65 + pointer * .22, elevation = .57;
  const gap = 34 + Math.sin(time * .6) * 3;
  const rotate = (x: number, z: number) => [x * Math.cos(angle) - z * Math.sin(angle), x * Math.sin(angle) + z * Math.cos(angle)];
  const depth = (x: number, y: number, z: number) => rotate(x, z)[1] * Math.cos(elevation) + y * Math.sin(elevation);
  const project = (x: number, y: number, z: number) => {
    const [rx, rz] = rotate(x, z);
    // Camera elevation and perspective use the same rotated depth for every face.
    const perspective = 620 / (620 - depth(x, y, z));
    return [cx + rx * scale * perspective, cy + (rz * Math.sin(elevation) - y * Math.cos(elevation)) * scale * perspective];
  };
  const polygon = (points: number[][], fill: string, stroke: string) => {
    ctx.beginPath(); points.forEach(([x,y], i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y)); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke();
  };
  const shadow = ctx.createRadialGradient(cx, cy + 75 * scale, 0, cx, cy + 75 * scale, 100 * scale);
  shadow.addColorStop(0, 'rgba(0,0,0,.4)'); shadow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = shadow; ctx.fillRect(0, 0, w, h);
  const corners = [[-65,-65],[65,-65],[65,65],[-65,65]];
  ctx.setLineDash([2,5]);
  corners.forEach(([x,z]) => line(ctx, [project(x,-gap*1.5,z), project(x,gap*1.5,z)], 'rgba(190,190,210,.16)'));
  ctx.setLineDash([]);
  const faces: {depth: number; draw: () => void}[] = [];
  for (let layer = 0; layer < 4; layer++) {
    const y = (layer - 1.5) * gap, red = layer === 2;
    const top = corners.map(([x,z]) => project(x,y,z));
    const bottom = corners.map(([x,z]) => project(x,y-7,z));
    for (let i = 0; i < 4; i++) {
      const j = (i+1)%4;
      const mx = (corners[i][0] + corners[j][0]) / 2, mz = (corners[i][1] + corners[j][1]) / 2;
      if (rotate(mx, mz)[1] > 0) faces.push({depth: depth(mx, y - 3.5, mz), draw: () =>
        polygon([top[i],top[j],bottom[j],bottom[i]], red ? '#661d24' : '#25252d', red ? '#aa343e' : '#4b4b57')});
    }
    faces.push({depth: depth(0, y, 0), draw: () => {
      polygon(top, red ? '#391d25' : '#222229', red ? '#ff3939' : '#686876');
      for (let tick = -32; tick <= 32; tick += 32) {
        line(ctx, [project(tick,y+.1,-65),project(tick,y+.1,65)], red ? 'rgba(255,90,90,.3)' : 'rgba(175,175,195,.18)');
        line(ctx, [project(-65,y+.1,tick),project(65,y+.1,tick)], red ? 'rgba(255,90,90,.3)' : 'rgba(175,175,195,.18)');
      }
      const tile = 15;
      polygon([project(-tile,y+.3,-tile),project(tile,y+.3,-tile),project(tile,y+.3,tile),project(-tile,y+.3,tile)], red ? '#b92b37' : '#35353f', red ? '#ff6666' : '#777784');
    }});
  }
  faces.sort((a, b) => a.depth - b.depth).forEach(face => face.draw());
}

function blackhole(ctx: CanvasRenderingContext2D, w: number, h: number, time: number) {
  const cx = w / 2, cy = h * .55, radius = Math.min(w * .12, h * .17);
  const halo = ctx.createRadialGradient(cx,cy,radius*.7,cx,cy,radius*2.6);
  halo.addColorStop(0,'rgba(255,80,70,.2)'); halo.addColorStop(.45,'rgba(255,0,0,.12)'); halo.addColorStop(1,'rgba(255,0,0,0)');
  ctx.fillStyle = halo; ctx.fillRect(0,0,w,h);
  for (let i = 0; i < 65; i++) {
    const x = noise(i+12)*w, y = 48+noise(i+92)*(h-65);
    ctx.fillStyle = `rgba(195,195,210,${.07+noise(i+34)*.17})`; ctx.fillRect(x,y,1,1);
  }
  // Back of the disk, central shadow, then the foreground disk create depth.
  const disk = (front: boolean) => {
    for (let ring = 0; ring < 20; ring++) {
      const r = radius * (1.2 + ring * .075), points: number[][] = [];
      for (let i = 0; i <= 90; i++) {
        const a = (front ? 0 : Math.PI) + i/90*Math.PI;
        const bend = !front ? Math.exp(-Math.pow(Math.cos(a)*2.2,2))*radius*.83 : 0;
        points.push([cx+Math.cos(a)*r,cy+Math.sin(a)*r*.25-bend]);
      }
      const brightness = .2 + (1+Math.sin(ring*.7-time*.65))*.17;
      line(ctx, points, ring < 3 ? `rgba(255,206,187,${brightness+.2})` : `rgba(255,${35+ring*3},${35+ring*2},${brightness})`, ring < 3 ? 1.4 : .8);
    }
    for (let i = 0; i < 60; i++) {
      const a = (i * 2.4 + time * .32) % TAU;
      if ((Math.sin(a)>0) !== front) continue;
      const r = radius*(1.3+noise(i+4)*1.25);
      const bend = !front ? Math.exp(-Math.pow(Math.cos(a)*2.2,2))*radius*.83 : 0;
      const x = cx+Math.cos(a)*r, y = cy+Math.sin(a)*r*.25-bend;
      ctx.fillStyle = i%4 === 0 ? '#ffd3bf' : '#ff4d45';
      ctx.beginPath(); ctx.arc(x,y,i%4===0?1.1:.6,0,TAU); ctx.fill();
    }
  };
  disk(false);
  ctx.fillStyle = '#08080b'; ctx.beginPath(); ctx.arc(cx,cy,radius,0,TAU); ctx.fill();
  ctx.shadowColor = '#ff3828'; ctx.shadowBlur = 13;
  ctx.strokeStyle = 'rgba(255,150,119,.85)'; ctx.lineWidth = 1.7;
  ctx.beginPath(); ctx.arc(cx,cy,radius*1.03,0,TAU); ctx.stroke(); ctx.shadowBlur = 0;
  disk(true);
}

function latency(ctx: CanvasRenderingContext2D, w: number, h: number, time: number) {
  const left = 39, right = w-22, top = 93, bottom = h-29;
  const width = Math.max(right-left,1), height = Math.max(bottom-top,1);
  ctx.font = '9px monospace'; ctx.textAlign = 'right';
  for (const value of [0,25,50,75,100]) {
    const y = bottom-value/100*height;
    line(ctx,[[left,y],[right,y]],'rgba(175,175,195,.1)');
    ctx.fillStyle = '#696976'; ctx.fillText(String(value),left-8,y+3);
  }
  for (let i=0;i<7;i++) line(ctx,[[left+i/6*width,top],[left+i/6*width,bottom]],'rgba(175,175,195,.055)');
  const values = (t: number) => {
    const n = t*45+time*.75;
    const index = Math.floor(n), mix = n-index;
    const jitter = noise(index+7)*(1-mix)+noise(index+8)*mix;
    const p50 = 14+jitter*9+Math.sin(n*.28)*3;
    const spike = Math.pow(Math.max(0,Math.sin(n*.39+.8)),12)*36;
    return [p50,p50+22+jitter*14+spike];
  };
  const series = [0,1].map(percentile => Array.from({length:100},(_,i) => [left+i/99*width,bottom-values(i/99)[percentile]/100*height]));
  ctx.beginPath(); ctx.moveTo(left,bottom);
  series[1].forEach(([x,y])=>ctx.lineTo(x,y)); ctx.lineTo(right,bottom); ctx.closePath();
  const fill=ctx.createLinearGradient(0,top,0,bottom); fill.addColorStop(0,'rgba(255,0,0,.12)');fill.addColorStop(1,'rgba(255,0,0,0)');
  ctx.fillStyle=fill;ctx.fill();
  line(ctx,series[0],'#a6a6b5',1.5);
  line(ctx,series[1],'#ff3b3b',1.6);
  for (const [i,color] of [[0,'#c5c5d0'],[1,'#ff4a4a']] as const) {
    const [x,y]=series[i][99];ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,2.7,0,TAU);ctx.fill();
  }
  ctx.textAlign='left';ctx.fillStyle='#696976';ctx.fillText('-60s',left,h-12);
  ctx.textAlign='right';ctx.fillText('now',right,h-12);
}

export function DataVisual({kind, playing}: {kind: VisualKind; playing: boolean}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef(0);
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !host || !ctx) return;
    let w = 0, h = 0, frame = 0, last = 0, visible = false, pointer = 0;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      if (kind === "terrain") terrain(ctx, w, h, timeRef.current, pointer);
      else if (kind === "market") market(ctx, w, h, timeRef.current);
      else if (kind === "network") network(ctx, w, h, timeRef.current, pointer);
      else if (kind === "stack") stack(ctx, w, h, timeRef.current, pointer);
      else if (kind === "blackhole") blackhole(ctx, w, h, timeRef.current);
      else if (kind === "latency") latency(ctx, w, h, timeRef.current);
      else binary(ctx, w, h, timeRef.current);
    };
    const tick = (now: number) => {
      if (now - last > 32) { timeRef.current += Math.min((now - last) / 1000, .05); last = now; draw(); }
      frame = requestAnimationFrame(tick);
    };
    const refresh = () => {
      cancelAnimationFrame(frame);
      draw();
      if (playing && visible && document.visibilityState === "visible") { last = performance.now(); frame = requestAnimationFrame(tick); }
    };
    const resize = () => {
      w = host.clientWidth; h = host.clientHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0); refresh();
    };
    const onPointer = (event: PointerEvent) => {
      pointer = (event.clientX - host.getBoundingClientRect().left) / Math.max(w, 1) - .5;
      if (!playing) draw();
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; refresh(); });
    const resizeObserver = new ResizeObserver(resize);
    observer.observe(host); resizeObserver.observe(host);
    host.addEventListener("pointermove", onPointer, {passive: true});
    document.addEventListener("visibilitychange", refresh);
    resize();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); resizeObserver.disconnect(); host.removeEventListener("pointermove", onPointer); document.removeEventListener("visibilitychange", refresh); };
  }, [kind, playing]);
  return <canvas className="data-canvas" ref={canvasRef} aria-hidden="true" />;
}
