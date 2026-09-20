// ---------------------------------------------------------------------------
// The training week as a bar: laps done on the practice server since the last
// race, with the two milestones marked on it.
//
// One component for the two places that draw it — the points page and the
// session card on the live page — because they are the same fact and a week
// that reads differently in two places is a week nobody trusts.
//
// The bar runs to the FAR milestone, with a notch where the near one sits, so
// the whole week is one shape rather than two bars in a row.
//
// Three shapes. The `card` one is the block on the points page. The `row` one
// is a single line for the live page's session card, where it sits under the
// session's own numbers and has to read like one of them: the eyebrow, the
// bar, the count, the two milestones, and nothing else. The `mini` one is a
// thumb-wide bar for that same card while it is FOLDED — no numbers at all,
// just the week filling up out of the corner of your eye. It is drawn at zero
// laps too, because a bar that only appears once you have done something says
// nothing about the thing you have not started yet.
// ---------------------------------------------------------------------------
const fmt = (n) => new Intl.NumberFormat(undefined, { useGrouping: true }).format(n || 0);

export default function TrainingBar({ week, variant = "card" }) {
  if (!week) return null;
  // Whether the league is paying at all right now: the week says so itself, so
  // the two places that draw it cannot disagree about it.
  const earning = week.paying !== false;
  const target = week.target || 50;
  const laps = week.laps || 0;
  const fill = Math.max(0, Math.min(1, laps / target));
  const tiers = week.tiers || [];

  // The marks on the bar: every milestone but the last one, which is the end
  // of the bar itself.
  const notches = tiers.slice(0, -1).map((t) => (
    <span
      key={t.laps}
      className="absolute top-0 h-full w-0.5 bg-card"
      style={{ left: `${Math.min(100, (t.laps / target) * 100)}%` }}
    />
  ));

  if (variant === "mini") {
    return (
      <span
        className="flex w-full items-center gap-2.5"
        title={`Your training: ${laps} of ${target} laps this week`}
      >
        <span className="shrink-0 font-mono text-[10px] uppercase leading-none tracking-wider text-light">Training</span>
        <span className="relative block h-1 flex-1 overflow-hidden rounded-full bg-surface2">
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-brand transition-[width] duration-500"
            style={{ width: `${fill * 100}%` }}
          />
          {notches}
        </span>
      </span>
    );
  }

  if (variant === "row") {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">Your training</span>
        <div className="relative h-1.5 min-w-[6rem] flex-1 overflow-hidden rounded-full bg-surface2">
          <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${fill * 100}%` }} />
          {notches}
        </div>
        <span className="whitespace-nowrap font-mono text-sm font-bold tabular-nums text-dark">
          {laps}
          <span className="font-normal text-light">/{target} laps</span>
        </span>
        <span className="flex flex-wrap items-center gap-x-3 font-mono text-[11px] tabular-nums">
          {tiers.map((t) => (
            <span key={t.laps} className={t.done ? "text-ok" : "text-light"}>
              {t.laps} +{t.points}
            </span>
          ))}
          {!earning && <span className="text-faint">not paying yet</span>}
        </span>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-3xl font-bold tabular-nums text-dark">{laps}</span>
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
        {notches}
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
