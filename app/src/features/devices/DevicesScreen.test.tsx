import { render, screen } from "@testing-library/react";
import { useDevice, usePeers, useRole } from "@/lib/stores";
import DevicesScreen, { EMPTY } from "./DevicesScreen";

beforeEach(() => {
  useDevice.setState({ info: { name: "iPhone15,4", platform: "ios", free_mem_mb: 3439, app_ver: "0.1.0", proto: "10.0.0" } });
  usePeers.setState({ peers: [], chosen: [] });
});

test("empty list shows guidance", () => {
  useRole.setState({ role: { role: "idle" } });
  render(<DevicesScreen />);
  expect(screen.getByText(EMPTY)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add by address" })).toBeInTheDocument();
});

test("an idle device can become a worker or host; a worker can't leave", () => {
  useRole.setState({ role: { role: "idle" } });
  const { unmount } = render(<DevicesScreen />);
  expect(screen.getByRole("radio", { name: "Idle" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Worker" })).toBeEnabled();
  expect(screen.getByRole("radio", { name: "Host" })).toBeEnabled();
  unmount();

  useRole.setState({ role: { role: "worker", status: { running: true, endpoint: "0.0.0.0:50052", device: "MTL0", free_mb: 3000 } } });
  render(<DevicesScreen />);
  expect(screen.getByRole("radio", { name: "Worker" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Idle" })).toBeDisabled();
  expect(screen.getByRole("radio", { name: "Host" })).toBeDisabled();
  expect(screen.getByText(/Serving layers at 0\.0\.0\.0:50052 \(MTL0\)/)).toBeInTheDocument();
});
