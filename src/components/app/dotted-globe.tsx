"use client";

import { useEffect, useRef } from "react";
import dots from "./globe-dots.json";
import { cn } from "@/lib/utils";

type Pulse = { lon: number; lat: number; t: number };

/**
 * Canvas-rendered, slowly rotating dotted globe (land masses as dots) with a few
 * "signal" pulses. Pure canvas — no external tiles or map services.
 */
export function DottedGlobe({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let rotation = -20;
    const tilt = -18 * (Math.PI / 180);
    const pulses: Pulse[] = [
      { lon: 10, lat: 51, t: 0 },
      { lon: -74, lat: 40.7, t: 0.35 },
      { lon: 139, lat: 35.6, t: 0.7 },
      { lon: -46, lat: -23.5, t: 0.2 },
      { lon: 77, lat: 28.6, t: 0.55 },
    ];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const project = (lon: number, lat: number, r: number, cx: number, cy: number) => {
      const λ = ((lon + rotation) * Math.PI) / 180;
      const φ = (lat * Math.PI) / 180;
      const x = Math.cos(φ) * Math.sin(λ);
      let y = Math.sin(φ);
      let z = Math.cos(φ) * Math.cos(λ);
      // tilt around x-axis
      const y2 = y * Math.cos(tilt) - z * Math.sin(tilt);
      const z2 = y * Math.sin(tilt) + z * Math.cos(tilt);
      y = y2;
      z = z2;
      return { x: cx + x * r, y: cy - y * r, z };
    };

    const draw = (time: number) => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);
      const r = Math.min(w, h) * 0.46;
      const cx = w / 2;
      const cy = h / 2;
      const dark = document.documentElement.classList.contains("dark");

      // sphere shading
      const grad = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
      grad.addColorStop(0, dark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,1)");
      grad.addColorStop(1, dark ? "rgba(255,255,255,0.01)" : "rgba(0,0,0,0.05)");
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      for (const [lon, lat] of dots as [number, number][]) {
        const p = project(lon, lat, r, cx, cy);
        if (p.z <= 0) continue;
        const alpha = 0.15 + p.z * 0.75;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.1 + p.z * 0.7, 0, Math.PI * 2);
        ctx.fillStyle = dark ? `rgba(240,240,235,${alpha * 0.8})` : `rgba(20,20,19,${alpha})`;
        ctx.fill();
      }

      for (const pulse of pulses) {
        const p = project(pulse.lon, pulse.lat, r, cx, cy);
        if (p.z <= 0.1) continue;
        const phase = ((time / 2400 + pulse.t) % 1 + 1) % 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3 + phase * 18, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(34,197,94,${(1 - phase) * 0.6})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(34,197,94,0.95)";
        ctx.fill();
      }

      if (!reduced) rotation += 0.06;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className={cn("h-full w-full", className)} aria-hidden />;
}
