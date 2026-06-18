import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
