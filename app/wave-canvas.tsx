"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

// Slow, continuous movement; time advances only while this panel is visible.
const MOTION_RATE = 1.2;
const MAX_PIXELS = 1_200_000;

const vertexSource = `
  attribute vec2 aPosition;
  void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }
`;

const fragmentSource = `
  precision highp float;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uVariant;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / uResolution;
    float aspect = uResolution.x / max(1.0, uResolution.y);
    vec2 p = (uv - vec2(0.61, 0.5)) * vec2(min(aspect, 2.2), 1.0);
    float t = uTime * 0.11 + uVariant * 2.8;

    // A continuous warped field produces long, curved folds, not separate blobs.
    p.x += 0.20 * sin(p.y * 3.2 + t * 0.62)
         + 0.09 * sin(p.y * 5.4 - t * 0.37);
    p.y += 0.11 * sin(p.x * 2.6 - t * 0.48);
    float bend = 0.24 * sin(p.y * 3.6 - t * 0.68)
               + 0.18 * sin(p.x * 2.1 + p.y * 1.8 + t * 0.34)
               + 0.18 * noise(p * 2.1 + vec2(t * 0.09, -t * 0.07));
    float field = p.x * 1.6 + p.y * 0.32 + bend + t * 0.18;
    float phase = field * 5.2;
    float fold = 0.5 + 0.5 * sin(phase);

    vec3 ink = vec3(0.071, 0.067, 0.078);
    vec3 signal = vec3(1.0, 0.0, 0.0);
    vec3 paper = vec3(0.957, 0.949, 0.933);

    // The signature red folds through ink, with a narrow silver reflection.
    float body = smoothstep(0.10, 0.93, fold);
    float light = 0.76 + 0.24 * sin(p.y * 2.2 - t * 0.3 + 1.0);
    vec3 color = mix(ink, signal * light * 0.88, pow(body, 2.0));
    float reflection = pow(0.5 + 0.5 * sin(phase + 0.53), 42.0);
    color = mix(color, paper, reflection * 0.8);
    float contour = pow(0.5 + 0.5 * sin(phase + 0.63), 160.0);
    color = mix(color, signal, contour * 0.9);
    float fineFold = pow(0.5 + 0.5 * sin(phase - 0.30), 18.0);
    color *= 1.0 - 0.26 * fineFold;

    // Keep the field brightest on the right; the page supplies a reading scrim.
    float lightField = mix(0.48, 1.0, smoothstep(0.10, 0.82, uv.x));
    color *= lightField;
    color += (hash(gl_FragCoord.xy) - 0.5) * 0.012;
    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`;

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function WaveCanvas({ variant = "hero" }: { variant?: "hero" | "footer" }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pausedRef = useRef(false);
  const refreshRef = useRef<() => void>(() => {});
  const [paused, setPaused] = useState(false);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    pausedRef.current = paused;
    refreshRef.current();
  }, [paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", {
      alpha: false, antialias: false, depth: false, stencil: false,
      powerPreference: "low-power", preserveDrawingBuffer: false,
    });
    if (!gl) return;

    let program: WebGLProgram | null = null;
    let buffer: WebGLBuffer | null = null;
    let vertex: WebGLShader | null = null;
    let fragment: WebGLShader | null = null;
    let resolution: WebGLUniformLocation | null = null;
    let time: WebGLUniformLocation | null = null;
    let variantUniform: WebGLUniformLocation | null = null;
    let frame = 0;
    let lastTime = 0;
    let elapsed = 8;
    let inView = true;
    let ready = false;
    let disposed = false;
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    pausedRef.current = motionPreference.matches;
    setPaused(motionPreference.matches);

    const release = () => {
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      program = null; buffer = null; vertex = null; fragment = null;
      ready = false;
    };

    const render = () => {
      if (!ready || disposed || gl.isContextLost()) return;
      gl.useProgram(program);
      gl.uniform2f(resolution, canvas.width, canvas.height);
      gl.uniform1f(time, elapsed * MOTION_RATE);
      gl.uniform1f(variantUniform, variant === "footer" ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    const shouldAnimate = () => ready && !disposed && inView && !pausedRef.current && document.visibilityState === "visible";
    const tick = (now: number) => {
      frame = 0;
      if (!shouldAnimate()) { lastTime = 0; return; }
      if (lastTime) elapsed += Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      render();
      frame = requestAnimationFrame(tick);
    };

    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      lastTime = 0;
      render();
      if (shouldAnimate()) frame = requestAnimationFrame(tick);
    };
    refreshRef.current = refresh;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const density = Math.min(window.devicePixelRatio || 1, 1.5,
        Math.sqrt(MAX_PIXELS / Math.max(1, bounds.width * bounds.height)));
      const width = Math.max(1, Math.round(bounds.width * density));
      const height = Math.max(1, Math.round(bounds.height * density));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      render();
    };

    const initialize = () => {
      release();
      vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
      // Older mobile GPUs may only support medium fragment precision.
      const highPrecision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision;
      fragment = compileShader(gl, gl.FRAGMENT_SHADER, highPrecision ? fragmentSource : fragmentSource.replace("precision highp float;", "precision mediump float;"));
      program = gl.createProgram();
      buffer = gl.createBuffer();
      if (!vertex || !fragment || !program || !buffer) { release(); setAvailable(false); return; }
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { release(); setAvailable(false); return; }
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, "aPosition");
      if (position < 0) { release(); setAvailable(false); return; }
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      resolution = gl.getUniformLocation(program, "uResolution");
      time = gl.getUniformLocation(program, "uTime");
      variantUniform = gl.getUniformLocation(program, "uVariant");
      ready = true;
      resize();
      setAvailable(true);
      refresh();
    };

    const handlePreference = () => {
      pausedRef.current = motionPreference.matches;
      setPaused(motionPreference.matches);
      refresh();
    };
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      cancelAnimationFrame(frame);
      ready = false;
      setAvailable(false);
    };
    const handleContextRestored = () => { if (!disposed) initialize(); };
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    const visibilityObserver = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      refresh();
    }, { rootMargin: "120px" }) : null;

    resizeObserver?.observe(canvas);
    visibilityObserver?.observe(canvas);
    if (!resizeObserver) window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", refresh);
    motionPreference.addEventListener("change", handlePreference);
    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);
    initialize();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      visibilityObserver?.disconnect();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", refresh);
      motionPreference.removeEventListener("change", handlePreference);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
      refreshRef.current = () => {};
      release();
    };
  }, [variant]);

  return <>
    <div className={`wave-background wave-background--${variant}`} aria-hidden="true"><canvas ref={canvasRef} className="wave-canvas" style={{ opacity: available ? 1 : 0 }} /></div>
    {available && <Button variant="ghost" className="motion-toggle" aria-label={`${paused ? "Resume" : "Pause"} ${variant === "hero" ? "hero" : "contact"} background animation`} aria-pressed={paused} onClick={() => setPaused((value) => !value)}>{paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}<span>{paused ? "Resume motion" : "Pause motion"}</span></Button>}
  </>;
}
