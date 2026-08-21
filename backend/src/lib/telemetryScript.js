// ---------------------------------------------------------------------------
// The served recorder script, and its version.
//
// The version exists because of what was learned the night the recorder went
// quiet: CSP caches a downloaded online script on the driver's disk KEYED BY
// URL, for two weeks or more, and a rejoin does not re-fetch — no response
// header changes that. The only guaranteed way to put a new recorder into a
// car that holds an old one is to change the URL itself. So the URL carries
// &v=<hash of this file>: the moment the script changes, the admin card's
// snippet changes with it, and pasting the new line into the race server's
// config is what busts every driver's cache at their next join.
//
// Read once per process: the file only changes with a deploy, and a deploy
// restarts the process.
// ---------------------------------------------------------------------------
import { readFileSync } from "fs";
import { createHash } from "crypto";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

let cached = null;
export function telemetryScript() {
  if (!cached) {
    const src = readFileSync(join(__dir, "telemetryOnlineScript.lua"), "utf8");
    // Eight hex chars: enough that two script versions never collide in
    // practice, short enough to read off a config line over voice chat.
    cached = { src, version: createHash("sha1").update(src).digest("hex").slice(0, 8) };
  }
  return cached;
}
