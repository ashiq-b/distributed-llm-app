// Will a model fit on this device plus the chosen workers? The same rule as the load
// guard in app/src-tauri/src/roles.rs (`memory_guard`): free memory added up, with a
// device whose free memory is unknown counted as 0. The host checks again when loading.

export interface Share {
  name: string;
  /** Free memory in MiB, or null if the device didn't say. */
  free: number | null;
  self?: boolean;
}

export interface Fit {
  ok: boolean;
  need: number;
  have: number;
  /** Same words as the guard's error, so the hint matches what a load would say. */
  reason: string | null;
}

export function fit(needMb: number, shares: Share[]): Fit {
  const have = shares.reduce((sum, s) => sum + (s.free ?? 0), 0);
  const ok = have >= needMb;
  return { ok, need: needMb, have, reason: ok ? null : `not enough memory: need ${needMb} MB, have ${have} MB` };
}

/** What splitting does for this load. Splitting is for capacity, not speed: each worker
 * adds network round trips to every token (5.2: one iPhone alone 22.6 tokens/s, with the
 * Mac 5.8, with the Mac and Android 3.2). null with no workers, or when this device's own
 * free memory is unknown. */
export type SplitAdvice =
  | { kind: "fits_alone"; free: number; need: number; workers: number }
  | { kind: "needs_split"; free: number; need: number; workers: number };

export function splitAdvice(needMb: number, shares: Share[]): SplitAdvice | null {
  const self = shares.find((s) => s.self);
  const workers = shares.filter((s) => !s.self).length;
  if (!self || self.free == null || workers === 0) return null;
  return { kind: self.free >= needMb ? "fits_alone" : "needs_split", free: self.free, need: needMb, workers };
}
