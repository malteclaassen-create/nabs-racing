/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Neutral tokens flip between light/dark (see index.css :root / .dark)
        bg: "var(--c-bg)",
        card: "var(--c-card)",
        surface2: "var(--c-surface2)",
        border: "var(--c-border)",
        dark: "var(--c-text)",
        medium: "var(--c-text2)",
        light: "var(--c-text3)",
        faint: "var(--c-faint)",
        // Fixed brand/accent colours (work on both themes)
        primary: { DEFAULT: "#4251A8", dark: "#36418A" },
        ink: "#0F172A", // intentional dark surface (hero, chips)
        gold: "#EAB308",
        silver: "#94A3B8",
        bronze: "#C2410C",
        brand: "#F4AFC6", // NABS pink (from the logo)
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        display: ["Archivo", "Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        card: "0 1px 3px 0 rgba(15,23,42,0.08), 0 1px 2px -1px rgba(15,23,42,0.06)",
        nav: "0 1px 3px 0 rgba(15,23,42,0.06)",
      },
    },
  },
  plugins: [],
};
