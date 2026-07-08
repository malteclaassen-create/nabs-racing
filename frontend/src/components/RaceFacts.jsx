import { Link } from "react-router-dom";
import Flag from "./Flag.jsx";
import { countryFor } from "../data/driverCountries.js";

// Fun facts for a completed round, derived entirely from the stored result rows
// (finish, grid, best lap, race time, car-to-car contacts). Each tile only shows
// when the data it needs exists, so historical rounds that only kept points and
// positions still render whatever they can (often nothing → the panel hides).

const MAX_LAP_MS = 1_800_000; // AC stores a huge sentinel for "no lap set"
const isLap = (ms) => ms > 0 && ms <= MAX_LAP_MS;

function fmtLap(ms) {
  if (!isLap(ms)) return null;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}

const ICONS = {
  trophy: "M8 21h8M12 17v4M7 4h10v4a5 5 0 01-10 0V4zM7 6H4v1a3 3 0 003 3M17 6h3v1a3 3 0 01-3 3",
  flag: "M5 21V4M5 4c3-1.5 6 1.5 9 0s4-1 4-1v9s-1 .5-4 1-6-1.5-9 0",
  stopwatch: "M12 13V9M9 2h6M19 6l-1.5 1.5M12 21a8 8 0 100-16 8 8 0 000 16z",
  climb: "M3 17l6-6 4 4 8-8M21 7v5M21 7h-5",
  swap: "M4 8h13l-3-3M20 16H7l3 3",
  burst: "M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.5 2.5M16.5 16.5L19 19M19 5l-2.5 2.5M7.5 16.5L5 19",
  star: "M12 2l3 6.5 7 .9-5 4.8 1.3 7L12 18l-6.6 3.2L6.7 14l-5-4.8 7-.9L12 2z",
};

function FactIcon({ name }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name] || ICONS.trophy} />
    </svg>
  );
}

function Tile({ fact }) {
  return (
    <div className="shine relative flex items-start gap-3 overflow-hidden rounded-xl border border-border bg-card p-3" style={{ "--i": fact.i }}>
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: `${fact.accent}1f`, color: fact.accent }}
      >
        <FactIcon name={fact.icon} />
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-wider text-light" title={fact.hint || undefined}>
          {fact.label}
          {fact.hint && <span className="cursor-help text-faint">ⓘ</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <Link
            to={`/drivers/${fact.driverId}`}
            className="truncate font-display text-sm font-extrabold uppercase tracking-tight text-dark transition hover:text-brand"
          >
            {fact.name}
          </Link>
          {fact.country && <Flag code={fact.country} w={16} h={12} />}
        </div>
        {fact.value && <div className="mt-0.5 font-mono text-xs font-bold tabular-nums text-medium">{fact.value}</div>}
      </div>
    </div>
  );
}

export default function RaceFacts({ race, results }) {
  const facts = [];
  const finished = results.filter((r) => (!r.status || r.status === "FINISHED") && r.position != null);
  const rowById = new Map(results.map((r) => [r.driverId, r]));

  // Race winner
  const winner = finished.find((r) => r.position === 1);
  if (winner) {
    facts.push({ key: "win", label: "Race winner", icon: "trophy", accent: "#eab308",
      driverId: winner.driverId, name: winner.name, country: countryFor(winner.driverId, winner.country),
      value: (winner.effectiveTeam || winner.team)?.name });
  }

  // Driver of the Day — admin's fan-favourite pick for the round.
  const dotd = race?.driverOfTheDay;
  if (dotd?.driverId) {
    const row = rowById.get(dotd.driverId);
    facts.push({ key: "dotd", label: "Driver of the Day", icon: "star", accent: "#f4afc6",
      driverId: dotd.driverId, name: dotd.name || row?.name || "—",
      country: row ? countryFor(row.driverId, row.country) : null,
      value: "Fan favourite of this round" });
  }

  // Pole position (grid P1) — note when the pole sitter didn't win.
  const pole = results.find((r) => r.grid === 1);
  if (pole) {
    facts.push({ key: "pole", label: "Pole position", icon: "flag", accent: "#6366f1",
      driverId: pole.driverId, name: pole.name, country: countryFor(pole.driverId, pole.country),
      value: winner && pole.driverId === winner.driverId ? "Led from lights to flag" : "Started P1" });
  }

  // Fastest lap
  const lapRows = results.filter((r) => isLap(r.bestLapMs));
  if (lapRows.length) {
    const fl = lapRows.reduce((b, r) => (r.bestLapMs < b.bestLapMs ? r : b));
    facts.push({ key: "fl", label: "Fastest lap", icon: "stopwatch", accent: "#a855f7",
      driverId: fl.driverId, name: fl.name, country: countryFor(fl.driverId, fl.country), value: fmtLap(fl.bestLapMs) });
  }

  // Biggest climber: most places gained from grid to final classification.
  const climbers = finished
    .filter((r) => r.grid != null)
    .map((r) => ({ r, gained: r.grid - r.position }))
    .filter((x) => x.gained > 0)
    .sort((a, b) => b.gained - a.gained);
  if (climbers.length) {
    const { r, gained } = climbers[0];
    facts.push({ key: "climb", label: "Biggest climber", icon: "climb", accent: "#10b981",
      driverId: r.driverId, name: r.name, country: countryFor(r.driverId, r.country),
      value: `+${gained} places (P${r.grid} → P${r.position})`,
      hint: "Most positions gained between the starting grid and the final classification." });
  }

  // Most overtakes (from AC telemetry, estimated).
  const otRows = results.filter((r) => typeof r.overtakes === "number" && r.overtakes > 0);
  if (otRows.length) {
    const best = otRows.reduce((b, r) => (r.overtakes > b.overtakes ? r : b));
    facts.push({ key: "overtakes", label: "Most overtakes", icon: "swap", accent: "#0ea5e9",
      driverId: best.driverId, name: best.name, country: countryFor(best.driverId, best.country),
      value: `${best.overtakes} on-track passes`,
      hint: "On-track passes counted from the race telemetry (estimated)." });
  }

  // Most car-to-car contacts (from AC telemetry).
  const contactRows = results.filter((r) => typeof r.contacts === "number" && r.contacts > 0);
  if (contactRows.length) {
    const worst = contactRows.reduce((b, r) => (r.contacts > b.contacts ? r : b));
    facts.push({ key: "contacts", label: "Most incidents", icon: "burst", accent: "#ef4444",
      driverId: worst.driverId, name: worst.name, country: countryFor(worst.driverId, worst.country),
      value: `${worst.contacts} car contacts`,
      hint: "Car-to-car contact incidents counted from the race telemetry." });
  }

  if (facts.length < 2) return null; // not enough signal to be worth a panel

  return (
    <div className="mb-5">
      <h3 className="mb-2.5 font-mono text-xs font-bold uppercase tracking-widest text-light">Race facts</h3>
      <div className="cascade grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {facts.map((f, i) => (
          <Tile key={f.key} fact={{ ...f, i: Math.min(i, 8) }} />
        ))}
      </div>
    </div>
  );
}
