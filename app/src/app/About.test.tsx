import { fireEvent, render, screen } from "@testing-library/react";
import { setWidth } from "@/test/setup";
import { useLayout } from "@/lib/stores";
import Shell from "./Shell";

vi.mock("@/lib/tauri", async (orig) => ({
  ...(await orig<typeof import("@/lib/tauri")>()),
  about: vi.fn().mockResolvedValue({
    app_ver: "0.1.0", llama_cpp_tag: "v1.0.0", llama_cpp_commit: "b1b770d90d94cad9e9ea5b993bdbc383a522fb28", rpc_proto: "10.0.0",
  }),
}));

for (const [label, width] of [["phone", 390], ["desktop", 1280]] as const) {
  test(`${label}: the wordmark opens About with the build and the trusted-LAN notice`, async () => {
    setWidth(width);
    useLayout.setState({ about: false, nav: true });
    render(<Shell />);
    fireEvent.click(screen.getByRole("button", { name: "About distllm" }));
    const sheet = await screen.findByRole("dialog");
    expect(await screen.findByText("0.1.0")).toBeInTheDocument();
    expect(sheet).toHaveTextContent("v1.0.0");
    expect(sheet).toHaveTextContent("b1b770d90d94cad9e9ea5b993bdbc383a522fb28");
    expect(sheet).toHaveTextContent("10.0.0");
    expect(screen.getByRole("heading", { name: "Use on a network you trust" })).toBeInTheDocument();
    expect(sheet).toHaveTextContent(/no password and no encryption/);
  });
}
