import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useApi } from "../site.jsx";
import { Loading, ErrorBox, Empty, DriverName, TeamName, Position, TeamDot, SeriesBadge, rise } from "../components/ui.jsx";
import Signup from "../components/Signup.jsx";
import Countdown from "../components/Countdown.jsx";
import { RoundFacts, Timetable } from "../components/RaceCards.jsx";
import { RoundPicture, VideoEmbed } from "../components/Picture.jsx";
import { dateLong, clock, lapTime, raceTime, points, gapText, inkOn } from "../format.js";

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
  const teams = rows.some((r) => r.team);
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th className="w-12 pl-5">Pos</th>
            <th>Driver</th>
            {teams && <th className="hidden md:table-cell">Team</th>}
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
              {teams && (
                <td className="hidden md:table-cell">
                  <TeamName team={r.team} />
                </td>
              )}
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
                  <span className={`ml-1 text-xs font-normal ${r.pointsAdjust > 0 ? "text-emerald-400" : "text-red-300"}`} title="Bonus or penalty points">
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
  const withPoints = rows.some((q) => q.points);
  const teams = rows.some((q) => q.team);
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th className="w-12 pl-5">Pos</th>
            <th>Driver</th>
            {teams && <th>Team</th>}
            <th className="text-right">Best lap</th>
            <th className={`text-right ${withPoints ? "" : "pr-5"}`}>Gap</th>
            {withPoints && <th className="pr-5 text-right">Points</th>}
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
              {teams && (
                <td>
                  <TeamName team={q.team} />
                </td>
              )}
              <td className="text-right font-mono text-xs tabular">{lapTime(q.bestLapMs)}</td>
              <td className={`text-right font-mono text-xs tabular text-muted ${withPoints ? "" : "pr-5"}`}>{q.gapMs ? gapText(q.gapMs) : ""}</td>
              {withPoints && <td className="pr-5 text-right font-black tabular">{q.points ? points(q.points) : ""}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The day of a round with more races: each driver's finishes and the points
// over the day (qualifying points included).
function DayTable({ race }) {
  const keys = Object.keys(race.sessions);
  const rows = new Map();
  const row = (x) => {
    if (!rows.has(x.driver.id)) rows.set(x.driver.id, { driver: x.driver, team: x.team, points: 0, races: {}, quali: null });
    return rows.get(x.driver.id);
  };
  for (const k of keys) {
    for (const r of race.sessions[k]) {
      const e = row(r);
      e.races[k] = r;
      e.points += r.points;
    }
  }
  for (const q of race.qualifying) {
    if (!rows.has(q.driver.id)) continue;
    const e = rows.get(q.driver.id);
    e.quali = q.position;
    e.points += q.points || 0;
  }
  const teams = [...rows.values()].some((e) => e.team);
  const list = [...rows.values()].sort((a, b) => b.points - a.points || Math.min(99, ...Object.values(a.races).map((r) => r.position)) - Math.min(99, ...Object.values(b.races).map((r) => r.position)));
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th className="w-12 pl-5">#</th>
            <th>Driver</th>
            {teams && <th className="hidden md:table-cell">Team</th>}
            {race.qualifying.length > 0 && <th className="hidden text-center sm:table-cell">Quali</th>}
            {keys.map((k, i) => (
              <th key={k} className="text-center">
                R{i + 1}
              </th>
            ))}
            <th className="pr-5 text-right">Points</th>
          </tr>
        </thead>
        <tbody>
          {list.map((e, i) => (
            <tr key={e.driver.id} {...rise(i, 30)}>
              <td className="pl-5 font-black tabular text-muted">{i + 1}</td>
              <td>
                <DriverName driver={e.driver} />
              </td>
              {teams && (
                <td className="hidden md:table-cell">
                  <TeamName team={e.team} />
                </td>
              )}
              {race.qualifying.length > 0 && <td className="hidden text-center tabular text-muted sm:table-cell">{e.quali ?? "·"}</td>}
              {keys.map((k) => (
                <td key={k} className="text-center">
                  {e.races[k] ? <Position value={e.races[k].position} status={e.races[k].status} /> : <span className="text-muted/40">·</span>}
                </td>
              ))}
              <td className="pr-5 text-right font-black tabular">{points(Math.round(e.points * 100) / 100)}</td>
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
  const series = race.season.series;
  const color = series.color || "#ffffff";
  const keys = Object.keys(race.sessions);
  const done = keys.some((k) => race.sessions[k].length > 0);
  const tabs = [
    ...(keys.length > 1 && done ? [["DAY", "Day"]] : []),
    ...keys.filter((k) => race.sessions[k].length).map((k) => [k, keys.length > 1 ? `Race ${k.slice(1)}` : "Race"]),
    ...(race.qualifying.length ? [["QUALIFY", "Qualifying"]] : []),
    ...(!done || race.signups.length ? [["ENTRY", "Entry list"]] : []),
  ];
  const active = tab && tabs.some(([k]) => k === tab) ? tab : tabs[0]?.[0];

  return (
    <div className="space-y-8">
      <Link to={`/series/${series.slug}/races`} className="inline-block text-sm text-muted hover:opacity-70">
        ← {series.name} calendar
      </Link>

      <section className="card overflow-hidden">
        <div className="grid lg:grid-cols-[1.15fr_1fr] [&>*]:min-w-0">
          <div className="relative">
            {/* a round that is over shows its recording right here */}
            {race.videoUrl && race.past ? (
              <VideoEmbed url={race.videoUrl} title={race.name} className="aspect-video h-full" />
            ) : (
              <RoundPicture race={race} extra={race.mysteryTrack && !race.track ? [] : [race.season.imageUrl]} color={series.color} label={race.season.name} className="aspect-video h-full w-full" />
            )}
            <span className="absolute inset-x-0 bottom-0 h-1.5 lg:inset-y-0 lg:left-auto lg:right-0 lg:h-auto lg:w-1.5" style={{ background: color }} />
          </div>
          <div className="flex flex-col gap-5 p-6 sm:p-8">
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <SeriesBadge series={series} />
                <span className="eyebrow">
                  {race.season.name} · Round {race.round}
                </span>
              </div>
              {/* a long word ("International") steps down a size on a phone
                  rather than breaking in the middle */}
              <h1 className={`h1 flex items-start gap-4 [overflow-wrap:anywhere] ${/\S{12,}/.test(race.name) ? "max-sm:text-[1.75rem]" : ""}`}>
                <span className="round-block mt-1 h-12 w-12 shrink-0 text-3xl" style={{ background: color, color: inkOn(color) }}>
                  {race.round}
                </span>
                <span className="title-line">
                  <span style={{ "--d": "120ms" }}>{race.name}</span>
                </span>
              </h1>
              <div className="mt-3 font-semibold">
                {dateLong(race.startsAt)} · {clock(race.startsAt)}
              </div>
              <RoundFacts race={race} className="mt-2" />
              {race.customPoints && <div className="mt-2 text-xs text-muted">This round pays its own points table.</div>}
              {race.notes && <p className="mt-4 max-w-2xl whitespace-pre-line text-sm text-muted">{race.notes}</p>}
            </div>
            {race.timetable.length > 0 && <Timetable rows={race.timetable} />}
            {!done && !race.past && (
              <div className="mt-auto space-y-4 border-t border-line pt-5">
                <p className="text-muted">
                  Starts in <Countdown to={race.startsAt} className="text-lg text-ink" />
                </p>
                {race.signupOpen && <Signup raceId={race.id} status={race.mySignup} onChange={reload} />}
              </div>
            )}
          </div>
        </div>
      </section>

      {race.past && !done && <Empty>No results on record for this round.</Empty>}

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

      {active === "DAY" && <DayTable race={race} />}
      {active && /^R\d$/.test(active) && <ResultTable key={active} rows={race.sessions[active]} showGrid={race.sessions[active].some((r) => r.grid != null)} />}
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
              <div className={`mb-2 text-xs font-bold uppercase tracking-wider ${tone}`}>
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
