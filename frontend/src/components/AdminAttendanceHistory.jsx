import { useCallback, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { CardHead, ErrorBox } from "./ui.jsx";

// Admin → Attendance → History: who answered what for the races that have
// already run. Nothing is written here; the sign-ups simply survive the result
// being saved, so this is a straight read of what people said at the time.
//
// The two columns worth having are the ones where the answer and the result
// disagree: someone who accepted and never started took a seat with them, and
// someone who started without answering never appeared in the planning. Both
// are computed server-side by comparing the sign-up against the classification.

const STATUS_LABEL = { ACCEPTED: "In", DECLINED: "Out", TENTATIVE: "Maybe" };
const STATUS_TONE = { ACCEPTED: "text-ok", DECLINED: "text-bad", TENTATIVE: "text-warn" };

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "no date";
}

function RaceRow({ race }) {
  const [open, setOpen] = useState(false);
  const title = race.type === "TRAINING" ? "Training" : `Round ${race.number}`;

  return (
    <li className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 py-3 text-left"
      >
        <div className="min-w-52 flex-1">
          <div className="text-sm font-semibold text-dark">
            {title} · {race.track}
          </div>
          <div className="font-mono text-[11px] uppercase tracking-wider text-light">
            {fmtDate(race.date)} · {race.starters} started
          </div>
        </div>
        <div className="flex gap-3 font-mono text-[11px] font-bold uppercase tracking-wider">
          {["ACCEPTED", "TENTATIVE", "DECLINED"].map((s) => (
            <span key={s} className={race.counts[s] ? STATUS_TONE[s] : "text-faint"}>
              {race.counts[s]} {STATUS_LABEL[s]}
            </span>
          ))}
        </div>
        {/* Only worth a badge when there is something to answer for. */}
        {race.noShows.length > 0 && (
          <span className="rounded-full bg-bad/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-bad">
            {race.noShows.length} no-show{race.noShows.length === 1 ? "" : "s"}
          </span>
        )}
        <svg
          viewBox="0 0 24 24"
          className={`h-4 w-4 shrink-0 text-light transition ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="pb-4">
          <div className="grid gap-4 sm:grid-cols-3">
            {["ACCEPTED", "TENTATIVE", "DECLINED"].map((s) => (
              <div key={s} className="min-w-0">
                <div className={`mb-1.5 font-mono text-[11px] font-bold uppercase tracking-wider ${STATUS_TONE[s]}`}>
                  {STATUS_LABEL[s]} ({race.counts[s]})
                </div>
                {race.rsvps[s].length === 0 ? (
                  <p className="text-sm text-faint">—</p>
                ) : (
                  <ul className="space-y-0.5 text-sm text-medium">
                    {race.rsvps[s].map((d) => (
                      <li key={d.driverId} className="truncate">
                        {d.name}
                        {s === "ACCEPTED" && race.noShows.includes(d.name) && (
                          <span className="ml-1.5 font-mono text-[10px] uppercase tracking-wider text-bad">didn&rsquo;t start</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          {race.unannounced.length > 0 && (
            <p className="mt-3 border-t border-border pt-3 text-sm text-light">
              <span className="font-semibold text-medium">Raced without answering:</span> {race.unannounced.join(", ")}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export default function AdminAttendanceHistory() {
  const { data, loading, error, reload } = useApi(useCallback(() => api.attendanceHistory(), []));
  const races = data?.races || [];

  return (
    <div className="card space-y-4 p-5">
      <CardHead eyebrow="Attendance page" title="Past sign-ups" />
      <p className="text-sm text-light">
        What people answered for the races of this season that have already run, kept exactly as it stood when the
        result was saved. Use the season switcher above to look further back.
      </p>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && <p className="text-sm text-light">Loading…</p>}

      {!loading && !error && races.length === 0 && (
        <p className="text-sm text-light">
          No sign-ups recorded for a finished race in this season yet. A race shows up here once it has both answers and
          a saved result.
        </p>
      )}

      {races.length > 0 && (
        <ul className="-mt-1">
          {races.map((r) => (
            <RaceRow key={r.id} race={r} />
          ))}
        </ul>
      )}
    </div>
  );
}
