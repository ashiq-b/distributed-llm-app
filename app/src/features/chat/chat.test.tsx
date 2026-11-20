import { act, fireEvent, render, screen } from "@testing-library/react";
import * as tauri from "@/lib/tauri";
import { connectStores, loadModel, useChat, usePeers, useRole } from "@/lib/stores";
import { setWidth } from "@/test/setup";
import ChatScreen from "./ChatScreen";
import Composer from "./Composer";
import MessageList from "./MessageList";

// Every Tauri event listener is captured, so the test can send real-shaped events.
const handlers: Record<string, (x: unknown) => void> = {};
const listen = (name: string) => (cb: (x: unknown) => void) => { handlers[name] = cb; return Promise.resolve(() => {}); };

vi.mock("@/lib/tauri", async (orig) => ({
  ...(await orig<typeof import("@/lib/tauri")>()),
  deviceInfo: vi.fn().mockResolvedValue({ name: "iPhone15,4", platform: "ios", free_mem_mb: 3439, app_ver: "0.1.0", proto: "10.0.0" }),
  roleState: vi.fn().mockResolvedValue({ role: "idle" }),
  discoveryStart: vi.fn().mockResolvedValue([]),
  catalog: vi.fn().mockResolvedValue([]),
  chatHistory: vi.fn().mockResolvedValue([]),
  chatStop: vi.fn().mockResolvedValue(undefined),
  becomeHost: vi.fn(),
  onRoleChanged: vi.fn((cb) => listen("role")(cb)),
  onPeersChanged: vi.fn((cb) => listen("peers")(cb)),
  onPeersHeard: vi.fn((cb) => listen("heard")(cb)),
  onToken: vi.fn((cb) => listen("token")(cb)),
  onDownloadProgress: vi.fn((cb) => listen("download")(cb)),
}));

beforeEach(() => {
  useChat.setState({ history: [], streaming: "", summary: null, sending: false, live: null, problem: null, lastLoad: null });
});

test("tokens append in order from events", () => {
  connectStores();
  useChat.setState({ sending: true });
  const Live = () => <MessageList history={[]} streaming={useChat((s) => s.streaming)} sending />;
  render(<Live />);
  for (const piece of ["The", " capital", " of France", " is Paris."]) act(() => handlers.token(piece));
  expect(screen.getByTestId("streaming")).toHaveTextContent("The capital of France is Paris.");
  expect(useChat.getState().live?.tokens).toBe(4);
});

test("stop calls host_cancel", () => {
  // chat_stop is the command that calls the host's cancel (commands.rs).
  const onStop = vi.fn(() => tauri.chatStop());
  render(<Composer sending desktop onSend={() => {}} onStop={onStop} />);
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  expect(tauri.chatStop).toHaveBeenCalledOnce();
});

test("worker-lost error shows banner and disables composer", async () => {
  setWidth(390);
  usePeers.setState({ peers: [], chosen: ["mac"] });
  // The load worked; then the worker dropped out mid-answer: the app went Idle and
  // chat_send failed with the engine's own message.
  vi.mocked(tauri.becomeHost).mockResolvedValue([]);
  await loadModel("lfm3-1.7b", ["mac"]);
  useRole.setState({ role: { role: "idle" } });
  useChat.setState({
    history: [{ role: "user", content: "Write a long story" }],
    problem: { kind: "worker_lost", message: "lost connection to worker 192.168.1.2:50052" },
  });
  render(<ChatScreen />);

  const banner = screen.getByRole("alert");
  expect(banner).toHaveTextContent("A device dropped out");
  expect(banner).toHaveTextContent("lost connection to worker 192.168.1.2:50052");
  expect(screen.getByRole("button", { name: "Reconnect" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Choose devices" })).toBeEnabled();
  expect(screen.getByRole("textbox", { name: "Message" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  // The conversation stays on screen.
  expect(screen.getByText("Write a long story")).toBeInTheDocument();

  // Reconnect loads the same model again, without the worker that is gone.
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reconnect" })));
  expect(tauri.becomeHost).toHaveBeenLastCalledWith("lfm3-1.7b", []);
});

test("out of memory on load shows its banner with Choose devices", async () => {
  vi.mocked(tauri.becomeHost).mockRejectedValue("not enough memory: need 1600 MB, have 1200 MB");
  await loadModel("qwen3.5-2b", []);
  useRole.setState({ role: { role: "idle" } });
  render(<ChatScreen />);
  expect(screen.getByRole("alert")).toHaveTextContent("Not enough memory");
  expect(screen.getByRole("button", { name: "Choose devices" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
});
