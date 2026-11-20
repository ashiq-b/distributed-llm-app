// llama.cpp names a worker's share by its endpoint ("192.168.1.4:50052"). Show the name the
// device announced instead, when a discovered device has that address; else keep the endpoint.
import type { DeviceShare, PeerView } from "@/lib/tauri";

export function withPeerNames(shares: DeviceShare[], peers: PeerView[]): DeviceShare[] {
  return shares.map((s) => {
    if (!s.is_remote || !s.endpoint) return s;
    const peer = peers.find((p) => `${p.addr}:${p.rpc_port}` === s.endpoint);
    return peer ? { ...s, name: peer.name } : s;
  });
}
