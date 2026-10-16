// The race day in one line of text, e.g.
//   QUALI  T2 12 MIN → T1 8 MIN  ·  RACE 25 LAPS
//
// A tier-split qualifying is ONE session in which Tier 2 has the track first
// and Tier 1 the rest, so the two halves are joined by an arrow in that
// order. Labels are muted and the numbers carry the line, so it scans at a
// glance. Each part keeps together (no wrap inside "T2 12 MIN"); the line
// itself wraps between parts on a narrow phone.
//
// Only what the admin entered is shown. A sprint weekend names both races
// even with no distance yet ("TBA"), because "there is a sprint" is the news.
// Nothing at all entered: nothing drawn. The caller sets size and colour.

function Part({ label, children }) {
  return (
    <span className="whitespace-nowrap">
      <span className="opacity-60">{label}</span> {children}
    </span>
  );
}

export default function SessionPlan({ race, className = "" }) {
  if (!race) return null;
  const t2 = race.qualiT2Minutes || 0;
  const t1 = race.qualiT1Minutes || 0;
  const split = t2 > 0 && t1 > 0;
  const quali = race.qualiMinutes || 0;
  const sprint = race.raceFormat === "SPRINT_FEATURE";
  const laps = (n) => (n ? `${n} laps` : "TBA");

  const parts = [];
  if (split) {
    parts.push(
      <Part key="q" label="Quali">
        T2 {t2} min <span className="opacity-60">→</span> T1 {t1} min
      </Part>
    );
  } else if (quali) {
    parts.push(
      <Part key="q" label="Quali">
        {quali} min
      </Part>
    );
  }
  if (sprint) {
    parts.push(
      <Part key="m" label="Main">
        {laps(race.raceLaps)}
      </Part>,
      <Part key="s" label="Sprint">
        {laps(race.sprintLaps)}
      </Part>
    );
  } else if (race.raceLaps) {
    parts.push(
      <Part key="r" label="Race">
        {laps(race.raceLaps)}
      </Part>
    );
  }
  if (!parts.length) return null;

  return (
    <div className={`font-mono text-[11px] font-bold uppercase leading-relaxed tracking-wider ${className}`}>
      {parts.map((p, i) => (
        <span key={p.key}>
          {/* Real spaces around the dot: they are where the line may break. */}
          {i > 0 && (
            <>
              {" "}
              <span className="opacity-40">·</span>{" "}
            </>
          )}
          {p}
        </span>
      ))}
    </div>
  );
}
