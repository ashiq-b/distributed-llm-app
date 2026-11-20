// The mesh: fine strands from one trunk (the host, or this device) out to each device,
// more strands for more memory or more layers. Light runs along them only when something
// real happens (a token, a heartbeat, a load step; see lib/pulse.ts). At rest it is still.
import { useEffect, useRef, useState } from "react";
import { onPulse, type Pulse } from "@/lib/pulse";
import { cn } from "@/lib/utils";
import { anchors, at, layoutStrands, type MeshNode, type Strand } from "./geometry";

/** A glint running along one strand. `back`: from the tip down to the trunk (a peer's
 * heartbeat arriving here); otherwise up from the trunk (a token, weights going out). */
interface Light { strand: number; t: number; speed: number; back: boolean }

const MAX_LIGHTS = 320;
const TAIL = 0.16;

function cssColor(name: string, alpha: number) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `hsl(${v} / ${alpha})` : `rgba(128,128,128,${alpha})`;
}

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function sample<T>(xs: T[], n: number): T[] {
  const pool = [...xs];
  const out: T[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return out;
}

/** Which strands a pulse lights, and which way. A token crosses every device in the split. */
function pick(p: Pulse, nodes: MeshNode[], strands: Strand[]): { strand: number; back: boolean; delay: number }[] {
  const of = (i: number) => strands.flatMap((s, k) => (s.node === i ? [k] : []));
  switch (p.kind) {
    case "token":
      return nodes.flatMap((_, i) => sample(of(i), 2).map((strand) => ({ strand, back: false, delay: 0 })));
    case "heartbeat": {
      const i = nodes.findIndex((n) => n.id === p.peerId);
      if (i < 0) return [];
      const mine = of(i);
      return sample(mine, Math.ceil(mine.length * 0.3)).map((strand) => ({ strand, back: true, delay: Math.random() * 450 }));
    }
    case "load":
      return nodes.flatMap((n, i) => (n.self ? [] : sample(of(i), 4).map((strand) => ({ strand, back: false, delay: Math.random() * 200 }))));
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

    const dark = document.documentElement.dataset.theme === "dark";

    // Strands at rest, drawn once.
    const rest = document.createElement("canvas");
    rest.width = c.width;
    rest.height = c.height;
    const r = rest.getContext("2d")!;
    r.scale(dpr, dpr);
    r.lineWidth = 0.6;
    for (const s of strands) {
      r.strokeStyle = nodes[s.node].self ? cssColor("--signal", 0.16 + 0.34 * s.tone) : cssColor("--strand", 0.08 + 0.3 * s.tone);
      r.beginPath();
      r.moveTo(s.p0.x, s.p0.y);
      r.bezierCurveTo(s.p1.x, s.p1.y, s.p2.x, s.p2.y, s.p3.x, s.p3.y);
      r.stroke();
      r.fillStyle = nodes[s.node].self ? cssColor("--signal", 0.5 * s.tone) : cssColor("--strand", 0.45 * s.tone);
      r.beginPath();
      r.arc(s.p3.x, s.p3.y, 0.9, 0, Math.PI * 2);
      r.fill();
    }
    // The trunk fades out at its foot (whatever the background), so the strands read as
    // rising out of the ground.
    const fade = r.createLinearGradient(0, h * 0.8, 0, h);
    fade.addColorStop(0, "rgba(0,0,0,0)");
    fade.addColorStop(1, "rgba(0,0,0,0.9)");
    r.globalCompositeOperation = "destination-out";
    r.fillStyle = fade;
    r.fillRect(0, h * 0.8, w, h * 0.2);
    r.globalCompositeOperation = "source-over";
    for (const [i, a] of anchors(nodes.length, w, h).entries()) {
      const color = nodes[i].self ? "--signal" : "--strand";
      r.fillStyle = cssColor(color, 0.18);
      r.beginPath();
      r.arc(a.x, a.y, 5, 0, Math.PI * 2);
      r.fill();
      r.fillStyle = cssColor(color, 0.85);
      r.beginPath();
      r.arc(a.x, a.y, 2.2, 0, Math.PI * 2);
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
      ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
      lights = lights.filter((l) => (l.t += l.speed * dt) < 1 + TAIL);
      for (const l of lights) {
        if (l.t <= 0) continue;                              // still waiting to start
        const s = strands[l.strand];
        const along = (t: number) => at(s, l.back ? 1 - t : t);
        const color = nodes[s.node].self ? selfColor : lightColor;
        const out = l.t > 1 ? Math.max(0, 1 - (l.t - 1) / TAIL) : 1;
        ctx.strokeStyle = color;
        const steps = 12;
        for (let k = 0; k < steps; k++) {
          const t0 = l.t - TAIL + (TAIL * k) / steps;
          const t1 = l.t - TAIL + (TAIL * (k + 1)) / steps;
          if (t1 <= 0 || t0 >= 1) continue;
          const p0 = along(Math.max(0, t0)), p1 = along(Math.min(1, t1));
          const f = (k + 1) / steps;
          ctx.globalAlpha = f * f * out;
          ctx.lineWidth = 0.8 + f * 1.2;
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
        }
        if (l.t <= 1) {
          const p = along(l.t);
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.25;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 0.95;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      frame = lights.length ? requestAnimationFrame(draw) : 0;
      if (!frame) last = 0;
    };
    draw(performance.now());

    const stop = listen && !reducedMotion()
      ? onPulse((p) => {
          if (document.hidden) return;
          for (const { strand, back, delay } of pick(p, nodes, strands)) {
            const speed = 1 / (900 + Math.random() * 600);
            if (lights.length < MAX_LIGHTS) lights.push({ strand, back, speed, t: -delay * speed });
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
            side === "left" ? { left: Math.max(6, a.x - 24), top: a.y - 10 }
            : side === "right" ? { right: Math.max(6, size.w - a.x - 24), top: a.y - 10 }
            : { left: a.x, top: a.y - 10, transform: "translateX(-50%)" };
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
