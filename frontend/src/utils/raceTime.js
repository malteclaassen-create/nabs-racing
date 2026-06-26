// Consistent rendering of race start times across the site.
//
// The stored race `date` is the real kickoff instant (the league runs at
// 18:00 GMT). We always format *that* instant in the viewer's own timezone with
// an explicit zone label, so there's a single, unambiguous time everywhere —
// no more mix of hardcoded "18:00 GMT" in some places and an unlabelled local
// "20:00" in others.

// e.g. "20:00 CEST" / "18:00 GMT" depending on the viewer's zone.
export function fmtRaceTime(date) {
  if (!date) return "";
  return new Date(date).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}
