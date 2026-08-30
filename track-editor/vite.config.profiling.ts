import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * A second dev server for performance work, on its own port so the one the
 * editor is actually being used on is never restarted by tooling.
 *
 * The one difference to the normal config is the Document-Policy header: it
 * unlocks the JS self-profiling API (`new Profiler(...)`), which is the only
 * way to get real stacks out of a multi-second main-thread block.
 */
export default defineConfig({
  plugins: [react()],
  // Has to match vite.config.ts, or the two dev servers serve the editor at
  // different addresses and every path in this README, in start.cmd and in the
  // profiling notes is right for only one of them.
  base: '/track-editor/',
  server: {
    port: 5299,
    strictPort: true,
    headers: { 'Document-Policy': 'js-profiling' },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
