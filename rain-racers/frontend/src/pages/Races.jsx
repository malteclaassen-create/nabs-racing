import { Link } from "react-router-dom";
import { useSite, useApi } from "../site.jsx";
import { Loading, ErrorBox, Empty, PageHeader, SeasonPicker, TeamDot, rise } from "../components/ui.jsx";
import { RoundFacts } from "../components/RaceCards.jsx";
import { RoundPicture, PlayBadge } from "../components/Picture.jsx";
import { dayShort, clock, inkOn } from "../format.js";

// The season's calendar as the league's posters: every round with its
// picture, where and with what, and the podium once it is raced.
export default function Races() {
  const { series, scope } = useSite();
  const { data, error, loading } = useApi(series ? `/races${scope}` : null);
  if (!series || (loading && !data)) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const nextId = data.races.find((r) => !r.done && !r.past)?.id;
  const color = series.color || "#ffffff";
  const banner = data.season?.imageUrl || series.imageUrl;

  return (
    <div>
      <PageHeader eyebrow={`${series.name} · ${data.season?.name ?? ""}`} title="Calendar">
        <SeasonPicker />
      </PageHeader>
      {data.races.length === 0 ? (
        <Empty>No races on the calendar yet.</Empty>
      ) : (
        <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {data.races.map((race, i) => {
            const next = race.id === nextId;
            return (
              <li key={race.id} {...rise(i, 45)}>
                <Link to={`/races/${race.id}`} className={`card lift group flex h-full flex-col overflow-hidden ${next ? "ring-2" : ""}`} style={next ? { "--tw-ring-color": color } : undefined}>
                  <div className="relative">
                    <RoundPicture
                      race={race}
                      // a round ahead without a poster of its own shows the season's banner, faded
                      extra={race.done || race.past ? [] : [banner]}
                      color={series.color}
                      imgClassName={`transition duration-700 group-hover:scale-105 ${!race.imageUrl && !race.videoUrl ? "opacity-40 grayscale" : ""}`}
                    />
                    <span className="round-block absolute left-3 top-3 h-11 w-11 text-2xl shadow-lg" style={{ background: color, color: inkOn(color) }}>
                      {race.round}
                    </span>
                    <span className="absolute right-3 top-3 flex gap-1.5">
                      {next && <Chip tone="accent" color={color}>Next</Chip>}
                      {race.pointsMultiplier > 1 && <Chip>×{race.pointsMultiplier}</Chip>}
                      {race.customPoints && <Chip>Own points</Chip>}
                    </span>
                    {race.videoUrl && race.past && (
                      <span className="absolute bottom-3 right-3">
                        <PlayBadge className="h-10 w-10" />
                      </span>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <div className="eyebrow mb-1">
                      {dayShort(race.startsAt)} · {clock(race.startsAt)}
                    </div>
                    <div className="display text-2xl leading-tight">{race.name}</div>
                    <RoundFacts race={race} className="mt-2" />
                    <div className="mt-auto pt-4 text-sm">
                      {race.done ? (
                        <ol className="flex flex-wrap gap-x-4 gap-y-1">
                          {race.podium.map((r) => (
                            <li key={r.driver.id} className="flex items-center gap-1.5">
                              <span className="font-black text-muted">{r.position}</span>
                              <TeamDot team={r.team} />
                              <span className="font-semibold">{r.driver.name}</span>
                            </li>
                          ))}
                        </ol>
                      ) : race.past ? (
                        <span className="text-muted">{race.videoUrl ? "Raced · recording up" : "Raced · no results on record"}</span>
                      ) : (
                        <span className="text-muted">
                          <b className="text-ink">{race.signedUp}</b> signed up
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function Chip({ children, tone, color }) {
  return tone === "accent" ? (
    <span className="rounded-full px-2.5 py-1 text-[10px] font-black uppercase italic shadow-lg" style={{ background: color, color: inkOn(color) }}>
      {children}
    </span>
  ) : (
    <span className="rounded-full bg-black/80 px-2.5 py-1 text-[10px] font-black uppercase italic text-white">{children}</span>
  );
}
