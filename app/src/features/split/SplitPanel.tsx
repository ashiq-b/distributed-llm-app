// Which device holds which part of the loaded model, from llama.cpp's own load report.
// The column is the model's layers, top to bottom, coloured by the device holding them.
import { Progress } from "@/components/ui/progress";
import { useRole } from "@/lib/stores";
import { UNKNOWN, mib, seconds } from "@/lib/format";
import type { DeviceShare } from "@/lib/tauri";
import { cn } from "@/lib/utils";

// This device in the accent; workers in ink shades, so the accent always means "here".
const TONES = ["bg-foreground/70", "bg-foreground/40", "bg-foreground/20"];
const tone = (shares: DeviceShare[], i: number) => {
  if (!shares[i].is_remote) return "bg-signal";
  const remote = shares.slice(0, i).filter((s) => s.is_remote).length;
  return TONES[remote % TONES.length];
};

function LayerColumn({ shares }: { shares: DeviceShare[] }) {
  const ranges = shares.flatMap((s, i) => (s.layers ? [{ i, from: s.layers[0], to: s.layers[1] }] : []));
  if (ranges.length === 0) return null;
  const n = Math.max(...ranges.map((r) => r.to)) + 1;
  const owner = (layer: number) => ranges.find((r) => layer >= r.from && layer <= r.to)?.i;
  return (
    <div className="flex w-10 shrink-0 flex-col gap-[2px]" role="img" aria-label={`${n} layers split across ${ranges.length} devices`}>
      {Array.from({ length: n }, (_, layer) => {
        const i = owner(layer);
        return <div key={layer} className={cn("min-h-[3px] flex-1 rounded-[2px]", i == null ? "bg-muted" : tone(shares, i))} />;
      })}
    </div>
  );
}

export default function SplitPanel() {
  const role = useRole((s) => s.role);

  if (role?.role === "loading") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Loading {role.model_id}</p>
        <Progress value={role.frac * 100} aria-label="Loading" />
        <p className="text-sm">{Math.round(role.frac * 100)}%</p>
      </div>
    );
  }

  if (role?.role !== "host") {
    return (
      <p className="text-sm text-muted-foreground">
        {role?.role === "worker"
          ? "This device is working for a host. The host shows how the model is split."
          : "Nothing is loaded. Load a model in Chat to see which device holds which layers."}
      </p>
    );
  }

  const { shares, load, model_id } = role;
  return (
    <div className="space-y-6 tabular-nums">
      <h3 className="text-lg font-semibold leading-tight">{model_id}</h3>
      <div className="flex min-h-[14rem] gap-4">
        <LayerColumn shares={shares} />
        <ul className="flex min-w-0 flex-1 flex-col justify-between gap-4">
          {shares.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span aria-hidden className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", tone(shares, i))} />
              <div className="min-w-0">
                <p className="truncate font-medium">{s.name}</p>
                <p className="text-sm text-muted-foreground">
                  {s.is_remote ? `Worker ${s.endpoint ?? ""}` : "This device"}
                </p>
                <p className="text-sm">
                  {s.layers ? `Layers ${s.layers[0]}–${s.layers[1]}` : `Layers ${UNKNOWN}`}
                  <span className="text-muted-foreground">
                    {", "}
                    {s.buffer_mib == null ? UNKNOWN : `${s.buffer_mib.toFixed(1)} MiB`}
                  </span>
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <dl className="tabular-nums grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t pt-4 text-sm">
        <dt className="text-muted-foreground">Loaded in</dt>
        <dd>{seconds(load.millis)}</dd>
        <dt className="text-muted-foreground">Sent to workers</dt>
        <dd>{mib(load.bytes_sent)}</dd>
        <dt className="text-muted-foreground">Already on workers</dt>
        <dd>{mib(load.bytes_cached)}</dd>
      </dl>
    </div>
  );
}
