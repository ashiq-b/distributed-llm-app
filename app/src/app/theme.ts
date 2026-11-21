// Dark by default on every device; the choice is remembered on this device. The tokens in
// theme.css key off data-theme on <html>. Switching reveals the new theme as a circle
// growing from the button (View Transitions); without that API, or with reduced motion,
// it switches at once.
import { systemBarsFor } from "./insets";

export type Theme = "dark" | "light";

const KEY = "theme";

export function savedTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export const currentTheme = (): Theme => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  systemBarsFor(theme);
  try { localStorage.setItem(KEY, theme); } catch { /* storage unavailable: still switches */ }
}

export function initTheme() {
  apply(savedTheme());
}

type ViewTransitionDoc = Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };

/** Switch theme, revealing it from (x, y): the centre of the button that was pressed. */
export function switchTheme(to: Theme, x: number, y: number) {
  const doc = document as ViewTransitionDoc;
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!doc.startViewTransition || still) return apply(to);
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  let switched = false;
  const run = () => { switched = true; apply(to); };
  // A webview that accepts the call but never runs it (seen in a headless browser) must
  // still switch: after 400 ms, apply it directly.
  setTimeout(() => { if (!switched) run(); }, 400);
  doc.startViewTransition(run).ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      { duration: 620, easing: "cubic-bezier(0.22, 1, 0.36, 1)", pseudoElement: "::view-transition-new(root)" },
    );
  }).catch(() => { /* transition skipped: the theme is already applied */ });
}
