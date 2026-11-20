// The model's layers as level bands, coloured by the device that holds them (llama.cpp's
// own ranges). This device is the accent; workers are ink, in steps.
import { useEffect, useState } from "react";
import type { DeviceShare } from "@/lib/tauri";
import { onPulse } from "@/lib/pulse";
import { cn } from "@/lib/utils";

const INKS = ["bg-foreground", "bg-foreground/55", "bg-foreground/30"];

export function toneOf(shares: DeviceShare[], i: number) {
  if (!shares[i].is_remote) return "bg-signal";
  return INKS[shares.slice(0, i).filter((s) => s.is_remote).length % INKS.length];
}

/** Owner of each layer, top (layer 0) to bottom; null where llama.cpp didn't say. */
export function layerOwners(shares: DeviceShare[]): (number | null)[] {
  const ranges = shares.flatMap((s, i) => (s.layers ? [{ i, from: s.layers[0], to: s.layers[1] }] : []));
  if (ranges.length === 0) return [];
  const n = Math.max(...ranges.map((r) => r.to)) + 1;
  return Array.from({ length: n }, (_, l) => ranges.find((r) => l >= r.from && l <= r.to)?.i ?? null);
}

/** Vertical: a lens of level bands, widest in the middle, a gap where devices change. */
export function LayerColumn({ shares, className }: { shares: DeviceShare[]; className?: string }) {
  const owners = layerOwners(shares);
  if (owners.length === 0) return null;
  const n = owners.length;
  return (
    <div className={cn("flex flex-col items-center gap-[3px]", className)} role="img"
      aria-label={shares.filter((s) => s.layers).map((s) => `${s.is_remote ? s.name : "this device"} layers ${s.layers![0]} to ${s.layers![1]}`).join(", ")}>
      {owners.map((o, l) => (
        <div key={l} className={cn("h-[7px] rounded-full", o == null ? "bg-muted" : toneOf(shares, o), l > 0 && owners[l - 1] !== o && "mt-[5px]")}
          style={{ width: `${62 + 38 * Math.sin((Math.PI * (l + 0.5)) / n)}%` }} />
      ))}
    </div>
  );
}

/** Horizontal: one pill per layer. Each real token sends a light across it, layer 0 to last. */
export function LayerBar({ shares, className }: { shares: DeviceShare[]; className?: string }) {
  const owners = layerOwners(shares);
  const [sweeps, setSweeps] = useState<number[]>([]);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let id = 0;
    let lastAt = 0;
    return onPulse((p) => {
      const now = performance.now();
      if (p.kind !== "token" || now - lastAt < 120) return; // at most ~8 sweeps a second
      lastAt = now;
      const mine = ++id;
      setSweeps((s) => [...s.slice(-4), mine]);
      setTimeout(() => setSweeps((s) => s.filter((x) => x !== mine)), 700);
    });
  }, []);

  if (owners.length === 0) return null;
  return (
    <div className={cn("relative flex gap-[3px] overflow-hidden", className)} aria-hidden>
      {owners.map((o, l) => (
        <span key={l} className={cn("h-3.5 flex-1 rounded-full", o == null ? "bg-muted" : toneOf(shares, o))} />
      ))}
      {sweeps.map((s) => (
        <span key={s} className="pointer-events-none absolute inset-y-0 w-10 animate-[sweep_0.7s_linear_forwards] bg-gradient-to-r from-transparent via-background/70 to-transparent" />
      ))}
    </div>
  );
}
