import { render, screen } from "@testing-library/react";
import MessageList from "./MessageList";

const answer = [
  "Let's break down **ZKP**: *Zero Knowledge Proof*.",
  "",
  "### 1. What is it?",
  "",
  "* **The Goal:** prove you know the answer.",
  "* **The Catch:** without telling it.",
  "",
  "Your secret number: `2020`.",
  "",
  "```python",
  "print(2020)",
  "```",
  "",
  "| Who | Knows |",
  "|---|---|",
  "| Prover | the secret |",
  "",
  "<script>alert(1)</script><b>raw</b>",
].join("\n");

test("answers render as formatted Markdown, not raw symbols", () => {
  const { container } = render(<MessageList history={[{ role: "assistant", content: answer }]} streaming="" sending={false} />);
  expect(screen.getByText("ZKP").tagName).toBe("STRONG");
  expect(screen.getByText("Zero Knowledge Proof").tagName).toBe("EM");
  expect(screen.getByRole("heading", { name: "1. What is it?" })).toBeInTheDocument();
  expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText("2020").tagName).toBe("CODE");
  expect(container.querySelector("pre code")).toHaveTextContent("print(2020)");
  expect(screen.getByRole("table")).toHaveTextContent("Prover");
  // No Markdown symbols left over, and raw HTML from the model is never rendered.
  expect(container.textContent).not.toMatch(/\*\*|###/);
  expect(container.querySelector("script, b")).toBeNull();
});
