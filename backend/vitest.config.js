import { defineConfig } from "vitest/config";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point every data directory (lib/dataDirs.js) at a throwaway location while
// tests run. Without this, any service a test touches writes into the REAL
// working tree — discovered when the live-timing tests started leaving pit
// recordings under backend/live-pits/test/ the moment the pit recorder was
// wired into ingestSnapshot. Services must stay writable by default (a
// recorder that needs opting in misses race night); tests opt out here
// instead, once, for all of them.
export default defineConfig({
  test: {
    env: {
      DATA_DIR: join(tmpdir(), "nabs-racing-test-data"),
    },
  },
});
