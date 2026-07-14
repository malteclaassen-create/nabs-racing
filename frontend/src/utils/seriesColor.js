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

// Returns null for an invalid/blank hex (caller then clears the dynamic vars,
// falling back to the default pink baked into index.css).
export function deriveSeriesAccent(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const hsl = rgbToHsl(rgb);
  // Same hue, fixed darker lightness for legible text on a light background;
  // a saturation floor keeps a pale pick from going muddy grey once darkened.
  const dark = hslToRgb({ h: hsl.h, s: Math.max(hsl.s, 0.55), l: 0.38 });
  return {
    brandRgb: triple(rgb),
    eyebrowDarkTheme: toHex(rgb),
    accentDarkThemeRgb: triple(rgb),
    eyebrowLightTheme: toHex(dark),
    accentLightThemeRgb: triple(dark),
  };
}
