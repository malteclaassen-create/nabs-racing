// Season Wrapped v2, a lab: a standalone story built into the site's public
// folder as a ready-made page (frontend/public/test/wrapped-v2/), next to the
// first version (test/wrapped/), whose films it plays.
//
//   cd frontend && npx vite build --config labs/wrapped-v2/vite.config.js
//   cd frontend && npx vite --config labs/wrapped-v2/vite.config.js   (dev)
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: here,
  base: "./",
  publicDir: "public",
  build: {
    outDir: fileURLToPath(new URL("../../public/test/wrapped-v2", import.meta.url)),
    emptyOutDir: true,
    // Not "assets": the server keeps anything under an assets path for a year.
    assetsDir: "app",
    target: "es2020",
    chunkSizeWarningLimit: 2000,
  },
  server: {
    // In dev the films come from the first version's folder.
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
  },
});
