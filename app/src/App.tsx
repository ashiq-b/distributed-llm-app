// Temporary plain screen (Task 2.1): buttons and real values only.
// The real UI replaces this in Phase 4.
import { useEffect, useState } from "react";
import {
  deviceInfo, workerStart, workerStatus, hostLoad, hostGenerate, hostCancel, hostUnload,
  onLoadProgress, onToken,
  type DeviceInfo, type WorkerStatus, type DeviceShare, type GenSummary,
} from "./lib/tauri";

const MODELS = ["qwen3.5-0.8b", "lfm3-1.7b", "qwen3.5-2b"]; // ids from catalog.json

export default function App() {
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  const [worker, setWorker] = useState<WorkerStatus | null>(null);
  const [modelId, setModelId] = useState(MODELS[0]);
  const [endpoints, setEndpoints] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [shares, setShares] = useState<DeviceShare[]>([]);
  const [prompt, setPrompt] = useState("");
  const [reply, setReply] = useState("");
  const [summary, setSummary] = useState<GenSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    deviceInfo().then(setInfo).catch((e) => setError(String(e)));
    workerStatus().then(setWorker).catch((e) => setError(String(e)));
    const un = [onLoadProgress(setProgress), onToken((p) => setReply((r) => r + p))];
    return () => { un.forEach((u) => u.then((f) => f())); };
  }, []);

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

      <h2>Host</h2>
      <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
        {MODELS.map((m) => <option key={m}>{m}</option>)}
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
      <input placeholder="Ask something" value={prompt} size={50} onChange={(e) => setPrompt(e.target.value)} />{" "}
      <button disabled={busy || shares.length === 0 || !prompt} onClick={() => run(async () => {
        setReply("");
        setSummary(null);
        setSummary(await hostGenerate([{ role: "user", content: prompt }]));
      })}>Send</button>{" "}
      <button onClick={() => hostCancel()}>Stop</button>
      <pre style={{ whiteSpace: "pre-wrap" }}>{reply}</pre>
      {summary && <p>{summary.tokens} tokens in {(summary.millis / 1000).toFixed(1)} s · stopped: {summary.stopped}</p>}

      {error && <p style={{ color: "crimson" }}>Error: {error}</p>}
    </main>
  );
}
