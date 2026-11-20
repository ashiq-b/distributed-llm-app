// App state, fed only by the Tauri commands and events in ./tauri.ts. Every store starts
// empty: nothing is shown until the device itself reports it (no seeded devices or models).
import { create } from "zustand";
import {
  deviceInfo, roleState, discoveryStart, catalog, chatHistory,
  onRoleChanged, onPeersChanged,
  onPeersHeard, onToken, onDownloadProgress,
  type DeviceInfo, type RoleState, type PeerView, type ModelView, type DownloadProgress,
  type ChatMessage, type GenSummary,
} from "./tauri";
import { emitPulse } from "./pulse";
import { addToken, type Live } from "./rate";

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** This device, as the app reports it. */
export const useDevice = create<{ info: DeviceInfo | null }>(() => ({ info: null }));

/** What this device is doing. null until the app answers. */
export const useRole = create<{ role: RoleState | null }>(() => ({ role: null }));

/** Other devices on the network, and the ones picked to work for this device. */
export const usePeers = create<{
  peers: PeerView[];
  chosen: string[];
  toggle: (id: string, on: boolean) => void;
}>((set) => ({
  peers: [],
  chosen: [],
  toggle: (id, on) => set((s) => ({ chosen: on ? [...new Set([...s.chosen, id])] : s.chosen.filter((c) => c !== id) })),
}));

/** Chosen peers that are still on the network. */
export const chosenPeers = (s: { peers: PeerView[]; chosen: string[] }) =>
  s.chosen.filter((id) => s.peers.some((p) => p.id === id));

export const useModels = create<{
  models: ModelView[];
  progress: Record<string, DownloadProgress>;
  refresh: () => Promise<void>;
}>((set) => ({
  models: [],
  progress: {},
  refresh: async () => {
    try {
      set({ models: await catalog() });
    } catch (e) {
      useNotice.getState().fail(e);
    }
  },
}));

/** The conversation with the loaded model. `streaming` is the reply as it arrives;
 *  `live` counts its tokens as they arrive (for the live speed). */
export const useChat = create<{
  history: ChatMessage[];
  streaming: string;
  summary: GenSummary | null;
  sending: boolean;
  live: Live | null;
}>(() => ({ history: [], streaming: "", summary: null, sending: false, live: null }));

/** Which screen is showing. */
export type Screen = "devices" | "models" | "chat";
const SCREENS: Screen[] = ["devices", "models", "chat"];
const fromHash = (): Screen => {
  const h = typeof location === "undefined" ? "" : location.hash.slice(1);
  return SCREENS.includes(h as Screen) ? (h as Screen) : "devices";
};
/** The screen is kept in the URL hash (#chat), so a reload comes back to it. */
export const useNav = create<{ screen: Screen; go: (s: Screen) => void }>((set) => ({
  screen: fromHash(),
  go: (screen) => {
    set({ screen });
    try { history.replaceState(null, "", `#${screen}`); } catch { /* not a browser */ }
  },
}));

/** The last thing that went wrong, shown until dismissed or replaced. */
export const useNotice = create<{
  error: string | null;
  fail: (e: unknown) => void;
  clear: () => void;
}>((set) => ({
  error: null,
  fail: (e) => set({ error: errorText(e) }),
  clear: () => set({ error: null }),
}));

/** Ask the app for its state and follow its events. Returns a function that stops listening. */
export function connectStores(): () => void {
  const fail = useNotice.getState().fail;
  const refreshHistory = () => chatHistory().then((history) => useChat.setState({ history })).catch(fail);

  deviceInfo().then((info) => useDevice.setState({ info })).catch(fail);
  roleState().then((role) => useRole.setState({ role })).catch(fail);
  discoveryStart().then((peers) => usePeers.setState({ peers })).catch(fail);
  useModels.getState().refresh();

  const listeners = [
    onRoleChanged((role) => {
      if (role.role === "loading") emitPulse({ kind: "load" });
      useRole.setState({ role });
      refreshHistory();
    }),
    onPeersChanged((peers) => usePeers.setState({ peers })),
    onPeersHeard((ids) => ids.forEach((peerId) => emitPulse({ kind: "heartbeat", peerId }))),
    onToken((piece) => {
      useChat.setState((s) => ({ streaming: s.streaming + piece, live: addToken(s.live, performance.now()) }));
      emitPulse({ kind: "token" });
    }),
    onDownloadProgress((p) => useModels.setState((s) => ({ progress: { ...s.progress, [p.id]: p } }))),
  ];
  return () => listeners.forEach((l) => l.then((stop) => stop()));
}
