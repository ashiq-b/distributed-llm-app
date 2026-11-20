import { render, screen } from "@testing-library/react";
import type { ModelView, RoleState } from "@/lib/tauri";
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
