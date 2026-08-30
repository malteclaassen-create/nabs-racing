import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { precompressAssets } from "./scripts/precompress-assets.mjs";

// After the build, lay a .br and a .gz next to every text asset so the server
// can hand out a ready-made compressed file instead of compressing the same
// bundle again for every visitor (see backend/src/index.js). Build-only, and
// deliberately forgiving: a shipped site without .br files is merely as fast as
// before, a failed build is a broken deployment.
function precompressBuildOutput() {
  // Read from the resolved config rather than assuming "dist": that is where
  // the root and outDir are settled, whoever started the build and from where.
  let outDir = "dist";
  return {
    name: "precompress-build-output",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      try {
        const { files } = await precompressAssets(resolve(outDir, "assets"));
        console.log(`precompress: wrote ${files} .br/.gz files`);
      } catch (e) {
        console.warn("precompress skipped:", e?.message || e);
      }
    },
  };
}

// `vite preview` (the shared/tunnelled build) sends no Cache-Control headers by
// itself, so browsers re-ask for every flag/logo/font on each page switch —
// painfully slow over a tunnel where each request costs ~0.5s. This tiny plugin
// adds the same caching rules the backend uses when it serves dist/ itself:
// hashed build assets cache "forever", images/fonts for 7 days, HTML always
// revalidates (so a rebuild shows up immediately). /api stays untouched.
function previewCacheHeaders() {
  return {
    name: "preview-cache-headers",
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || "").split("?")[0];
        if (!url.startsWith("/api/")) {
          if (url.startsWith("/assets/")) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          } else if (/\.(png|jpe?g|webp|svg|gif|ico|woff2?)$/i.test(url)) {
            res.setHeader("Cache-Control", "public, max-age=604800");
          }
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), previewCacheHeaders(), precompressBuildOutput()],
  server: {
    port: 5173,
    host: true, // listen on all interfaces (needed for LAN / tunnels)
    allowedHosts: true, // allow tunnel hostnames (e.g. *.trycloudflare.com)
    proxy: {
      // Proxy API calls to the backend during development.
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        ws: true, // proxy the live-timing WebSocket (/api/live/ws) too
      },
      // The track editor is its own Vite project (track-editor/) and in
      // development it has its own dev server, with its own hot reload. In a
      // BUILT site it is just a folder inside dist/ that Express hands out, so
      // /track-editor/ is the address either way and the card on /tools does
      // not need to know which of the two it is talking to.
      //
      // Only reachable while that second server is actually running:
      //     npm --prefix ../track-editor run dev
      // Without it the proxy has nothing to reach and the page fails to load,
      // which is the honest outcome — the alternative would be this app's own
      // 404, and that reads like the editor was never integrated at all.
      "/track-editor": {
        target: "http://localhost:5199",
        changeOrigin: true,
      },
    },
  },
  // `vite preview` serves the production build with NO HMR websocket — the
  // reliable way to share the site over a quick tunnel (cloudflared/ngrok).
  // It needs its own proxy + allowedHosts (it does not reuse `server`).
  preview: {
    port: 4173,
    host: true,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
