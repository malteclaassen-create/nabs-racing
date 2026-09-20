import { Link } from "react-router-dom";
import { TierBadge, Rank, DriverAvatar, CountUp, PosDelta } from "./ui.jsx";
import Flag from "./Flag.jsx";
import TeamLogo from "./TeamLogo.jsx";
import DriverName from "./DriverName.jsx";
import { countryFor } from "../data/driverCountries.js";

// The caption under a driver's points, on the podium cards and in every row.
//
// Who leads is decided by RANK, never by the points gap. Before a season's
// first round everybody sits on zero, so a gap-based test called the entire
// podium "Leader" at once — which is what an announced-but-not-started season
// showed. And a driver who is genuinely level with the leader reads "level"
// rather than "−0", which looked like a rounding fault.
export function standingCaption(position, gap, { decided = false, unit = "", lower = false } = {}) {
  const cased = (s) => (lower ? s.toLowerCase() : s);
  if (position === 1) return cased(decided ? "Champion" : "Leader");
  if (gap <= 0) return cased("Level");
  return `−${gap}${unit}`;
}

export default function DriverRow({ d, leaderTotal, index = 0, showTier = true, champion = false, decided = false, delta = null }) {
  const gap = leaderTotal - d.total;
  const pct = d.total > 0 && leaderTotal > 0 ? Math.max(4, (d.total / leaderTotal) * 100) : 0;
  return (
    <Link
      to={`/drivers/${d.driverId}`}
      data-driver-id={d.driverId}
      data-replay-prev={d.prevPosition ?? ""}
      style={{ "--i": index }}
      className={`flex items-center gap-2.5 px-3 py-3 transition sm:gap-4 sm:px-5 ${
        champion ? (decided ? "row-gold" : "row-leader") : "hover:bg-surface2"
      }`}
    >
      <Rank position={d.position} />
      <PosDelta delta={delta} />
      <span className="h-9 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: d.team.color }} />
      <DriverAvatar name={d.name} photoUrl={d.photoUrl} color={d.team.color} size={36} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <DriverName driver={d} className="truncate font-display text-base font-bold uppercase tracking-tight text-dark sm:text-lg" />
          <Flag code={countryFor(d.driverId, d.country)} />
          {/* On phones the badge stole the name's room (even short names were
              cut) — the tier filter tabs above cover that info there. */}
          {showTier && (
            <span className="hidden sm:inline-flex">
              <TierBadge tier={d.tier} />
            </span>
          )}
          {!d.isActive && <span className="pill bg-surface2 text-light">inactive</span>}
        </div>
        <TeamLogo
          id={d.team.id}
          name={d.team.name}
          color={d.team.color}
          logoUrl={d.team.logoUrl}
          size={16}
          showName
          nameClassName="truncate text-xs text-light sm:text-sm"
        />
      </div>

      {/* points bar */}
      <div className="hidden w-28 shrink-0 md:block lg:w-40 xl:w-56">
        <div className="h-1.5 overflow-hidden rounded-full bg-border">
          <div className="bar-fill h-full rounded-full" style={{ "--w": `${pct}%`, backgroundColor: d.team.color }} />
        </div>
      </div>

      <div className="w-12 shrink-0 text-right sm:w-20">
        <div className="font-mono text-lg font-bold tabular-nums text-dark sm:text-xl">
          <CountUp end={d.total} duration={900} />
        </div>
        <div className="font-mono text-[11px] tabular-nums text-light">
          {standingCaption(d.position, gap, { lower: true })}
        </div>
      </div>
    </Link>
  );
}
