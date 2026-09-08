"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowRight, Database, FileStack, Network, Pause, Play, RotateCcw, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The stationary stage keeps pointer coordinates stable while the card tilts. */
export function RadishArchitecture() {
  const stageRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [ambientPaused, setAmbientPaused] = useState(false);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    const update = () => {
      card.dataset.bokehRunning = String(visible && !ambientPaused && !reducedMotion.matches && document.visibilityState === "visible");
    };
    const observer = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    }) : null;
    if (observer) observer.observe(card);
    else visible = true;
    update();
    document.addEventListener("visibilitychange", update);
    reducedMotion.addEventListener("change", update);
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", update);
      reducedMotion.removeEventListener("change", update);
      delete card.dataset.bokehRunning;
    };
  }, [ambientPaused]);

  useEffect(() => {
    const stage = stageRef.current;
    const card = cardRef.current;
    if (!stage || !card) return;
    // The whole feature responds, including its copy and the space around the card.
    const interactionArea = stage.closest<HTMLElement>(".featured-project") ?? stage;
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let x = 0.5;
    let y = 0.5;

    const reset = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      delete card.dataset.active;
      card.style.removeProperty("--tilt-x");
      card.style.removeProperty("--tilt-y");
      card.style.removeProperty("--light-x");
      card.style.removeProperty("--light-y");
    };
    const paint = () => {
      frame = 0;
      card.dataset.active = "true";
      card.style.setProperty("--tilt-x", `${(0.5 - y) * 14}deg`);
      card.style.setProperty("--tilt-y", `${(x - 0.5) * 14}deg`);
      card.style.setProperty("--light-x", `${x * 100}%`);
      card.style.setProperty("--light-y", `${y * 100}%`);
    };
    const move = (event: PointerEvent) => {
      if (!finePointer.matches || reducedMotion.matches || event.pointerType !== "mouse") return;
      const bounds = interactionArea.getBoundingClientRect();
      x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
      y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / Math.max(1, bounds.height)));
      if (!frame) frame = requestAnimationFrame(paint);
    };
    interactionArea.addEventListener("pointermove", move);
    interactionArea.addEventListener("pointerleave", reset);
    interactionArea.addEventListener("pointercancel", reset);
    window.addEventListener("blur", reset);
    finePointer.addEventListener("change", reset);
    reducedMotion.addEventListener("change", reset);
    return () => {
      reset();
      interactionArea.removeEventListener("pointermove", move);
      interactionArea.removeEventListener("pointerleave", reset);
      interactionArea.removeEventListener("pointercancel", reset);
      window.removeEventListener("blur", reset);
      finePointer.removeEventListener("change", reset);
      reducedMotion.removeEventListener("change", reset);
    };
  }, []);

  return (
    <div className="radish-holo-stage" ref={stageRef}>
      <div className="radish-holo-card" ref={cardRef}>
        <div className="holo-bokeh" aria-hidden="true"><span className="bokeh-orb bokeh-orb--carmine" /><span className="bokeh-orb bokeh-orb--ash" /><span className="bokeh-orb bokeh-orb--sand" /></div>
        <div className="holo-card-content">
          <div className="holo-header"><span className="holo-mark">r.</span><span>RADISH / SYSTEM MAP<span className="holo-edition">In memory. On disk. After restart.</span></span><span className="holo-serial">01</span></div>
          <div className="radish-diagram" role="img" aria-label="Radish persistence architecture: redis-cli uses RESP2 or RESP3 to connect to the nonblocking Asio TCP server. The server accesses a TTL-aware in-memory store with concurrent readers. Writes go to an append-only log. On restart, crash replay restores the in-memory state from the log.">
            <div className="architecture-node"><span className="architecture-index">01</span><Terminal aria-hidden="true" /><span className="architecture-label">redis-cli<small>RESP2 / RESP3</small></span><span className="architecture-kind">CLIENT</span></div>
            <div className="architecture-link" aria-hidden="true"><ArrowDown /><span>TCP connection</span></div>
            <div className="architecture-node"><span className="architecture-index">02</span><Network aria-hidden="true" /><span className="architecture-label">Asio TCP server<small>Nonblocking connections</small></span><span className="architecture-kind">I/O</span></div>
            <div className="architecture-link" aria-hidden="true"><ArrowDown /><span>Read / write</span></div>
            <div className="architecture-node architecture-memory"><span className="architecture-index">03</span><Database aria-hidden="true" /><span className="architecture-label">In-memory store<small>TTL-aware · Concurrent readers</small></span><span className="memory-indicator" aria-hidden="true" /></div>
            <div className="architecture-branches" aria-hidden="true"><svg viewBox="0 0 400 64" preserveAspectRatio="none"><path d="M200 0 V17 Q200 24 193 24 H107 Q100 24 100 31 V59" /><path className="replay-route" d="M300 64 V31 Q300 24 293 24 H224 Q217 24 217 17 V2" /><path className="route-arrow" d="M96 54 L100 60 L104 54 M213 8 L217 2 L221 8" /></svg><span>Persist</span><span>Restore</span></div>
            <div className="architecture-durability"><div className="durability-node"><FileStack aria-hidden="true" /><span>Append-only log<small>Durable writes</small></span></div><ArrowRight className="recovery-arrow" aria-hidden="true" /><div className="durability-node"><RotateCcw aria-hidden="true" /><span>Crash replay<small>Deterministic recovery</small></span></div></div>
            <p className="architecture-restart" aria-hidden="true">Log → replay on restart</p>
          </div>
          <div className="holo-footer"><span className="holo-chip">C++23</span><span>Correctness across restarts.</span><span className="holo-prism" aria-hidden="true" /><Button variant="ghost" size="icon" className="holo-motion-toggle" aria-label={`${ambientPaused ? "Resume" : "Pause"} Radish ambient animation`} aria-pressed={ambientPaused} title={ambientPaused ? "Resume ambient motion" : "Pause ambient motion"} onClick={() => setAmbientPaused(value => !value)}>{ambientPaused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}</Button></div>
        </div>
      </div>
    </div>
  );
}
