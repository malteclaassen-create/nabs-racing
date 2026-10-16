// The race day at a glance, in the same tiles as the countdown under it:
// qualifying on the left, the race (or feature + sprint) on the right.
//
// A tier-split qualifying is ONE session in which Tier 2 has the track first
// and Tier 1 the rest, so it is drawn as two tiles side by side, T2 first,
// each as wide as its share of the session — 12 + 8 reads as a long and a
// short block before anyone reads the numbers. Without a split it is one tile.
//
// Only what the admin entered is shown. A sprint weekend names both races
// even with no distance yet ("TBA"), because "there is a sprint" is the news;
// a normal round with no laps entered shows qualifying alone. Nothing at all
// entered: nothing drawn.

const tileCls = "flex min-w-0 flex-col items-center justify-center rounded-xl bg-ink/[0.06] px-2 py-2.5 dark:bg-white/10";
const valueCls = "font-mono text-2xl font-black leading-none tabular-nums text-ink dark:text-white sm:text-[1.7rem]";
const labelCls = "mt-1.5 max-w-full truncate font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-ink/45 dark:text-white/55";
const captionCls = "mb-1.5 flex items-baseline justify-between gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-ink/55 dark:text-white/60";

function Tile({ value, label, accent = false, style }) {
  return (
    <div className={tileCls} style={style}>
      <span className={`${valueCls} ${accent ? "!text-eyebrow" : ""}`}>{value}</span>
      <span className={labelCls}>{label}</span>
    </div>
  );
}

export default function SessionPlan({ race, className = "" }) {
  if (!race) return null;
  const t2 = race.qualiT2Minutes || 0;
  const t1 = race.qualiT1Minutes || 0;
  const split = t2 > 0 && t1 > 0;
  const qualiTotal = split ? t2 + t1 : race.qualiMinutes || 0;
  const sprint = race.raceFormat === "SPRINT_FEATURE";
  const races = sprint
    ? [
        { key: "feature", value: race.raceLaps || "TBA", label: "Main" },
        { key: "sprint", value: race.sprintLaps || "TBA", label: "Sprint" },
      ]
    : race.raceLaps
      ? [{ key: "race", value: race.raceLaps, label: "Laps" }]
      : [];
  if (!qualiTotal && !races.length) return null;

  return (
    <div className={`flex gap-3 ${className}`}>
      {qualiTotal > 0 && (
        // The wider group: two tiles when split, and the race tiles beside it
        // stay readable at phone width.
        <div className="min-w-0" style={{ flex: `${split ? 2 : 1} 1 0` }}>
          <div className={captionCls}>
            <span>Qualifying</span>
            {split && <span className="text-ink/40 dark:text-white/45">{qualiTotal} min</span>}
          </div>
          {split ? (
            <div className="flex gap-1.5" title={`One session: Tier 2 first (${t2} min), then Tier 1 (${t1} min)`}>
              {/* Proportional, with a floor so a 15 + 5 split still fits its label. */}
              <Tile value={t2} label="T2 min" style={{ flex: `${t2} 1 0`, minWidth: "4.25rem" }} />
              <Tile value={t1} label="T1 min" accent style={{ flex: `${t1} 1 0`, minWidth: "4.25rem" }} />
            </div>
          ) : (
            <Tile value={qualiTotal} label="Min" />
          )}
        </div>
      )}
      {races.length > 0 && (
        <div className="min-w-0" style={{ flex: `${races.length} 1 0` }}>
          <div className={captionCls}>
            <span>{sprint ? "Race laps" : "Race"}</span>
          </div>
          <div className="flex gap-1.5">
            {races.map((r) => (
              <div key={r.key} className="min-w-0 flex-1">
                <Tile value={r.value} label={r.label} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
