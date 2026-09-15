// Derives every accent-colour CSS value the site needs from ONE admin-picked
// hex colour (Series.accentColor). Used instead of a hardcoded CSS rule keyed
// to a series slug — that broke the moment production's real slug differed
// from the one tested locally (a slug guessed ahead of time in the codebase
// vs. whatever the admin actually typed when creating the series).
//
// --c-brand (Tailwind's `brand` token) is the SAME value in light/dark, like
// the default pink. --c-eyebrow/--c-accent stay themed for contrast, exactly
// like the default tokens in index.css: the pale picked colour as-is for dark
// mode, a darkened variant (same hue) for legible text on a light background.

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHsl({ r, g, b }) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return { h, s, l };
}

function hslToRgb({ h, s, l }) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

const triple = ({ r, g, b }) => `${r} ${g} ${b}`;
const toHex = ({ r, g, b }) =>
  `#${[r, g, b].map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0")).join("")}`;

// Relative luminance (WCAG), 0 black .. 1 white.
function luminance({ r, g, b }) {
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// Returns null for an invalid/blank hex (caller then clears the dynamic vars,
// falling back to the default pink baked into index.css).
export function deriveSeriesAccent(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const hsl = rgbToHsl(rgb);
  // Same hue, fixed darker lightness for legible text on a light background;
  // a saturation floor keeps a pale pick from going muddy grey once darkened.
  const dark = hslToRgb({ h: hsl.h, s: Math.max(hsl.s, 0.55), l: 0.38 });
  // The filled buttons: a hover shade one step deeper (the default pink's own
  // step, #f4afc6 -> #ee8bac, is about 8 points of lightness), and the text
  // colour that reads on the fill. Ink beats white once the fill's luminance
  // passes 0.2 — where (L + 0.05)² outgrows 1.05 × 0.058, the two contrast
  // ratios crossing — so a pale accent gets ink, a deep one gets white.
  const hover = hslToRgb({ h: hsl.h, s: hsl.s, l: Math.max(0.1, hsl.l - 0.08) });
  return {
    brandRgb: triple(rgb),
    brandHoverRgb: triple(hover),
    onBrand: luminance(rgb) > 0.2 ? "#0f172a" : "#ffffff",
    eyebrowDarkTheme: toHex(rgb),
    accentDarkThemeRgb: triple(rgb),
    eyebrowLightTheme: toHex(dark),
    accentLightThemeRgb: triple(dark),
  };
}

// The colour the phone's status bar is painted in for a series: its accent
// colour, or the site's default pink (the theme-color index.html ships with).
// The server stamps the same answer into every page it serves (backend
// lib/pageMeta.js, pageThemeColor); this is the client's copy, used to tell
// whether a switch of series changes the bar at all.
export const DEFAULT_THEME_COLOR = "#f4afc6";
export function seriesThemeColor(series) {
  const rgb = hexToRgb(series?.accentColor);
  return rgb ? toHex(rgb) : DEFAULT_THEME_COLOR;
}
