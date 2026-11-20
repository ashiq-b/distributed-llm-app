// This device: what it is, and its role. Idle, Worker (holds layers for a host) or
// Host (loads a model, in Chat). A worker stays one until the app closes: llama.cpp's
// RPC server can't be stopped once it is serving.
import { useState } from "react";
import { becomeWorker, leaveRole, type DeviceInfo, type RoleState } from "@/lib/tauri";
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
        ? `Serving layers at ${role.status.endpoint} (${role.status.device}). It stays a worker until the app is closed.`
        : `Worker at ${role.status.endpoint} is not running. Close and reopen the app to try again.`;
    case "loading": return `Loading ${role.model_id}, ${Math.round(role.frac * 100)}%.`;
    case "host": return `Hosting ${role.model_id}. Chat with it in Chat.`;
  }
}

export default function ThisDeviceCard({ info }: { info: DeviceInfo | null }) {
  const role = useRole((s) => s.role);
  const fail = useNotice((s) => s.fail);
  const go = useNav((s) => s.go);
  const [busy, setBusy] = useState(false);
  const on = current(role);

  const pick = async (c: Choice) => {
    if (c === on || busy) return;
    if (c === "host") return go("chat");
    setBusy(true);
    try {
      useRole.setState({ role: c === "worker" ? await becomeWorker() : await leaveRole() });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  // Which choices can be made from here: a worker can't leave, a load can't be interrupted.
  const allowed = (c: Choice) =>
    !busy && role != null && role.role !== "worker" && role.role !== "loading" && (c !== "worker" || role.role === "idle");

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
      <p className="mt-3 text-pretty text-sm" aria-live="polite">{roleStatus(role)}</p>
    </section>
  );
}
