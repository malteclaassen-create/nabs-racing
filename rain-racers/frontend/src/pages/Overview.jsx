import { Link } from "react-router-dom";
import { useSite, useApi } from "../site.jsx";
import { Loading, ErrorBox, Logo, Streaks, SocialButtons, SeriesBadge, TeamDot, Empty, rise, HeroTitle } from "../components/ui.jsx";
import { NextRace } from "../components/RaceCards.jsx";
import { Img, RoundPicture, PosterPanel, PlayBadge, roundSources } from "../components/Picture.jsx";
import { dateTime, dateLong, points, inkOn } from "../format.js";

// The league's home: every series it runs at a glance, then the next races,
// the latest results and the latest recordings across all of them.
export default function Overview() {
  const { settings } = useSite();
  const { data, error, loading } = useApi("/overview");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const first = data.upcoming[0];

  return (
    <div className="space-y-10">
      <section className="card relative overflow-hidden">
        <Streaks />
        <div className="relative grid items-center gap-10 px-6 py-12 sm:px-10 sm:py-16 lg:grid-cols-[1.5fr_1fr]">
          <div>
            <div className="eyebrow rise mb-4">
              {data.series.length > 0 ? `${data.series.length} series · ` : ""}Assetto Corsa league
            </div>
            <HeroTitle text={settings.leagueName} />
            {settings.tagline && (
              <p {...rise(4, 90)} className="rise mt-6 max-w-xl text-lg text-muted">
                {settings.tagline}
              </p>
            )}
            <div {...rise(5, 90)} className="rise mt-8 flex flex-wrap gap-3">
              {data.series[0] && (
                <Link to={`/series/${data.series[0].series.slug}/drivers`} className="btn-accent">
                  Standings
                </Link>
              )}
              <SocialButtons />
            </div>
          </div>
          <div className="hidden justify-center lg:flex">
            <div className="logo-in">
              <div className="float glow">
                <Logo size={300} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {data.series.length === 0 ? (
        <div className="rise">
          <Empty>No series yet. Create the first one in the admin under Series &amp; seasons.</Empty>
        </div>
      ) : (
        <section>
          <div className="rise mb-4 flex flex-wrap items-end justify-between gap-3">
            <h2 className="h2 text-2xl">Series</h2>
            <Link to="/history" className="text-sm text-muted hover:text-ink">
              League history →
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {data.series.map((c, i) => (
              <div key={c.series.id} {...rise(i + 1, 90)}>
                <SeriesCard card={c} />
              </div>
            ))}
          </div>
        </section>
      )}

      {first && (
        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] [&>*]:min-w-0">
          <div {...rise(2, 90)}>
            <NextRace
              race={first}
              color={first.series.color}
              label={`Next race · ${first.series.name}`}
              extraImages={[data.series.find((c) => c.series.id === first.series.id)?.series.imageUrl]}
            />
          </div>
          <div {...rise(3, 90)}>
            <Upcoming races={data.upcoming.slice(1)} banners={Object.fromEntries(data.series.map((c) => [c.series.id, c.series.imageUrl]))} />
          </div>
        </div>
      )}

      {data.latest.length > 0 && (
        <section>
          <h2 className="h2 mb-4 text-2xl">Latest results</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {data.latest.map((r, i) => (
              <Link key={r.id} to={`/races/${r.id}`} {...rise(i, 80)} className="card lift group rise block overflow-hidden">
                <RoundPicture race={r} color={r.series.color} className="aspect-video" imgClassName="transition duration-700 group-hover:scale-105" />
                <div className="p-5">
                  <SeriesBadge series={r.series} />
                  <div className="display mt-3 truncate text-xl">{r.name}</div>
                  <div className="truncate text-xs text-muted">
                    {r.track || "Mystery track"} · {dateLong(r.startsAt)}
                  </div>
                  <ol className="mt-4 space-y-1.5 text-sm">
                    {r.podium.map((p) => (
                      <li key={p.driver.id} className="flex items-center gap-2">
                        <span className="w-4 font-black text-muted">{p.position}</span>
                        <TeamDot team={p.team} />
                        <span className="truncate font-semibold">{p.driver.name}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {data.replays.length > 0 && (
        <section>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <h2 className="h2 text-2xl">Replays</h2>
            <Link to="/history" className="text-sm text-muted hover:text-ink">
              Every season →
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {data.replays.map((r, i) => (
              <Link key={r.id} to={`/races/${r.id}`} {...rise(i, 60)} className="group rise block">
                <div className="relative overflow-hidden rounded-2xl border border-line">
                  <RoundPicture race={{ ...r, imageUrl: null }} extra={[r.imageUrl]} color={r.series.color} className="aspect-video" imgClassName="transition duration-700 group-hover:scale-105" />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/20">
                    <PlayBadge className="h-12 w-12" />
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.series.color || "rgb(var(--ink))" }} />
                  <span className="truncate text-xs font-bold uppercase tracking-wider text-muted">
                    {r.series.name} · R{r.round}
                  </span>
                </div>
                <div className="truncate font-bold group-hover:opacity-80">{r.name}</div>
                <div className="text-xs text-muted">{dateLong(r.startsAt)}</div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SeriesCard({ card }) {
  const { series, season, leader, nextRace, roundsDone, roundsTotal } = card;
  const color = series.color || "#ffffff";
  return (
    <Link to={`/series/${series.slug}`} className="card lift group relative flex h-full flex-col overflow-hidden">
      <div className="relative aspect-video overflow-hidden">
        <Img
          sources={[series.imageUrl, ...(nextRace ? roundSources(nextRace) : [])]}
          className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-[1.03]"
          fallback={<PosterPanel color={color} label={season?.name} className="absolute inset-0" />}
        />
        <span className="absolute inset-x-0 bottom-0 h-1.5" style={{ background: color }} />
      </div>
      <div className="flex flex-1 flex-col p-6">
        <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-muted">{season?.name ?? "No season yet"}</div>
        <div className="display mt-1 text-3xl">{series.name}</div>
        {series.schedule && <div className="display mt-1 text-sm" style={{ color }}>{series.schedule}</div>}
        <div className="mt-5 grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="eyebrow mb-1">Leader</div>
            {leader ? (
              <>
                <div className="font-bold">{leader.name}</div>
                <div className="text-xs text-muted">
                  {points(leader.points)} pts{leader.team ? ` · ${leader.team.name}` : ""}
                </div>
              </>
            ) : (
              <div className="text-muted">No results yet</div>
            )}
          </div>
          <div>
            <div className="eyebrow mb-1">Next race</div>
            {nextRace ? (
              <>
                <div className="truncate font-bold">{nextRace.name}</div>
                <div className="text-xs text-muted">{dateTime(nextRace.startsAt)}</div>
              </>
            ) : (
              <div className="text-muted">None planned</div>
            )}
          </div>
        </div>
        {roundsTotal > 0 && (
          <div className="mt-auto pt-5">
            <div className="mb-1 flex justify-between text-xs text-muted">
              <span>Season progress</span>
              <span>
                {roundsDone} / {roundsTotal} rounds
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-line">
              <div className="grow-x h-full rounded-full" style={{ width: `${(roundsDone / roundsTotal) * 100}%`, background: color }} />
            </div>
          </div>
        )}
      </div>
    </Link>
  );
}

function Upcoming({ races, banners }) {
  return (
    <section className="card h-full p-6">
      <div className="eyebrow mb-3">Coming up</div>
      {races.length === 0 ? (
        <p className="text-sm text-muted">Nothing else on the calendar yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {races.map((r, i) => (
            <li key={r.id} {...rise(i + 3)}>
              <Link to={`/races/${r.id}`} className="group flex items-center gap-4 py-3">
                <span className="relative h-12 w-20 shrink-0 overflow-hidden rounded-lg">
                  <RoundPicture race={r} extra={[banners[r.series.id]]} color={r.series.color} bare className="h-full w-full" imgClassName="transition duration-500 group-hover:scale-110" />
                  <span
                    className="round-block absolute bottom-1 left-1 h-6 w-6 text-sm"
                    style={{ background: r.series.color || "#fff", color: inkOn(r.series.color || "#fff") }}
                  >
                    {r.round}
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{r.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {r.series.name} · {r.track || "Mystery track"} · {dateTime(r.startsAt)}
                  </span>
                </span>
                <span className="text-xs text-muted">{r.signedUp} in</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
