// Which device holds which part of the loaded model, from llama.cpp's own load report:
// the mesh (lit by real tokens), the layers as bands, and how the load went.
import { useShallow } from "zustand/react/shallow";
import { Progress } from "@/components/ui/progress";
import MeshView from "@/features/mesh/MeshView";
import { peerNodes, shareNodes } from "@/features/mesh/nodes";
import { chosenPeers, useModels, usePeers, useRole } from "@/lib/stores";
import { mib, seconds } from "@/lib/format";
import DeviceBars from "./DeviceBar";
import { LayerColumn } from "./LayerBands";
import LiveStats from "./LiveStats";
import { withPeerNames } from "./names";

export default function SplitView() {
  const role = useRole((s) => s.role);
  const peers = usePeers((s) => s.peers);
  const chosen = usePeers(useShallow(chosenPeers));
  const models = useModels((s) => s.models);
  const nameOf = (id: string) => models.find((m) => m.id === id)?.name ?? id;

  if (role?.role === "loading") {
    const workers = peers.filter((p) => chosen.includes(p.id));
    return (
      <div className="space-y-4">
        {workers.length > 0
          ? <MeshView className="h-56" nodes={peerNodes(workers)} trunk={`Loading ${nameOf(role.model_id)}`} />
          : <p className="font-serif text-xl">Loading {nameOf(role.model_id)} on this device</p>}
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
        <LayerColumn shares={shares} className="w-20 shrink-0 self-center" />
        <div className="min-w-0 flex-1"><DeviceBars shares={shares} /></div>
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
      <p className="text-xs text-muted-foreground">Source: llama.cpp load report.</p>
    </div>
  );
}
