// This device and the others on the network, drawn as the mesh they would form.
// Pick workers here; load in Chat.
import MeshView from "@/features/mesh/MeshView";
import SearchingView from "@/features/mesh/SearchingView";
import { peerNodes } from "@/features/mesh/nodes";
import { useDevice, useLayout, usePeers } from "@/lib/stores";
import { freeMib } from "@/lib/format";
import AddPeerDialog from "./AddPeerDialog";
import PeerRow from "./PeerRow";
import ThisDeviceCard from "./ThisDeviceCard";

export const EMPTY = "No devices found yet. Make sure others are on the same Wi‑Fi with the app open.";

export default function DevicesScreen() {
  const info = useDevice((s) => s.info);
  const { peers, chosen, toggle } = usePeers();
  const setAbout = useLayout((s) => s.setAbout);

  return (
    <div className="space-y-8">
      <section>
        <h1 className="font-serif text-4xl font-medium tracking-tight">Devices</h1>
        <div className="relative mt-2">
          {peers.length === 0 ? (
            <SearchingView className="h-72 desk:h-80" trunk={info ? `${info.name}, ${freeMib(info.free_mem_mb)}` : undefined} />
          ) : (
            <MeshView
              className="h-72 desk:h-80"
              nodes={peerNodes(peers)}
              trunk={info ? `${info.name}, ${freeMib(info.free_mem_mb)}` : undefined}
            />
          )}
        </div>
      </section>

      <ThisDeviceCard info={info} />

      <section aria-labelledby="nearby">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 id="nearby" className="font-serif text-2xl font-medium">On this Wi‑Fi</h2>
            <p className="text-sm text-muted-foreground">Turn on the devices that should hold part of the model.</p>
          </div>
          <AddPeerDialog />
        </div>
        {peers.length === 0 ? (
          <p className="mt-3 border-t py-4 text-pretty text-muted-foreground">{EMPTY}</p>
        ) : (
          <ul className="mt-3 border-t">
            {peers.map((p) => (
              <PeerRow key={p.id} peer={p} local={info} chosen={chosen.includes(p.id)} onChoose={(on) => toggle(p.id, on)} />
            ))}
          </ul>
        )}
      </section>

      <p className="text-pretty text-sm text-muted-foreground">
        Only use Worker on a network you trust.{" "}
        <button type="button" onClick={() => setAbout(true)} className="font-medium text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground">
          About distllm and network safety
        </button>
      </p>
    </div>
  );
}
