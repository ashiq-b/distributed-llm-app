import { render, screen } from "@testing-library/react";
import type { DeviceShare } from "@/lib/tauri";
import { usePeers, useRole } from "@/lib/stores";
import DeviceBars from "./DeviceBar";
import SplitView from "./SplitView";

// The recorded split from docs/evidence/2.4: Mac worker 654.58 MiB, iPhone host 386.24 MiB.
const shares: DeviceShare[] = [
  { name: "192.168.1.2:50052", endpoint: "192.168.1.2:50052", is_remote: true, layers: [0, 18], buffer_mib: 654.58 },
  { name: "MTL0", endpoint: null, is_remote: false, layers: [19, 24], buffer_mib: 386.24 },
];

test("bars proportional to buffer_mib", () => {
  render(<DeviceBars shares={shares} />);
  const [mac, phone] = screen.getAllByTestId("share-bar");
  const total = 654.58 + 386.24;
  expect(parseFloat(mac.style.width)).toBeCloseTo((100 * 654.58) / total, 3);
  expect(parseFloat(phone.style.width)).toBeCloseTo((100 * 386.24) / total, 3);
  expect(screen.getByText("Total").parentElement).toHaveTextContent("1,040.8 MiB");
  expect(screen.getByText("RPC")).toBeInTheDocument();
  expect(screen.getByText("Local")).toBeInTheDocument();
});

test('unknown layers render "unknown"', () => {
  render(<DeviceBars shares={[{ ...shares[0], layers: null, buffer_mib: null }, shares[1]]} />);
  expect(screen.getByText("Layers unknown")).toBeInTheDocument();
  expect(screen.getByText("unknown MiB")).toBeInTheDocument();
  expect(screen.getByText("Total").parentElement).toHaveTextContent("at least 386.2 MiB");
});

test("renders nothing but empty state when no model loaded", () => {
  usePeers.setState({ peers: [], chosen: [] });
  useRole.setState({ role: { role: "idle" } });
  const { container } = render(<SplitView />);
  expect(container.children).toHaveLength(1);
  expect(container).toHaveTextContent("Nothing is loaded yet");
  expect(screen.queryByRole("list")).toBeNull();
  expect(screen.queryByText(/Source: llama.cpp/)).toBeNull();
});

test("hosting shows each share and the source", () => {
  useRole.setState({ role: { role: "host", model_id: "lfm3-1.7b", shares, load: { millis: 3200, bytes_sent: 0, bytes_cached: 0 } } });
  render(<SplitView />);
  expect(screen.getByRole("list", { name: "Devices in the split" }).children).toHaveLength(2);
  expect(screen.getByText("Source: llama.cpp load report.")).toBeInTheDocument();
});
