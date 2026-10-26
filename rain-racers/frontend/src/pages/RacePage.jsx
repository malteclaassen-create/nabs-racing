import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useApi } from "../site.jsx";
import { Loading, ErrorBox, Empty, DriverName, TeamName, Position, TeamDot, SeriesBadge, rise } from "../components/ui.jsx";
import Signup from "../components/Signup.jsx";
import Countdown from "../components/Countdown.jsx";
import { dateTime, lapTime, raceTime, points, gapText } from "../format.js";
import { inkOn } from "../components/RaceCards.jsx";

function gapCell(r, winner) {
  if (r.status === "DNS" || r.status === "DSQ") return "—";
  if (r === winner) return r.totalTimeMs != null ? raceTime(r.totalTimeMs + (r.penaltyMs || 0)) : "—";
  if (r.laps < winner.laps) {
    const n = winner.laps - r.laps;
    return `+${n} lap${n > 1 ? "s" : ""}`;
  }
  if (r.totalTimeMs != null && winner.totalTimeMs != null) {
    return `+${((r.totalTimeMs + (r.penaltyMs || 0) - winner.totalTimeMs - (winner.penaltyMs || 0)) / 1000).toFixed(3)}`;
  }
  return "—";
}

function Gained({ value }) {
  if (value == null) return <span className="text-muted/40">·</span>;
  if (value === 0) return <span className="text-muted">=</span>;
  return <span className={value > 0 ? "text-emerald-400" : "text-red-300"}>{value > 0 ? `▲${value}` : `▼${-value}`}</span>;
}

