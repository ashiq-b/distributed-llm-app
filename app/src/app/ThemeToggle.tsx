// The sun that sets into a moon: one circle, a shadow disc that slides over it, and rays
// that turn and fold away. Pressing it reveals the other theme from the button outward.
import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils";
import { currentTheme, switchTheme, type Theme } from "./theme";

export default function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  useEffect(() => {
    const mo = new MutationObserver(() => setTheme(currentTheme()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  const dark = theme === "dark";
  const mask = `moon-${useId().replace(/:/g, "")}`;
  const ease = "transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none";

  return (
    <button
      type="button"
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Light theme" : "Dark theme"}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        switchTheme(dark ? "light" : "dark", r.left + r.width / 2, r.top + r.height / 2);
      }}
      className={cn(
        "group relative flex size-9 shrink-0 touch-manipulation items-center justify-center rounded-full border bg-surface text-foreground",
        "transition-[transform,background-color] hover:bg-accent active:scale-90 [-webkit-tap-highlight-color:transparent]",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden className={cn(ease, dark ? "rotate-0" : "rotate-90")}>
        <mask id={mask}>
          <rect width="24" height="24" fill="white" />
          <circle cx="12" cy="12" r="7" fill="black" className={ease}
            style={{ transform: dark ? "translate(5px, -5px)" : "translate(14px, -14px)" }} />
        </mask>
        <circle cx="12" cy="12" r="5" fill="currentColor" mask={`url(#${mask})`} className={ease}
          style={{ transformOrigin: "12px 12px", transform: dark ? "scale(1.6)" : "scale(1)" }} />
        <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={cn(ease, "transition-[transform,opacity]")}
          style={{ transformOrigin: "12px 12px", transform: dark ? "rotate(-45deg) scale(0.4)" : "none", opacity: dark ? 0 : 1 }}>
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <line key={a} x1="12" y1="2" x2="12" y2="3.5" transform={`rotate(${a} 12 12)`} />
          ))}
        </g>
      </svg>
    </button>
  );
}
