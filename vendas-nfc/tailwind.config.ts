import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

// Tokens herdados do design system do RikuAI (rikuai-app/src/index.css).
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        muted: "hsl(var(--foreground-muted))",
        subtle: "hsl(var(--foreground-subtle))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))", dim: "hsl(var(--primary-dim))" },
        surface: { DEFAULT: "hsl(var(--surface))", raised: "hsl(var(--surface-raised))", overlay: "hsl(var(--surface-overlay))" },
        ok: "hsl(var(--success))",
        warn: "hsl(var(--warning))",
        bad: "hsl(var(--danger))",
        neutral: "hsl(var(--neutral))",
        demo: "hsl(var(--demo))",
      },
      fontFamily: { sans: ["Inter", "system-ui", "-apple-system", "sans-serif"] },
      borderRadius: { lg: "1rem", xl: "1.25rem", "2xl": "1.5rem" },
      keyframes: {
        "slide-up": { from: { transform: "translateY(16px)", opacity: "0" }, to: { transform: "translateY(0)", opacity: "1" } },
        "sheet-in": { from: { transform: "translateY(100%)" }, to: { transform: "translateY(0)" } },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        pop: { "0%": { transform: "scale(.9)", opacity: "0" }, "100%": { transform: "scale(1)", opacity: "1" } },
      },
      animation: {
        "slide-up": "slide-up .35s cubic-bezier(.16,.8,.24,1)",
        "sheet-in": "sheet-in .32s cubic-bezier(.16,.8,.24,1)",
        "fade-in": "fade-in .25s ease-out",
        pop: "pop .2s ease-out",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
