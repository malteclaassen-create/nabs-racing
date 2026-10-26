import { Link } from "react-router-dom";
import { useSite, useApi } from "../site.jsx";
import { Loading, ErrorBox, Empty, PageHeader, SeasonPicker, TeamDot, rise } from "../components/ui.jsx";
import { dateTime } from "../format.js";

export default function Races() {
  const { series, scope } = useSite();
  const { data, error, loading } = useApi(series ? `/races${scope}` : null);
  if (!series || (loading && !data)) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const nextId = data.races.find((r) => !r.done)?.id;

  return (
    <div>
      <PageHeader eyebrow={`${series.name} · ${data.season?.name ?? ""}`} title="Calendar">
        <SeasonPicker />
      </PageHeader>
      {data.races.length === 0 ? (
        <Empty>No races on the calendar yet.</Empty>
      ) : (
        <ol className="space-y-3">
          {data.races.map((race, i) => (
            <li key={race.id} {...rise(i, 55)}>
              <Link
                to={`/races/${race.id}`}
                className={`card lift group flex flex-col gap-4 p-5 sm:flex-row sm:items-center ${race.id === nextId ? "border-accent/60" : ""}`}
              >
                <div className="flex items-center gap-4 sm:w-1/2">
                  {/* the round's number in a block, as on the league's calendar graphics */}
                  <div
                    className={`round-block h-14 w-14 text-3xl transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105 ${
                      race.id === nextId ? "bg-accent text-accent-ink" : race.done ? "bg-white/10 text-muted" : "border border-line text-ink"
                    }`}
                  >
                    {race.round}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="display truncate text-2xl">{race.track || race.name}</span>
                      {race.id === nextId && <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-black uppercase italic text-accent-ink">Next</span>}
                      {race.hasSprint && <span className="rounded-full border border-line px-2 py-0.5 text-[10px] font-black uppercase italic text-muted">Sprint</span>}
                      {race.customPoints && <span className="rounded-full border border-line px-2 py-0.5 text-[10px] font-black uppercase italic text-muted">Own points</span>}
                      {race.pointsMultiplier !== 1 && (
                        <span className="rounded border border-amber-400/50 px-1.5 py-0.5 text-[10px] font-black uppercase text-amber-300">
                          ×{race.pointsMultiplier} points
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-muted">
                      {race.track && race.name !== race.track ? `${race.name} · ` : ""}
                      {dateTime(race.startsAt)}
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
