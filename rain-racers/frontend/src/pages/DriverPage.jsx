import { useParams, Link } from "react-router-dom";
import { useSite, useApi } from "../site.jsx";
import { seasonQuery } from "../api.js";
import { Loading, ErrorBox, Empty, Position, SeasonPicker, TeamName } from "../components/ui.jsx";
import { flag, lapTime, points } from "../format.js";

export default function DriverPage() {
  const { id } = useParams();
  const { seasonId } = useSite();
  const { data, error, loading } = useApi(`/drivers/${id}${seasonQuery(seasonId)}`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const { driver, standing, results, season } = data;
  const stats = [
    ["Position", standing ? `P${standing.position}` : "—"],
    ["Points", standing ? points(standing.points) : "0"],
    ["Wins", standing?.wins ?? 0],
    ["Podiums", standing?.podiums ?? 0],
    ["Races", results.filter((r) => r.status !== "DNS").length],
  ];

  return (
    <div className="space-y-6">
      <Link to="/drivers" className="text-sm text-muted hover:text-accent">
        ← Standings
      </Link>
      <section className="card relative overflow-hidden p-6 sm:p-8">
        <div className="absolute inset-y-0 left-0 w-1.5" style={{ background: driver.team?.color || "rgb(var(--accent))" }} />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="eyebrow mb-1">{season?.name}</div>
            <h1 className="h1 flex items-center gap-3">
              {driver.number != null && <span className="text-muted">#{driver.number}</span>}
              {driver.name}
              {driver.country && <span className="text-3xl not-italic">{flag(driver.country)}</span>}
            </h1>
            <div className="mt-2">
              <TeamName team={driver.team} />
            </div>
          </div>
          <SeasonPicker />
        </div>
        <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {stats.map(([label, value]) => (
            <div key={label} className="rounded-xl bg-bg px-4 py-3">
              <dt className="text-[10px] font-bold uppercase tracking-widest text-muted">{label}</dt>
              <dd className="text-2xl font-black tabular">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {results.length === 0 ? (
        <Empty>No races in this season yet.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="pl-5">Round</th>
                <th>Race</th>
                <th>Pos</th>
                <th>Team</th>
                <th className="text-right">Best lap</th>
                <th className="pr-5 text-right">Points</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.id}>
                  <td className="pl-5 text-muted">R{r.race.round}</td>
                  <td>
                    <Link to={`/races/${r.race.id}`} className="font-semibold hover:text-accent">
                      {r.race.name}
                    </Link>
                  </td>
                  <td>
                    <Position value={r.position} status={r.status} />
                  </td>
                  <td>
                    <TeamName team={r.team} />
                  </td>
                  <td className={`text-right font-mono text-xs ${r.fastestLap ? "font-bold text-fuchsia-400" : ""}`}>{lapTime(r.bestLapMs)}</td>
                  <td className="pr-5 text-right font-black tabular">{points(r.points)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
