import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
  plugins: [react(), previewCacheHeaders()],
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
