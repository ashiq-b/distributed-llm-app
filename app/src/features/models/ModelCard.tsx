// One model from the catalog: what it is, whether it's on this device (download, resume,
// cancel, delete), whether it fits on this device plus the workers picked in Devices,
// and Load. Every number is real: catalog sizes, download progress, announced free memory.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { modelCancelDownload, modelDelete, modelDownload, type ModelView, type RoleState } from "@/lib/tauri";
import { loadModel, useModels, useNav, useNotice } from "@/lib/stores";
import { UNKNOWN, fileSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { fit, type Share } from "./fit";

/** Why Load can't be used right now, or null if it can. Not shown for a model that isn't downloaded. */
export function loadBlocked(m: ModelView, role: RoleState | null, shares: Share[]): string | null {
  if (role == null) return "Asking the device…";
  if (role.role === "worker") return "This device is a worker. Switch it to Idle in Devices to load a model here.";
  if (role.role === "loading") return `Loading ${role.model_id}. Wait for it to finish.`;
  const f = fit(m.min_free_mb, shares);
  if (!f.ok) {
    return `Doesn't fit: needs ${f.need.toLocaleString()} MiB free, these devices have ${f.have.toLocaleString()} MiB. Turn on more workers in Devices.`;
  }
  return null;
}

function Progress({ m }: { m: ModelView }) {
  const p = useModels((s) => s.progress[m.id]);
  const pct = p && p.total ? (100 * p.bytes) / p.total : 0;
  return (
    <div className="mt-4 space-y-1.5">
      <div role="progressbar" aria-label={`Downloading ${m.name}`} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}
        className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
        <div className="h-full rounded-full bg-signal transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <p className="num text-sm text-muted-foreground">{p ? `${fileSize(p.bytes)} of ${fileSize(p.total)}, ${Math.floor(pct)}%` : "Starting…"}</p>
    </div>
  );
}

/** Free memory of each device as a stacked bar, with a mark where the model's need falls. */
function FitBar({ need, shares }: { need: number; shares: Share[] }) {
  const f = fit(need, shares);
  const scale = Math.max(need, f.have) * 1.08 || 1;
  const at = (mb: number) => `${(100 * mb) / scale}%`;
  const names = shares.map((s) => `${s.name} ${s.free == null ? `free memory ${UNKNOWN}` : `${s.free.toLocaleString()} MiB`}`).join(", ");
  return (
    <div className="mt-4">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span className="font-medium">Fits with selected devices?</span>
        <span className={cn("num font-semibold", f.ok ? "text-signal" : "text-destructive")}>
          {f.ok ? "Yes" : "No"}: {f.have.toLocaleString()} MiB free, needs {need.toLocaleString()}
        </span>
      </p>
      <div className="relative mt-2 h-2.5" role="img" aria-label={`Needs ${need.toLocaleString()} MiB free. ${names}.`}>
        <div className="flex h-full gap-px overflow-hidden rounded-full bg-foreground/10">
          {shares.map((s) => (
            <span key={s.name} className={cn("h-full", s.self ? "bg-signal" : "bg-foreground/60")} style={{ width: at(s.free ?? 0) }} />
          ))}
        </div>
        <span aria-hidden className="absolute -top-1 bottom-[-4px] w-0.5 rounded-full bg-foreground" style={{ left: at(need) }} />
      </div>
      <p className="num mt-1.5 text-pretty text-xs text-muted-foreground">
        {shares.map((s, i) => (
          <span key={s.name}>
            {i > 0 && " + "}
            <span className={cn(s.self && "text-signal")}>{s.name}</span> {s.free == null ? `${UNKNOWN} (counted as 0)` : `${s.free.toLocaleString()}`}
          </span>
        ))}
        {" MiB free. The mark is what the model needs."}
      </p>
    </div>
  );
}

export default function ModelCard({
  m, role, shares, workers,
}: { m: ModelView; role: RoleState | null; shares: Share[]; workers: string[] }) {
  const refresh = useModels((s) => s.refresh);
  const fail = useNotice((s) => s.fail);
  const go = useNav((s) => s.go);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const st = m.status;
  const ready = !m.downloading && st.state === "ready";
  const loaded = (role?.role === "host" || role?.role === "loading") && role.model_id === m.id;
  const blocked = ready && !loaded ? loadBlocked(m, role, shares) : null;
  const partialPct = st.state === "partial" ? Math.floor((100 * st.bytes) / m.size_bytes) : 0;

  const download = () => {
    modelDownload(m.id).catch(fail).finally(refresh);
    setTimeout(refresh, 300);
  };
  const load = () => {
    loadModel(m.id, workers);   // a failure shows as a banner in Chat
    go("chat");
  };

  return (
    <li className={cn("rounded-2xl border bg-surface p-5", ready && "border-signal/35")}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 text-balance font-serif text-2xl font-medium">{m.name}</h2>
        <span className={cn("num mt-1.5 shrink-0 text-sm font-semibold", ready ? "text-signal" : "text-muted-foreground")}>
          {m.downloading ? "Downloading" : loaded ? "Loaded" : ready ? "Ready" : st.state === "partial" ? `Paused at ${partialPct}%` : "Not downloaded"}
        </span>
      </div>
      <p className="num mt-0.5 text-sm text-muted-foreground">
        {m.vendor}, {m.params_b}B parameters, {m.quant}, {fileSize(m.size_bytes)}
      </p>

      {m.downloading && <Progress m={m} />}
      {!m.downloading && st.state === "partial" && (
        <p className="num mt-3 text-sm text-muted-foreground">{fileSize(st.bytes)} of {fileSize(m.size_bytes)} downloaded. Resume picks up from there.</p>
      )}

      <FitBar need={m.min_free_mb} shares={shares} />

      {confirmDelete ? (
        <div role="alertdialog" aria-labelledby={`del-${m.id}`} className="mt-4 rounded-xl border border-destructive/40 bg-destructive/5 p-3.5">
          <p id={`del-${m.id}`} className="text-pretty text-sm">
            Delete {m.name} from this device? It frees {fileSize(st.state === "partial" ? st.bytes : m.size_bytes)}; you'd download it again to use it.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="destructive" onClick={() => { setConfirmDelete(false); modelDelete(m.id).then(refresh).catch(fail); }}>Delete</Button>
            <Button size="sm" variant="outline" onClick={() => setConfirmDelete(false)}>Keep it</Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {m.downloading ? (
            <Button variant="outline" onClick={() => modelCancelDownload(m.id).catch(fail)}>Cancel</Button>
          ) : loaded ? (
            <Button variant="signal" onClick={() => go("chat")}>Open chat</Button>
          ) : ready ? (
            <Button variant="signal" disabled={!!blocked} aria-describedby={blocked ? `why-${m.id}` : undefined} onClick={load}>
              Load{workers.length ? ` on ${workers.length + 1} devices` : ""}
            </Button>
          ) : (
            <Button variant="outline" onClick={download}>{st.state === "partial" ? "Resume" : "Download"}</Button>
          )}
          {!m.downloading && st.state !== "not_downloaded" && !loaded && (
            <Button variant="ghost" onClick={() => setConfirmDelete(true)}>Delete</Button>
          )}
        </div>
      )}
      {blocked && !confirmDelete && <p id={`why-${m.id}`} className="mt-2 text-pretty text-sm text-muted-foreground">{blocked}</p>}
    </li>
  );
}
