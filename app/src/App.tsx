// Temporary plain screen (Task 2.1): buttons and real values only.
// The real UI replaces this in Phase 4.
import { useEffect, useState } from "react";
import {
  deviceInfo, workerStart, workerStatus, hostLoad, hostGenerate, hostCancel, hostUnload,
  onLoadProgress, onToken, catalog, modelDownload, modelCancelDownload, modelDelete, onDownloadProgress,
  type DeviceInfo, type WorkerStatus, type DeviceShare, type GenSummary, type ModelView, type DownloadProgress,
  type ChatMessage,
} from "./lib/tauri";

// Reasoning ("<think>…</think>") is shown but not sent back as history: it wastes context.
const withoutThinking = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(0)} MB`;

export default function App() {
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  const [worker, setWorker] = useState<WorkerStatus | null>(null);
  const [models, setModels] = useState<ModelView[]>([]);
  const [dl, setDl] = useState<Record<string, DownloadProgress>>({});
  const [modelId, setModelId] = useState("");
  const [endpoints, setEndpoints] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [shares, setShares] = useState<DeviceShare[]>([]);
  const [prompt, setPrompt] = useState("");
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [reply, setReply] = useState("");
  const [summary, setSummary] = useState<GenSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    deviceInfo().then(setInfo).catch((e) => setError(String(e)));
    workerStatus().then(setWorker).catch((e) => setError(String(e)));
    refreshModels();
    const un = [
      onLoadProgress(setProgress),
      onToken((p) => setReply((r) => r + p)),
      onDownloadProgress((p) => setDl((d) => ({ ...d, [p.id]: p }))),
    ];
    return () => { un.forEach((u) => u.then((f) => f())); };
  }, []);

  const refreshModels = () =>
    catalog()
      .then((m) => {
        setModels(m);
        setModelId((cur) => cur || m[0]?.id || "");
      })
      .catch((e) => setError(String(e)));

  // Downloads run independently of the busy flag so Cancel stays usable.
  const download = (id: string) => {
    setError(null);
    modelDownload(id).catch((e) => setError(String(e))).finally(refreshModels);
    setTimeout(refreshModels, 300);
  };

  const run = async (f: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try { await f(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  return (
    <main style={{ fontFamily: "system-ui", padding: 16, maxWidth: 760 }}>
      <h2>This device</h2>
      {info && (
        <p>
          {info.name} · {info.platform} · free {info.free_mem_mb ?? "unknown"} MiB · app {info.app_ver} · RPC {info.proto}
        </p>
      )}

      <h2>Worker</h2>
      <button disabled={busy || !!worker} onClick={() => run(async () => setWorker(await workerStart(50052)))}>
        Start worker
      </button>
      <p>
        {worker
          ? `Running on ${worker.endpoint} · ${worker.device} · free ${worker.free_mb ?? "unknown"} MiB (stays on until the app is closed)`
          : "Not running"}
      </p>

      <h2>Models</h2>
      {models.map((m) => {
        const p = dl[m.id];
        const st = m.status;
        return (
          <div key={m.id} style={{ marginBottom: 8 }}>
            <b>{m.name}</b> · {m.vendor} · {m.quant} · {mb(m.size_bytes)} —{" "}
            {m.downloading
              ? `downloading ${p ? `${mb(p.bytes)} / ${mb(p.total)} (${p.total ? Math.floor((100 * p.bytes) / p.total) : 0}%)` : "…"}`
              : st.state === "ready" ? "ready"
              : st.state === "partial" ? `paused at ${mb(st.bytes)}`
              : "not downloaded"}{" "}
            {m.downloading ? (
              <button onClick={() => modelCancelDownload(m.id)}>Cancel</button>
            ) : st.state !== "ready" ? (
              <button onClick={() => download(m.id)}>{st.state === "partial" ? "Resume" : "Download"}</button>
            ) : null}{" "}
            {!m.downloading && st.state !== "not_downloaded" && (
              <button onClick={() => modelDelete(m.id).then(refreshModels).catch((e) => setError(String(e)))}>Delete</button>
            )}
          </div>
        );
      })}

      <h2>Host</h2>
      <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
        {models.map((m) => (
          <option key={m.id} value={m.id}>{m.name}{m.status.state === "ready" ? "" : " (not downloaded)"}</option>
        ))}
      </select>{" "}
      <input placeholder="workers: 192.168.1.20:50052, …" value={endpoints} size={36}
        onChange={(e) => setEndpoints(e.target.value)} />{" "}
      <button disabled={busy} onClick={() => run(async () => {
        setShares([]);
        setProgress(0);
        const eps = endpoints.split(",").map((s) => s.trim()).filter(Boolean);
        setShares(await hostLoad(modelId, eps));
      })}>Load</button>{" "}
      <button disabled={busy} onClick={() => run(async () => { await hostUnload(); setShares([]); setProgress(null); })}>
        Unload
      </button>
      {progress !== null && <p>Load progress: {Math.round(progress * 100)}%</p>}
      {shares.length > 0 && (
        <table cellPadding={4}>
          <thead><tr><th align="left">Device</th><th>Where</th><th>Layers</th><th align="right">MiB</th></tr></thead>
          <tbody>
            {shares.map((s, i) => (
              <tr key={i}>
                <td>{s.name}</td>
                <td>{s.is_remote ? "worker (RPC)" : "this device"}</td>
                <td>{s.layers ? `${s.layers[0]}–${s.layers[1]}` : "unknown"}</td>
                <td align="right">{s.buffer_mib?.toFixed(2) ?? "unknown"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Chat</h2>
      {history.map((m, i) => (
        <p key={i} style={{ whiteSpace: "pre-wrap" }}><b>{m.role === "user" ? "You" : "Model"}:</b> {m.content}</p>
      ))}
      <input placeholder="Ask something" value={prompt} size={50} onChange={(e) => setPrompt(e.target.value)} />{" "}
      <button disabled={busy || shares.length === 0 || !prompt} onClick={() => run(async () => {
        const turn: ChatMessage[] = [...history, { role: "user", content: prompt }];
        setHistory(turn);
        setPrompt("");
        setReply("");
        setSummary(null);
        let text = "";
        const unlisten = await onToken((p) => { text += p; });
        try {
          setSummary(await hostGenerate(turn));
          setHistory([...turn, { role: "assistant", content: withoutThinking(text) }]);
          setReply("");
        } finally {
          unlisten();
        }
      })}>Send</button>{" "}
      <button onClick={() => hostCancel()}>Stop</button>{" "}
      <button disabled={busy} onClick={() => { setHistory([]); setReply(""); setSummary(null); }}>New chat</button>
      {reply && <pre style={{ whiteSpace: "pre-wrap" }}>{reply}</pre>}
      {summary && <p>{summary.tokens} tokens in {(summary.millis / 1000).toFixed(1)} s · stopped: {summary.stopped}</p>}

      {error && <p style={{ color: "crimson" }}>Error: {error}</p>}
    </main>
  );
}
