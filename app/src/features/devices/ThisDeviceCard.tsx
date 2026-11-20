// This device: what it is, and its role. Idle, Worker (holds layers for a host) or
// Host (loads a model, in Chat). Leaving Worker stops its RPC server; if a host is using
// it right then, that host's model stops working, so the card asks first.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { becomeWorker, leaveRole, workerHosts, type DeviceInfo, type RoleState } from "@/lib/tauri";
import { useNav, useNotice, useRole } from "@/lib/stores";
import { UNKNOWN, freeMib } from "@/lib/format";
import { cn } from "@/lib/utils";

type Choice = "idle" | "worker" | "host";

const CHOICES: { id: Choice; label: string }[] = [
  { id: "idle", label: "Idle" },
  { id: "worker", label: "Worker" },
  { id: "host", label: "Host" },
];

const current = (role: RoleState | null): Choice | null =>
  role == null ? null : role.role === "loading" ? "host" : role.role;

/** What the role control says under itself, from the real role state. */
export function roleStatus(role: RoleState | null): string {
  switch (role?.role) {
    case undefined: return "Asking the device…";
    case "idle": return "Not holding any part of a model. Make it a worker so a host can use it, or host a model here.";
    case "worker":
      return role.status.running
        ? `Serving layers at ${role.status.endpoint} (${role.status.device}). Switch to Idle to stop.`
        : `Worker at ${role.status.endpoint} is not running. Switch to Idle, then to Worker, to try again.`;
    case "loading": return `Loading ${role.model_id}, ${Math.round(role.frac * 100)}%.`;
    case "host": return `Hosting ${role.model_id}. Chat with it in Chat.`;
  }
}

export default function ThisDeviceCard({ info }: { info: DeviceInfo | null }) {
  const role = useRole((s) => s.role);
  const fail = useNotice((s) => s.fail);
  const go = useNav((s) => s.go);
  const [busy, setBusy] = useState(false);
  /** A choice waiting for "yes": leaving Worker while `hosts` hosts are using it. */
  const [ask, setAsk] = useState<{ to: Choice; hosts: number } | null>(null);
  const on = current(role);

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    try { await f(); } catch (e) { fail(e); } finally { setBusy(false); }
  };

  // Leave Worker (stopping its server), then go where asked: Host loads in Chat.
  const leaveWorker = (to: Choice) => run(async () => {
    setAsk(null);
    useRole.setState({ role: await leaveRole() });
    if (to === "host") go("chat");
  });

  const pick = (c: Choice) => {
    if (c === on || busy) return;
    setAsk(null);
    if (role?.role === "worker") {
      return run(async () => {
        const hosts = await workerHosts();
        if (hosts > 0) setAsk({ to: c, hosts });
        else await leaveWorker(c);
      });
    }
    if (c === "host") return go("chat");
    run(async () => { useRole.setState({ role: c === "worker" ? await becomeWorker() : await leaveRole() }); });
  };

  // A load can't be interrupted; a host unloads (Idle) before it can become a worker.
  const allowed = (c: Choice) =>
    !busy && role != null && role.role !== "loading" && (c !== "worker" || role.role === "idle");

  return (
    <section aria-labelledby="this-device" className="rounded-2xl border bg-surface p-5">
      <p className="text-sm text-muted-foreground">This device</p>
      <h2 id="this-device" className="mt-1 truncate font-serif text-2xl font-medium">{info?.name ?? "…"}</h2>
      <p className="num text-sm text-muted-foreground">
        {info ? `${info.platform}, ${freeMib(info.free_mem_mb)}, app ${info.app_ver}, engine ${info.proto || UNKNOWN}` : "Asking the device…"}
      </p>

      <div role="radiogroup" aria-label="Role" className="mt-4 grid grid-cols-3 gap-1 rounded-full border bg-background p-1">
        {CHOICES.map((c) => {
          const checked = on === c.id;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={!checked && !allowed(c.id)}
              onClick={() => pick(c.id)}
              className={cn(
                "h-10 touch-manipulation rounded-full text-sm font-semibold transition-colors desk:h-9",
                checked ? "bg-signal text-white dark:text-background" : "text-muted-foreground hover:text-foreground",
                "disabled:cursor-not-allowed disabled:opacity-40",
                checked && "disabled:opacity-100",
              )}
            >
              {c.label}
            </button>
          );
        })}
      </div>
      {ask ? (
        <div role="alertdialog" aria-labelledby="stop-worker" className="mt-3 rounded-xl border border-signal/40 bg-signal/5 p-3.5">
          <p id="stop-worker" className="text-pretty text-sm">
            {ask.hosts === 1 ? "A host is" : `${ask.hosts} hosts are`} using this device right now. Stopping the worker ends
            {ask.hosts === 1 ? " its" : " their"} model, and {ask.hosts === 1 ? "it has" : "they have"} to load again without this device.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="signal" disabled={busy} onClick={() => leaveWorker(ask.to)}>Stop worker</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setAsk(null)}>Keep working</Button>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-pretty text-sm" aria-live="polite">{roleStatus(role)}</p>
      )}
    </section>
  );
}
