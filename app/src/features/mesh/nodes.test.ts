import { peerNodes, shareNodes } from "./nodes";
import type { DeviceShare, PeerView } from "@/lib/tauri";

const peer = (id: string, free: number | null): PeerView => ({
  id, name: id, platform: null, app_ver: null, proto: null, rpc_port: 50052,
  free_mem_mb: free, role: null, addr: "192.168.1.9", source: "mdns", compat: "ok",
});

test("peer strands follow real free memory, unknown stays unknown", () => {
  const [a, b] = peerNodes([peer("mac", 12000), peer("phone", null)]);
  expect(a.weight).toBe(1);
  expect(b.weight).toBe(0);
  expect(b.detail).toBe("free memory unknown");
});

test("split strands follow the layers each device holds", () => {
  // The recorded 2.4 split: Mac layers 0–18 over RPC, iPhone 19–24 locally.
  const shares: DeviceShare[] = [
    { name: "Mac", endpoint: "192.168.1.2:50052", is_remote: true, layers: [0, 18], buffer_mib: 654.58 },
    { name: "MTL0", endpoint: null, is_remote: false, layers: [19, 24], buffer_mib: 386.24 },
  ];
  const [mac, me] = shareNodes(shares);
  expect(mac.weight).toBe(1);
  expect(me.weight).toBeCloseTo(6 / 19);
  expect(me.self).toBe(true);
  expect(me.detail).toBe("layers 19–24");
});
