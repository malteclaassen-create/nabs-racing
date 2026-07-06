// ---------------------------------------------------------------------------
// Archive helper #1 — list the finished RACE sessions on the Emperor server so
// we can figure out which session belongs to which old-season round.
//
// The server keeps every session ever run but never labels them with a season
// or round number, so this prints them grouped by ISO week + track as a
// checklist. Confirm each league round against the Season-6 ZIP calendar (or
// your memory) and write the chosen ids into backend/archive/season<N>/rounds.json.
//
// Usage:
//   node scripts/archive-emperor-inventory.mjs --from 2025-01-01 --to 2026-03-31
//   node scripts/archive-emperor-inventory.mjs --from 2025-01-01 --detail
//   node scripts/archive-emperor-inventory.mjs --from 2025-01-01 --out ../archive/emperor-inventory.md
//
//   --detail  also downloads each session and prints entrant/racer counts + the
//             winner, which tells a real ~20-40 car league round apart from a
//             practice lobby or random pickup race. (Slower: one request each.)
// ---------------------------------------------------------------------------
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { listRemoteResults, fetchRemoteResult } from "../src/services/emperorResults.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { detail: false, out: null, from: null, to: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--detail") args.detail = true;
    else if (a === "--from") args.from = argv[++i];
    else if (a === "--to") args.to = argv[++i];
    else if (a === "--out") args.out = argv[++i];
  }
  return args;
}

// ISO-8601 week number (Mon-based), e.g. 2025-01-17 -> "2025-W03".
function isoWeek(d) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (date.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  date.setUTCDate(date.getUTCDate() - day + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function fmtWhen(d) {
  return `${WD[d.getUTCDay()]} ${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}Z`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fromTs = args.from ? Date.parse(args.from) : -Infinity;
  const toTs = args.to ? Date.parse(args.to) + 86400000 : Infinity; // inclusive day

  const all = await listRemoteResults({ type: "RACE", limit: 1000 });
  const rows = all
    .filter((r) => r.ts != null && r.ts >= fromTs && r.ts < toTs)
    .sort((a, b) => a.ts - b.ts); // oldest first: reads like a calendar

  const lines = [];
  const push = (s = "") => lines.push(s);
  push(`# Emperor RACE sessions ${args.from || "(start)"} → ${args.to || "(now)"}`);
  push("");
  push(`${rows.length} RACE session(s). Group each league round below; write the`);
  push("chosen ids into backend/archive/season<N>/rounds.json.");
  push("");

  let curWeek = null;
  for (const r of rows) {
    const d = new Date(r.ts);
    const wk = isoWeek(d);
    if (wk !== curWeek) {
      curWeek = wk;
      push("");
      push(`## ${wk}`);
    }
    let extra = "";
    if (args.detail) {
      try {
        const json = await fetchRemoteResult(r.id);
        const result = Array.isArray(json?.Result) ? json.Result : [];
        const racers = result.filter((x) => (x.NumLaps || 0) > 0).length;
        const winner = result.find((x) => (x.NumLaps || 0) > 0)?.DriverName || result[0]?.DriverName || "?";
        extra = `  — ${racers} racers / ${result.length} entries · winner: ${winner}`;
      } catch (e) {
        extra = `  — (download failed: ${e.message})`;
      }
    }
    push(`- [ ] ${fmtWhen(d)} · ${r.trackShort}${extra}`);
    push(`      id: ${r.id}`);
  }

  const text = lines.join("\n") + "\n";
  if (args.out) {
    const outPath = resolve(HERE, args.out);
    writeFileSync(outPath, text, "utf8");
    console.log(`Wrote ${rows.length} sessions to ${outPath}`);
  } else {
    process.stdout.write(text);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
