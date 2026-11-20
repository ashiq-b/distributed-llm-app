import { render, screen } from "@testing-library/react";
import type { DeviceInfo, PeerView } from "@/lib/tauri";
import PeerRow from "./PeerRow";

const local: DeviceInfo = { name: "iPhone15,4", platform: "ios", free_mem_mb: 3439, app_ver: "0.1.0", proto: "10.0.0" };
const mac: PeerView = {
  id: "mac", name: "Mac", platform: "macos", app_ver: "0.1.0", proto: "10.0.0", rpc_port: 50052,
  free_mem_mb: 12100, role: "worker", addr: "192.168.1.2", source: "mdns", compat: "ok",
};
const row = (peer: PeerView) => render(<ul><PeerRow peer={peer} local={local} chosen={false} onChoose={() => {}} /></ul>);

test("incompatible peer is not selectable and shows reason", () => {
  row({ ...mac, proto: "9.0.0", compat: "proto_mismatch" });
  expect(screen.getByRole("switch", { name: "Use Mac as a worker" })).toBeDisabled();
  expect(screen.getByText(/Different engine \(9\.0\.0; this device has 10\.0\.0\)/)).toBeInTheDocument();
});

test("a host or idle peer is not selectable and says why", () => {
  row({ ...mac, role: "host" });
  expect(screen.getByRole("switch")).toBeDisabled();
  expect(screen.getByText(/Hosting its own model/)).toBeInTheDocument();
});

test('unknown memory renders "unknown"', () => {
  row({ ...mac, free_mem_mb: null, platform: null, role: null, compat: "unknown", source: "manual" });
  expect(screen.getByText(/Free memory unknown/)).toBeInTheDocument();
  expect(screen.getByText(/Platform unknown/)).toBeInTheDocument();
  // Unknown version is allowed (a device added by address), but labelled.
  expect(screen.getByText("Version unknown")).toBeInTheDocument();
  expect(screen.getByRole("switch")).toBeEnabled();
});

test("a compatible worker can be picked", () => {
  row(mac);
  expect(screen.getByRole("switch", { name: "Use Mac as a worker" })).toBeEnabled();
  expect(screen.getByText(/macOS, Worker, 12,100 MiB free/)).toBeInTheDocument();
});
