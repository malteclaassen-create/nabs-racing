import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the API runs on :4000 (npm run dev in backend/).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: "http://localhost:4000", ws: true },
    },
  },
});
