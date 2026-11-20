// Real events, as moments the mesh can light up: each streamed token, each discovery
// heartbeat from a peer, each step of a model load. Nothing here is generated on a timer.
export type Pulse =
  | { kind: "token" }                      // one token came back from the split
  | { kind: "heartbeat"; peerId: string }   // a peer's announcement arrived
  | { kind: "load" };                      // the load moved forward (weights going to workers)

type Listener = (p: Pulse) => void;
const listeners = new Set<Listener>();

export function onPulse(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function emitPulse(p: Pulse) {
  listeners.forEach((fn) => fn(p));
}
