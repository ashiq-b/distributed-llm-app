// Temporary plain screen (Task 2.1): buttons and real values only.
// The real UI replaces this in Phase 4.
import { useEffect, useState } from "react";
import {
  deviceInfo, roleState, becomeWorker, becomeHost, leaveRole, onRoleChanged,
  chatSend, chatStop, chatHistory, chatReset, onToken,
  catalog, modelDownload, modelCancelDownload, modelDelete, onDownloadProgress,
  type DeviceInfo, type GenSummary, type ModelView, type DownloadProgress, type RoleState,
  type ChatMessage, discoveryStart, addManualPeer, onPeersChanged, type PeerView,
} from "./lib/tauri";

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(0)} MB`;
const mib = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MiB`;

export default function App() {
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  const [role, setRole] = useState<RoleState>({ role: "idle" });
  const [models, setModels] = useState<ModelView[]>([]);
  const [dl, setDl] = useState<Record<string, DownloadProgress>>({});
  const [modelId, setModelId] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [peers, setPeers] = useState<PeerView[]>([]);
  const [manualAddr, setManualAddr] = useState("");
  const [prompt, setPrompt] = useState("");
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [reply, setReply] = useState("");
  const [summary, setSummary] = useState<GenSummary | null>(null);
  const [think, setThink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    deviceInfo().then(setInfo).catch((e) => setError(String(e)));
    roleState().then(setRole).catch((e) => setError(String(e)));
    refreshModels();
    discoveryStart().then(setPeers).catch((e) => setError(String(e)));
    const un = [
      onPeersChanged(setPeers),
      onRoleChanged((s) => { setRole(s); chatHistory().then(setHistory); }),
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

  const shares = role.role === "host" ? role.shares : [];

  return (
    <main style={{ fontFamily: "system-ui", padding: 16, maxWidth: 760 }}>
      <h2>This device</h2>
      {info && (
        <p>
          {info.name} · {info.platform} · free {info.free_mem_mb ?? "unknown"} MiB · app {info.app_ver} · RPC {info.proto}
        </p>
      )}

      <h2>Role: {role.role}</h2>
      <button disabled={busy || role.role !== "idle"} onClick={() => run(async () => setRole(await becomeWorker()))}>
        Start worker
      </button>
      <p>
        {role.role === "worker"
          ? `Running on ${role.status.endpoint} · ${role.status.device} · free ${role.status.free_mb ?? "unknown"} MiB (stays on until the app is closed)`
          : "Not a worker"}
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

      <h2>Devices on this network</h2>
      {peers.length === 0 && <p>None found yet.</p>}
      {peers.map((p) => {
        const ep = `${p.addr}:${p.rpc_port}`;
        return (
          <div key={p.id}>
            {p.name} · {p.platform ?? "unknown"} · {p.role ?? "unknown"} · {ep} · free{" "}
            {p.free_mem_mb ?? "unknown"} MiB · {p.compat}{" "}
            <label>
              <input type="checkbox" checked={chosen.includes(p.id)}
                disabled={p.compat === "proto_mismatch" || p.compat === "app_version_mismatch" || (p.role !== null && p.role !== "worker")}
                onChange={(e) => setChosen((c) => e.target.checked ? [...c, p.id] : c.filter((id) => id !== p.id))} />
              use as worker
            </label>
          </div>
        );
      })}
      <input placeholder="add by address: 192.168.1.4" value={manualAddr} size={24}
        onChange={(e) => setManualAddr(e.target.value)} />{" "}
      <button disabled={busy || !manualAddr} onClick={() => run(async () => {
        await addManualPeer(manualAddr);
        setManualAddr("");
      })}>Add</button>

      <h2>Host</h2>
      <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
        {models.map((m) => (
          <option key={m.id} value={m.id}>{m.name}{m.status.state === "ready" ? "" : " (not downloaded)"}</option>
        ))}
      </select>{" "}
      {" "}with {chosen.filter((id) => peers.some((p) => p.id === id)).length} worker(s){" "}
      <button disabled={busy || role.role === "worker" || role.role === "loading"} onClick={() => run(async () => {
        await becomeHost(modelId, chosen.filter((id) => peers.some((p) => p.id === id)));
      })}>Load</button>{" "}
      <button disabled={busy || role.role !== "host"} onClick={() => run(async () => setRole(await leaveRole()))}>
        Unload
      </button>
      {role.role === "loading" && <p>Loading {role.model_id}: {Math.round(role.frac * 100)}%</p>}
      {role.role === "host" && (
        <p>
          Loaded in {(role.load.millis / 1000).toFixed(1)} s · sent to workers {mib(role.load.bytes_sent)} ·
          already on workers {mib(role.load.bytes_cached)}
        </p>
      )}
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

      <h2>Chat{role.role === "host" ? ` · ${role.model_id}` : ""}</h2>
      {history.map((m, i) => (
        <p key={i} style={{ whiteSpace: "pre-wrap" }}><b>{m.role === "user" ? "You" : "Model"}:</b> {m.content}</p>
      ))}
      <input placeholder="Ask something" value={prompt} size={50} onChange={(e) => setPrompt(e.target.value)} />{" "}
      <button disabled={busy || role.role !== "host" || !prompt} onClick={() => run(async () => {
        const text = prompt;
        setHistory((h) => [...h, { role: "user", content: text }]);
        setPrompt("");
        setReply("");
        setSummary(null);
        try {
          const s = await chatSend(text, think);
          setSummary(s);
          // Ran out of length mid-thought: keep the reasoning on screen, it's all there is.
          if (s.stopped !== "max_tokens_while_thinking") setReply("");
        } finally {
          setHistory(await chatHistory());
        }
      })}>Send</button>{" "}
      <label><input type="checkbox" checked={think} onChange={(e) => setThink(e.target.checked)} /> Think first</label>{" "}
      <button onClick={() => chatStop()}>Stop</button>{" "}
      <button disabled={busy} onClick={() => run(async () => {
        await chatReset(); setHistory([]); setReply(""); setSummary(null);
      })}>New chat</button>
      {reply && <pre style={{ whiteSpace: "pre-wrap" }}>{reply}</pre>}
      {summary?.stopped === "max_tokens_while_thinking" && (
        <p style={{ color: "crimson" }}>Ran out of length while thinking, so there is no answer. Ask again, or turn off "Think first".</p>
      )}
      {summary && <p>{summary.tokens} tokens in {(summary.millis / 1000).toFixed(1)} s · stopped: {summary.stopped}</p>}

      {error && <p style={{ color: "crimson" }}>Error: {error}</p>}
    </main>
  );
}
