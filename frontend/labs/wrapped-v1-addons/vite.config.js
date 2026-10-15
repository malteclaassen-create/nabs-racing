// Parts of Season Wrapped v2 for the first test page (test/wrapped): one
// script, app/addons.js, that the page loads next to its own bundle and
// that steps in on four slides (see src/addons.js).
//
//   cd frontend && npx vite build --config labs/wrapped-v1-addons/vite.config.js
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: false,
  build: {
    outDir: fileURLToPath(new URL("../../public/test/wrapped/app", import.meta.url)),
    // That folder holds the page's own bundle too: add, never empty it.
    emptyOutDir: false,
    target: "es2020",
    chunkSizeWarningLimit: 2000,
    // One script with a fixed name (an app build, so it is fully minified).
    modulePreload: false,
    rollupOptions: {
      input: fileURLToPath(new URL("src/addons.js", import.meta.url)),
      output: { entryFileNames: "addons.js", inlineDynamicImports: true },
    },
  },
});
