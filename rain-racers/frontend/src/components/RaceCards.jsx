import { Link } from "react-router-dom";
import { useApi } from "../site.jsx";
import { DriverName, TeamName, TeamDot, CountUp, rise } from "./ui.jsx";
import Countdown from "./Countdown.jsx";
import Signup from "./Signup.jsx";
import { RoundPicture, PlayBadge } from "./Picture.jsx";
import { dateLong, dayShort, clock, points, inkOn } from "../format.js";

export { inkOn };

const Icon = ({ d, className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const ICON = {
  flag: "M5 21V4M5 4h11l-2 4 2 4H5",
  car: "M5 16h14M6.5 16l1.4-5.2A2 2 0 0 1 9.8 9.3h4.4a2 2 0 0 1 1.9 1.5L17.5 16M7 19.5h.01M17 19.5h.01M4 16v3h16v-3",
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  laps: "M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4",
};

// Where, with what and how many races, as a line of small facts.
export function RoundFacts({ race, className = "" }) {
  const facts = [
    race.mysteryTrack && !race.track ? [ICON.flag, "Mystery track", "text-amber-300"] : race.track ? [ICON.flag, race.track] : null,
    race.car ? [ICON.car, race.car] : null,
    race.raceCount > 1 ? [ICON.laps, `${race.raceCount} races`] : null,
  ].filter(Boolean);
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted ${className}`}>
      {facts.map(([d, text, tone]) => (
        <span key={text} className={`inline-flex items-center gap-1.5 ${tone || ""}`}>
          <Icon d={d} />
          {text}
        </span>
      ))}
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
          <div className="truncate text-[10px] font-bold uppercase tracking-widest text-muted">{t.label}</div>
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
          <span className="live-dot h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
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
        <Countdown to={race.startsAt} compact />
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
          {race.raceCount > 1 && race.done && <span> · podium on points over {race.raceCount} races</span>}
        </div>
        {race.podium.length === 0 && (
          <p className="mt-4 text-sm text-muted">{race.videoUrl ? "No results on record for this round. The recording is up." : "No results on record for this round."}</p>
        )}
        <ol className="mt-auto grid grid-cols-3 items-end gap-3 pt-6">
          {[1, 0, 2].map((i) => {
            const r = race.podium[i];
            if (!r) return <li key={i} />;
            const height = ["h-24", "h-16", "h-12"][i];
            const tone = ["bg-amber-400", "bg-slate-300", "bg-orange-400"][i];
            return (
              <li key={i} className="min-w-0 text-center">
                <Link to={`/drivers/${r.driver.id}`} className="block truncate text-sm font-bold hover:opacity-70">
                  {r.driver.name}
                </Link>
                <div className="mb-2 flex items-center justify-center gap-1.5 truncate text-xs text-muted">
                  {r.team ? (
                    <>
                      <TeamDot team={r.team} />
                      {r.team.name}
                    </>
                  ) : (
                    `${points(r.points)} pts`
                  )}
                </div>
                <div
                  className={`${height} ${tone} grow-up flex items-start justify-center rounded-t-lg pt-2 text-2xl font-black italic text-black`}
                  style={{ "--d": `${200 + [1, 0, 2].indexOf(i) * 150}ms` }}
                >
                  {i + 1}
                </div>
              </li>
            );
          })}
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
                  <CountUp value={d.points} format={points} />
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
                  <CountUp value={t.points} format={points} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
