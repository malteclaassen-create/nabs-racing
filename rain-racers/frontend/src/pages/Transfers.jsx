import { Link } from "react-router-dom";
import { useSite, useApi } from "../site.jsx";
import { Loading, ErrorBox, Empty, PageHeader, SeasonPicker, TeamName, rise } from "../components/ui.jsx";

// The transfer market: every driver's team round by round, and the moves of
// the season, the ones still ahead marked as booked.
export default function Transfers() {
  const { series, scope } = useSite();
  const { data, error, loading } = useApi(series ? `/transfers${scope}` : null);
  if (!series || (loading && !data)) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={`${series.name} · ${data.season?.name ?? ""}`} title="Transfers">
        <SeasonPicker />
      </PageHeader>

      <section>
        <h2 className="h2 mb-3">Moves</h2>
        {data.moves.length === 0 ? (
          <Empty>No team changes this season.</Empty>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {data.moves.map((m, i) => (
              <li key={m.id} {...rise(i, 60)} className="card rise flex flex-wrap items-center gap-3 p-4">
                <span className="round-block h-10 w-10 bg-white/10 text-lg">R{m.fromRound}</span>
                <div className="min-w-0 flex-1">
                  <Link to={`/drivers/${m.driver.id}?season=${data.season.id}`} className="font-bold hover:opacity-70">
                    {m.driver.name}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <TeamName team={m.from} />
                    <span className="text-muted">→</span>
                    {m.to ? <TeamName team={m.to} /> : <span className="text-muted">no team</span>}
                  </div>
                </div>
                {m.upcoming && <span className="rounded-full border border-amber-400/50 px-2 py-0.5 text-[10px] font-black uppercase text-amber-300">Booked</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="h2 mb-3">Team by round</h2>
        {data.rows.length === 0 ? (
          <Empty>The entry list is empty.</Empty>
        ) : (
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="pl-5">Driver</th>
                  {data.rounds.map((r) => (
                    <th key={r.id} className="text-center" title={r.track}>
                      R{r.round}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr key={row.driver.id} {...rise(i, 35)}>
                    <td className="pl-5 font-semibold">
                      <Link to={`/drivers/${row.driver.id}?season=${data.season.id}`} className="hover:opacity-70">
                        {row.driver.name}
                      </Link>
                    </td>
                    {row.cells.map((c, i) => {
                      const changed = i > 0 && row.cells[i - 1].team?.id !== c.team?.id;
                      return (
                        <td key={c.raceId} className="px-1 text-center">
                          <span
                            className={`inline-block h-6 w-full min-w-10 rounded px-1 text-[10px] font-bold leading-6 ${c.done && !c.raced ? "opacity-35" : ""} ${changed ? "ring-2 ring-ink" : ""}`}
                            style={{ background: c.team?.color ? `${c.team.color}33` : "rgb(var(--line) / 0.5)", color: c.team?.color || "rgb(var(--muted))" }}
                            title={`${c.team?.name ?? "No team"}${c.done ? (c.raced ? "" : " · did not race") : ""}`}
                          >
                            {c.team ? initials(c.team.name) : "–"}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted">Faded: did not race that round. Outlined: first round with the new team.</p>
      </section>
    </div>
  );
}

const initials = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w[0].toUpperCase())
    .join("");
