// One row per device in the split, straight from llama.cpp's load report: who it is,
// whether llama.cpp runs it here (Local) or over the network (RPC), its layers and the
// memory its buffers take, with a bar for its part of the total.
import type { DeviceShare } from "@/lib/tauri";
import { UNKNOWN } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toneOf } from "./LayerBands";

const mibText = (m: number) => `${m.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MiB`;

/** Sum of the buffers llama.cpp reported; `partial` when a device didn't report one. */
export function totalMib(shares: DeviceShare[]) {
  const known = shares.filter((s) => s.buffer_mib != null);
  return { mib: known.reduce((sum, s) => sum + s.buffer_mib!, 0), partial: known.length < shares.length };
}

export function DeviceBar({ shares, i, total }: { shares: DeviceShare[]; i: number; total: number }) {
  const s = shares[i];
  const pct = s.buffer_mib != null && total > 0 ? (100 * s.buffer_mib) / total : null;
  return (
    <li className="min-w-0 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-2">
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", toneOf(shares, i))} />
        <span className={cn("min-w-0 truncate font-semibold", !s.is_remote && "text-signal")}>{s.is_remote ? s.name : "This device"}</span>
        <span className="shrink-0 rounded-full border px-2 py-px text-[0.6875rem] font-medium text-muted-foreground"
          title={s.is_remote ? `Over the network (llama.cpp RPC) at ${s.endpoint ?? UNKNOWN}` : `Runs here, on ${s.name}`}>
          {s.is_remote ? "RPC" : "Local"}
        </span>
      </div>
      <p className="num mt-0.5 flex flex-wrap justify-between gap-x-3 text-sm">
        <span>{s.layers ? `Layers ${s.layers[0]}–${s.layers[1]}` : `Layers ${UNKNOWN}`}</span>
        <span className="text-muted-foreground">
          {s.buffer_mib == null ? `${UNKNOWN} MiB` : mibText(s.buffer_mib)}{pct != null && `, ${Math.round(pct)}%`}
        </span>
      </p>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-foreground/10" role="meter"
        aria-label={`${s.is_remote ? s.name : "This device"} holds ${pct == null ? UNKNOWN : `${Math.round(pct)}%`} of the model's memory`}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct == null ? undefined : Math.round(pct)}>
        <div data-testid="share-bar" className={cn("h-full rounded-full transition-[width] duration-500", toneOf(shares, i))} style={{ width: `${pct ?? 0}%` }} />
      </div>
    </li>
  );
}

/** All rows, then the total. */
export default function DeviceBars({ shares }: { shares: DeviceShare[] }) {
  const total = totalMib(shares);
  return (
    <div>
      <ul aria-label="Devices in the split" className="divide-y">
        {shares.map((_, i) => <DeviceBar key={i} shares={shares} i={i} total={total.mib} />)}
      </ul>
      <p className="num mt-3 flex justify-between border-t pt-3 text-sm font-semibold">
        <span>Total</span>
        <span>{total.partial ? "at least " : ""}{mibText(total.mib)}</span>
      </p>
    </div>
  );
}
