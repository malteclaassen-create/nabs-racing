// ---------------------------------------------------------------------------
// The training week as a bar: laps done on the practice server since the last
// race, with the two milestones marked on it.
//
// One component for the two places that draw it — the points page and the
// panel on the live page — because they are the same fact and a week that
// reads differently in two places is a week nobody trusts.
//
// The bar runs to the FAR milestone, with a notch where the near one sits, so
// the whole week is one shape rather than two bars in a row.
// ---------------------------------------------------------------------------
const fmt = (n) => new Intl.NumberFormat(undefined, { useGrouping: true }).format(n || 0);

export default function TrainingBar({ week, compact = false }) {
  if (!week) return null;
  // Whether the league is paying at all right now: the week says so itself, so
  // the two places that draw it cannot disagree about it.
  const earning = week.paying !== false;
  const target = week.target || 50;
  const laps = week.laps || 0;
  const fill = Math.max(0, Math.min(1, laps / target));
  const tiers = week.tiers || [];

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div className="flex items-baseline gap-2">
          <span className={`font-mono font-bold tabular-nums text-dark ${compact ? "text-2xl" : "text-3xl"}`}>{laps}</span>
          <span className="text-sm text-light">{laps === 1 ? "lap" : "laps"} on the practice server</span>
        </div>
        {/* What the week has actually paid. Nothing has while the counting is
            off, and a green +10 beside "nothing is paid out" is a lie. */}
        {earning && week.earned > 0 && (
          <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-ok">+{fmt(week.earned)}</span>
        )}
      </div>

      <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-surface2">
        <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${fill * 100}%` }} />
        {tiers.slice(0, -1).map((t) => (
          <span
            key={t.laps}
            className="absolute top-0 h-full w-0.5 bg-card"
            style={{ left: `${Math.min(100, (t.laps / target) * 100)}%` }}
          />
        ))}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {tiers.map((t) => (
          <span key={t.laps} className={t.done ? "text-ok" : "text-light"}>
            <span className="font-mono tabular-nums">{t.laps} laps</span> +{fmt(t.points)}
          </span>
        ))}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-light">
        {!earning
          ? "Laps are being counted, but nothing is paid out until the league starts the counting."
          : week.next
            ? `${week.next.toGo} more ${week.next.toGo === 1 ? "lap" : "laps"} for the next ${fmt(week.next.points)}.`
            : "Both milestones are yours for this week. The count starts again after the race."}
      </p>
    </div>
  );
}