function ResultTable({ rows, showGrid }) {
  const winner = rows[0];
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th className="w-12 pl-5">Pos</th>
            <th>Driver</th>
            <th className="hidden md:table-cell">Team</th>
            {showGrid && <th className="hidden text-center sm:table-cell">Grid</th>}
            {showGrid && <th className="text-center">+/−</th>}
            <th className="hidden text-right sm:table-cell">Laps</th>
            <th className="text-right">Time / Gap</th>
            <th className="hidden text-right sm:table-cell">Best lap</th>
            <th className="pr-5 text-right">Points</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} style={rise(i, 35).style} className={`rise ${r.status !== "FIN" ? "text-muted" : ""}`}>
              <td className="pl-5">
                <Position value={r.position} status={r.status} />
              </td>
              <td>
                <DriverName driver={r.driver} />
                {r.penaltyMs > 0 && (
                  <span className="mt-1 block w-fit rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold text-red-300 sm:ml-2 sm:mt-0 sm:inline" title={r.penaltyNote || "Time penalty"}>
                    +{r.penaltyMs / 1000}s{r.penaltyNote ? ` · ${r.penaltyNote}` : ""}
                  </span>
                )}
              </td>
              <td className="hidden md:table-cell">
                <TeamName team={r.team} />
              </td>
              {showGrid && <td className="hidden text-center tabular text-muted sm:table-cell">{r.grid ?? "·"}</td>}
              {showGrid && (
                <td className="text-center text-xs font-bold tabular">
                  <Gained value={r.gained} />
                </td>
              )}
              <td className="hidden text-right tabular sm:table-cell">{r.laps}</td>
              <td className="text-right font-mono text-xs tabular">{gapCell(r, winner)}</td>
              <td className={`hidden text-right font-mono text-xs tabular sm:table-cell ${r.fastestLap ? "font-bold text-fuchsia-400" : ""}`}>{lapTime(r.bestLapMs)}</td>
              <td className="pr-5 text-right font-black tabular">
                {points(r.points)}
                {r.pointsAdjust !== 0 && (
                  <span className="ml-1 text-xs font-normal text-red-300" title="Penalty or bonus points">
                    ({r.pointsAdjust > 0 ? "+" : ""}
                    {r.pointsAdjust})
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QualiTable({ rows }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th className="w-12 pl-5">Pos</th>
            <th>Driver</th>
            <th>Team</th>
            <th className="text-right">Best lap</th>
            <th className="pr-5 text-right">Gap</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((q, i) => (
            <tr key={q.driver.id} {...rise(i, 35)}>
              <td className="pl-5">
                <Position value={q.position} />
              </td>
              <td>
                <DriverName driver={q.driver} />
                {q.position === 1 && <span className="ml-2 rounded bg-sky-400/15 px-1.5 py-0.5 text-[10px] font-black text-sky-300">POLE</span>}
              </td>
              <td>
                <TeamName team={q.team} />
              </td>
              <td className="text-right font-mono text-xs tabular">{lapTime(q.bestLapMs)}</td>
              <td className="pr-5 text-right font-mono text-xs tabular text-muted">{q.gapMs ? gapText(q.gapMs) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function RacePage() {
  const { id } = useParams();
  const { data, error, loading, reload } = useApi(`/races/${id}`);
  const [tab, setTab] = useState(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const race = data;
  const done = race.sessions.FEATURE.length > 0 || race.sessions.SPRINT.length > 0;
  const tabs = [
    ...(race.sessions.FEATURE.length ? [["FEATURE", race.hasSprint ? "Feature race" : "Race"]] : []),
    ...(race.sessions.SPRINT.length ? [["SPRINT", "Sprint"]] : []),
    ...(race.qualifying.length ? [["QUALIFY", "Qualifying"]] : []),
    ...(!done || race.signups.length ? [["ENTRY", "Entry list"]] : []),
  ];
  const active = tab && tabs.some(([k]) => k === tab) ? tab : tabs[0]?.[0];

  return (
    <div className="space-y-6">
      <div>
        <Link to={`/series/${race.season.series.slug}/races`} className="text-sm text-muted hover:opacity-70">
          ← {race.season.series.name} calendar
        </Link>
        <div className="mb-1 mt-4 flex flex-wrap items-center gap-2">
          <SeriesBadge series={race.season.series} />
          <span className="eyebrow">
            {race.season.name} · Round {race.round}
          </span>
        </div>
        <h1 className="h1 flex items-center gap-4">
          <span
            className="logo-in round-block h-12 w-12 bg-accent text-3xl text-accent-ink sm:h-14 sm:w-14 sm:text-4xl"
            style={race.season.series.color ? { background: race.season.series.color, color: inkOn(race.season.series.color) } : undefined}
          >
            {race.round}
          </span>
          <span className="title-line">
            <span style={{ "--d": "120ms" }}>{race.name}</span>
          </span>
        </h1>
        <div className="mt-2 text-muted">
          {race.track} · {dateTime(race.startsAt)}
          {race.hasSprint && <span className="ml-2">· Sprint + Feature</span>}
          {race.pointsMultiplier !== 1 && <span className="ml-2 font-bold text-amber-300">×{race.pointsMultiplier} points</span>}
          {race.customPoints && <span className="ml-2 text-muted">· own points table</span>}
        </div>
        {race.notes && <p className="mt-4 max-w-2xl whitespace-pre-line text-sm text-muted">{race.notes}</p>}
      </div>

      {!done && (
        <section className="card rise flex flex-wrap items-center justify-between gap-5 p-6">
          <div>
            <div className="eyebrow mb-2">Starts in</div>
            <Countdown to={race.startsAt} />
          </div>
          {race.signupOpen && <Signup raceId={race.id} status={race.mySignup} onChange={reload} />}
        </section>
      )}

      {tabs.length > 1 && (
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-black uppercase italic ${active === k ? "bg-accent text-accent-ink" : "border border-line text-muted hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {active === "FEATURE" && <ResultTable key="f" rows={race.sessions.FEATURE} showGrid={race.sessions.FEATURE.some((r) => r.grid != null)} />}
      {active === "SPRINT" && <ResultTable key="s" rows={race.sessions.SPRINT} showGrid={race.sessions.SPRINT.some((r) => r.grid != null)} />}
      {active === "QUALIFY" && <QualiTable rows={race.qualifying} />}
      {active === "ENTRY" && <SignupList signups={race.signups} />}
    </div>
  );
}

const GROUPS = [
  ["in", "In", "text-emerald-400"],
  ["maybe", "Maybe", "text-amber-300"],
  ["out", "Can't make it", "text-red-300"],
];

function SignupList({ signups }) {
  if (signups.length === 0) return <Empty>Nobody has signed up yet.</Empty>;
  return (
    <section className="card p-6">
      <div className="grid gap-5 sm:grid-cols-3">
        {GROUPS.map(([status, label, tone]) => {
          const list = signups.filter((s) => s.status === status);
          return (
            <div key={status}>
              <div className={`mb-2 text-xs font-bold uppercase tracking-widest ${tone}`}>
                {label} · {list.length}
              </div>
              <ul className="space-y-1.5 text-sm">
                {list.map((s, i) => (
                  <li key={i} className="flex items-center gap-2">
                    {s.avatar ? <img src={s.avatar} alt="" className="h-5 w-5 rounded-full" /> : <TeamDot team={s.team} />}
                    <span className="truncate">{s.name}</span>
                    {s.team && <span className="truncate text-xs text-muted">{s.team.name}</span>}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
