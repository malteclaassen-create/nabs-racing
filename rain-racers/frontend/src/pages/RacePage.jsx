import { useParams, Link } from "react-router-dom";
import { useApi } from "../site.jsx";
import { Loading, ErrorBox, Empty, DriverName, TeamName, Position, TeamDot } from "../components/ui.jsx";
import Signup from "../components/Signup.jsx";
import Countdown from "../components/Countdown.jsx";
import { dateTime, lapTime, raceTime, points } from "../format.js";

function gapCell(r, winner) {
  if (r.status === "DNS" || r.status === "DSQ") return "—";
  if (r === winner) return raceTime(r.totalTimeMs);
  if (r.laps < winner.laps) {
    const n = winner.laps - r.laps;
    return `+${n} lap${n > 1 ? "s" : ""}`;
  }
  if (r.totalTimeMs && winner.totalTimeMs) return `+${((r.totalTimeMs - winner.totalTimeMs) / 1000).toFixed(3)}`;
  return "—";
}

export default function RacePage() {
  const { id } = useParams();
  const { data, error, loading, reload } = useApi(`/races/${id}`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const race = data;
  const winner = race.results[0];

  return (
    <div className="space-y-6">
      <div>
        <Link to="/races" className="text-sm text-muted hover:opacity-70">
          ← Calendar
        </Link>
        <div className="eyebrow mb-1 mt-4">
          {race.season.name} · Round {race.round}
        </div>
        <h1 className="h1 flex items-center gap-4">
          <span className="round-block h-12 w-12 bg-accent text-3xl text-accent-ink sm:h-14 sm:w-14 sm:text-4xl">{race.round}</span>
          {race.name}
        </h1>
        <div className="mt-1 text-muted">
          {race.track} · {dateTime(race.startsAt)}
          {race.pointsMultiplier !== 1 && <span className="ml-2 font-bold text-amber-300">×{race.pointsMultiplier} points</span>}
        </div>
        {race.notes && <p className="mt-4 max-w-2xl whitespace-pre-line text-sm text-muted">{race.notes}</p>}
      </div>

      {race.results.length > 0 ? (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="w-12 pl-5">Pos</th>
                <th>Driver</th>
                <th>Team</th>
                <th className="text-right">Laps</th>
                <th className="text-right">Time / Gap</th>
                <th className="text-right">Best lap</th>
                <th className="pr-5 text-right">Points</th>
              </tr>
            </thead>
            <tbody>
              {race.results.map((r) => (
                <tr key={r.id} className={r.status !== "FIN" ? "text-muted" : ""}>
                  <td className="pl-5">
                    <Position value={r.position} status={r.status} />
                  </td>
                  <td>
                    <DriverName driver={r.driver} />
                  </td>
                  <td>
                    <TeamName team={r.team} />
                  </td>
                  <td className="text-right tabular">{r.laps}</td>
                  <td className="text-right font-mono text-xs tabular">{gapCell(r, winner)}</td>
                  <td className={`text-right font-mono text-xs tabular ${r.fastestLap ? "font-bold text-fuchsia-400" : ""}`}>
                    {lapTime(r.bestLapMs)}
                  </td>
                  <td className="pr-5 text-right font-black tabular">
                    {points(r.points)}
                    {r.pointsAdjust !== 0 && (
                      <span className="ml-1 text-xs font-normal text-red-300" title="Penalty or bonus">
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
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <section className="card space-y-5 p-6">
            <div className="eyebrow">Starts in</div>
            <Countdown to={race.startsAt} />
            {race.signupOpen && <Signup raceId={race.id} status={race.mySignup} onChange={reload} />}
          </section>
          <SignupList signups={race.signups} />
        </div>
      )}
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
      <h2 className="h2 mb-4">Entry list</h2>
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
