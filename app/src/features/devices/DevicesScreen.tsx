// This device and the others on the network, drawn as the mesh they would form.
// Pick workers here; load in Chat. (Task 4.2 adds the full device details.)
import { useState } from "react";
import { Laptop, Smartphone, HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import MeshView from "@/features/mesh/MeshView";
import { peerNodes } from "@/features/mesh/nodes";
import { addManualPeer, becomeWorker, type PeerView } from "@/lib/tauri";
import { useDevice, useNav, useNotice, usePeers, useRole } from "@/lib/stores";
import { UNKNOWN, freeMib } from "@/lib/format";

const COMPAT: Record<PeerView["compat"], string | null> = {
  ok: null,
  unknown: "Version unknown",
  app_version_mismatch: "Different app version",
  proto_mismatch: "Incompatible engine",
};

const canWork = (p: PeerView) =>
  p.compat !== "proto_mismatch" && p.compat !== "app_version_mismatch" && (p.role === null || p.role === "worker");

function DeviceIcon({ platform }: { platform: string | null }) {
  const Icon = platform === "ios" || platform === "android" ? Smartphone : platform ? Laptop : HelpCircle;
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
      <Icon className="size-5" strokeWidth={1.6} aria-hidden />
    </span>
  );
}

export default function DevicesScreen() {
  const info = useDevice((s) => s.info);
  const role = useRole((s) => s.role);
  const { peers, chosen, toggle } = usePeers();
  const fail = useNotice((s) => s.fail);
  const go = useNav((s) => s.go);
  const [addr, setAddr] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    try { await f(); } catch (e) { fail(e); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-8">
      <section>
        <h1 className="font-serif text-4xl font-medium tracking-tight">Devices</h1>
        <div className="relative mt-2">
          <MeshView
            className="h-72 desk:h-80"
            nodes={peerNodes(peers)}
            trunk={info ? `${info.name}, ${freeMib(info.free_mem_mb)}` : undefined}
          />
          {peers.length === 0 && (
            <p className="absolute inset-x-0 top-10 text-center text-sm text-muted-foreground">
              Looking for DistLLM on this Wi‑Fi…
            </p>
          )}
        </div>
      </section>

      <section className="rounded-2xl border bg-surface p-5">
        <p className="text-sm text-muted-foreground">This device</p>
        <p className="mt-1 truncate font-serif text-2xl font-medium">{info?.name ?? "…"}</p>
        <p className="num text-sm text-muted-foreground">
          {info ? `${info.platform}, ${freeMib(info.free_mem_mb)}, app ${info.app_ver}` : "Asking the device…"}
        </p>
        {role?.role === "worker" ? (
          <p className="mt-4 text-pretty text-sm">
            <span className="font-semibold text-signal">Working for hosts</span> at {role.status.endpoint}. It stays a worker until the app is closed.
          </p>
        ) : (
          <div className="mt-4 flex gap-2.5">
            <Button className="flex-1" disabled={busy || role?.role !== "idle"}
              onClick={() => run(async () => useRole.setState({ role: await becomeWorker() }))}>
              Start worker
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => go("chat")}>Host a model</Button>
          </div>
        )}
      </section>

      <section>
        <h2 className="font-serif text-2xl font-medium">On this Wi‑Fi</h2>
        <p className="mb-2 text-sm text-muted-foreground">Turn on the devices that should hold part of the model.</p>
        {peers.length === 0 ? (
          <p className="border-t py-4 text-pretty text-muted-foreground">
            None yet. Open DistLLM on another device on this Wi‑Fi, or add one by its address below.
          </p>
        ) : (
          <ul className="border-t">
            {peers.map((p) => {
              const note = COMPAT[p.compat];
              return (
                <li key={p.id} className="flex items-center gap-3.5 border-b py-3.5">
                  <DeviceIcon platform={p.platform} />
                  <div className="min-w-0 flex-1">
                    <p className="flex min-w-0 items-center gap-2 font-semibold">
                      <span className="truncate">{p.name}</span>
                      {note && <Badge variant="outline" className="shrink-0 font-normal">{note}</Badge>}
                    </p>
                    <p className="num truncate text-sm text-muted-foreground">
                      {p.role ?? UNKNOWN}, {freeMib(p.free_mem_mb)}
                    </p>
                    <p className="num truncate text-xs text-muted-foreground">{p.addr}:{p.rpc_port}</p>
                  </div>
                  <Switch label={`Use ${p.name} as a worker`} checked={chosen.includes(p.id)} disabled={!canWork(p)}
                    onChange={(on) => toggle(p.id, on)} />
                </li>
              );
            })}
          </ul>
        )}
        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => { await addManualPeer(addr.trim()); setAddr(""); });
          }}
        >
          <label htmlFor="addr" className="text-sm text-muted-foreground">Not listed? Add it by address</label>
          <div className="mt-2 flex gap-2">
            <Input id="addr" className="h-11 min-w-0 rounded-[10px] bg-raised text-base desk:h-10"
              placeholder="192.168.1.4" inputMode="decimal" autoComplete="off" value={addr} onChange={(e) => setAddr(e.target.value)} />
            <Button type="submit" variant="outline" disabled={busy || !addr.trim()}>Add</Button>
          </div>
        </form>
      </section>
    </div>
  );
}
