import { Link } from "react-router-dom";
import { useSite, useApi } from "../site.jsx";
import { Loading, ErrorBox, Empty, PageHeader, SeasonPicker, TeamName } from "../components/ui.jsx";
import LineChart from "../components/LineChart.jsx";
import { flag, points } from "../format.js";

export default function Teams() {
  const { series, scope } = useSite();
  const { data, error, loading } = useApi(series ? `/teams${scope}` : null);
  if (!series || (loading && !data)) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const rounds = data.rounds.filter((r) => r.done);
  const ranked = data.teams.filter((t) => t.standing);
  const prog = data.progression;

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={`${series.name} · ${data.season?.name ?? ""}`} title="Teams">
        <SeasonPicker />
      </PageHeader>

      {data.teams.length === 0 ? (
        <Empty>No teams yet.</Empty>
      ) : (
        <>
          {ranked.length > 0 && (
            <div className="card overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th className="w-12 pl-5">Pos</th>
                    <th>Team</th>
                    {rounds.map((r) => (
                      <th key={r.id} className="hidden text-center md:table-cell" title={`${r.name} (${r.track})`}>
                        R{r.round}
                      </th>
                    ))}
                    <th className="text-center">Wins</th>
                    <th className="pr-5 text-right">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((t) => (
                    <tr key={t.id}>
                      <td className="pl-5 font-black tabular">{t.standing.position}</td>
                      <td>
                        <TeamName team={t} />
                      </td>
                      {rounds.map((r) => (
                        <td key={r.id} className="hidden text-center text-xs tabular text-muted md:table-cell">
                          {t.standing.rounds[r.id] ? points(t.standing.rounds[r.id].points) : "·"}
                        </td>
                      ))}
                      <td className="text-center tabular">{t.standing.wins}</td>
                      <td className="pr-5 text-right text-base font-black tabular">{points(t.standing.points)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {prog.rounds.length > 1 && (
            <section className="card p-6">
              <h2 className="h2 mb-4">Points after each round</h2>
              <LineChart
                key={data.season?.id}
                labels={prog.rounds.map((r) => `R${r.round}`)}
                lines={prog.teams.map((t) => ({ id: t.id, label: t.name, color: t.color, values: t.values }))}
                initialVisible={10}
              />
            </section>
          )}

          <section>
            <h2 className="h2 mb-4 text-xl">Line-ups</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.teams.map((t) => (
                <article key={t.id} className="card relative overflow-hidden p-5">
                  <div className="absolute inset-y-0 left-0 w-1.5" style={{ background: t.color || "rgb(var(--line))" }} />
                  <div className="flex items-start justify-between gap-4 pl-2">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-widest text-muted">{t.standing ? `P${t.standing.position}` : "No points yet"}</div>
                      <h3 className="display mt-1 text-xl">{t.name}</h3>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-black tabular">{points(t.standing?.points ?? 0)}</div>
                      <div className="text-[10px] font-bold uppercase tracking-widest text-muted">points</div>
                    </div>
                  </div>
                  <ul className="mt-4 space-y-1.5 pl-2">
                    {t.drivers.length === 0 && <li className="text-sm text-muted">No drivers</li>}
                    {t.drivers.map((d) => (
                      <li key={d.id}>
                        <Link to={`/drivers/${d.id}?season=${data.season.id}`} className="inline-flex items-center gap-2 text-sm hover:opacity-70">
                          {d.number != null && <span className="font-mono text-xs text-muted">#{d.number}</span>}
                          <span className="font-semibold">{d.name}</span>
                          {d.country && <span>{flag(d.country)}</span>}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
