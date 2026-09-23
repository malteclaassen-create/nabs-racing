// ---------------------------------------------------------------------------
// The stewarding desk's small rules, kept out of the components so both sides
// of a report read a decision the same way and the filters can be tested
// without a browser.
//
// A penalty has a KIND (backend lib/reports.js). Only TIME ever reaches the
// results editor; a warning, a grid drop or a disqualification is recorded,
// shown to the drivers and carried out by hand, so none of them is ever "not
// yet in results".
// ---------------------------------------------------------------------------

export const PENALTY_KINDS = [
  { key: "TIME", label: "Time penalty" },
  { key: "WARNING", label: "Warning" },
  { key: "GRID", label: "Grid drop" },
  { key: "DSQ", label: "Disqualification" },
];

export const MAX_LICENCE_POINTS = 12;

const DECIDED = ["PENALTY", "NO_PENALTY", "DISMISSED"];

// A decision already read by the server has its kind filled in; one saved
// before kinds existed and not yet re-read is seconds, which is what they all
// were.
const kindOf = (r) => r?.penaltyKind || (r?.status === "PENALTY" ? "TIME" : null);

export const pointsLabel = (n) => `${n} licence point${n === 1 ? "" : "s"}`;

// What a penalty decision amounts to, as short as a pill: "+5s", "Warning",
// "Grid drop", "Disqualified". Null for anything that is not a penalty, and for
// a time penalty with no seconds on it, which says nothing a status pill does
// not already.
export function penaltyLabel(r) {
  if (r?.status !== "PENALTY") return null;
  const kind = kindOf(r);
  if (kind === "WARNING") return "Warning";
  if (kind === "GRID") return "Grid drop";
  if (kind === "DSQ") return "Disqualified";
  return r.penaltySeconds > 0 ? `+${r.penaltySeconds}s` : null;
}

// The same in a sentence's worth, for the line under a verdict: "5s, 2 licence
// points" or "warning". Null when the decision carried nothing to add.
export function penaltySummary(r) {
  if (r?.status !== "PENALTY") return null;
  const label = penaltyLabel(r);
  const parts = [];
  if (label) parts.push(label.startsWith("+") ? label.slice(1) : label.toLowerCase());
  if (r.licencePoints > 0) parts.push(pointsLabel(r.licencePoints));
  return parts.length ? parts.join(", ") : null;
}

// The gap between what the stewards decided and what the results editor has
// written, for a TIME penalty — or null when there is none. The editor fills
// the seconds in when the round is opened (lib/reports.js dbPenaltiesForRace),
// so this is what is still waiting for somebody to open it and save.
//
// A reversal counts as well: seconds written and then taken back by the
// stewards are still in the classification until the editor takes them off.
export function resultsGap(r) {
  if (!r) return null;
  const applied = Math.max(0, r.appliedSeconds || 0);
  const target = r.status === "PENALTY" && kindOf(r) === "TIME" ? Math.max(0, r.penaltySeconds || 0) : 0;
  if (target === applied) return null;
  if (!applied) return `decided +${target}s, not yet in results`;
  if (!target) return `+${applied}s still in results`;
  return `decided +${target}s, results have +${applied}s`;
}

// The list's filters, all at once. `show` is the existing open / decided / all;
// the rest narrow within it:
//   q        a driver's name, either side of the report (reporter or named)
//   raceId   one round; "none" for reports that give no round
//   source   "SITE" or "INGAME"
//   unnamed  only the ones that name nobody yet
export function filterReports(reports, { show = "open", q = "", raceId = "", source = "", unnamed = false } = {}) {
  const needle = String(q || "").trim().toLowerCase();
  return (reports || []).filter((r) => {
    const decided = DECIDED.includes(r.status);
    if (show === "open" && decided) return false;
    if (show === "decided" && !decided) return false;
    if (raceId === "none" ? r.raceId : raceId && r.raceId !== raceId) return false;
    if (source && (r.source || "SITE") !== source) return false;
    if (unnamed && r.accusedDriverId) return false;
    if (needle) {
      const names = `${r.reporterName || ""}\n${r.accusedName || ""}`.toLowerCase();
      if (!names.includes(needle)) return false;
    }
    return true;
  });
}
