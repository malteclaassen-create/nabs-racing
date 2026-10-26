import { Link } from "react-router-dom";
import { useSite, useApi } from "../site.jsx";
import { Loading, ErrorBox, Logo, Streaks, SocialButtons, SeriesBadge, TeamDot, Empty } from "../components/ui.jsx";
import { NextRace, inkOn } from "../components/RaceCards.jsx";
import { dateTime, dateLong, points } from "../format.js";

// The league's home: every series it runs at a glance, then the next races
// and the latest results across all of them.
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
            <div className="eyebrow mb-4">
              {data.series.length} series · Assetto Corsa
            </div>
            <h1 className="display max-w-[10ch] text-6xl sm:text-8xl">{settings.leagueName}</h1>
            {settings.tagline && <p className="mt-6 max-w-xl text-lg text-muted">{settings.tagline}</p>}
            <div className="mt-8 flex flex-wrap gap-3">
              {data.series[0] && (
                <Link to={`/series/${data.series[0].series.slug}/drivers`} className="btn-accent">
                  Standings
                </Link>
              )}
              <SocialButtons />
            </div>
          </div>
          <div className="hidden justify-center lg:flex">
            <Logo size={300} />
          </div>
        </div>
      </section>

      {data.series.length === 0 ? (
        <Empty>No series yet. Create the first one in the admin under Series &amp; seasons.</Empty>
      ) : (
        <section>
          <h2 className="h2 mb-4 text-2xl">Series</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {data.series.map((c) => (
              <SeriesCard key={c.series.id} card={c} />
            ))}
          </div>
        </section>
      )}

      {first && (
        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <NextRace race={first} color={first.series.color} label={first.series.name} />
          <Upcoming races={data.upcoming.slice(1)} />
        </div>
      )}

      {data.latest.length > 0 && (
        <section>
          <h2 className="h2 mb-4 text-2xl">Latest results</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {data.latest.map((r) => (
              <Link key={r.id} to={`/races/${r.id}`} className="card block p-5 transition hover:border-ink/40">
                <SeriesBadge series={r.series} />
                <div className="display mt-3 text-xl">{r.track || r.name}</div>
                <div className="text-xs text-muted">
                  {r.name} · {dateLong(r.startsAt)}
                </div>
                <ol className="mt-4 space-y-1.5 text-sm">
                  {r.podium.map((p) => (
                    <li key={p.id} className="flex items-center gap-2">
                      <span className="w-4 font-black text-muted">{p.position}</span>
                      <TeamDot team={p.team} />
                      <span className="truncate font-semibold">{p.driver.name}</span>
                    </li>
                  ))}
                </ol>
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
    <Link to={`/series/${series.slug}`} className="card group relative block overflow-hidden transition hover:border-ink/40">
      <div className="slant px-6 pb-7 pt-5" style={{ background: color, color: inkOn(color) }}>
        <div className="text-[11px] font-bold uppercase tracking-[0.22em] opacity-70">{season?.name ?? "No season yet"}</div>
        <div className="display mt-1 text-3xl">{series.name}</div>
        {series.schedule && <div className="display mt-2 text-sm opacity-80">{series.schedule}</div>}
      </div>
      <div className="grid grid-cols-2 gap-4 p-6 text-sm">
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
              <div className="font-bold">{nextRace.track || nextRace.name}</div>
              <div className="text-xs text-muted">{dateTime(nextRace.startsAt)}</div>
            </>
          ) : (
            <div className="text-muted">None planned</div>
          )}
        </div>
        {roundsTotal > 0 && (
          <div className="col-span-2">
            <div className="mb-1 flex justify-between text-xs text-muted">
              <span>Season progress</span>
              <span>
                {roundsDone} / {roundsTotal} rounds
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full" style={{ width: `${(roundsDone / roundsTotal) * 100}%`, background: color }} />
            </div>
          </div>
        )}
      </div>
    </Link>
  );
}

function Upcoming({ races }) {
  return (
    <section className="card p-6">
      <div className="eyebrow mb-3">Coming up</div>
      {races.length === 0 ? (
        <p className="text-sm text-muted">Nothing else on the calendar yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {races.map((r) => (
            <li key={r.id}>
              <Link to={`/races/${r.id}`} className="flex items-center gap-4 py-3 hover:opacity-80">
                <span className="round-block h-10 w-10 text-xl" style={{ background: r.series.color || "#fff", color: inkOn(r.series.color || "#fff") }}>
                  {r.round}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{r.track || r.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {r.series.name} · {dateTime(r.startsAt)}
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
