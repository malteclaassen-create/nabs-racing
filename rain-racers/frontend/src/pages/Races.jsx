import { Link } from "react-router-dom";
import { useSite, useApi } from "../site.jsx";
import { seasonQuery } from "../api.js";
import { Loading, ErrorBox, Empty, PageHeader, SeasonPicker, TeamDot } from "../components/ui.jsx";
import { dateTime } from "../format.js";

export default function Races() {
  const { seasonId } = useSite();
  const { data, error, loading } = useApi(`/races${seasonQuery(seasonId)}`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const nextId = data.races.find((r) => !r.done)?.id;

  return (
    <div>
      <PageHeader eyebrow={data.season?.name} title="Calendar">
        <SeasonPicker />
      </PageHeader>
      {data.races.length === 0 ? (
        <Empty>No races on the calendar yet.</Empty>
      ) : (
        <ol className="space-y-3">
          {data.races.map((race) => (
            <li key={race.id}>
              <Link
                to={`/races/${race.id}`}
                className={`card flex flex-col gap-4 p-5 transition hover:border-accent/50 sm:flex-row sm:items-center ${race.id === nextId ? "border-accent/60" : ""}`}
              >
                <div className="flex items-center gap-4 sm:w-1/2">
                  <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-bg">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Rd</span>
                    <span className="text-xl font-black leading-none">{race.round}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="h2 truncate">{race.name}</span>
                      {race.id === nextId && <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-black uppercase text-bg">Next</span>}
                      {race.pointsMultiplier !== 1 && (
                        <span className="rounded border border-amber-400/50 px-1.5 py-0.5 text-[10px] font-black uppercase text-amber-300">
                          ×{race.pointsMultiplier} points
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-muted">
                      {race.track} · {dateTime(race.startsAt)}
                    </div>
                  </div>
                </div>
                <div className="sm:ml-auto">
                  {race.done ? (
                    <ol className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      {race.podium.map((r) => (
                        <li key={r.id} className="flex items-center gap-1.5">
                          <span className="font-black text-muted">{r.position}</span>
                          <TeamDot team={r.team} />
                          <span className="font-semibold">{r.driver.name}</span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <span className="text-sm text-muted">{race.signedUp} signed up</span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
