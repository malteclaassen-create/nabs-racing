import { Link } from "react-router-dom";
import { TeamDot } from "./ui.jsx";
import SeatMarket from "./SeatMarket.jsx";
import Flag from "./Flag.jsx";
import { countryFor } from "../data/driverCountries.js";

// Quiet by default, colour only where it means something: the three answer
// buttons are neutral outlines with a tinted icon, and fill with their status
// colour once picked. The race identity itself lives in the hero above this
// card on the Attendance page, so the header only carries the question.
const STATUS_UI = {
  ACCEPTED: {
    label: "Accept",
    title: "Accepted",
    icon: "M4.5 12.5l5 5L19.5 7",
    idle: "border-border bg-card text-medium hover:border-green-600/60 hover:text-dark",
    idleIcon: "text-green-600",
    active: "border-green-600 bg-green-600 text-white",
    bar: "bg-green-600",
  },
  DECLINED: {
    label: "Decline",
    title: "Declined",
    icon: "M6 6l12 12M18 6L6 18",
    idle: "border-border bg-card text-medium hover:border-red-600/60 hover:text-dark",
    idleIcon: "text-red-600",
    active: "border-red-600 bg-red-600 text-white",
    bar: "bg-red-600",
  },
  TENTATIVE: {
    label: "Tentative",
    title: "Tentative",
    icon: "M9 9.2a3 3 0 115.4 1.8c-.8 1-2.4 1.5-2.4 3M12 17.5h.01",
    idle: "border-border bg-card text-medium hover:border-amber-500/60 hover:text-dark",
    idleIcon: "text-amber-500",
    active: "border-amber-500 bg-amber-500 text-white",
    bar: "bg-amber-500",
  },
};

function StatusIcon({ d, className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={`h-4 w-4 ${className}`} fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

// One upcoming race: attendance buttons (when signed in) + the three status
// columns + the embedded Driver Market. State/actions are owned by the parent.
export default function RaceSignupCard({
  ev,
  marketRace,
  me,
  reloadMarket,
  driverId,
  canSignUp,
  busy,
  onSetStatus,
  onClear,
}) {
  const myStatus = ["ACCEPTED", "DECLINED", "TENTATIVE"].find((s) =>
    ev.rsvps[s].some((r) => r.driverId === driverId)
  );
  const capacity = ev.capacity ?? 40;
  const accepted = ev.rsvps.ACCEPTED.length;

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border px-5 py-4">
        <div>
          <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-light">Sign-Up</h3>
          <p className="mt-0.5 font-display text-lg font-extrabold uppercase tracking-tight text-dark">
            Are you on the grid?
          </p>
        </div>
        {canSignUp ? (
          <div className="flex flex-wrap gap-2">
            {Object.entries(STATUS_UI).map(([status, ui]) => {
              const active = myStatus === status;
              return (
                <button
                  key={status}
                  onClick={() => onSetStatus(ev.id, status)}
                  disabled={busy === `${ev.id}:${status}`}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition disabled:opacity-50 ${
                    active ? ui.active : ui.idle
                  }`}
                >
                  <StatusIcon d={ui.icon} className={active ? "" : ui.idleIcon} />
                  {ui.label}
                </button>
              );
            })}
            {myStatus && (
              <button
                onClick={() => onClear(ev.id)}
                disabled={busy === `${ev.id}:clear`}
                className="btn-secondary"
              >
                Remove
              </button>
            )}
          </div>
        ) : (
          <Link to="/profile" className="text-sm font-semibold text-primary hover:underline">
            Log in to respond
          </Link>
        )}
      </div>

      {/* grid fill: how many of the available seats are taken */}
      <div className="border-b border-border px-5 py-3">
        <div className="flex items-center justify-between font-mono text-[10px] font-bold uppercase tracking-wider text-light">
          <span>Grid</span>
          <span className="tabular-nums text-medium">{accepted}/{capacity} seats taken</span>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface2">
          <div
            className="h-full rounded-full bg-green-600 transition-all"
            style={{ width: `${Math.min(100, (accepted / capacity) * 100)}%` }}
          />
        </div>
      </div>

      <div className="grid gap-4 p-5 sm:grid-cols-3">
        {["ACCEPTED", "DECLINED", "TENTATIVE"].map((status) => (
          <div key={status}>
            <div className="mb-2 flex items-center gap-1.5 font-mono text-xs font-bold uppercase tracking-wider text-medium">
              <StatusIcon d={STATUS_UI[status].icon} className={`h-3.5 w-3.5 ${STATUS_UI[status].idleIcon}`} />
              {STATUS_UI[status].title}
              <span className="text-light">({ev.rsvps[status].length})</span>
            </div>
            <ul className="space-y-1.5">
              {ev.rsvps[status].map((r) => (
                <li key={r.driverId} className="flex items-center gap-2 text-sm">
                  <TeamDot color={r.team.color} />
                  <span className={r.driverId === driverId ? "font-bold text-dark" : "text-dark"}>
                    {r.name}
                  </span>
                  <Flag code={countryFor(r.driverId, r.country)} w={16} h={12} />
                </li>
              ))}
              {ev.rsvps[status].length === 0 && <li className="text-sm text-faint">—</li>}
            </ul>
          </div>
        ))}
      </div>

      <SeatMarket race={marketRace} me={me} reload={reloadMarket} />
    </div>
  );
}
