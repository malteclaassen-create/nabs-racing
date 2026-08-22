// ---------------------------------------------------------------------------
// Which in-game reporters can the contact matcher actually identify?
//
// An in-game report can only be pinned to a contact if its reporter resolves
// to a Steam GUID (lib/reportAnchor.js reporterGuids). This prints every
// INGAME report's name through that exact resolution, then diagnoses each
// failure: no roster driver under that name, a roster row with no Steam id,
// or a name two different people race under (which the matcher deliberately
// refuses to guess at).
//
// Read-only — it writes nothing. Run it on the machine that has the database:
//   node scripts/audit-report-names.mjs
// ---------------------------------------------------------------------------
import prisma from "../src/lib/prisma.js";
import { reporterGuids } from "../src/lib/reportAnchor.js";

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const reports = await prisma.report.findMany({
  where: { source: "INGAME" },
  select: { id: true, raceId: true, reporterName: true, reporterDiscordId: true, incidentAt: true },
  orderBy: { incidentAt: "desc" },
});
if (!reports.length) {
  console.log("No in-game reports in the database.");
  process.exit(0);
}

// With the races the resolver can also fall back to each round's result file,
// which is what production does — so this prints what the matcher truly sees.
const races = await prisma.race.findMany({
  where: { id: { in: [...new Set(reports.map((r) => r.raceId).filter(Boolean))] } },
  select: { id: true, number: true, season: { select: { number: true } } },
});
const resolved = await reporterGuids(prisma, reports, races);

// The same candidates the resolver tries: the full name, and the part after
// the last pipe for anyone racing under a clan tag.
const candidatesOf = (name) => {
  const full = String(name || "");
  const cut = full.lastIndexOf("|");
  return [full, cut === -1 ? "" : full.slice(cut + 1)].map(norm).filter(Boolean);
};

// Why a name failed, worked out against the same roster the resolver reads.
const drivers = await prisma.driver.findMany({ select: { name: true, discordName: true, steamId: true } });
const rows = new Map(); // normalized name -> Set of steamIds ("" for none)
for (const d of drivers) {
  for (const raw of [d.name, d.discordName]) {
    const key = norm(raw);
    if (!key) continue;
    if (!rows.has(key)) rows.set(key, new Set());
    rows.get(key).add(d.steamId || "");
  }
}
const diagnose = (name) => {
  for (const c of candidatesOf(name)) {
    const ids = rows.get(c);
    if (!ids) continue;
    const real = [...ids].filter(Boolean);
    if (real.length > 1) return `ambiguous: ${real.length} different Steam ids race under this name`;
    if (!real.length) return "roster driver exists but has no Steam id (no imported result, no Steam sign-in)";
    return "matches the roster — resolver should have found it (re-check reportAnchor.js)";
  }
  return "no roster driver under this name, and the round's result file could not place it either (no archive for the round, or the name is not in it)";
};

const ok = reports.filter((r) => resolved.has(r.id));
const bad = reports.filter((r) => !resolved.has(r.id));
console.log(`${reports.length} in-game reports: ${ok.length} resolve to a Steam GUID, ${bad.length} do not.\n`);

// One line per distinct failing name, most recent first, with the diagnosis.
const byName = new Map();
for (const r of bad) {
  const key = String(r.reporterName || "(no name)");
  const seen = byName.get(key) || { count: 0, last: null };
  seen.count += 1;
  if (r.incidentAt && (!seen.last || r.incidentAt > seen.last)) seen.last = r.incidentAt;
  byName.set(key, seen);
}
for (const [name, { count, last }] of [...byName.entries()].sort((a, b) => b[1].count - a[1].count)) {
  const when = last ? last.toISOString().slice(0, 10) : "?";
  console.log(`  ✗ "${name}"  (${count} report${count === 1 ? "" : "s"}, last ${when})`);
  console.log(`      ${diagnose(name)}`);
}
if (!bad.length) console.log("Every in-game reporter resolves — unmatched reports are down to the contact window, not names.");

await prisma.$disconnect();
