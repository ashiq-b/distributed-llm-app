// Sizes and times as people read them. null means the device didn't say: show "unknown".
export const UNKNOWN = "unknown";

export const mib = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MiB`;
export const freeMib = (mb: number | null) => (mb == null ? UNKNOWN : `${mb.toLocaleString()} MiB free`);

export function fileSize(bytes: number) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
