// The mesh: fine strands from one trunk (the host, or this device) out to each device,
// more strands for more memory or more layers. Light runs along them only when something
// real happens (a token, a heartbeat, a load step; see lib/pulse.ts). At rest it is still.
import { useEffect, useRef, useState } from "react";
import { onPulse, type Pulse } from "@/lib/pulse";
import { cn } from "@/lib/utils";
import { anchors, at, layoutStrands, type MeshNode, type Strand } from "./geometry";

interface Light { strand: number; t: number; speed: number }

const MAX_LIGHTS = 240;
const TAIL = 0.14;

function cssColor(name: string, alpha: number) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `hsl(${v} / ${alpha})` : `rgba(128,128,128,${alpha})`;
}

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** Which strands a pulse lights: a token crosses every device in the split. */
function pick(p: Pulse, nodes: MeshNode[], strands: Strand[]): number[] {
  const of = (i: number) => strands.flatMap((s, k) => (s.node === i ? [k] : []));
  const one = (ks: number[]) => (ks.length ? [ks[Math.floor(Math.random() * ks.length)]] : []);
  switch (p.kind) {
    case "token":
      return nodes.flatMap((_, i) => one(of(i)));
    case "heartbeat": {
      const i = nodes.findIndex((n) => n.id === p.peerId);
      return i < 0 ? [] : [...one(of(i)), ...one(of(i))];
    }
    case "load":
      return nodes.flatMap((n, i) => (n.self ? [] : [...one(of(i)), ...one(of(i))]));
  }
}

export default function MeshView({
  nodes, trunk, className, listen = true,
}: {
  nodes: MeshNode[];
  /** Label at the trunk's foot (the host or this device). */
  trunk?: string;
  className?: string;
  /** Light up on real events. Off: strands only. */
  listen?: boolean;
}) {
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

  const key = nodes.map((n) => `${n.id}:${n.weight.toFixed(2)}:${n.self ? 1 : 0}`).join("|");

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext?.("2d");
    const { w, h } = size;
    if (!c || !ctx || w === 0 || h === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    c.width = w * dpr;
    c.height = h * dpr;
    const strands = layoutStrands(nodes, w, h);

    // Strands at rest, drawn once.
    const rest = document.createElement("canvas");
    rest.width = c.width;
    rest.height = c.height;
    const r = rest.getContext("2d")!;
    r.scale(dpr, dpr);
    r.lineWidth = 0.75;
    for (const s of strands) {
      r.strokeStyle = nodes[s.node].self ? cssColor("--signal", 0.18 + 0.32 * s.tone) : cssColor("--strand", 0.07 + 0.2 * s.tone);
      r.beginPath();
      r.moveTo(s.p0.x, s.p0.y);
      r.bezierCurveTo(s.p1.x, s.p1.y, s.p2.x, s.p2.y, s.p3.x, s.p3.y);
      r.stroke();
    }
    for (const [i, a] of anchors(nodes.length, w, h).entries()) {
      r.fillStyle = nodes[i].self ? cssColor("--signal", 0.9) : cssColor("--strand", 0.55);
      r.beginPath();
      r.arc(a.x, a.y + 12, 2.5, 0, Math.PI * 2);
      r.fill();
    }

    const lightColor = cssColor("--strand", 1);
    const selfColor = cssColor("--signal", 1);
    let lights: Light[] = [];
    let frame = 0;
    let last = 0;

    const draw = (now: number) => {
      const dt = last ? Math.min(64, now - last) : 16;
      last = now;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(rest, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round";
      lights = lights.filter((l) => (l.t += l.speed * dt) < 1 + TAIL);
      for (const l of lights) {
        const s = strands[l.strand];
        const head = Math.min(1, l.t);
        const color = nodes[s.node].self ? selfColor : lightColor;
        ctx.strokeStyle = color;
        const steps = 10;
        for (let k = 0; k < steps; k++) {
          const t0 = Math.max(0, l.t - TAIL + (TAIL * k) / steps);
          const t1 = Math.max(0, l.t - TAIL + (TAIL * (k + 1)) / steps);
          if (t1 <= 0 || t0 >= 1) continue;
          const a = at(s, Math.min(1, t0)), b = at(s, Math.min(1, t1));
          ctx.globalAlpha = ((k + 1) / steps) * (l.t > 1 ? Math.max(0, 1 - (l.t - 1) / TAIL) : 1);
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        if (l.t <= 1) {
          const p = at(s, head);
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      frame = lights.length ? requestAnimationFrame(draw) : 0;
      if (!frame) last = 0;
    };
    draw(performance.now());

    const stop = listen && !reducedMotion()
      ? onPulse((p) => {
          if (document.hidden) return;
          for (const k of pick(p, nodes, strands)) {
            if (lights.length < MAX_LIGHTS) lights.push({ strand: k, t: 0, speed: 1 / (700 + Math.random() * 500) });
          }
          if (!frame) frame = requestAnimationFrame(draw);
        })
      : () => {};
    return () => { stop(); cancelAnimationFrame(frame); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, size.w, size.h, theme, listen]);

  const tops = anchors(nodes.length, size.w, size.h);
  return (
    <div ref={box} className={cn("relative overflow-hidden", className)}>
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-hidden />
      <ul aria-label="Devices in the mesh">
        {nodes.map((n, i) => {
          const a = tops[i];
          if (!a || size.w === 0) return <li key={n.id} className="sr-only">{n.label}{n.detail ? `, ${n.detail}` : ""}</li>;
          const side = a.x < size.w * 0.34 ? "left" : a.x > size.w * 0.66 ? "right" : "mid";
          const style =
            side === "left" ? { left: Math.max(6, a.x - 28), top: a.y }
            : side === "right" ? { right: Math.max(6, size.w - a.x - 28), top: a.y }
            : { left: a.x, top: a.y, transform: "translateX(-50%)" };
          return (
            <li
              key={n.id}
              style={{ ...style, transform: `${style.transform ?? ""} translateY(-100%)`.trim() }}
              className="absolute max-w-[46%] rounded-lg border bg-surface/95 px-2.5 py-1.5 text-left shadow-[0_1px_0_hsl(var(--border))]"
            >
              <p className={cn("flex items-center gap-1.5 truncate text-sm font-semibold", n.self && "text-signal")}>
                <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", n.self ? "bg-signal" : "bg-foreground/60")} />
                <span className="truncate">{n.label}</span>
              </p>
              {n.detail && <p className="num truncate text-xs text-muted-foreground">{n.detail}</p>}
            </li>
          );
        })}
      </ul>
      {trunk && (
        <p className="num absolute bottom-2 left-1/2 max-w-[70%] -translate-x-1/2 truncate rounded-md bg-background/85 px-2 py-0.5 text-xs font-medium">
          {trunk}
        </p>
      )}
    </div>
  );
}
