import { act, fireEvent, render, screen } from "@testing-library/react";
import { setWidth } from "@/test/setup";
import { useLayout, useRole } from "@/lib/stores";
import Crashed from "./Crashed";
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
  // Nothing loaded: no empty split dock taking a third of the window.
  expect(screen.queryByRole("complementary", { name: "Split" })).toBeNull();
});

test("the split dock shows on desktop once a model is loading", () => {
  setWidth(1280);
  useRole.setState({ role: { role: "loading", model_id: "lfm3-1.7b", frac: 0.4 } });
  render(<Shell />);
  expect(screen.getByRole("complementary", { name: "Split" })).toHaveTextContent("40%");
  act(() => useRole.setState({ role: { role: "idle" } }));
  expect(screen.queryByRole("complementary", { name: "Split" })).toBeNull();
});

test("Devices renders before any device is found", () => {
  setWidth(390);
  useRole.setState({ role: { role: "idle" } });
  render(<Shell />);
  expect(screen.getByRole("heading", { name: "Devices" })).toBeInTheDocument();
});

test("a screen that throws shows the error and a reload, not a blank window", () => {
  const Boom = () => { throw new Error("boom"); };
  vi.spyOn(console, "error").mockImplementation(() => {});
  render(<Crashed><Boom /></Crashed>);
  expect(screen.getByRole("alert")).toHaveTextContent("boom");
  expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
});

test("desktop: the sidebar and the split dock can be hidden and shown again", () => {
  setWidth(1280);
  useLayout.setState({ nav: true, split: true });
  useRole.setState({ role: { role: "loading", model_id: "lfm3-1.7b", frac: 0.4 } });
  render(<Shell />);
  expect(screen.getByRole("navigation", { name: "Sidebar" })).toHaveTextContent("Devices");

  fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
  // Collapsed to icons: still a way to every screen, by name.
  expect(screen.getByRole("button", { name: "Devices" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show sidebar" }));
  expect(screen.getByRole("navigation", { name: "Sidebar" })).toHaveTextContent("Devices");

  fireEvent.click(screen.getByRole("button", { name: "Hide how it's split" }));
  expect(screen.queryByRole("complementary", { name: "Split" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show how it's split" }));
  expect(screen.getByRole("complementary", { name: "Split" })).toHaveTextContent("40%");
});
