"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type AgentOrbState = "idle" | "thinking" | "working" | "success" | "error" | "offline";

type StateStyle = {
  /** CSS custom property holding the dot colour. */
  cssVar: string;
  /** Hex fallback when the browser canvas can't parse the (oklch) variable. */
  fallback: string;
  /** Rotation speed in radians per second. */
  speed: number;
  /** Radius "breathing" amplitude (0 = none). */
  pulse: number;
  /** Pulse frequency in Hz. */
  pulseHz: number;
  /** Opacity of the soft glow behind the sphere. */
  glow: number;
};

const STYLES: Record<AgentOrbState, StateStyle> = {
  idle: { cssVar: "--brand", fallback: "#22a55a", speed: 0.28, pulse: 0.015, pulseHz: 0.25, glow: 0.14 },
  thinking: { cssVar: "--info", fallback: "#4f86d9", speed: 0.9, pulse: 0.045, pulseHz: 0.9, glow: 0.22 },
  working: { cssVar: "--brand", fallback: "#22a55a", speed: 1.5, pulse: 0.035, pulseHz: 1.4, glow: 0.24 },
  success: { cssVar: "--success", fallback: "#2f9e5b", speed: 0.4, pulse: 0.02, pulseHz: 0.4, glow: 0.18 },
  error: { cssVar: "--destructive", fallback: "#d9453c", speed: 0.3, pulse: 0.03, pulseHz: 1.8, glow: 0.18 },
  offline: { cssVar: "--muted-foreground", fallback: "#8a8984", speed: 0, pulse: 0, pulseHz: 0, glow: 0 },
};

type Point = { x: number; y: number; z: number };

/** Evenly distributed points on a unit sphere (golden-angle spiral). */
function spherePoints(count: number): Point[] {
  const pts: Point[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = golden * i;
    pts.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r });
  }
  return pts;
}

/** Resolves a CSS variable to a colour string the 2D canvas understands. */
function resolveColor(ctx: CanvasRenderingContext2D, cssVar: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  if (!raw) return fallback;
  const sentinel = "#010203";
  ctx.fillStyle = sentinel;
  ctx.fillStyle = raw;
  const parsed = ctx.fillStyle;
  return parsed === sentinel ? fallback : raw;
}

/**
 * Animated dotted orb that represents an agent. The sphere of dots rotates slowly; speed, pulse
 * and colour reflect the agent state. Renders a single static frame for reduced motion or offline.
 */
export function AgentOrb({
  size = 40,
  state = "idle",
  className,
  title,
}: {
  size?: number;
  state?: AgentOrbState;
  className?: string;
  title?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const style = STYLES[state];
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const count = Math.max(48, Math.min(420, Math.round(size * 2.6)));
    const points = spherePoints(count);
    const dotBase = Math.max(0.55, size / 90);
    const tilt = 0.38;
    const cosT = Math.cos(tilt);
    const sinT = Math.sin(tilt);

    let color = resolveColor(ctx, style.cssVar, style.fallback);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animated = !reduceMotion && style.speed > 0;

    let angle = 0.6;
    let raf = 0;
    let last = 0;
    let visible = true;
    const t0 = performance.now();

    const draw = (time: number) => {
      const c = size / 2;
      const elapsed = (time - t0) / 1000;
      const pulse = animated ? 1 + style.pulse * Math.sin(elapsed * Math.PI * 2 * style.pulseHz) : 1;
      const radius = size * 0.4 * pulse;

      ctx.clearRect(0, 0, size, size);

      if (style.glow > 0) {
        const g = ctx.createRadialGradient(c, c, radius * 0.1, c, c, size / 2);
        g.addColorStop(0, color);
        g.addColorStop(1, "transparent");
        ctx.globalAlpha = style.glow;
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
      }

      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      ctx.fillStyle = color;
      // Two passes: far hemisphere first, then the near one on top.
      for (let pass = 0; pass < 2; pass++) {
        for (const p of points) {
          // Rotate around Y, then tilt around X.
          const x1 = p.x * cosA + p.z * sinA;
          const z1 = -p.x * sinA + p.z * cosA;
          const y2 = p.y * cosT - z1 * sinT;
          const z2 = p.y * sinT + z1 * cosT;
          if ((pass === 0) !== z2 < 0) continue;
          const depth = (z2 + 1) / 2; // 0 = back, 1 = front
          ctx.globalAlpha = style.speed === 0 ? 0.25 + depth * 0.45 : 0.12 + depth * 0.88;
          const r = dotBase * (0.55 + depth * 0.75);
          ctx.beginPath();
          ctx.arc(c + x1 * radius, c + y2 * radius, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };

    const frame = (time: number) => {
      const dt = last ? Math.min(0.1, (time - last) / 1000) : 0;
      last = time;
      angle += dt * style.speed;
      draw(time);
      raf = visible ? requestAnimationFrame(frame) : 0;
    };

    const start = () => {
      if (!animated || raf) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    draw(performance.now());
    start();

    // Pause while scrolled out of view.
    const io =
      animated && "IntersectionObserver" in window
        ? new IntersectionObserver((entries) => {
            visible = entries.some((e) => e.isIntersecting);
            if (visible) start();
            else stop();
          })
        : null;
    io?.observe(canvas);

    // Re-read colours when the theme (class / data attributes on <html>) changes.
    const mo = new MutationObserver(() => {
      color = resolveColor(ctx, style.cssVar, style.fallback);
      if (!raf) draw(performance.now());
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });

    return () => {
      stop();
      io?.disconnect();
      mo.disconnect();
    };
  }, [size, state]);

  return (
    <span
      role="img"
      aria-label={title ?? `Agent ${state}`}
      title={title}
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <canvas ref={canvasRef} className="block" style={{ width: size, height: size }} />
    </span>
  );
}
