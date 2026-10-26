import { Link } from "react-router-dom";
import { useSite, useApi } from "../site.jsx";
import { seasonQuery } from "../api.js";
import { Loading, ErrorBox, Empty, PageHeader, SeasonPicker } from "../components/ui.jsx";
import { flag, points } from "../format.js";

export default function Teams() {
  const { seasonId } = useSite();
  const { data, error, loading } = useApi(`/teams${seasonQuery(seasonId)}`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  return (
    <div>
      <PageHeader eyebrow={data.season?.name} title="Teams">
        <SeasonPicker />
      </PageHeader>
      {data.teams.length === 0 ? (
        <Empty>No teams yet.</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.teams.map((t) => (
            <article key={t.id} className="card relative overflow-hidden p-5">
              <div className="absolute inset-y-0 left-0 w-1.5" style={{ background: t.color || "rgb(var(--line))" }} />
              <div className="flex items-start justify-between gap-4 pl-2">
                <div>
                  <div className="text-xs font-bold uppercase tracking-widest text-muted">
                    {t.standing ? `P${t.standing.position}` : "No points yet"}
                  </div>
                  <h2 className="h2 mt-1 text-xl">{t.name}</h2>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-black tabular">{points(t.standing?.points ?? 0)}</div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-muted">points</div>
                </div>
              </div>
              <ul className="mt-4 space-y-1.5 pl-2">
                {t.drivers.length === 0 && <li className="text-sm text-muted">No drivers</li>}
                {t.drivers.map((d) => (
                  <li key={d.id}>
                    <Link to={`/drivers/${d.id}`} className="inline-flex items-center gap-2 text-sm hover:text-accent">
                      {d.number != null && <span className="font-mono text-xs text-muted">#{d.number}</span>}
                      <span className="font-semibold">{d.name}</span>
                      {d.country && <span>{flag(d.country)}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
              {t.standing && (
                <div className="mt-4 flex gap-4 pl-2 text-xs text-muted">
                  <span>
                    <b className="text-ink">{t.standing.wins}</b> wins
                  </span>
                  <span>
                    <b className="text-ink">{t.standing.podiums}</b> podiums
                  </span>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
