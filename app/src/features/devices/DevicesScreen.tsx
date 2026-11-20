// This device and the others on the network. Pick workers here; load in Chat.
// (Task 4.2 replaces this with the full devices screen.)
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { addManualPeer, becomeWorker, type PeerView } from "@/lib/tauri";
import { useDevice, useNotice, usePeers, useRole } from "@/lib/stores";
import { UNKNOWN, freeMib } from "@/lib/format";
import RoleChip from "@/app/RoleChip";

const COMPAT: Record<PeerView["compat"], string | null> = {
  ok: null,
  unknown: "Version unknown",
  app_version_mismatch: "Different app version",
  proto_mismatch: "Incompatible engine",
};

function canWork(p: PeerView) {
  return p.compat !== "proto_mismatch" && p.compat !== "app_version_mismatch" && (p.role === null || p.role === "worker");
}

export default function DevicesScreen() {
  const info = useDevice((s) => s.info);
  const role = useRole((s) => s.role);
  const { peers, chosen, toggle } = usePeers();
  const fail = useNotice((s) => s.fail);
  const [addr, setAddr] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    try { await f(); } catch (e) { fail(e); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">This device</h1>
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold">{info?.name ?? "…"}</p>
              <p className="text-sm text-muted-foreground">
                {info ? `${info.platform}, ${freeMib(info.free_mem_mb)}, app ${info.app_ver}` : "Asking the device…"}
              </p>
            </div>
            <RoleChip className="flex text-foreground" />
            {role?.role === "worker" ? (
              <p className="text-sm text-muted-foreground">
                Hosts on this network can use it at {role.status.endpoint}. It stays a worker until the app is closed.
              </p>
            ) : (
              <Button disabled={busy || role?.role !== "idle"} onClick={() => run(async () => useRole.setState({ role: await becomeWorker() }))}>
                Start worker
              </Button>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">On this network</h2>
        {peers.length === 0 ? (
          <p className="text-muted-foreground">
            No other devices yet. Open DistLLM on another device on this Wi‑Fi, or add one by its address.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border bg-card">
            {peers.map((p) => {
              const usable = canWork(p);
              const note = COMPAT[p.compat];
              return (
                <li key={p.id}>
                  <label className="flex min-h-14 cursor-pointer items-center gap-4 px-4 py-3 has-[:disabled]:cursor-default">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 font-medium">
                        <span className="truncate">{p.name}</span>
                        {note && <Badge variant="outline">{note}</Badge>}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        {p.platform ?? UNKNOWN}, {p.role ?? UNKNOWN}, {freeMib(p.free_mem_mb)}, {p.addr}:{p.rpc_port}
                      </p>
                    </div>
                    <span className="text-sm text-muted-foreground">Use as worker</span>
                    <input
                      type="checkbox"
                      className="size-5 accent-[hsl(var(--signal))]"
                      checked={chosen.includes(p.id)}
                      disabled={!usable}
                      onChange={(e) => toggle(p.id, e.target.checked)}
                    />
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => { await addManualPeer(addr.trim()); setAddr(""); });
          }}
        >
          <Input
            className="h-11 desk:h-9"
            placeholder="Add by address, like 192.168.1.4"
            inputMode="decimal"
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            aria-label="Device address"
          />
          <Button type="submit" variant="outline" disabled={busy || !addr.trim()}>Add</Button>
        </form>
      </section>
    </div>
  );
}
