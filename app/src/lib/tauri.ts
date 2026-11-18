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

export type StopReason = "eos" | "max_tokens" | "cancelled";
export interface GenSummary {
  tokens: number;
  millis: number;
  stopped: StopReason;
}

export const deviceInfo = () => invoke<DeviceInfo>("device_info");
export const workerStart = (port: number) => invoke<WorkerStatus>("worker_start", { port });
export const workerStatus = () => invoke<WorkerStatus | null>("worker_status");
export const hostLoad = (modelId: string, endpoints: string[]) =>
  invoke<DeviceShare[]>("host_load", { modelId, endpoints });
export const hostGenerate = (messages: ChatMessage[]) => invoke<GenSummary>("host_generate", { messages });
export const hostCancel = () => invoke<void>("host_cancel");
export const hostUnload = () => invoke<void>("host_unload");
export const deviceShares = () => invoke<DeviceShare[]>("device_shares");

export const onLoadProgress = (cb: (frac: number) => void): Promise<UnlistenFn> =>
  listen<{ frac: number }>("load-progress", (e) => cb(e.payload.frac));
export const onToken = (cb: (piece: string) => void): Promise<UnlistenFn> =>
  listen<{ piece: string }>("token", (e) => cb(e.payload.piece));
