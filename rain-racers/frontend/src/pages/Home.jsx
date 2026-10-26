import { Link } from "react-router-dom";
import { useSite, useApi } from "../site.jsx";
import { Loading, ErrorBox, DriverName, TeamName, TeamDot } from "../components/ui.jsx";
import Countdown from "../components/Countdown.jsx";
import Signup from "../components/Signup.jsx";
import { dateTime, dateLong, points } from "../format.js";

export default function Home() {
  const { settings } = useSite();
  const { data, error, loading } = useApi("/home");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  return (
    <div className="space-y-8">
      <Hero settings={settings} season={data.season} done={data.roundsDone} total={data.roundsTotal} />
      <div className="grid gap-6 lg:grid-cols-2">
        <NextRace race={data.nextRace} />
        <LastRace race={data.lastRace} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <TopDrivers rows={data.drivers} />
        <TopTeams rows={data.teams} />
      </div>
    </div>
  );
}

function Hero({ settings, season, done, total }) {
  return (
    <section className="card relative overflow-hidden px-6 py-12 sm:px-10 sm:py-16">
      <div className="rain" aria-hidden="true" />
      <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent/20 blur-3xl" aria-hidden="true" />
      <div className="relative">
        {season && (
          <div className="eyebrow mb-3">
            {season.name}
            {total > 0 && ` · Round ${done} of ${total}`}
          </div>
        )}
        <h1 className="text-5xl font-black uppercase italic leading-none tracking-tight sm:text-7xl">{settings.leagueName}</h1>
        {settings.tagline && <p className="mt-4 max-w-xl text-lg text-muted">{settings.tagline}</p>}
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/drivers" className="btn-accent">
            Standings
          </Link>
          <Link to="/races" className="btn-ghost">
            Calendar
          </Link>
          {settings.discordInvite && (
            <a href={settings.discordInvite} target="_blank" rel="noopener noreferrer" className="btn-ghost">
              Join the Discord
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

function NextRace({ race }) {
  const detail = useApi(race ? `/races/${race.id}` : null);
  return (
    <section className="card p-6">
      <div className="eyebrow mb-2">Next race</div>
      {!race ? (
        <p className="text-muted">No race on the calendar yet.</p>
      ) : (
        <div className="space-y-5">
          <div>
            <Link to={`/races/${race.id}`} className="h2 text-2xl hover:text-accent">
              {race.name}
            </Link>
            <div className="mt-1 text-sm text-muted">
              Round {race.round} · {race.track} · {dateTime(race.startsAt)}
            </div>
          </div>
          <Countdown to={race.startsAt} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            {detail.data && <Signup raceId={race.id} status={detail.data.mySignup} onChange={detail.reload} />}
            <Link to={`/races/${race.id}`} className="text-sm text-muted hover:text-accent">
              {detail.data ? detail.data.signups.filter((s) => s.status === "in").length : race.signedUp} signed up →
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}

function LastRace({ race }) {
  return (
    <section className="card p-6">
      <div className="eyebrow mb-2">Last result</div>
      {!race ? (
        <p className="text-muted">No results yet.</p>
      ) : (
        <>
          <Link to={`/races/${race.id}`} className="h2 text-2xl hover:text-accent">
            {race.name}
          </Link>
          <div className="mt-1 text-sm text-muted">
            Round {race.round} · {race.track} · {dateLong(race.startsAt)}
          </div>
          <ol className="mt-5 grid grid-cols-3 items-end gap-3">
            {[1, 0, 2].map((i) => {
              const r = race.podium[i];
              if (!r) return <li key={i} />;
              const height = ["h-28", "h-20", "h-14"][i];
              const tone = ["bg-amber-400", "bg-slate-300", "bg-orange-400"][i];
              return (
                <li key={i} className="text-center">
                  <Link to={`/drivers/${r.driver.id}`} className="block truncate text-sm font-bold hover:text-accent">
                    {r.driver.name}
                  </Link>
                  <div className="mb-2 flex items-center justify-center gap-1.5 truncate text-xs text-muted">
                    <TeamDot team={r.team} />
                    {r.team?.name ?? "—"}
                  </div>
                  <div className={`${height} ${tone} flex items-start justify-center rounded-t-lg pt-2 text-2xl font-black text-bg`}>
                    {i + 1}
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}

function TopDrivers({ rows }) {
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between px-6 pt-5">
        <h2 className="h2">Drivers</h2>
        <Link to="/drivers" className="text-sm text-muted hover:text-accent">
          Full standings →
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="px-6 pb-6 pt-3 text-sm text-muted">The table fills up after the first race.</p>
      ) : (
        <table className="table mt-3">
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td className="w-10 pl-6 font-black tabular text-muted">{d.position}</td>
                <td>
                  <DriverName driver={d} />
                  <div className="text-xs text-muted">{d.team?.name ?? ""}</div>
                </td>
                <td className="pr-6 text-right text-lg font-black tabular">{points(d.points)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function TopTeams({ rows }) {
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between px-6 pt-5">
        <h2 className="h2">Teams</h2>
        <Link to="/teams" className="text-sm text-muted hover:text-accent">
          All teams →
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="px-6 pb-6 pt-3 text-sm text-muted">No team points yet.</p>
      ) : (
        <table className="table mt-3">
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td className="w-10 pl-6 font-black tabular text-muted">{t.position}</td>
                <td>
                  <TeamName team={t} />
                </td>
                <td className="pr-6 text-right text-lg font-black tabular">{points(t.points)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
