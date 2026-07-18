import { Link } from "react-router-dom";
import Flag from "./Flag.jsx";
import { countryFor } from "../data/driverCountries.js";
import { fmtGap } from "../utils/raceDuration.js";

// Post-race stats panel for a completed round, shown below the classification:
// the Driver of the Day (named after whoever made the pick, usually the round's
// streamer) as a lead line, then a quiet two-column list of stats derived from
// the stored results and telemetry. Deliberately monochrome and rule-lined, in
// the same visual language as the Track record list on the upcoming-race panel.
// Every row only shows when the data it needs exists, so historical rounds that
// only kept points and positions still render whatever they can.

const MAX_LAP_MS = 1_800_000; // AC stores a huge sentinel for "no lap set"
const isLap = (ms) => ms > 0 && ms <= MAX_LAP_MS;

function fmtLap(ms) {
  if (!isLap(ms)) return null;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}

// Race time with any steward penalty included, matching the classification.
const adjTime = (r) => (r.totalTimeMs > 0 ? r.totalTimeMs + (r.penaltySeconds || 0) * 1000 : null);

const ICONS = {
  flag: "M5 21V4M5 4c3-1.5 6 1.5 9 0s4-1 4-1v9s-1 .5-4 1-6-1.5-9 0",
  stopwatch: "M12 13V9M9 2h6M19 6l-1.5 1.5M12 21a8 8 0 100-16 8 8 0 000 16z",
  climb: "M3 17l6-6 4 4 8-8M21 7v5M21 7h-5",
  burst: "M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.5 2.5M16.5 16.5L19 19M19 5l-2.5 2.5M7.5 16.5L5 19",
  star: "M12 2l3 6.5 7 .9-5 4.8 1.3 7L12 18l-6.6 3.2L6.7 14l-5-4.8 7-.9L12 2z",
  gap: "M4 4v16M20 4v16M8 12h8M8 12l3-3M8 12l3 3M16 12l-3-3M16 12l-3 3",
  steady: "M3 12h4l2-5 4 10 2-5h6",
  lead: "M5 20h14M6 20V9l3 2 3-6 3 6 3-2v11",
};

function FactIcon({ name, className = "h-4 w-4" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name] || ICONS.star} />
    </svg>
  );
}

function FactRow({ fact }) {
  return (
    <div className="flex items-center gap-3 py-3" title={fact.hint || undefined}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface2 text-light">
        <FactIcon name={fact.icon} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">{fact.label}</div>
        <div className="flex items-center gap-1.5">
          {/* no driver id = a quali entrant outside the roster — plain text */}
          {fact.driverId ? (
            <Link
              to={`/drivers/${fact.driverId}`}
              className="truncate font-display text-sm font-extrabold uppercase tracking-tight text-dark transition hover:text-brand"
            >
              {fact.name}
            </Link>
          ) : (
            <span className="truncate font-display text-sm font-extrabold uppercase tracking-tight text-dark">
              {fact.name}
            </span>
          )}
          {fact.country && <Flag code={fact.country} w={16} h={12} />}
        </div>
      </div>
      {fact.value && (
        <div className="max-w-[45%] shrink-0 text-right font-mono text-xs font-bold leading-snug tabular-nums text-medium">
          {fact.value}
        </div>
      )}
    </div>
  );
}

// The fan-favourite pick as the panel's lead line: just typography, no box of
// its own. The label names whoever made the call (the round's streamer).
function DriverOfTheDay({ row, name, pickedBy }) {
  const title = pickedBy ? `${pickedBy}’s Driver of the Day` : "Driver of the Day";
  const teamName = row ? (row.effectiveTeam || row.team)?.name : null;
  const finish =
    row && row.status && row.status !== "FINISHED"
      ? row.status
      : row?.position != null
        ? `P${row.position}`
        : null;
  return (
    <div className="border-b border-border px-5 py-4">
      <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-eyebrow">{title}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        {row ? (
          <Link
            to={`/drivers/${row.driverId}`}
            className="truncate font-display text-2xl font-black uppercase tracking-tight text-dark transition hover:text-brand"
          >
            {name}
          </Link>
        ) : (
          <span className="truncate font-display text-2xl font-black uppercase tracking-tight text-dark">{name}</span>
        )}
        {row && <Flag code={countryFor(row.driverId, row.country)} w={20} h={15} />}
        {(finish || teamName) && (
          <span className="font-mono text-[11px] uppercase tracking-wider text-light">
            {[finish, teamName].filter(Boolean).join(" · ")}
          </span>
        )}
      </div>
    </div>
  );
}

