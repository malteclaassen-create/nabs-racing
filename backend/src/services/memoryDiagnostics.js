// ---------------------------------------------------------------------------
// Memory diagnostics — born on race night 2026-08-07, when the deployed
// instance climbed from ~350 MB to over 1 GB across an afternoon and nobody
// could say what the gigabyte WAS. The Railway chart only shows the total
// (RSS); the question that actually locates a leak is which pot is growing:
//
//   heapUsed      — our own JavaScript data (caches, maps, boards). If THIS
//                   grows, the leak is in our code and a heap snapshot will
//                   name the culprit.
//   external /    — buffers and native allocations (sockets, zlib, file
//   arrayBuffers    reads). If RSS grows while heapUsed stays flat, the leak
//                   is native — a heap snapshot will look innocent, and the
//                   suspects are the WebSocket plumbing, compression, or
//                   fragmentation.
//
// Baseline for comparison, measured freshly started on Railway: RSS ~197 MB,
// heapUsed ~25 MB, external ~4 MB. Everything is reported in MB because these
// numbers are read by a human next to a Railway chart, not by a parser.
//
// Two consumers: a [mem] log line every 5 minutes (so the growth curve can be
// reconstructed from the Railway logs after the fact), and the admin Health
// tab (live view + heap snapshot download).
// ---------------------------------------------------------------------------
import v8 from "node:v8";
import { join } from "node:path";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { LOGS_DIR } from "../lib/dataDirs.js";
import { getLiveStats } from "./liveTiming.js";
// Namespace import on purpose: the buffered-bytes getter below is still being
// added to liveTiming.js, and a named import of an export that does not exist
// is a load-time SyntaxError. This module must never be the reason the server
// refuses to start, so it asks the namespace instead of importing by name.
import * as liveTiming from "./liveTiming.js";

const mb = (n) => Math.round((n / 1024 / 1024) * 10) / 10;

// Which V8 space the JS heap actually sits in. heapUsed is one number for
// everything; when it grows, this says whether it is long-lived objects
// (old_space — retained references, i.e. a classic leak) or big buffers and
// oversized arrays that V8 allocates outside the normal pages
// (large_object_space — the shape a growing backlog of unsent boards has).
// Both the used and the committed size are reported: a wide gap between them
// means V8 is holding pages it no longer fills, which shows up as RSS that
// never comes back down even though the leak itself is gone.
// getHeapSpaceStatistics() is a cheap synchronous read of counters V8 keeps
// anyway, and it is only ever called from memoryReport(), so it runs exactly
// as often as the diagnostics already run.
function v8Spaces() {
  try {
    const out = {};
    for (const s of v8.getHeapSpaceStatistics()) {
      if (s.space_name === "old_space") {
        out.oldSpaceUsedMb = mb(s.space_used_size);
        out.oldSpaceCommittedMb = mb(s.space_size);
      } else if (s.space_name === "large_object_space") {
        out.largeObjectUsedMb = mb(s.space_used_size);
        out.largeObjectCommittedMb = mb(s.space_size);
      }
    }
    return out;
  } catch {
    // Space names are not part of Node's stable API surface; if a future
    // runtime renames or drops them, the rest of the report still stands.
    return null;
  }
}

// The bytes ws is holding for viewer sockets that are not reading fast enough.
// This is the prime suspect for a gigabyte that a heap snapshot cannot see, and
// it is the one number nobody had on race night. liveTiming.js owns it; the
// getter is landing there separately and its final name is not fixed yet, so we
// take the first of the agreed candidates that is actually exported. Once the
// name is settled this list can shrink to that one entry.
// Anything at all going wrong here (missing export, a throw inside it) must
// leave the rest of the report intact, hence the try/catch and the null.
const VIEWER_BUFFER_GETTERS = ["getViewerBufferStats", "getBufferedBytes", "getViewerBuffering"];
function viewerBuffers() {
  try {
    for (const name of VIEWER_BUFFER_GETTERS) {
      const fn = liveTiming[name];
      if (typeof fn !== "function") continue;
      // Round-trip through JSON before the value leaves here. The report is
      // JSON.stringify'd for the [mem] line and res.json()'d for the Health
      // card, so a getter that hands back something unserialisable (a Map of
      // sockets, a circular structure, a BigInt) would throw THERE, and in the
      // admin route that means the Health card turns into an error box. Failing
      // in here instead costs one null field and nothing else.
      return JSON.parse(JSON.stringify(fn() ?? null));
    }
    return null;
  } catch {
    return null;
  }
}

export function memoryReport() {
  const m = process.memoryUsage();
  return {
    uptimeHours: +(process.uptime() / 3600).toFixed(1),
    // What the Railway chart shows: the whole process, everything included.
    rssMb: mb(m.rss),
    // Our own JavaScript data…
    heapUsedMb: mb(m.heapUsed),
    heapTotalMb: mb(m.heapTotal),
    // …versus native buffers/connections living outside the JS heap.
    externalMb: mb(m.external),
    arrayBuffersMb: mb(m.arrayBuffers),
    // …and, inside that JS heap, which V8 space is the one growing.
    v8Spaces: v8Spaces(),
    // Live-timing internals: frontend viewer count plus each relay's map sizes.
    // These are the in-memory structures most likely to grow on a race night,
    // so they ride along with every measurement.
    live: getLiveStats(),
    // Unsent bytes queued for viewer sockets (null while liveTiming.js has no
    // getter for it yet).
    viewerBuffers: viewerBuffers(),
  };
}

// One compact log line every 5 minutes. unref() so the timer never keeps the
// process alive on its own (same manners as the reminder tick in index.js).
export function startMemoryLog(intervalMs = 5 * 60 * 1000) {
  setInterval(() => {
    try {
      console.log("[mem]", JSON.stringify(memoryReport()));
    } catch {
      /* diagnostics must never hurt the patient */
    }
  }, intervalMs).unref();
}

// Full V8 heap snapshot written to disk, for offline analysis (Chrome DevTools
// or a script). Two things the caller must know:
//   1. Writing BLOCKS the event loop — the site freezes for seconds (longer
//      when the heap is big). The admin UI warns before triggering it.
//   2. It captures the JS heap only. A snapshot that looks tiny while RSS is
//      huge is itself a finding: the growth is native, not our data.
// Only one snapshot is kept on disk — they are roughly heap-sized, and the
// volume is capped. The admin route streams the file out and deletes it after.
export function writeHeapSnapshotFile() {
  if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });
  for (const old of readdirSync(LOGS_DIR)) {
    if (old.startsWith("heap-") && old.endsWith(".heapsnapshot")) {
      try {
        unlinkSync(join(LOGS_DIR, old));
      } catch {
        /* a stuck old file must not block a fresh snapshot */
      }
    }
  }
  const name = `heap-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.heapsnapshot`;
  const path = join(LOGS_DIR, name);
  v8.writeHeapSnapshot(path);
  return { path, name, size: statSync(path).size };
}
