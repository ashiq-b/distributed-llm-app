// Safe-area insets as CSS variables (--inset-top/right/bottom/left), plus the on-screen
// keyboard's height (--inset-keyboard). By default they are the browser's
// env(safe-area-inset-*) and 0 (theme.css): iOS moves the page for the keyboard itself.
// Android's WebView doesn't fill those in, and its keyboard covers the page, so the
// Android app passes the real sizes itself: once at startup through
// window.DistllmInsets, then on every change.

declare global {
  interface Window {
    DistllmInsets?: { get(): string; setDark?(dark: boolean): void };
    __distllmInsets?: (insets: string) => void;
  }
}

const SIDES = ["top", "right", "bottom", "left", "keyboard"] as const;

/** Apply "top,right,bottom,left[,keyboard]" in CSS pixels; ignores anything malformed. */
export function applyInsets(insets: string, root: HTMLElement = document.documentElement) {
  const px = insets.split(",").map(Number);
  if (px.length < 4 || px.length > 5 || px.some((n) => !Number.isFinite(n) || n < 0)) return;
  px.forEach((n, i) => root.style.setProperty(`--inset-${SIDES[i]}`, `${n}px`));
  if (px.length === 5) {
    keyboard = px[4];
    window.dispatchEvent(new Event(KEYBOARD_EVENT));
  }
}

/** Fired when the Android keyboard opens or closes. */
export const KEYBOARD_EVENT = "distllm-keyboard";
let keyboard: number | null = null;

/** The Android keyboard's height, or null where the app can't tell (iOS, desktop). */
export const keyboardHeight = () => keyboard;

export function initInsets() {
  window.__distllmInsets = (insets) => applyInsets(insets);
  try {
    const now = window.DistllmInsets?.get();
    if (now) applyInsets(now);
  } catch {
    // Not on Android: theme.css's env() defaults stay.
  }
}

/** Android: match the status bar icons to the app's theme. Elsewhere: nothing. */
export function systemBarsFor(theme: "light" | "dark") {
  try {
    window.DistllmInsets?.setDark?.(theme === "dark");
  } catch {
    // The bars keep their colour.
  }
}
