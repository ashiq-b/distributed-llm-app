// Tailwind 3. Colours come from the CSS variables in src/app/theme.css (light and dark),
// so components never hard-code a colour.
import animate from "tailwindcss-animate";

const v = (name) => `hsl(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    screens: { sm: "600px", desk: "900px", wide: "1240px" },
    extend: {
      colors: {
        border: v("border"),
        input: v("input"),
        ring: v("ring"),
        background: v("background"),
        foreground: v("foreground"),
        primary: { DEFAULT: v("primary"), foreground: v("primary-foreground") },
        secondary: { DEFAULT: v("secondary"), foreground: v("secondary-foreground") },
        destructive: { DEFAULT: v("destructive"), foreground: v("destructive-foreground") },
        muted: { DEFAULT: v("muted"), foreground: v("muted-foreground") },
        accent: { DEFAULT: v("accent"), foreground: v("accent-foreground") },
        popover: { DEFAULT: v("popover"), foreground: v("popover-foreground") },
        card: { DEFAULT: v("card"), foreground: v("card-foreground") },
        signal: { DEFAULT: v("signal"), soft: v("signal-soft"), ink: v("signal-ink") },
        ok: v("ok"),
        warn: v("warn"),
        surface: v("surface"),
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 3px)",
        sm: "calc(var(--radius) - 6px)",
      },
      fontFamily: {
        sans: ['"Schibsted Grotesk Variable"', "system-ui", "-apple-system", "sans-serif"],
      },
      // A 1.2 scale from 15px body; line heights tighten as size grows.
      fontSize: {
        xs: ["0.8125rem", { lineHeight: "1.1rem" }],
        sm: ["0.875rem", { lineHeight: "1.25rem" }],
        base: ["0.9375rem", { lineHeight: "1.45rem" }],
        lg: ["1.125rem", { lineHeight: "1.55rem" }],
        xl: ["1.35rem", { lineHeight: "1.75rem" }],
        "2xl": ["1.62rem", { lineHeight: "2rem" }],
        "3xl": ["1.95rem", { lineHeight: "2.3rem" }],
      },
      spacing: {
        "safe-t": "env(safe-area-inset-top)",
        "safe-b": "env(safe-area-inset-bottom)",
        "safe-l": "env(safe-area-inset-left)",
        "safe-r": "env(safe-area-inset-right)",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [animate],
};
