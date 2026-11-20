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
