import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--color-bg)",
        surface: "var(--color-surface)",
        surface2: "var(--color-surface-2)",
        border: "var(--color-border)",
        text: "var(--color-text)",
        muted: "var(--color-muted)",
        positive: "var(--color-positive)",
        negative: "var(--color-negative)",
        purple: "var(--color-purple)",
        green: "var(--color-green)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        mono: ["var(--font-jbmono)", "JetBrains Mono", "monospace"],
      },
      backgroundImage: {
        "icemarkets-gradient": "linear-gradient(90deg, #9945FF, #14F195)",
        "icemarkets-gradient-diag": "linear-gradient(135deg, #9945FF, #14F195)",
      },
      borderRadius: {
        xl2: "1rem",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(153,69,255,0.25), 0 8px 30px rgba(20,241,149,0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
