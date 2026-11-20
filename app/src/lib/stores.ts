// App state, fed only by the Tauri commands and events in ./tauri.ts. Every store starts
// empty: nothing is shown until the device itself reports it (no seeded devices or models).
import { create } from "zustand";
import {
  deviceInfo, roleState, discoveryStart, catalog, chatHistory, becomeHost,
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
/** What went wrong with the model or the conversation, sorted by what the user can do. */
export interface ChatProblem {
  kind: "worker_lost" | "out_of_memory" | "not_loaded" | "other";
  message: string;
}

/** Sort an error from the app by its message (the Rust side's own words). */
export function classify(e: unknown): ChatProblem {
  const message = errorText(e);
  const kind: ChatProblem["kind"] =
    /lost connection to worker|device no longer available|cannot reach worker/i.test(message) ? "worker_lost"
    : /not enough memory/i.test(message) ? "out_of_memory"
    : /no model loaded/i.test(message) ? "not_loaded"
    : "other";
  return { kind, message };
}

export const useChat = create<{
  history: ChatMessage[];
  streaming: string;
  summary: GenSummary | null;
  sending: boolean;
  live: Live | null;
  problem: ChatProblem | null;
  /** The last load asked for, so Reconnect can ask again. */
  lastLoad: { modelId: string; workers: string[] } | null;
}>(() => ({ history: [], streaming: "", summary: null, sending: false, live: null, problem: null, lastLoad: null }));

/** Load a model with these workers. A failure is kept as the chat's problem (shown as a
 * banner with what to do), not thrown. */
export async function loadModel(modelId: string, workers: string[]) {
  useChat.setState({ lastLoad: { modelId, workers }, problem: null });
  try {
    await becomeHost(modelId, workers);
  } catch (e) {
    useChat.setState({ problem: classify(e) });
  }
}

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

// Layout choices are per-viewer conveniences kept in this browser's storage; the app works
// the same without it (private mode, cleared storage).
function remembered(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}
function remember(key: string, on: boolean) {
  try { localStorage.setItem(key, on ? "1" : "0"); } catch { /* storage unavailable */ }
}

/** Desktop: are the sidebar and the split dock open (both by default)? Phone: has the
 * split sheet been opened at least once (until then its trigger says what it is)? */
export const useLayout = create<{
  nav: boolean;
  split: boolean;
  seenSplit: boolean;
  toggleNav: () => void;
  toggleSplit: () => void;
  sawSplit: () => void;
}>((set, get) => ({
  nav: remembered("layout.nav", true),
  split: remembered("layout.split", true),
  seenSplit: remembered("layout.seenSplit", false),
  toggleNav: () => { const nav = !get().nav; remember("layout.nav", nav); set({ nav }); },
  toggleSplit: () => { const split = !get().split; remember("layout.split", split); set({ split }); },
  sawSplit: () => { if (!get().seenSplit) { remember("layout.seenSplit", true); set({ seenSplit: true }); } },
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

/** Whatever started the hosting, Reconnect should be able to load the same model again. */
function rememberHosted(modelId: string) {
  if (useChat.getState().lastLoad?.modelId !== modelId) {
    useChat.setState({ lastLoad: { modelId, workers: chosenPeers(usePeers.getState()) } });
  }
}

/** Ask the app for its state and follow its events. Returns a function that stops listening. */
export function connectStores(): () => void {
  const fail = useNotice.getState().fail;
  const refreshHistory = () => chatHistory().then((history) => useChat.setState({ history })).catch(fail);

  deviceInfo().then((info) => useDevice.setState({ info })).catch(fail);
  roleState().then((role) => {
    if (role.role === "host") rememberHosted(role.model_id);
    useRole.setState({ role });
  }).catch(fail);
  discoveryStart().then((peers) => usePeers.setState({ peers })).catch(fail);
  useModels.getState().refresh();

  const listeners = [
    onRoleChanged((role) => {
      if (role.role === "loading") emitPulse({ kind: "load" });
      if (role.role === "host") rememberHosted(role.model_id);
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
