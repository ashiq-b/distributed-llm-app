import type { DeviceShare, PeerView } from "@/lib/tauri";
import { withPeerNames } from "./names";

const iphone: PeerView = {
  id: "i", name: "iPhone15,4", platform: "ios", app_ver: "0.1.0", proto: "10.0.0", rpc_port: 50052,
  free_mem_mb: 3253, role: "worker", addr: "192.168.1.4", source: "mdns", compat: "ok",
};
const shares: DeviceShare[] = [
  { name: "192.168.1.4:50052", endpoint: "192.168.1.4:50052", is_remote: true, layers: [0, 6], buffer_mib: 150.1 },
  { name: "MTL0", endpoint: null, is_remote: false, layers: [7, 25], buffer_mib: 613.7 },
];

test("a worker's share shows the name it announced", () => {
  expect(withPeerNames(shares, [iphone])[0].name).toBe("iPhone15,4");
  expect(withPeerNames(shares, [iphone])[1]).toEqual(shares[1]);
});

test("an unknown endpoint keeps its address", () => {
  expect(withPeerNames(shares, [])[0].name).toBe("192.168.1.4:50052");
});
