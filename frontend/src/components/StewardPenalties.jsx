import { CardBar } from "./ui.jsx";

// ---------------------------------------------------------------------------
// What the stewards decided for this round, beside the editor that owns the
// penalty column.
//
// The two are deliberately not the same thing. Deciding "five seconds" in the
// Reports tab does not write five seconds into a classification: two places
// writing the same number eventually disagree, and the one that decides a
// championship has to be the one that was saved on purpose.
//
// What that rule used to cost was memory. An agreed penalty could be forgotten
// between the two screens and nothing would ever say so — the result was just
// quietly wrong. So the editor now types the decided seconds into the column
// itself when a round is opened (see EditResults), and this panel is the
// receipt: for every report that ended in a penalty, whether the seconds are
// actually in the table you are looking at, and whether they have been saved.
//
// It reads the rows being edited, not the saved race, so a number you have just
// typed — or one the editor filled in a second ago — stops nagging immediately.
// ---------------------------------------------------------------------------

// The decided penalties against the rows being edited.
//
// `perDriver` arrives already grouped by driver and added up, which is the
// shape the table has: one penalty cell per driver, and two incidents in one
// race is an ordinary evening. Compared one report at a time, typing five would
// have satisfied both and the second penalty would quietly vanish.
//
// `rows` is the editor's live state, whose penalty field is a string while it
// is being typed.
function match(perDriver, rows) {
  return perDriver.map((g) => {
    const row = rows.find((x) => x.driverId && x.driverId === g.driverId);
    const inTable = row ? Number(row.penaltySeconds) || 0 : null;
    return {
      ...g,
      driverInRace: !!row,
      inTable,
      // In the table is one thing; SAVED is another. A penalty the editor has
      // just filled in reads as done here and is not stored until the button
      // below is pressed, which is exactly why the two are drawn differently.
      done: row != null && inTable >= g.decided,
      saved: g.outstanding === 0,
    };
  });
}

export default function StewardPenalties({ data, rows, prefilled = [], onFill }) {
  const perDriver = (data?.perDriver || []).filter((g) => g.decided > 0 || g.applied > 0);
  if (perDriver.length === 0) return null;

  const checked = match(perDriver, rows || []);
  const missing = checked.filter((c) => c.driverInRace && !c.done).length;
  const unnamed = checked.filter((c) => !c.driverId).length;

  return (
    <div className={`card overflow-hidden ${missing || unnamed ? "border-amber-500/50" : ""}`}>
      <CardBar
        title="Penalties the stewards decided"
        right={
          <span
            className={`font-mono text-[11px] font-bold uppercase tracking-wider ${
              missing ? "text-bad" : "text-ok"
            }`}
          >
            {missing ? `${missing} not in the table` : "all entered"}
          </span>
        }
      />
      {/* What the editor did on its own. A number typed into a table by
          something other than the person looking at it has to say so, and say
          it where the number is — otherwise the first anybody knows about it is
          a championship that moved. */}
      {prefilled.length > 0 && (
        <p className="border-b border-border bg-amber-500/10 px-5 py-3 text-xs leading-relaxed text-medium">
          Filled in for you when this round was opened:{" "}
          {prefilled
            .map((p) => `${p.name} ${p.seconds > 0 ? `+${p.seconds}` : p.seconds}s`)
            .join(", ")}
          . Nothing is stored until you save.
        </p>
      )}
      <ul className="divide-y divide-border">
        {checked.map((c) => (
          <li key={c.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-dark">
              {c.name || "Nobody named"}
              {c.reports.length > 1 && (
                <span className="ml-2 font-mono text-[10px] font-bold uppercase tracking-wider text-light">
                  {c.reports.length} incidents
                </span>
              )}
            </span>
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">
              decided +{c.decided}s
            </span>
            {!c.driverId ? (
              // A penalty against nobody cannot be put on a row. The fix is in
              // the Reports tab, not here.
              <span className="pill bg-amber-500/15 text-bad">names nobody</span>
            ) : !c.driverInRace ? (
              <span className="pill bg-surface2 text-light">not in this result</span>
            ) : c.done ? (
              <span className={`pill ${c.saved ? "bg-emerald-500/15 text-ok" : "bg-sky-500/15 text-link"}`}>
                {c.saved ? `in the table (${c.inTable}s)` : `typed in (${c.inTable}s) — not saved yet`}
              </span>
            ) : (
              <span className="pill bg-red-500/15 text-bad">table says {c.inTable}s</span>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-3">
        {missing > 0 && onFill && (
          <button type="button" className="btn-secondary py-1.5 text-sm" onClick={onFill}>
            Fill them in
          </button>
        )}
        <p className="min-w-40 flex-1 text-xs leading-relaxed text-light">
          Opening a round types the decided seconds into the Penalty column above; saving is what puts them on
          the driver, and what marks them as entered so the next visit leaves them alone. Change a number and
          this keeps up as you type. A penalty against a driver{" "}
          <span className="font-semibold text-medium">nobody named</span> is fixed in the Reports tab, where
          somebody says who it was about.
        </p>
      </div>
    </div>
  );
}
