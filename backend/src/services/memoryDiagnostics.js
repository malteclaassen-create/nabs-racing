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

const mb = (n) => Math.round((n / 1024 / 1024) * 10) / 10;

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
    // Live-timing internals: frontend viewer count plus each relay's map sizes.
    // These are the in-memory structures most likely to grow on a race night,
    // so they ride along with every measurement.
    live: getLiveStats(),
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
