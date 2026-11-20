// Typed wrappers over the app's Tauri commands (app/src-tauri/src/commands.rs).
// Names mirror the Rust commands in camelCase.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface DeviceInfo {
  name: string;
  platform: string;
  free_mem_mb: number | null;
  app_ver: string;
  proto: string;
}

export interface WorkerStatus {
  running: boolean;
  endpoint: string;
  device: string;
  free_mb: number | null;
}

export interface DeviceShare {
  name: string;
  endpoint: string | null;
  is_remote: boolean;
  /** Inclusive [first, last]; null when llama.cpp did not report it. */
  layers: [number, number] | null;
  buffer_mib: number | null;
}

export type ChatRole = "system" | "user" | "assistant";
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export type StopReason = "eos" | "max_tokens" | "max_tokens_while_thinking" | "cancelled";
export interface GenSummary {
  tokens: number;
  millis: number;
  stopped: StopReason;
}

export const deviceInfo = () => invoke<DeviceInfo>("device_info");

/** What this device is doing. A worker stays one until the app is closed. */
export type RoleState =
  | { role: "idle" }
  | { role: "worker"; status: WorkerStatus }
  | { role: "loading"; model_id: string; frac: number }
  | { role: "host"; model_id: string; shares: DeviceShare[] };

export const roleState = () => invoke<RoleState>("role_state");
export const becomeWorker = (port?: number) => invoke<RoleState>("become_worker", { port });
/** peerIds: ids from the discovered device list; empty = this device alone. */
export const becomeHost = (modelId: string, peerIds: string[]) =>
  invoke<DeviceShare[]>("become_host", { modelId, peerIds });
export const leaveRole = () => invoke<RoleState>("leave_role");
export const onRoleChanged = (cb: (s: RoleState) => void): Promise<UnlistenFn> =>
  listen<RoleState>("role-changed", (e) => cb(e.payload));

/** Sends one message in the current conversation; the answer streams as `token` events. */
/** The answer streams as `token` events; with `think`, its reasoning comes first inside <think>…</think>. */
export const chatSend = (text: string, think: boolean) => invoke<GenSummary>("chat_send", { text, think });
export const chatStop = () => invoke<void>("chat_stop");
export const chatHistory = () => invoke<ChatMessage[]>("chat_history");
export const chatReset = () => invoke<void>("chat_reset");

export const onToken = (cb: (piece: string) => void): Promise<UnlistenFn> =>
  listen<{ piece: string }>("token", (e) => cb(e.payload.piece));

// ---- Discovery ----

export type DeviceRole = "idle" | "worker" | "host";
export type Compat = "ok" | "app_version_mismatch" | "proto_mismatch" | "unknown";

/** Another device. null = the device didn't say (manual peers): show "unknown". */
export interface PeerView {
  id: string;
  name: string;
  platform: string | null;
  app_ver: string | null;
  proto: string | null;
  rpc_port: number;
  free_mem_mb: number | null;
  role: DeviceRole | null;
  addr: string;
  source: "mdns" | "manual";
  compat: Compat;
}

export const discoveryStart = () => invoke<PeerView[]>("discovery_start");
export const discoveryPeers = () => invoke<PeerView[]>("discovery_peers");
export const addManualPeer = (addr: string) => invoke<PeerView>("add_manual_peer", { addr });
export const onPeersChanged = (cb: (peers: PeerView[]) => void): Promise<UnlistenFn> =>
  listen<{ peers: PeerView[] }>("peers-changed", (e) => cb(e.payload.peers));

// ---- Models ----

export type ModelState =
  | { state: "not_downloaded" }
  | { state: "partial"; bytes: number }
  | { state: "ready"; path: string };

export interface ModelView {
  id: string;
  name: string;
  vendor: string;
  params_b: number;
  quant: string;
  file: string;
  size_bytes: number;
  sha256: string;
  min_free_mb: number;
  url: string;
  status: ModelState;
  downloading: boolean;
}

export interface DownloadProgress {
  id: string;
  bytes: number;
  total: number;
}

export const catalog = () => invoke<ModelView[]>("catalog");
export const modelState = (id: string) => invoke<ModelState>("model_state", { id });
export const modelDownload = (id: string) => invoke<ModelState>("model_download", { id });
export const modelCancelDownload = (id: string) => invoke<void>("model_cancel_download", { id });
export const modelDelete = (id: string) => invoke<ModelState>("model_delete", { id });
export const onDownloadProgress = (cb: (p: DownloadProgress) => void): Promise<UnlistenFn> =>
  listen<DownloadProgress>("download-progress", (e) => cb(e.payload));
