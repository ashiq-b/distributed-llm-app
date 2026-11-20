// Which device holds which part of the loaded model, from llama.cpp's own load report:
// the mesh (lit by real tokens), the layers as bands, and how the load went.
import { useShallow } from "zustand/react/shallow";
import { Progress } from "@/components/ui/progress";
import MeshView from "@/features/mesh/MeshView";
import { peerNodes, shareNodes } from "@/features/mesh/nodes";
import { chosenPeers, useModels, usePeers, useRole } from "@/lib/stores";
import { UNKNOWN, mib, seconds } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LayerColumn, toneOf } from "./LayerBands";
import LiveStats from "./LiveStats";
import { withPeerNames } from "./names";

export default function SplitPanel() {
  const role = useRole((s) => s.role);
  const peers = usePeers((s) => s.peers);
  const chosen = usePeers(useShallow(chosenPeers));
  const models = useModels((s) => s.models);
  const nameOf = (id: string) => models.find((m) => m.id === id)?.name ?? id;

  if (role?.role === "loading") {
    const workers = peers.filter((p) => chosen.includes(p.id));
    return (
      <div className="space-y-4">
        <MeshView className="h-56" nodes={peerNodes(workers)} trunk={`Loading ${nameOf(role.model_id)}`} />
        <Progress value={role.frac * 100} aria-label="Loading" />
        <p className="num text-sm text-muted-foreground">{Math.round(role.frac * 100)}%. Weights a worker already has are not sent again.</p>
      </div>
    );
  }

  if (role?.role !== "host") {
    return (
      <p className="text-pretty text-sm text-muted-foreground">
        {role?.role === "worker"
          ? "This device is holding layers for a host. The host shows how the model is split."
          : "Nothing is loaded yet. Load a model in Chat to see which device holds which layers."}
      </p>
    );
  }

  const { load, model_id } = role;
  const shares = withPeerNames(role.shares, peers);
  const n = Math.max(0, ...shares.map((s) => (s.layers ? s.layers[1] + 1 : 0)));
  return (
    <div className="space-y-6">
      <MeshView className="-mx-2 h-64" nodes={shareNodes(shares)} trunk={nameOf(model_id)} />
      <LiveStats />
      <div className="flex gap-5">
        <LayerColumn shares={shares} className="w-28 shrink-0" />
        <ul className="flex min-w-0 flex-1 flex-col justify-around gap-4">
          {shares.map((s, i) => (
            <li key={i} className="min-w-0">
              <p className={cn("flex items-center gap-2 font-semibold", !s.is_remote && "text-signal")}>
                <span aria-hidden className={cn("size-2 shrink-0 rounded-full", toneOf(shares, i))} />
                <span className="truncate">{s.is_remote ? s.name : "This device"}</span>
              </p>
              <p className="truncate text-sm text-muted-foreground">{s.is_remote ? `Worker ${s.endpoint ?? ""}` : "Host"}</p>
              <p className="num text-sm">
                {s.layers ? `Layers ${s.layers[0]}–${s.layers[1]}` : `Layers ${UNKNOWN}`}, {s.buffer_mib == null ? UNKNOWN : `${s.buffer_mib.toFixed(1)} MiB`}
              </p>
            </li>
          ))}
        </ul>
      </div>
      {n > 0 && <p className="text-sm text-muted-foreground">{n} layers, placed by each device's free memory.</p>}
      <dl className="num grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t pt-4 text-sm">
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
