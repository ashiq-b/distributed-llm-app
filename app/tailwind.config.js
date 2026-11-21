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
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
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
        raised: v("raised"),
        strand: v("strand"),
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 3px)",
        sm: "calc(var(--radius) - 6px)",
      },
      fontFamily: {
        sans: ['"Inter Tight Variable"', "system-ui", "-apple-system", "sans-serif"],
        serif: ['"Newsreader Variable"', "Georgia", "serif"],
      },
      // A 1.2 scale from 16px body (no iOS zoom on inputs); line heights tighten as size grows.
      fontSize: {
        xs: ["0.8125rem", { lineHeight: "1.1rem" }],
        sm: ["0.875rem", { lineHeight: "1.3rem" }],
        base: ["1rem", { lineHeight: "1.5rem" }],
        lg: ["1.125rem", { lineHeight: "1.55rem" }],
        xl: ["1.35rem", { lineHeight: "1.75rem" }],
        "2xl": ["1.5rem", { lineHeight: "1.9rem" }],
        "3xl": ["2.25rem", { lineHeight: "2.5rem" }],
        "4xl": ["2.75rem", { lineHeight: "3rem" }],
      },
      spacing: {
        "safe-t": "var(--inset-top)",
        "safe-b": "var(--inset-bottom)",
        "safe-l": "var(--inset-left)",
        "safe-r": "var(--inset-right)",
      },
      keyframes: {
        sweep: { from: { transform: "translateX(-2.5rem)" }, to: { transform: "translateX(calc(100vw))" } },
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
