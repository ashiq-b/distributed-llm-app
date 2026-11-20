import { act, fireEvent, render, screen } from "@testing-library/react";
import * as tauri from "@/lib/tauri";
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

vi.mock("@/lib/tauri", async (orig) => ({
  ...(await orig<typeof import("@/lib/tauri")>()),
  workerHosts: vi.fn(),
  leaveRole: vi.fn(),
}));

const worker = { role: "worker" as const, status: { running: true, endpoint: "0.0.0.0:50052", device: "MTL0", free_mb: 3000 } };

test("an idle device can become a worker or host; a worker can go back", () => {
  useRole.setState({ role: { role: "idle" } });
  const { unmount } = render(<DevicesScreen />);
  expect(screen.getByRole("radio", { name: "Idle" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Worker" })).toBeEnabled();
  expect(screen.getByRole("radio", { name: "Host" })).toBeEnabled();
  unmount();

  useRole.setState({ role: worker });
  render(<DevicesScreen />);
  expect(screen.getByRole("radio", { name: "Worker" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Idle" })).toBeEnabled();
  expect(screen.getByRole("radio", { name: "Host" })).toBeEnabled();
  expect(screen.getByText(/Serving layers at 0\.0\.0\.0:50052 \(MTL0\)/)).toBeInTheDocument();
});

test("a worker with no host connected goes Idle at once", async () => {
  useRole.setState({ role: worker });
  vi.mocked(tauri.workerHosts).mockResolvedValue(0);
  vi.mocked(tauri.leaveRole).mockResolvedValue({ role: "idle" });
  render(<DevicesScreen />);
  await act(async () => fireEvent.click(screen.getByRole("radio", { name: "Idle" })));
  expect(tauri.leaveRole).toHaveBeenCalledOnce();
  expect(screen.getByRole("radio", { name: "Idle" })).toBeChecked();
});

test("a worker in use asks before stopping, and can keep working", async () => {
  useRole.setState({ role: worker });
  vi.mocked(tauri.workerHosts).mockResolvedValue(1);
  vi.mocked(tauri.leaveRole).mockReset().mockResolvedValue({ role: "idle" });
  render(<DevicesScreen />);
  await act(async () => fireEvent.click(screen.getByRole("radio", { name: "Idle" })));
  expect(screen.getByRole("alertdialog")).toHaveTextContent("A host is using this device right now");
  expect(tauri.leaveRole).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Keep working" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(screen.getByRole("radio", { name: "Worker" })).toBeChecked();

  await act(async () => fireEvent.click(screen.getByRole("radio", { name: "Idle" })));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Stop worker" })));
  expect(tauri.leaveRole).toHaveBeenCalledOnce();
  expect(screen.getByRole("radio", { name: "Idle" })).toBeChecked();
});
