// The models this app can run, downloaded on this device. (Task 4.3 replaces this.)
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { modelCancelDownload, modelDelete, modelDownload, type ModelView } from "@/lib/tauri";
import { useModels, useNotice } from "@/lib/stores";
import { fileSize } from "@/lib/format";

function Status({ m }: { m: ModelView }) {
  const p = useModels((s) => s.progress[m.id]);
  if (m.downloading) {
    const pct = p && p.total ? (100 * p.bytes) / p.total : 0;
    return (
      <div className="space-y-1.5">
        <Progress value={pct} aria-label={`Downloading ${m.name}`} />
        <p className="text-sm tabular-nums text-muted-foreground">
          {p ? `${fileSize(p.bytes)} of ${fileSize(p.total)}` : "Starting…"}
        </p>
      </div>
    );
  }
  const st = m.status;
  return (
    <p className="text-sm text-muted-foreground">
      {st.state === "ready" ? "On this device" : st.state === "partial" ? `Paused at ${fileSize(st.bytes)}` : "Not downloaded"}
    </p>
  );
}

export default function ModelsScreen() {
  const { models, refresh } = useModels();
  const fail = useNotice((s) => s.fail);

  const download = (id: string) => {
    modelDownload(id).catch(fail).finally(refresh);
    setTimeout(refresh, 300);
  };

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight">Models</h1>
      {models.length === 0 ? (
        <p className="text-muted-foreground">Reading the model list…</p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {models.map((m) => (
            <li key={m.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="font-medium">{m.name}</p>
                <p className="text-sm text-muted-foreground">
                  {m.vendor}, {m.params_b}B parameters, {m.quant}, {fileSize(m.size_bytes)}
                </p>
                <Status m={m} />
              </div>
              <div className="flex gap-2">
                {m.downloading ? (
                  <Button variant="outline" onClick={() => modelCancelDownload(m.id).catch(fail)}>Cancel</Button>
                ) : m.status.state !== "ready" ? (
                  <Button variant="outline" onClick={() => download(m.id)}>
                    {m.status.state === "partial" ? "Resume" : "Download"}
                  </Button>
                ) : null}
                {!m.downloading && m.status.state !== "not_downloaded" && (
                  <Button variant="ghost" onClick={() => modelDelete(m.id).then(refresh).catch(fail)}>Delete</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
