import { useCallback } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { CardBar } from "./ui.jsx";

// ---------------------------------------------------------------------------
// What the stewards decided for this round, shown beside the editor that owns
// the penalty column.
//
// It is here because of a deliberate gap: deciding "five seconds" in the
// Reports tab does NOT write five seconds into the classification. Two places
// writing the same number eventually disagree, and the one that decides a
// championship has to be the one a human typed. The cost of that rule is that
// an agreed penalty can be forgotten between the two screens, and nothing would
// ever say so — the result would just be quietly wrong.
//
// So this compares the two: for every report that ended in a penalty, it shows
// whether the seconds are actually in the table you are looking at. It reads
// the rows being edited, not the saved race, so an entry you have just typed
// stops nagging immediately.
// ---------------------------------------------------------------------------

// Each decided penalty against the row for that driver. `rows` is the editor's
// live state, whose penalty field is a string while it is being typed.
function match(decided, rows) {
  return decided.map((r) => {
    const row = rows.find((x) => x.driverId && x.driverId === r.accusedDriverId);
    const inTable = row ? Number(row.penaltySeconds) || 0 : null;
    return {
      ...r,
      driverInRace: !!row,
      inTable,
      done: row != null && r.penaltySeconds != null && inTable >= r.penaltySeconds,
    };
  });
}

export default function StewardPenalties({ raceId, rows }) {
  const { data } = useApi(
    useCallback(() => (raceId ? api.raceReportPenalties(raceId) : Promise.resolve({ decided: [] })), [raceId])
  );

  const decided = data?.decided || [];
  // Only the ones that mean work. "No penalty" and "closed" are decisions the
  // results editor has nothing to do about, and listing them here would bury
  // the two lines that do need typing.
  const penalties = decided.filter((r) => r.status === "PENALTY" && (r.penaltySeconds ?? 0) > 0);
  if (penalties.length === 0) return null;

  const checked = match(penalties, rows || []);
  const missing = checked.filter((c) => !c.done).length;

  return (
    <div className={`card overflow-hidden ${missing ? "border-amber-500/50" : ""}`}>
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
      <ul className="divide-y divide-border">
        {checked.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-dark">
              {c.accusedName || "Nobody named"}
            </span>
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">
              decided +{c.penaltySeconds}s
            </span>
            {!c.driverInRace ? (
              <span className="pill bg-surface2 text-light">not in this result</span>
            ) : c.done ? (
              <span className="pill bg-emerald-500/15 text-ok">in the table ({c.inTable}s)</span>
            ) : (
              <span className="pill bg-red-500/15 text-bad">
                table says {c.inTable}s
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="border-t border-border px-5 py-3 text-xs leading-relaxed text-light">
        Deciding a penalty in Reports never writes it into a classification, on purpose. Type it into the
        Penalty column above and save, and this turns green. It reads what you have typed, not what is saved,
        so it keeps up as you go.
      </p>
    </div>
  );
}
