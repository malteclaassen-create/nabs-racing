// Consistent rendering of race start times across the site.
//
// The stored race `date` is the real kickoff instant (the league runs at
// 18:00 GMT). We always format *that* instant in the viewer's own timezone with
// an explicit zone label, so there's a single, unambiguous time everywhere —
// no more mix of hardcoded "18:00 GMT" in some places and an unlabelled local
// "20:00" in others.

// The corrected kickoff instant for a stored race date. Older/date-only entries
// land on UTC midnight, so we fall back to the league's 18:00 GMT start for
// those; real timestamps are returned untouched.
export function raceTarget(date) {
  if (!date) return null;
  const d = new Date(date);
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 18, 0, 0));
  }
  return d;
}

// e.g. "20:00 CEST" / "18:00 GMT" depending on the viewer's zone.
export function fmtRaceTime(date) {
  if (!date) return "";
  return new Date(date).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}
