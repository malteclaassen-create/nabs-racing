// Vite config for the recap preview. Root is harness/; the page and every
// component come straight from the site's own frontend/src,
// with the site's own Tailwind config and global CSS. Dependencies resolve
// through frontend/node_modules (run `npm install` in frontend/ once).
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import siteTailwind from "../../tailwind.config.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, "../.."); // frontend/
const SITE_SRC = resolve(SITE, "src");
const HARNESS = resolve(HERE, "harness");

// The site serves its pictures from its own root (/flags/…, /teams/…,
// /nabs-star.webp). An Artifact page lives under somebody else's root, so the
// components' absolute paths are made relative at build time. The source files
// themselves are not touched.
const PUBLIC_DIRS = ["flags", "teams", "nabs-star", "nabs-points", "maps", "cards", "cars", "heroes", "shop", "textures"];
function relativePublicPaths() {
  const re = new RegExp(`(["'\`(])\\/(${PUBLIC_DIRS.join("|")})(?=[/.\\-])`, "g");
  return {
    name: "relative-public-paths",
    enforce: "pre",
    transform(code, id) {
      if (!id.startsWith(SITE_SRC) || !/\.(jsx?|mjs)$/.test(id)) return null;
      const out = code.replace(re, "$1./$2");
      return out === code ? null : { code: out, map: null };
    },
  };
}

export default defineConfig({
  root: HARNESS,
  base: "./",
  publicDir: resolve(HARNESS, "public"), // filled by build.mjs with only what the page shows
  plugins: [relativePublicPaths(), react()],
  resolve: {
    alias: [
      // Every `../api/client.js` (the page, the series context) gets the mock.
      { find: /^(\.{1,2}\/)+api\/client\.js$/, replacement: resolve(HARNESS, "mockClient.js") },
      { find: "@site", replacement: SITE_SRC },
    ],
  },
  css: {
    postcss: {
      plugins: [
        tailwindcss({
          ...siteTailwind,
          // The site's own content globs, made absolute (Tailwind reads them
          // against the working directory otherwise).
          content: [resolve(SITE, "index.html"), `${SITE_SRC}/**/*.{js,jsx}`, `${HARNESS}/**/*.{js,jsx,html}`],
        }),
        autoprefixer(),
      ],
    },
  },
  server: {
    port: 8851,
    fs: { allow: [HERE] },
  },
  build: {
    outDir: resolve(HERE, "dist"),
    emptyOutDir: true,
    assetsDir: "app",
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
  logLevel: "warn",
});
