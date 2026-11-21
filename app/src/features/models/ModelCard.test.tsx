import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as tauri from "@/lib/tauri";
import type { ModelView, RoleState } from "@/lib/tauri";
import { useModels, useNotice } from "@/lib/stores";
import ModelCard from "./ModelCard";
import type { Share } from "./fit";

const qwen2b: ModelView = {
  id: "qwen3.5-2b", name: "Qwen3.5 2B", vendor: "Qwen", params_b: 2, quant: "Q4_K_M", file: "x",
  size_bytes: 1280835840, sha256: "", min_free_mb: 1600, url: "", status: { state: "ready", path: "x" }, downloading: false,
};
const idle: RoleState = { role: "idle" };
const card = (m: ModelView, shares: Share[], role: RoleState = idle) =>
  render(<ul><ModelCard m={m} role={role} shares={shares} workers={[]} /></ul>);

test("partial download shows resume, not ready", () => {
  card({ ...qwen2b, status: { state: "partial", bytes: 525000000 } }, [{ name: "iPhone15,4", free: 3439, self: true }]);
  expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Load/ })).toBeNull();
  expect(screen.queryByText("Ready")).toBeNull();
  expect(screen.getByText("Paused at 40%")).toBeInTheDocument();
});

test("load disabled when guard fails, with reason", () => {
  card(qwen2b, [{ name: "iPhone15,4", free: 1200, self: true }]);
  const load = screen.getByRole("button", { name: "Load" });
  expect(load).toBeDisabled();
  expect(load).toHaveAccessibleDescription(/Doesn't fit: needs 1,600 MiB free, these devices have 1,200 MiB/);
});

test("load enabled when it fits with the chosen workers", () => {
  render(<ul><ModelCard m={qwen2b} role={idle} workers={["mac"]}
    shares={[{ name: "iPhone15,4", free: 1200, self: true }, { name: "Mac", free: 12100 }]} /></ul>);
  expect(screen.getByRole("button", { name: "Load on 2 devices" })).toBeEnabled();
  expect(screen.getByText(/Yes: 13,300 MiB free, needs 1,600/)).toBeInTheDocument();
});

test("a worker can't load, and is told how to", () => {
  card(qwen2b, [{ name: "Mac", free: 12100, self: true }],
    { role: "worker", status: { running: true, endpoint: "0.0.0.0:50052", device: "MTL0", free_mb: 12000 } });
  expect(screen.getByRole("button", { name: "Load" })).toHaveAccessibleDescription(/Switch it to Idle in Devices/);
});

vi.mock("@/lib/tauri", async (orig) => ({
  ...(await orig<typeof import("@/lib/tauri")>()),
  modelDownload: vi.fn(),
}));

test("cancelling a download is not shown as an error; a real failure is", async () => {
  const fail = vi.fn();
  useNotice.setState({ fail });
  useModels.setState({ refresh: vi.fn() });
  const fresh = { ...qwen2b, status: { state: "not_downloaded" as const } };

  vi.mocked(tauri.modelDownload).mockRejectedValueOnce("download cancelled");
  const { unmount } = card(fresh, [{ name: "Mac", free: 12100, self: true }]);
  fireEvent.click(screen.getByRole("button", { name: "Download" }));
  await waitFor(() => expect(useModels.getState().refresh).toHaveBeenCalled());
  expect(fail).not.toHaveBeenCalled();
  unmount();

  vi.mocked(tauri.modelDownload).mockRejectedValueOnce("checksum mismatch");
  card(fresh, [{ name: "Mac", free: 12100, self: true }]);
  fireEvent.click(screen.getByRole("button", { name: "Download" }));
  await waitFor(() => expect(fail).toHaveBeenCalledWith("checksum mismatch"));
});

test("with workers on, says whether the split is needed or only slower", () => {
  const { unmount } = card(qwen2b, [{ name: "iPhone15,4", free: 4095, self: true }, { name: "Mac", free: 12123 }]);
  expect(screen.getByText("Fits on this device alone")).toBeInTheDocument();
  expect(screen.getByText(/Splitting will be slower/)).toBeInTheDocument();
  unmount();
  card(qwen2b, [{ name: "iPhone15,4", free: 1200, self: true }, { name: "Mac", free: 12123 }]);
  expect(screen.getByText("Too big for this device alone")).toBeInTheDocument();
});

test("no workers: no split note", () => {
  card(qwen2b, [{ name: "iPhone15,4", free: 4095, self: true }]);
  expect(screen.queryByText(/this device alone/)).toBeNull();
});
