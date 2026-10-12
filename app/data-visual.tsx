"use client";

import { useEffect, useRef } from "react";

type VisualKind = "terrain" | "market" | "network" | "binary";
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
  const columns = 17, rows = 10, dx = (w - 50) / columns, dy = (h - 100) / rows;
  ctx.font = "11px monospace"; ctx.textAlign = "center";
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const wave = Math.sin(x * .36 + y * .48 - time * .48);
    const red = wave > .72 && x > 3 && x < 14;
    const bit = noise(x * 53 + y * 17 + Math.floor(time * .7)) > .5 ? "1" : "0";
    ctx.fillStyle = red ? `rgba(255,30,30,${.35 + wave * .5})` : `rgba(177,177,192,${.12 + noise(x * 7 + y * 21) * .16})`;
    ctx.fillText(bit, 30 + x * dx, 76 + y * dy);
  }
  const cx = w / 2, cy = h * .51, box = Math.min(w, h) * .27;
  ctx.fillStyle = "rgba(20,20,23,.88)"; ctx.fillRect(cx - box / 2, cy - box / 2, box, box);
  const length = 13;
  for (const [sx, sy] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
    line(ctx, [[cx + sx * (box / 2 - length), cy + sy * box / 2], [cx + sx * box / 2, cy + sy * box / 2], [cx + sx * box / 2, cy + sy * (box / 2 - length)]], "#ff2424", 1.5);
  }
  ctx.font = "32px monospace"; ctx.fillStyle = "#d9d9de"; ctx.fillText("01", cx, cy + 11);
  ctx.font = "9px monospace"; ctx.fillStyle = "#777780"; ctx.fillText("UNDEFINED / NEXT", cx, cy + box / 2 + 23);
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
