// No other device yet: this device's strands reach out while sonar rings ripple from its
// trunk, and each strand's tip flares as a ring passes, the way an announcement goes out
// and waits for an answer. It runs only while this screen shows and nothing is found;
// with Reduce Motion it is a still picture.
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { canopy, type Point } from "./geometry";

interface Fibre { a: number; reach: number; phase: number; lift: number; bend: number; tone: number }

const FIBRES = 64;
const PERIOD = 3200;   // ms between rings
const RINGS = 2;

function cssColor(name: string, alpha: number) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `hsl(${v} / ${alpha})` : `rgba(128,128,128,${alpha})`;
}

/** Seeded, so the same fibres come back on every visit. */
function fibres(): Fibre[] {
  let s = 0x2c47c4;
  const r = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
  const span = (78 * Math.PI) / 180;
  return Array.from({ length: FIBRES }, (_, i) => ({
    a: -span + (2 * span * (i + r() * 0.8)) / FIBRES,
    reach: 0.38 + Math.pow(r(), 0.7) * 0.5,
    phase: r() * Math.PI * 2,
    lift: 0.35 + r() * 0.35,
    bend: 0.35 + r() * 0.3,
    tone: 0.25 + r() * 0.75,
  }));
}

function bezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

export default function SearchingView({ trunk, className }: { trunk?: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [theme, setTheme] = useState(0);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const r0 = el.getBoundingClientRect();
    setSize({ w: Math.round(r0.width), h: Math.round(r0.height) });
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    const mo = new MutationObserver(() => setTheme((t) => t + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, []);

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext?.("2d");
    const { w, h } = size;
    if (!c || !ctx || w === 0 || h === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    c.width = w * dpr;
    c.height = h * dpr;
    const cv = canopy(w, h);
    const base = { x: w / 2, y: h + 2 };
    const trunkTop = cv.cy + h * 0.06;
    const maxR = Math.hypot(w / 2, h) * 1.02;
    const fs = fibres();
    const ink = (a: number) => cssColor("--strand", a);
    const sig = (a: number) => cssColor("--signal", a);
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let frame = 0;
    const start = performance.now();

    const draw = (now: number) => {
      // A frame's timestamp can be a little before `start` (it is when the frame began),
      // and a negative time would give rings a negative radius, which canvas rejects.
      const t = still ? 1200 : Math.max(0, now - start);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = "round";

      // Rings going out from the trunk's foot.
      const rings = Array.from({ length: RINGS }, (_, k) => ((t + (k * PERIOD) / RINGS) % PERIOD) / PERIOD);
      for (const p of rings) {
        const r = p * maxR;
        ctx.strokeStyle = sig(0.42 * (1 - p) * Math.min(1, p * 6));
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(base.x, base.y, r, Math.PI, 2 * Math.PI);
        ctx.stroke();
      }

      // A soft glow at the foot as each ring sets off.
      const fresh = Math.max(...rings.map((p) => Math.max(0, 1 - p * 5)));
      const glowR = Math.min(w, h) * 0.32;
      const g = ctx.createRadialGradient(base.x, base.y, 0, base.x, base.y, glowR);
      g.addColorStop(0, sig(0.22 * fresh + 0.06));
      g.addColorStop(1, sig(0));
      ctx.fillStyle = g;
      ctx.fillRect(base.x - glowR, base.y - glowR, glowR * 2, glowR);

      for (const f of fs) {
        // Tips sway a little, as if feeling for something.
        const sway = still ? 0 : Math.sin(t / 1700 + f.phase) * 0.035;
        const a = f.a + sway;
        const reach = f.reach * (1 + (still ? 0 : Math.sin(t / 2300 + f.phase * 1.7) * 0.04));
        const end = { x: cv.cx + cv.rx * reach * Math.sin(a), y: cv.cy - cv.ry * reach * Math.cos(a) };
        const p0 = { x: base.x + (f.phase / Math.PI - 1) * w * 0.012, y: base.y };
        const p1 = { x: cv.cx, y: trunkTop - (trunkTop - end.y) * f.lift * 0.5 };
        const p2 = { x: cv.cx + (end.x - cv.cx) * f.bend, y: end.y + (trunkTop - end.y) * 0.35 };

        // How close a ring is to this tip right now: the tip flares as one passes.
        const d = Math.hypot(end.x - base.x, end.y - base.y);
        const glow = Math.max(...rings.map((p) => Math.exp(-(((p * maxR - d) / 16) ** 2)) * (1 - p)));

        ctx.strokeStyle = ink(0.06 + 0.2 * f.tone);
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, end.x, end.y);
        ctx.stroke();

        if (glow > 0.04) {
          // Light the last stretch of the strand, then the tip.
          ctx.strokeStyle = sig(0.85 * glow);
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          const s0 = bezier(p0, p1, p2, end, 0.8);
          ctx.moveTo(s0.x, s0.y);
          for (let k = 1; k <= 6; k++) { const q = bezier(p0, p1, p2, end, 0.8 + (0.2 * k) / 6); ctx.lineTo(q.x, q.y); }
          ctx.stroke();
          ctx.fillStyle = sig(0.25 * glow);
          ctx.beginPath();
          ctx.arc(end.x, end.y, 4.5 * glow + 1, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = glow > 0.04 ? sig(0.5 + 0.5 * glow) : ink(0.35 * f.tone);
        ctx.beginPath();
        ctx.arc(end.x, end.y, 0.9 + 1.2 * glow, 0, Math.PI * 2);
        ctx.fill();
      }

      // The trunk fades into the ground, as in the mesh.
      const fade = ctx.createLinearGradient(0, h * 0.8, 0, h);
      fade.addColorStop(0, "rgba(0,0,0,0)");
      fade.addColorStop(1, "rgba(0,0,0,0.9)");
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = fade;
      ctx.fillRect(0, h * 0.8, w, h * 0.2);
      ctx.globalCompositeOperation = "source-over";

      if (!still) frame = requestAnimationFrame(draw);
    };

    const onVisible = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("visibilitychange", onVisible); };
  }, [size, theme]);

  return (
    <div ref={box} className={cn("relative overflow-hidden", className)}>
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-hidden />
      <div role="status" className="absolute inset-x-0 top-3 px-4 text-center">
        <p className="font-medium">Looking for DistLLM on this Wi‑Fi…</p>
        <p className="mx-auto mt-1 max-w-xs text-pretty text-sm text-muted-foreground">
          Open DistLLM on another phone or computer on the same network. It shows up here on its own.
        </p>
      </div>
      {trunk && (
        <p className="num absolute bottom-2 left-1/2 max-w-[70%] -translate-x-1/2 truncate rounded-md bg-background/85 px-2 py-0.5 text-xs font-medium">
          {trunk}
        </p>
      )}
    </div>
  );
}
