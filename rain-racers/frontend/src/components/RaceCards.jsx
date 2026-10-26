import { Link } from "react-router-dom";
import { useApi } from "../site.jsx";
import { DriverName, TeamName, TeamDot, Streaks, CountUp, rise } from "./ui.jsx";
import Countdown from "./Countdown.jsx";
import Signup from "./Signup.jsx";
import { dateTime, dateLong, points, hexToRgb } from "../format.js";

// The accent colour as it is set on the page right now, as a hex value.
function accentHex() {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim().split(/\s+/).map(Number);
  return v.length === 3 ? `#${v.map((n) => n.toString(16).padStart(2, "0")).join("")}` : "#ffffff";
}

// Black or white text on a colour, whichever reads.
export function inkOn(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#000";
  const [r, g, b] = rgb.split(" ").map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? "#000" : "#fff";
}

// The next race the way the league announces one: a slanted colour panel
// with the round and the start, the countdown and sign-up next to it.
export function NextRace({ race, color = null, label = "Next race" }) {
  const detail = useApi(race ? `/races/${race.id}` : null);
  if (!race) {
    return (
      <section className="card h-full p-6">
        <div className="eyebrow mb-2">{label}</div>
        <p className="text-muted">No race on the calendar yet.</p>
      </section>
    );
  }
  const start = new Date(race.startsAt);
  return (
    <section className="card h-full overflow-hidden">
      <Link
        to={`/races/${race.id}`}
        className="slant group relative block overflow-hidden bg-accent px-6 pb-9 pt-6 text-accent-ink sm:pr-14"
        style={color ? { background: color, color: inkOn(color) } : undefined}
      >
        <Streaks tone={inkOn(color || accentHex()) === "#000" ? "black" : "white"} opacity={0.09} className="streaks-full" />
        <div className="relative transition-transform duration-300 group-hover:translate-x-1">
        <div className="text-[11px] font-bold uppercase tracking-[0.22em] opacity-70">
          {label} · Round {race.round}
          {race.hasSprint && " · Sprint + Feature"}
        </div>
        <div className="display mt-2 text-3xl sm:text-4xl">{race.name}</div>
        <div className="display mt-3 text-base opacity-80">
          {start.toLocaleDateString("en-GB", { weekday: "long" })}s{" "}
          {start.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}
        </div>
        <div className="mt-1 text-sm opacity-70">
          {race.track} · {dateTime(race.startsAt)}
        </div>
        </div>
      </Link>
      <div className="space-y-5 p-6">
        <Countdown to={race.startsAt} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          {detail.data && <Signup raceId={race.id} status={detail.data.mySignup} onChange={detail.reload} />}
          <Link to={`/races/${race.id}`} className="text-sm text-muted hover:text-ink">
            {detail.data ? detail.data.signups.filter((s) => s.status === "in").length : race.signedUp} signed up →
          </Link>
        </div>
      </div>
    </section>
  );
}

export function LastRace({ race }) {
  return (
    <section className="card h-full p-6">
      <div className="eyebrow mb-2">Last result</div>
      {!race ? (
        <p className="text-muted">No results yet.</p>
      ) : (
        <>
          <Link to={`/races/${race.id}`} className="display text-3xl hover:opacity-80">
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
                  <Link to={`/drivers/${r.driver.id}`} className="block truncate text-sm font-bold hover:opacity-70">
                    {r.driver.name}
                  </Link>
                  <div className="mb-2 flex items-center justify-center gap-1.5 truncate text-xs text-muted">
                    <TeamDot team={r.team} />
                    {r.team?.name ?? "—"}
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
        </>
      )}
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
