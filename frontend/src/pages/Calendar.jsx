import { PageHeader } from "../components/ui.jsx";
import Flag from "../components/Flag.jsx";
import { circuitFor } from "../data/circuits.js";

// Full Season 7 calendar. SE = Special Event (not a championship round).
const SCHEDULE = [
  { type: "round", number: 1, track: "Melbourne", date: "2026-04-10T18:00:00Z" },
  { type: "round", number: 2, track: "Mugello", date: "2026-04-17T18:00:00Z" },
  { type: "se", track: "Watkins Glen 2.5", date: "2026-04-25T18:00:00Z" },
  { type: "round", number: 3, track: "Most", date: "2026-05-01T18:00:00Z" },
  { type: "round", number: 4, track: "Bahrain", date: "2026-05-08T18:00:00Z" },
  { type: "round", number: 5, track: "Monza", date: "2026-05-15T18:00:00Z" },
  { type: "round", number: 6, track: "Jeddah", date: "2026-05-22T18:00:00Z" },
  { type: "round", number: 7, track: "Nurburgring", date: "2026-05-29T18:00:00Z" },
  { type: "round", number: 8, track: "Spa", date: "2026-06-05T18:00:00Z" },
  { type: "se", track: "NASCAR Oval", date: "2026-06-06T18:00:00Z" },
  { type: "round", number: 9, track: "Imola", date: "2026-06-12T18:00:00Z" },
  { type: "round", number: 10, track: "Turkey", date: "2026-06-19T18:00:00Z" },
  { type: "se", track: "Le Mans 2.5", date: "2026-06-26T18:00:00Z" },
  { type: "round", number: 11, track: "COTA", date: "2026-07-03T18:00:00Z" },
  { type: "round", number: 12, track: "Interlagos", date: "2026-07-10T18:00:00Z" },
];

function fmt(d) {
  return new Date(d).toLocaleDateString("en-GB", {
    weekday: "short", day: "2-digit", month: "long", year: "numeric",
  });
}

function CalendarRow({ e, i, now, nextIdx }) {
  const past = new Date(e.date).getTime() < now;
  const isNext = i === nextIdx;
  const se = e.type === "se";
  const circuit = se ? null : circuitFor(e.track);
  return (
    <li
      className={`flex items-center gap-4 border-b border-border px-5 py-4 last:border-0 transition hover:bg-surface2 ${
        isNext ? "bg-brand/5" : ""
      }`}
    >
      {/* round badge */}
      <div
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl font-display text-lg font-black tabular-nums ${
          se
            ? "bg-emerald-500/15 text-emerald-600"
            : past
            ? "bg-surface2 text-light"
            : "bg-brand/20 text-dark"
        }`}
      >
        {se ? "SE" : e.number}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          {circuit && <Flag code={circuit.country} title={circuit.countryName} />}
          <span
            className={`font-display text-lg font-extrabold uppercase tracking-tight ${
              se ? "text-emerald-600" : "text-dark"
            }`}
          >
            {e.track}
          </span>
          {se && <span className="pill bg-emerald-500/15 text-emerald-600">Special Event</span>}
          {isNext && <span className="pill bg-brand/20 text-dark">Next up</span>}
          {past && <span className="pill bg-surface2 text-light">Done</span>}
        </div>
      </div>

      <div className="shrink-0 text-right">
        <div className="font-mono text-sm font-semibold tabular-nums text-medium">{fmt(e.date)}</div>
        <div className="font-mono text-xs text-light">6:00 PM GMT</div>
      </div>
    </li>
  );
}

export default function Calendar() {
  const now = Date.now();
  // first event still in the future = "next"
  const nextIdx = SCHEDULE.findIndex((e) => new Date(e.date).getTime() >= now);

  // Split into two chronological halves so wide screens read top-to-bottom
  // down the left column, then continue down the right column.
  const half = Math.ceil(SCHEDULE.length / 2);

  return (
    <div>
      <PageHeader
        eyebrow="Schedule"
        title="Season 7 Calendar"
        subtitle="Every championship round and special event. Races run Fridays at 6 PM GMT."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {[SCHEDULE.slice(0, half), SCHEDULE.slice(half)].map((chunk, col) => (
          <div key={col} className="card overflow-hidden self-start">
            <ul>
              {chunk.map((e, j) => {
                const i = col * half + j;
                return <CalendarRow key={i} e={e} i={i} now={now} nextIdx={nextIdx} />;
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
