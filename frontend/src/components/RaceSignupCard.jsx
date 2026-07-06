import { Link } from "react-router-dom";
import { TeamDot } from "./ui.jsx";
import SeatMarket from "./SeatMarket.jsx";
import Flag from "./Flag.jsx";
import { circuitFor } from "../data/circuits.js";
import { countryFor } from "../data/driverCountries.js";
import { fmtRaceTime } from "../utils/raceTime.js";

const STATUS_UI = {
  ACCEPTED: { label: "Accept", title: "Accepted", btn: "bg-green-600 hover:bg-green-700", icon: "M4.5 12.5l5 5L19.5 7" },
  DECLINED: { label: "Decline", title: "Declined", btn: "bg-red-600 hover:bg-red-700", icon: "M6 6l12 12M18 6L6 18" },
  TENTATIVE: { label: "Tentative", title: "Tentative", btn: "bg-amber-500 hover:bg-amber-600", icon: "M9 9.2a3 3 0 115.4 1.8c-.8 1-2.4 1.5-2.4 3M12 17.5h.01" },
};

function StatusIcon({ d }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function fmtDate(d) {
  if (!d) return "Date TBA";
  return new Date(d).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
}

// One upcoming race: attendance buttons (when signed in) + the three status
// columns + the embedded Driver Market. Extracted from the old Sign-Up page so
// it can live inside the Races page. State/actions are owned by the parent.
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

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface2 px-5 py-4">
        <div>
          <h3 className="flex items-center gap-2.5 font-display text-xl font-extrabold uppercase tracking-tight text-dark">
            {circuitFor(ev.track) && (
              <Flag code={circuitFor(ev.track).country} title={circuitFor(ev.track).countryName} />
            )}
            <span className="text-light">R{ev.number}</span> {ev.track}
          </h3>
          <p className="mt-0.5 font-mono text-sm text-light">
            {fmtDate(ev.date)}
            {ev.date && <span className="text-medium"> · {fmtRaceTime(ev.date)}</span>}
          </p>
        </div>
        {canSignUp ? (
          <div className="flex flex-wrap gap-2">
            {Object.entries(STATUS_UI).map(([status, ui]) => (
              <button
                key={status}
                onClick={() => onSetStatus(ev.id, status)}
                disabled={busy === `${ev.id}:${status}`}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white transition disabled:opacity-50 ${ui.btn} ${
                  myStatus === status ? "ring-2 ring-offset-2 ring-dark" : ""
                }`}
              >
                <StatusIcon d={ui.icon} />
                {ui.label}
              </button>
            ))}
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

      <div className="grid gap-4 p-5 sm:grid-cols-3">
        {["ACCEPTED", "DECLINED", "TENTATIVE"].map((status) => (
          <div key={status}>
            <div className="mb-2 font-mono text-xs font-bold uppercase tracking-wider text-medium">
              {STATUS_UI[status].title}{" "}
              <span className="text-light">
                ({ev.rsvps[status].length}
                {status === "ACCEPTED" ? `/${ev.capacity ?? 40}` : ""})
              </span>
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
