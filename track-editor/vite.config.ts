import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error -- plain JS plugin, no types needed for a dev only bridge.
import { acBridge } from './tools/acBridge.mjs';

export default defineConfig({
  plugins: [react(), acBridge()],
  // The editor is not the site's root: it is served by the league's own Express
  // process under /track-editor (backend/src/index.js). Vite rewrites the asset
  // URLs in index.html and the font urls in the CSS from this, so the bundle
  // asks for /track-editor/assets/... instead of /assets/... -- the latter
  // would collide with the website's own build output, which sits one level up
  // in the same dist folder. Anything referenced from TSX by hand has to use
  // import.meta.env.BASE_URL itself (see ui/TopBar.tsx, ui/StartDialog.tsx).
  base: '/track-editor/',
  server: {
    port: 5199,
    strictPort: false,
    // Lets the page profile itself, which is how the flight recorder gets the
    // call stack of a frozen frame. Without it `new Profiler()` throws.
    headers: { 'Document-Policy': 'js-profiling' },
  },
  // Plain `dist`, inside this project, where Vite puts it by default. The
  // backend mounts this folder at /track-editor (backend/src/index.js).
  //
  // It was briefly built straight into frontend/dist/track-editor instead,
  // which sounds tidier -- one folder, one static handler, no second mount --
  // and is a trap. The website's own build EMPTIES frontend/dist before it
  // writes, so the editor had to be rebuilt after every frontend build or it
  // silently vanished, and the two were welded into one fixed order for good.
  // Keeping the output here costs six lines in the backend and buys back the
  // ability to build either project on its own.
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
