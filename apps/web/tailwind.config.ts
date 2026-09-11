import type { Config } from "tailwindcss";

/**
 * Glacier tokens. Colors mirror :root in app/globals.css — see docs/DESIGN.md.
 * Panel surfaces are the `.glass` / `.glass-strong` component classes, not utilities.
 */
const config: Config = {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ground: "var(--ground)",
        bg: "var(--ground)",
        text: "var(--text)",
        muted: "var(--muted)",
        body: "var(--body)",
        dim: "var(--dim)",
        positive: "var(--positive)",
        negative: "var(--negative)",
        green: "var(--positive)",
        purple: "var(--purple)",
        lavender: "var(--lavender)",
        hairline: "var(--hairline)",
        border: "var(--hairline)",
      },
      fontFamily: {
        display: ["var(--font-display)", "Sora", "Manrope", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "Manrope", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "ui-monospace", "monospace"],
      },
      backgroundImage: {
        "ice-gradient": "linear-gradient(90deg, #9945FF, #14F195)",
        "ice-gradient-diag": "linear-gradient(135deg, #9945FF, #14F195)",
      },
      borderRadius: {
        glass: "20px",
        chip: "999px",
      },
      boxShadow: {
        glass: "inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -1px 0 rgba(0,0,0,0.25), 0 24px 60px rgba(0,0,0,0.45)",
        "glass-strong": "inset 0 1px 0 rgba(255,255,255,0.20), 0 30px 80px rgba(0,0,0,0.5)",
        gradient: "0 10px 30px rgba(153,69,255,0.35), inset 0 1px 0 rgba(255,255,255,0.35)",
      },
    },
  },
  plugins: [],
};

export default config;
