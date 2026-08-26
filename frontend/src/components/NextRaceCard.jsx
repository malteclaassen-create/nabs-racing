import { Link } from "react-router-dom";
import Flag from "./Flag.jsx";
import CircuitMap from "./CircuitMap.jsx";
import RaceCountdown from "./RaceCountdown.jsx";
import { circuitFor, flagFor } from "../data/circuits.js";
import { fmtRaceTime } from "../utils/raceTime.js";
import { sessionSummary } from "../utils/raceFormat.js";

// ---------------------------------------------------------------------------
// The next round, as a card: country, round number, the circuit's outline, the
// track name, a countdown, the date and a way in.
//
// Lives here rather than inside the Home hero because it is now in two heroes.
// A newcomer landing on the welcome page and a member landing on the home page
// want the same answer to the same question, and two copies of this markup
// would be two answers within a week of the first change to either.
// ---------------------------------------------------------------------------

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// Box for a circuit watermark, derived from the track's own proportions. The
// league's outlines run from a 2.1:1 sprawl (Miami) to a 1:3 sliver (Jeddah),
// and one fixed box would draw the wide ones large and the narrow ones tiny,
// since each outline is fitted inside whatever box it gets. Equal AREA instead,
// so every track carries about the same weight, then clamped so the mark stays
// inside the space it was given.
export const MARK_AREA = 6700; // px², about 100x67 for a typical layout

// `area`, the clamps and `rotateBelow` are overridable because this card gives
// the outline a band of its own rather than tucking it into a corner: it is
// wider, shorter, and lays every portrait track down.
export function circuitMark(track, { area = MARK_AREA, maxW = 120, maxH = 100, rotateBelow = 0.5 } = {}) {
  const c = circuitFor(track);
  if (!c) return null;
  const [, , w, h] = String(c.box || "0 0 100 100").split(/\s+/).map(Number);
  let aspect = w > 0 && h > 0 ? w / h : 1;
  // A track taller than its slot is wide comes out as a thin scratch however
  // much area it is given, because the area has nowhere to go. Those lie down,
  // the same move the admin can make per track for the race pages. Where the
  // cutoff sits depends on the slot: a squarish corner only needs to turn the
  // extremes (Jeddah is 1:3, Montreal and Watkins Glen close behind), a wide
  // band turns everything portrait. CircuitMap grows its viewBox to the rotated
  // bounds, so nothing clips.
  const rotate = aspect < rotateBelow ? 90 : 0;
  if (rotate) aspect = 1 / aspect;
  const height = Math.sqrt(area / aspect);
  const width = aspect * height;
  const fit = Math.min(1, maxW / width, maxH / height);
  return { rotate, style: { width: Math.round(width * fit), height: Math.round(height * fit) } };
}

export default function NextRaceCard({ race, className = "", style = null }) {
  if (!race) return null;

  const circuit = flagFor(race.track, race.country);
  const date = race.date ? new Date(race.date) : null;
  const mark = race.track ? circuitMark(race.track, { area: 14000, maxW: 236, maxH: 92, rotateBelow: 1 }) : null;

  return (
    <div
      className={`rounded-2xl border border-black/10 bg-white/75 p-5 shadow-xl shadow-ink/10 backdrop-blur-md dark:border-white/10 dark:bg-white/[0.08] ${className}`}
      style={style}
    >
      <div className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-sky-600 dark:text-sky-300">
        {circuit && <Flag code={circuit.country} title={circuit.countryName} w={22} h={16} />}
        <span>Next Race</span>
        {/* Trainings have no round number but still are the next race —
            an unlabeled corner would read like a missing number. */}
        <span className="ml-auto text-ink/40 dark:text-white/50">
          {race.number != null ? `Round ${race.number}` : race.type === "TRAINING" ? "Training" : "Event"}
        </span>
      </div>

      {/* The circuit gets a band of its own between the label and the name: the
          card grows by exactly the drawing's height, and the outline never has
          to share space with the letters. Centred and near full width, because
          every other block in this card (name, countdown, button) runs the full
          width too — pinned to one side it left half the band empty. */}
      {mark && (
        <div className="mt-4 flex justify-center" aria-hidden="true">
          <div
            className="pointer-events-none text-ink opacity-[0.16] dark:text-white dark:opacity-[0.22]"
            style={mark.style}
          >
            <CircuitMap
              track={race.track}
              animate
              rotate={mark.rotate}
              className="h-full w-full"
              stroke="currentColor"
              strokeWidth={2}
            />
          </div>
        </div>
      )}

      <div className="mt-4 break-words font-display text-2xl font-black uppercase leading-[1.05] tracking-tight text-ink dark:text-white sm:text-3xl">
        {race.track}
      </div>
      {/* skip the circuit line when it just repeats the race name (e.g. race
          "Interlagos" at circuit "Interlagos") */}
      {circuit && circuit.circuit?.toLowerCase() !== race.track?.toLowerCase() && (
        <div className="mt-2 font-mono text-[11px] uppercase tracking-wider text-ink/60 dark:text-white/65">
          {circuit.circuit}
        </div>
      )}
      {/* The session line — on a sprint weekend "there is a sprint" is exactly
          what this card exists to announce. Same wording as the sign-up page. */}
      {sessionSummary(race).length > 0 && (
        <div className="mt-2 font-mono text-[11px] font-bold uppercase tracking-wider text-ink/60 dark:text-white/65">
          {sessionSummary(race).join(" · ")}
        </div>
      )}

      <RaceCountdown date={race.date} className="mt-5" />

      {date && (
        <div className="mt-3 flex items-center justify-center gap-2 font-mono text-[11px] uppercase tracking-wider text-ink/65 dark:text-white/70">
          <span className="font-bold text-ink/80 dark:text-white/85">
            {date.getDate()} {MONTHS[date.getMonth()]}
          </span>
          <span className="h-3 w-px bg-ink/20 dark:bg-white/25" />
          <span>{fmtRaceTime(race.date)}</span>
        </div>
      )}

      <Link
        to={`/attendance?race=${race.id}`}
        className="shine group mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-ink transition hover:brightness-105"
      >
        Sign Up
        <span className="transition group-hover:translate-x-0.5">→</span>
      </Link>
    </div>
  );
}
