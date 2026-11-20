// The models this app can run, downloaded on this device. (Task 4.3 adds the fit check.)
import { Button } from "@/components/ui/button";
import { modelCancelDownload, modelDelete, modelDownload, type ModelView } from "@/lib/tauri";
import { useModels, useNav, useNotice } from "@/lib/stores";
import { fileSize } from "@/lib/format";

function Download({ m }: { m: ModelView }) {
  const p = useModels((s) => s.progress[m.id]);
  const pct = p && p.total ? (100 * p.bytes) / p.total : 0;
  return (
    <div className="mt-3 space-y-2">
      <div role="progressbar" aria-label={`Downloading ${m.name}`} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}
        className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
        <div className="h-full rounded-full bg-signal transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <p className="num text-sm text-muted-foreground">{p ? `${fileSize(p.bytes)} of ${fileSize(p.total)}, ${Math.floor(pct)}%` : "Starting…"}</p>
    </div>
  );
}

export default function ModelsScreen() {
  const { models, refresh } = useModels();
  const fail = useNotice((s) => s.fail);
  const go = useNav((s) => s.go);

  const download = (id: string) => {
    modelDownload(id).catch(fail).finally(refresh);
    setTimeout(refresh, 300);
  };

  return (
    <div>
      <h1 className="font-serif text-4xl font-medium tracking-tight">Models</h1>
      <p className="mb-5 mt-1 text-pretty text-sm text-muted-foreground">
        Download a model once on each device. Workers serve layers from their own copy, so loading sends almost nothing over Wi‑Fi.
      </p>
      {models.length === 0 ? (
        <p className="text-muted-foreground">Reading the model list…</p>
      ) : (
        <ul className="border-t">
          {models.map((m) => {
            const st = m.status;
            return (
              <li key={m.id} className="border-b py-5">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="min-w-0 truncate font-serif text-2xl font-medium">{m.name}</h2>
                  {!m.downloading && st.state === "ready" && <span className="shrink-0 text-sm font-semibold text-signal">On this device</span>}
                  {!m.downloading && st.state === "partial" && <span className="num shrink-0 text-sm text-muted-foreground">Paused at {fileSize(st.bytes)}</span>}
                </div>
                <p className="num mt-0.5 text-sm text-muted-foreground">
                  {m.vendor}, {m.quant}, {fileSize(m.size_bytes)}. Needs {m.min_free_mb.toLocaleString()} MiB free.
                </p>
                {m.downloading && <Download m={m} />}
                <div className="mt-3 flex flex-wrap gap-2">
                  {m.downloading ? (
                    <Button variant="outline" onClick={() => modelCancelDownload(m.id).catch(fail)}>Cancel</Button>
                  ) : st.state === "ready" ? (
                    <Button onClick={() => go("chat")}>Load</Button>
                  ) : (
                    <Button variant="outline" onClick={() => download(m.id)}>{st.state === "partial" ? "Resume" : "Download"}</Button>
                  )}
                  {!m.downloading && st.state !== "not_downloaded" && (
                    <Button variant="ghost" onClick={() => modelDelete(m.id).then(refresh).catch(fail)}>Delete</Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
