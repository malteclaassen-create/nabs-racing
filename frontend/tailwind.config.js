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
        // Brand accent (NABS pink by default). Raw RGB triple with alpha support
        // (brand/20 etc.), driven by --c-brand so a series can override it — see
        // the [data-series] block in index.css.
        brand: "rgb(var(--c-brand) / <alpha-value>)",
        // Eyebrow/mono-label text: readable rose in light mode, brand pink in
        // dark mode (see --c-eyebrow in index.css).
        eyebrow: "var(--c-eyebrow)",
        // Same theme-aware pink but with alpha support (accent/40 etc.) for
        // borders and fills that wash out on white (see --c-accent).
        accent: "rgb(var(--c-accent) / <alpha-value>)",
        // Status colours as TEXT, theme-aware (see --c-link/--c-ok/… in
        // index.css). `primary` above stays fixed because it also fills buttons
        // that carry white text; these are for writing ON a card, where one
        // fixed value cannot satisfy both themes. Alpha works too, so the tinted
        // pill behind the label recolours with it (bg-ok/15 text-ok).
        link: "rgb(var(--c-link) / <alpha-value>)",
        ok: "rgb(var(--c-ok) / <alpha-value>)",
        bad: "rgb(var(--c-bad) / <alpha-value>)",
        warn: "rgb(var(--c-warn) / <alpha-value>)",
        fl: "rgb(var(--c-fl) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        display: ["Archivo", "Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        // Was a fixed light-mode shadow, which is why ~60 places reached past it
        // for Tailwind's shadow-lg/xl/2xl instead — all of them equally invisible
        // on the dark card. These point at the same per-theme tokens the .card
        // class uses (--c-shadow in index.css), so one elevation works in both.
        card: "var(--c-shadow)",
        lift: "var(--c-shadow-lift)",
        nav: "0 1px 3px 0 rgba(15,23,42,0.06)",
      },
      // The motion scale from index.css, made reachable from JSX. It was five
      // documented durations and five curves that no component could actually
      // use: Tailwind's theme never exposed them, so ~290 `transition` classes
      // silently ran at its own 150ms/ease, plus scattered duration-200/300/500.
      // Six speeds where the design system defines five. Now `duration-base` and
      // `ease-out-soft` resolve to the same values the CSS animations use.
      transitionDuration: {
        // The ~290 bare `transition` classes are almost all hover states, which
        // the scale calls --t-quick (140ms). Tailwind's own default is 150ms, so
        // pointing DEFAULT at the token moves every one of them onto the system
        // and changes what you see by ten milliseconds, i.e. nothing. Same idea
        // for the curve below: --e-soft and Tailwind's default differ by 0.1 in
        // one control point.
        DEFAULT: "var(--t-quick)",
        quick: "var(--t-quick)",
        base: "var(--t-base)",
        slow: "var(--t-slow)",
        tell: "var(--t-tell)",
        draw: "var(--t-draw)",
      },
      transitionTimingFunction: {
        DEFAULT: "var(--e-soft)",
        "out-soft": "var(--e-out)",
        draw: "var(--e-draw)",
        soft: "var(--e-soft)",
        pop: "var(--e-pop)",
        "in-fast": "var(--e-in)",
      },
      animation: {
        // Same for keyframe animations declared inline.
        "spin-slow": "spin var(--t-draw) linear infinite",
      },
    },
  },
  plugins: [],
};
