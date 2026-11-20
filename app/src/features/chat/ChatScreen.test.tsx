import { fireEvent, render, screen } from "@testing-library/react";
import { setWidth } from "@/test/setup";
import { useLayout, useRole } from "@/lib/stores";
import ChatScreen from "./ChatScreen";

vi.mock("@/lib/tauri", async (orig) => ({
  ...(await orig<typeof import("@/lib/tauri")>()),
  chatHistory: vi.fn().mockResolvedValue([]),
}));

test("phone: the split card says it opens until it has been opened once", () => {
  setWidth(390);
  useLayout.setState({ seenSplit: false });
  useRole.setState({ role: { role: "host", model_id: "qwen3.5-0.8b", load: { millis: 3200, bytes_sent: 0, bytes_cached: 0 }, shares: [
    { name: "192.168.1.4:50052", endpoint: "192.168.1.4:50052", is_remote: true, layers: [0, 6], buffer_mib: 150.1 },
    { name: "MTL0", endpoint: null, is_remote: false, layers: [7, 25], buffer_mib: 613.7 },
  ] } });
  render(<ChatScreen />);
  const card = screen.getByRole("button", { name: /How it's split/ });
  expect(card).toHaveTextContent("Tap to see it live");
  fireEvent.click(card);
  expect(useLayout.getState().seenSplit).toBe(true);
  expect(screen.getByRole("dialog", { name: "How it's split" })).toBeInTheDocument();
});
