import { Link } from "react-router-dom";
import { useApi } from "../site.jsx";
import { DriverName, TeamName, TeamDot, rise } from "./ui.jsx";
import Countdown from "./Countdown.jsx";
import Signup from "./Signup.jsx";
import { RoundPicture, PlayBadge } from "./Picture.jsx";
import { dateLong, dayShort, clock, points, inkOn } from "../format.js";

export { inkOn };

// Where, with what and how many races: "Phakisa Freeway · Formula 4 (KERS) · 2 races".
export function RoundFacts({ race, className = "" }) {
  const facts = [
    race.mysteryTrack && !race.track ? "Mystery track" : race.track || null,
    race.car || null,
    race.raceCount > 1 ? `${race.raceCount} races` : null,
  ].filter(Boolean);
  return (
    <div className={`text-sm text-muted ${className}`}>
      {facts.join(" · ")}
      {race.pointsMultiplier > 1 && <span className="rounded border border-amber-400/50 px-1.5 py-0.5 text-[10px] font-black uppercase text-amber-300">×{race.pointsMultiplier} points</span>}
    </div>
  );
}

// The day's sessions with their local start and length.
export function Timetable({ rows, className = "" }) {
  if (!rows?.length) return null;
  return (
    <ol className={`grid gap-1.5 text-sm ${className}`} style={{ gridTemplateColumns: "repeat(auto-fit, minmax(5.5rem, 1fr))" }}>
      {rows.map((t, i) => (
        <li key={i} className="rounded-xl border border-line bg-bg px-3 py-2">
          <div className="truncate text-[10px] font-bold uppercase tracking-wider text-muted">{t.label}</div>
          <div className="font-black italic tabular">{t.at ? clock(t.at) : "—"}</div>
          {t.length && <div className="truncate text-xs text-muted">{t.length}</div>}
        </li>
      ))}
    </ol>
  );
}

// The next race the way the league announces one: its poster up top, then
// the round, where and with what, the countdown, the day's sessions and the
// sign-up.
export function NextRace({ race, color = null, label = "Next race", extraImages = [], emptyText = "No race on the calendar yet." }) {
  const detail = useApi(race ? `/races/${race.id}` : null);
  if (!race) {
    return (
      <section className="card flex h-full flex-col justify-center p-6">
        <div className="eyebrow mb-2">{label}</div>
        <p className="text-muted">{emptyText}</p>
      </section>
    );
  }
  const accent = color || "rgb(var(--accent))";
  const signedUp = detail.data ? detail.data.signups.filter((s) => s.status === "in").length : race.signedUp;
  return (
    <section className="card flex h-full flex-col overflow-hidden">
      <Link to={`/races/${race.id}`} className="group relative block">
        <RoundPicture race={race} extra={extraImages} color={color} label={label} imgClassName="transition duration-700 group-hover:scale-[1.03]" />
        <span className="absolute inset-x-0 bottom-0 h-1" style={{ background: accent }} />
        <span className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full bg-black/80 px-3 py-1 text-[11px] font-black uppercase italic tracking-wider text-white">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
          {label}
        </span>
      </Link>
      <div className="flex flex-1 flex-col gap-5 p-6">
        <div>
          <div className="eyebrow mb-1">
            Round {race.round} · {dayShort(race.startsAt)} · {clock(race.startsAt)}
          </div>
          <Link to={`/races/${race.id}`} className="display block text-3xl hover:opacity-80 sm:text-4xl">
            {race.name}
          </Link>
          <RoundFacts race={race} className="mt-3" />
        </div>
        <p className="text-sm text-muted">
          Starts in <Countdown to={race.startsAt} className="text-ink" />
        </p>
        {detail.data?.timetable?.length > 0 && <Timetable rows={detail.data.timetable} />}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          {detail.data?.signupOpen && <Signup raceId={race.id} status={detail.data.mySignup} onChange={detail.reload} />}
          <Link to={`/races/${race.id}`} className="ml-auto inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <b className="text-ink">{signedUp}</b> signed up →
          </Link>
        </div>
      </div>
    </section>
  );
}

// The latest round with results: its poster (with the recording, if there
// is one) and the podium. With more races in a round, the podium is the
// day's points.
export function LastRace({ race, color = null }) {
  if (!race) {
    return (
      <section className="card flex h-full flex-col justify-center p-6">
        <div className="eyebrow mb-2">Last result</div>
        <p className="text-muted">No results yet.</p>
      </section>
    );
  }
  return (
    <section className="card flex h-full flex-col overflow-hidden">
      <Link to={`/races/${race.id}`} className="group relative block">
        <RoundPicture race={race} color={color} label="Last result" imgClassName="transition duration-700 group-hover:scale-[1.03]" />
        {race.videoUrl && (
          <span className="absolute right-4 top-4">
            <PlayBadge className="h-11 w-11" />
          </span>
        )}
      </Link>
      <div className="flex flex-1 flex-col p-6">
        <div className="eyebrow mb-1">
          {race.done ? "Last result" : "Last round"} · Round {race.round}
        </div>
        <Link to={`/races/${race.id}`} className="display block text-3xl hover:opacity-80">
          {race.name}
        </Link>
        <div className="mt-1 text-sm text-muted">
          {race.track || "Mystery track"} · {dateLong(race.startsAt)}
          {race.raceCount > 1 && race.done && <span> · {race.raceCount} races, by points</span>}
        </div>
        {race.podium.length === 0 && (
          <p className="mt-4 text-sm text-muted">{race.videoUrl ? "No results on record for this round. The recording is up." : "No results on record for this round."}</p>
        )}
        <ol className="mt-auto divide-y divide-line pt-4">
          {race.podium.map((r, i) => (
            <li key={r.driver.id} className="flex items-center gap-3 py-2">
              <span className="w-5 font-black italic tabular text-muted">{i + 1}</span>
              <Link to={`/drivers/${r.driver.id}`} className="min-w-0 truncate font-bold hover:opacity-70">
                {r.driver.name}
              </Link>
              <span className="ml-auto flex shrink-0 items-center gap-1.5 text-sm text-muted">
                {r.team && <TeamDot team={r.team} />}
                {r.team ? r.team.name : `${points(r.points)} pts`}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function TopDrivers({ rows, more }) {
  return (
    <section className="card h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 pt-5">
        <h2 className="h2">Drivers</h2>
        <Link to={more} className="text-sm text-muted hover:opacity-70">
          Full standings →
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="px-6 pb-6 pt-3 text-sm text-muted">The table fills up after the first race.</p>
      ) : (
        <table className="table mt-3">
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} {...rise(d.position, 50)}>
                <td className="w-10 pl-6 font-black tabular text-muted">{d.position}</td>
                <td>
                  <DriverName driver={d} />
                  <div className="text-xs text-muted">{d.team?.name ?? ""}</div>
                </td>
                <td className="pr-6 text-right text-lg font-black tabular">
                  {points(d.points)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function TopTeams({ rows, more }) {
  return (
    <section className="card h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 pt-5">
        <h2 className="h2">Teams</h2>
        <Link to={more} className="text-sm text-muted hover:opacity-70">
          All teams →
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="px-6 pb-6 pt-3 text-sm text-muted">No team points yet.</p>
      ) : (
        <table className="table mt-3">
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} {...rise(t.position, 50)}>
                <td className="w-10 pl-6 font-black tabular text-muted">{t.position}</td>
                <td>
                  <TeamName team={t} />
                </td>
                <td className="pr-6 text-right text-lg font-black tabular">
                  {points(t.points)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