export default function RaceFacts({ race, results, quali = null }) {
  const finished = results.filter((r) => (!r.status || r.status === "FINISHED") && r.position != null);
  const rowById = new Map(results.map((r) => [r.driverId, r]));
  const winner = finished.find((r) => r.position === 1) || null;

  // Driver of the Day — one person (the round's streamer) picks it; the admin
  // records the pick and the picker's name.
  const dotd = race?.driverOfTheDay;
  const dotdRow = dotd?.driverId ? rowById.get(dotd.driverId) : null;
  const hasDotd = !!dotd?.driverId;

  const facts = [];

  // Fastest lap
  const lapRows = results.filter((r) => isLap(r.bestLapMs));
  if (lapRows.length) {
    const fl = lapRows.reduce((b, r) => (r.bestLapMs < b.bestLapMs ? r : b));
    facts.push({ key: "fl", label: "Fastest lap", icon: "stopwatch",
      driverId: fl.driverId, name: fl.name, country: countryFor(fl.driverId, fl.country), value: fmtLap(fl.bestLapMs) });
  }

  // Winning margin: P1 to P2 at the flag, penalties included.
  const p2 = finished.find((r) => r.position === 2);
  if (winner && p2) {
    const w = adjTime(winner);
    const g = adjTime(p2);
    let value = null;
    if (w && g) {
      if (winner.laps != null && p2.laps != null && p2.laps < winner.laps) {
        const down = winner.laps - p2.laps;
        value = `${down} lap${down > 1 ? "s" : ""}`;
      } else if (g > w) {
        value = fmtGap(g - w);
      }
    }
    if (value) {
      facts.push({ key: "margin", label: "Winning margin", icon: "gap",
        driverId: winner.driverId, name: winner.name, country: countryFor(winner.driverId, winner.country),
        value: `${value} over ${p2.name}`,
        hint: "Gap between P1 and P2 at the flag, time penalties included." });
    }
  }

  // Biggest climber: most places gained from grid to final classification.
  const climbers = finished
    .filter((r) => r.grid != null)
    .map((r) => ({ r, gained: r.grid - r.position }))
    .filter((x) => x.gained > 0)
    .sort((a, b) => b.gained - a.gained);
  if (climbers.length) {
    const { r, gained } = climbers[0];
    facts.push({ key: "climb", label: "Biggest climber", icon: "climb",
      driverId: r.driverId, name: r.name, country: countryFor(r.driverId, r.country),
      value: `+${gained} places (P${r.grid} → P${r.position})`,
      hint: "Most positions gained between the starting grid and the final classification." });
  }

  // Most consistent: highest consistency percentage (average racing lap vs own
  // best lap, simresults-style — the same figure the Discord result posts use).
  // Older rounds without the percentage fall back to the clean-lap spread.
  const pctRows = results.filter((r) => typeof r.consistencyPct === "number" && r.consistencyPct > 0);
  if (pctRows.length) {
    const best = pctRows.reduce((b, r) => (r.consistencyPct > b.consistencyPct ? r : b));
    facts.push({ key: "steady", label: "Most consistent", icon: "steady",
      driverId: best.driverId, name: best.name, country: countryFor(best.driverId, best.country),
      value: `${best.consistencyPct.toFixed(2)}%`,
      hint: "How close the driver's racing laps stayed to their own best lap. 100% would mean every lap at best-lap pace." });
  } else {
    const steadyRows = results.filter((r) => typeof r.consistencyMs === "number" && r.consistencyMs >= 0);
    if (steadyRows.length) {
      const best = steadyRows.reduce((b, r) => (r.consistencyMs < b.consistencyMs ? r : b));
      facts.push({ key: "steady", label: "Most consistent", icon: "steady",
        driverId: best.driverId, name: best.name, country: countryFor(best.driverId, best.country),
        value: `±${(best.consistencyMs / 1000).toFixed(3)}s per lap`,
        hint: "Smallest spread between the driver's own clean race laps, from the race telemetry." });
    }
  }

  // Most laps led — the car out front at the S/F line most often. A heuristic
  // from lap-by-lap order (grid lap excluded, safety-car laps counted), so it's
  // shown as a fun fact, not an official stat.
  const ledRows = results.filter((r) => typeof r.lapsLed === "number" && r.lapsLed > 0);
  if (ledRows.length) {
    const most = ledRows.reduce((b, r) => (r.lapsLed > b.lapsLed ? r : b));
    const wireToWire = winner && most.driverId === winner.driverId && most.laps != null && most.lapsLed >= most.laps;
    facts.push({ key: "led", label: "Most laps led", icon: "lead",
      driverId: most.driverId, name: most.name, country: countryFor(most.driverId, most.country),
      value: wireToWire ? `All ${most.lapsLed} laps` : `${most.lapsLed} lap${most.lapsLed > 1 ? "s" : ""}`,
      hint: "Laps spent leading at the start/finish line (estimated from lap-by-lap order; grid lap excluded, safety-car laps counted)." });
  }

  // Pole position — with an imported qualifying, the fact shows the REAL pole
  // lap time (and the pole sitter comes from the quali classification, which
  // also covers rounds without stored grid data). Without one it falls back to
  // grid P1 with the old wording.
  const qPole = Array.isArray(quali) ? quali.find((q) => q.position === 1 && isLap(q.bestLapMs)) : null;
  if (qPole) {
    facts.push({ key: "pole", label: "Pole position", icon: "flag",
      driverId: qPole.driverId, name: qPole.name,
      country: qPole.driverId ? countryFor(qPole.driverId, qPole.country) : null,
      value: fmtLap(qPole.bestLapMs),
      hint: "Fastest lap of the qualifying session." });
  } else {
    const pole = results.find((r) => r.grid === 1);
    if (pole) {
      facts.push({ key: "pole", label: "Pole position", icon: "flag",
        driverId: pole.driverId, name: pole.name, country: countryFor(pole.driverId, pole.country),
        value: winner && pole.driverId === winner.driverId ? "Led from lights to flag" : "Started P1" });
    }
  }

  // Most car-to-car contacts (from AC telemetry). The estimated overtake count
  // is deliberately NOT shown here: it's a heuristic, not an official stat.
  const contactRows = results.filter((r) => typeof r.contacts === "number" && r.contacts > 0);
  if (contactRows.length) {
    const worst = contactRows.reduce((b, r) => (r.contacts > b.contacts ? r : b));
    facts.push({ key: "contacts", label: "Most incidents", icon: "burst",
      driverId: worst.driverId, name: worst.name, country: countryFor(worst.driverId, worst.country),
      value: `${worst.contacts} car contacts`,
      hint: "Car-to-car contact incidents counted from the race telemetry." });
  }

  if (!hasDotd && facts.length < 2) return null; // not enough signal

  // Two balanced columns of rows on desktop, one on phones. Each column keeps
  // its own divider lines, so there's never a stray rule at the card edge.
  const mid = Math.ceil(facts.length / 2);
  const cols = [facts.slice(0, mid), facts.slice(mid)].filter((c) => c.length > 0);

  return (
    <div className="card mt-6 overflow-hidden">
      <div className="border-b border-border bg-surface2/50 px-5 py-3">
        <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-light">Race Facts</h3>
      </div>
      {hasDotd && <DriverOfTheDay row={dotdRow} name={dotd.name || dotdRow?.name || "—"} pickedBy={dotd.pickedBy} />}
      {facts.length > 0 && (
        <div className="grid gap-x-10 px-5 py-1 sm:grid-cols-2">
          {cols.map((col, ci) => (
            <div key={ci} className={`divide-y divide-border ${ci === 1 ? "border-t border-border sm:border-t-0" : ""}`}>
              {col.map((f) => (
                <FactRow key={f.key} fact={f} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
