// Mesh nodes from real data only: discovered peers (by free memory) or the loaded split
// (by layers held).
import type { DeviceShare, PeerView } from "@/lib/tauri";
import { UNKNOWN } from "@/lib/format";
import type { MeshNode } from "./geometry";

export const MAX_NODES = 6;

export function peerNodes(peers: PeerView[]): MeshNode[] {
  const shown = peers.slice(0, MAX_NODES);
  const most = Math.max(1, ...shown.map((p) => p.free_mem_mb ?? 0));
  return shown.map((p) => ({
    id: p.id,
    label: p.name,
    detail: p.free_mem_mb == null ? `free memory ${UNKNOWN}` : `${p.free_mem_mb.toLocaleString()} MiB free`,
    weight: (p.free_mem_mb ?? 0) / most,
  }));
}

export const layerCount = (s: DeviceShare) => (s.layers ? s.layers[1] - s.layers[0] + 1 : 0);

export function shareNodes(shares: DeviceShare[]): MeshNode[] {
  const most = Math.max(1, ...shares.map(layerCount));
  return shares.slice(0, MAX_NODES).map((s, i) => ({
    id: s.endpoint ?? `local-${i}`,
    label: s.is_remote ? s.name : "This device",
    detail: s.layers ? `layers ${s.layers[0]}–${s.layers[1]}` : `layers ${UNKNOWN}`,
    weight: layerCount(s) / most,
    self: !s.is_remote,
  }));
}
