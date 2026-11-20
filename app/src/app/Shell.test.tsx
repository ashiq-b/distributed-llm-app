import { act, render, screen } from "@testing-library/react";
import { setWidth } from "@/test/setup";
import Shell from "./Shell";

test("Shell renders phone tabs under 900px and sidebar above", () => {
  setWidth(390);
  render(<Shell />);
  const tabs = screen.getByRole("navigation", { name: "Tabs" });
  expect(tabs).toHaveTextContent("Devices");
  expect(tabs).toHaveTextContent("Models");
  expect(tabs).toHaveTextContent("Chat");
  expect(screen.queryByRole("navigation", { name: "Sidebar" })).toBeNull();
  expect(screen.queryByRole("complementary", { name: "Split" })).toBeNull();

  act(() => setWidth(1280));
  const side = screen.getByRole("navigation", { name: "Sidebar" });
  expect(side).toHaveTextContent("Devices");
  expect(side).toHaveTextContent("Models");
  expect(side).toHaveTextContent("Chat");
  expect(screen.queryByRole("navigation", { name: "Tabs" })).toBeNull();
  expect(screen.getByRole("complementary", { name: "Split" })).toBeInTheDocument();
});
