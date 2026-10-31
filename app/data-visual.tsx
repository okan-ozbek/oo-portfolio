"use client";

import { useEffect, useRef } from "react";
import { createMarketFeed } from "./market-feed";
import { animate } from "./animation-clock";

import { drawProjectVisual, type ProjectVisualKind as VisualKind } from '../lib/project-visuals';
export function DataVisual({kind, playing}: {kind: VisualKind; playing: boolean}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef(0);
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !host || !ctx) return;
    let w = 0, h = 0, visible = false, pointer = 0;
    let stop: (() => void) | undefined;
    const marketFeed = kind === "market" ? createMarketFeed() : null;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      drawProjectVisual(ctx,w,h,timeRef.current,pointer,kind,marketFeed?.(timeRef.current));
    };
    const refresh = () => {
      stop?.(); stop = undefined;
      draw();
      if (playing && visible && document.visibilityState === "visible") {
        // The feed has 12 trades per four-second candle; 3 fps captures every trade.
        const fps = kind === "market" ? 3 : kind === "latency" ? 10 : kind === "binary" ? 12 : w < 500 ? 20 : 24;
        stop = animate(delta => { timeRef.current += delta; draw(); }, fps);
      }
    };
    const resize = () => {
      w = host.clientWidth; h = host.clientHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0); refresh();
    };
    const onPointer = (event: PointerEvent) => {
      pointer = (event.clientX - host.getBoundingClientRect().left) / Math.max(w, 1) - .5;
      if (!playing && visible && document.visibilityState === "visible") draw();
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; refresh(); });
    const resizeObserver = new ResizeObserver(resize);
    observer.observe(host); resizeObserver.observe(host);
    host.addEventListener("pointermove", onPointer, {passive: true});
    document.addEventListener("visibilitychange", refresh);
    resize();
    return () => { stop?.(); observer.disconnect(); resizeObserver.disconnect(); host.removeEventListener("pointermove", onPointer); document.removeEventListener("visibilitychange", refresh); };
  }, [kind, playing]);
  return <canvas className="data-canvas" ref={canvasRef} aria-hidden="true" />;
}
