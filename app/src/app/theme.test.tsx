import { fireEvent, render, screen } from "@testing-library/react";
import ThemeToggle from "./ThemeToggle";
import { initTheme } from "./theme";

beforeEach(() => localStorage.clear());

test("dark is the default theme", () => {
  initTheme();
  expect(document.documentElement.dataset.theme).toBe("dark");
});

test("the toggle switches theme and the choice is remembered", async () => {
  initTheme();
  render(<ThemeToggle />);
  fireEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(await screen.findByRole("button", { name: "Switch to dark theme" })).toBeInTheDocument();
  initTheme();
  expect(document.documentElement.dataset.theme).toBe("light");
});
