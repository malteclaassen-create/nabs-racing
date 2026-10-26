import { useSite, useApi } from "../site.jsx";
import { seasonQuery } from "../api.js";
import { Loading, ErrorBox, Empty, PageHeader, SeasonPicker, DriverName, TeamName } from "../components/ui.jsx";
import { points } from "../format.js";

// The colour of a round's cell: podiums stand out, a DNF is dimmed.
function cellTone(r) {
  if (!r) return "text-muted/40";
  if (r.status !== "FIN") return "text-muted";
  if (r.position === 1) return "bg-amber-400/20 text-amber-300";
  if (r.position <= 3) return "bg-accent/10 text-accent";
  return "";
}

export default function Drivers() {
  const { seasonId } = useSite();
  const { data, error, loading } = useApi(`/standings${seasonQuery(seasonId)}`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const rounds = data.rounds.filter((r) => r.done);

  return (
    <div>
      <PageHeader eyebrow={data.season?.name} title="Driver standings">
        <SeasonPicker />
      </PageHeader>
      {data.drivers.length === 0 ? (
        <Empty>No results yet. The standings appear after the first race.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="w-12 pl-5">Pos</th>
                <th>Driver</th>
                <th>Team</th>
                {rounds.map((r) => (
                  <th key={r.id} className="hidden text-center lg:table-cell" title={`${r.name} (${r.track})`}>
                    R{r.round}
                  </th>
                ))}
                <th className="text-center">Wins</th>
                <th className="text-center">Podiums</th>
                <th className="pr-5 text-right">Points</th>
              </tr>
            </thead>
            <tbody>
              {data.drivers.map((d) => (
                <tr key={d.id}>
                  <td className="pl-5 font-black tabular">{d.position}</td>
                  <td>
                    <DriverName driver={d} />
                  </td>
                  <td>
                    <TeamName team={d.team} />
                  </td>
                  {rounds.map((r) => {
                    const res = d.rounds[r.id];
                    return (
                      <td key={r.id} className="hidden px-1 text-center lg:table-cell">
                        <span
                          className={`inline-block min-w-8 rounded px-1 py-0.5 text-xs font-bold tabular ${cellTone(res)}`}
                          title={res ? `${points(res.points)} pts${res.fastestLap ? " · fastest lap" : ""}` : "did not race"}
                        >
                          {res ? (res.status === "FIN" ? res.position : res.status) : "·"}
                          {res?.fastestLap && <span className="text-fuchsia-400">•</span>}
                        </span>
                      </td>
                    );
                  })}
                  <td className="text-center tabular">{d.wins}</td>
                  <td className="text-center tabular">{d.podiums}</td>
                  <td className="pr-5 text-right text-base font-black tabular">{points(d.points)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.drivers.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          <span className="text-fuchsia-400">•</span> fastest lap
        </p>
      )}
    </div>
  );
}
