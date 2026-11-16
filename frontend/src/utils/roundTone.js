// The colour of one round in a season strip: a medal for the podium, the
// accent at full strength for a scoring finish and pale for a finish that
// paid nothing, grey for a retirement, and nothing at all (null) for a round
// not started. Shared by the career page and the season review, so the same
// round reads the same colour on both.
import { MEDAL } from "../components/ui.jsx";

export function roundTone(r) {
  // A round the person was entered for but did not take: an empty slot, so the
  // strip still shows the gap in the season rather than hiding it.
  if (r.status === "DNS") return null;
  if (r.status !== "FINISHED" || r.position == null) return "var(--c-faint)";
  if (r.position <= 3) return MEDAL[r.position - 1];
  // One colour, two strengths: a scoring finish reads solid, a finish that
  // paid nothing is the same square gone pale.
  if ((r.points ?? 0) > 0) return "rgb(var(--c-accent) / 0.7)";
  return "rgb(var(--c-accent) / 0.22)";
}
