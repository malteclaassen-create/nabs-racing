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

// Why the stewards decided what they did, picked from a list so both drivers
// read the same plain words. Keep in step with DECISION_REASONS in the
// backend's lib/reports.js. N/A is never shown to the drivers; Other needs the
// note beside it to say anything.
export const DECISION_REASONS = [
  { key: "AVOIDABLE_CONTACT", label: "Avoidable contact" },
  { key: "OFF_TRACK_OVERTAKE", label: "Overtaking off track" },
  { key: "SC_OVERTAKE", label: "Overtaking under safety car" },
  { key: "UNSAFE_REJOIN", label: "Unsafe rejoin" },
  { key: "RACING_INCIDENT", label: "Racing incident" },
  { key: "NA", label: "N/A" },
  { key: "OTHER", label: "Other" },
];

// Why the driver who filed a report took it back. Same as WITHDRAW_REASONS in
// the backend's lib/reports.js.
export const WITHDRAW_REASONS = [
  { key: "SORTED", label: "Sorted it out with the driver" },
  { key: "MISTAKE", label: "Filed by mistake" },
  { key: "RACING_INCIDENT", label: "Watched it back, it was a racing incident" },
  { key: "OTHER", label: "Other" },
];

// Does this outcome take a reason? Only an actual decision does.
export const takesReason = (status) => status === "PENALTY" || status === "NO_PENALTY";

// The reason as the drivers read it, or null when there is nothing to show.
export function reasonLabel(r) {
  if (!takesReason(r?.status) || !r?.decisionReason) return null;
  if (r.decisionReason === "NA" || r.decisionReason === "OTHER") return null;
  return DECISION_REASONS.find((x) => x.key === r.decisionReason)?.label || null;
}

// Why a withdrawn report was taken back, in words: the note for Other, the
// reason with the note after it otherwise. Null for a report never withdrawn.
export function withdrawText(r) {
  if (!r?.withdrawnAt) return null;
  const label = WITHDRAW_REASONS.find((x) => x.key === r.withdrawReason)?.label || null;
  if (r.withdrawReason === "OTHER" || !label) return r.withdrawNote || label || null;
  return r.withdrawNote ? `${label}. ${r.withdrawNote}` : label;
}

// Withdrawn is stored as closed (DISMISSED) so every list keeps treating it as
// finished; this is what tells the two apart on screen.
export const isWithdrawn = (r) => r?.status === "DISMISSED" && !!r?.withdrawnAt;

// What a decision form may not be saved without: a reason on a penalty or a
// no-penalty, and words when that reason is Other. Null when it is fine.
export function decisionProblem(draft) {
  if (!takesReason(draft?.status)) return null;
  if (!draft.decisionReason) return "Pick a reason first.";
  if (draft.decisionReason === "OTHER" && !String(draft.verdict || "").trim()) {
    return "Other needs a line saying why.";
  }
  return null;
}

const DECIDED = ["PENALTY", "NO_PENALTY", "DISMISSED"];

// A decision already read by the server has its kind filled in; one saved
// before kinds existed and not yet re-read is seconds, which is what they all
// were.
const kindOf = (r) => r?.penaltyKind || (r?.status === "PENALTY" ? "TIME" : null);

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

// The same in a sentence's worth, for the line under a verdict: "5s" or
// "warning". Null when the decision carried nothing to add.
export function penaltySummary(r) {
  const label = penaltyLabel(r);
  if (!label) return null;
  return label.startsWith("+") ? label.slice(1) : label.toLowerCase();
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
