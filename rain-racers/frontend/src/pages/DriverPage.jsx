import { useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { useApi, useSite } from "../site.jsx";
import { Loading, ErrorBox, Empty, Position, TeamName, SeriesBadge, Streaks } from "../components/ui.jsx";
import { Img, PosterPanel, thumbnails } from "../components/Picture.jsx";
import LineChart from "../components/LineChart.jsx";
import { flag, points, inkOn } from "../format.js";

// A driver: who they are and what they have done across every series, then
// one season in detail. The page opens on the season the visitor came from
// (a link from a standings table or a race passes it; else the season of
// the series on screen), and on their latest one when they did not race it.
export default function DriverPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { seasonId } = useSite();
  const asked = params.get("season") || seasonId;
  const { data, error, loading } = useApi(`/drivers/${id}${asked ? `?season=${asked}` : ""}`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const { driver, career, detail } = data;
  const color = detail?.team?.color || detail?.season.series.color || "#ffffff";

  return (
    <div className="space-y-8">
      <Hero driver={driver} detail={detail} career={career} color={color} />
      {career.length > 1 && <Seasons career={career} current={detail?.season.id} onPick={(sid) => setParams({ season: sid })} />}
      {detail && <SeasonDetail driver={driver} detail={detail} />}
    </div>
  );
}

// Name, number, flag, team and the career in five numbers.
function Hero({ driver, detail, career, color }) {
  const total = (k) => career.reduce((sum, c) => sum + (c[k] || 0), 0);
  const titles = career.filter((c) => c.champion && c.rounds > 1).length;
  const facts = [
    ["Seasons", career.length],
    ["Starts", total("starts")],
    ["Wins", total("wins")],
    ["Podiums", total("podiums")],
    ["Titles", titles],
  ];
  return (
    <section className="card relative overflow-hidden">
      <Streaks />
      <span className="absolute inset-y-0 left-0 w-2" style={{ background: color }} />
      <div className="relative grid gap-8 p-6 sm:p-10 lg:grid-cols-[1fr_auto] lg:items-end">
        <div className="flex min-w-0 items-center gap-5 sm:gap-7">
          {driver.avatar ? (
            <img src={driver.avatar} alt="" className="h-20 w-20 shrink-0 rounded-full ring-2 ring-white/20 sm:h-28 sm:w-28" />
          ) : (
            <span className="display flex h-20 w-20 shrink-0 items-center justify-center rounded-full text-4xl sm:h-28 sm:w-28 sm:text-5xl" style={{ background: color, color: inkOn(color) }}>
              {detail?.number ?? driver.name[0]?.toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="display text-4xl leading-[0.95] [overflow-wrap:anywhere] sm:text-6xl">{driver.name}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
              {detail?.number != null && <span className="font-black italic text-ink">#{detail.number}</span>}
              {driver.country && <span className="text-xl">{flag(driver.country)}</span>}
              {detail?.team && <TeamName team={detail.team} />}
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-5 gap-4 sm:gap-8">
          {facts.map(([label, value]) => (
            <div key={label} className="flex flex-col-reverse">
              <dt className="mt-1.5 text-xs text-muted sm:text-sm">{label}</dt>
              <dd className="display text-3xl leading-none sm:text-4xl">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

// Every season they raced, newest first, as the series' banners: where they
// finished, with their points. The one shown below is framed.
function Seasons({ career, current, onPick }) {
  return (
    <section>
      <h2 className="h2 mb-3">Seasons</h2>
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        {career.map((c) => {
          const s = c.season;
          const color = s.series.color || "#ffffff";
          const on = s.id === current;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onPick(s.id)}
              aria-pressed={on}
              className={`w-60 shrink-0 overflow-hidden rounded-2xl border bg-card text-left transition ${on ? "border-ink" : "border-line opacity-75 hover:opacity-100"}`}
            >
              <div className="relative aspect-[16/7] overflow-hidden">
                <Img sources={[c.imageUrl, ...thumbnails(c.videoUrl)]} className="absolute inset-0 h-full w-full object-cover" fallback={<PosterPanel color={color} className="absolute inset-0" />} />
                <span className="absolute inset-x-0 bottom-0 h-1" style={{ background: color }} />
              </div>
              <div className="p-3.5">
                <div className="truncate text-xs text-muted">{s.series.name}</div>
                <div className="truncate font-bold">{s.name}</div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="display text-2xl leading-none">{c.position ? `P${c.position}` : "–"}</span>
                  <span className="text-sm text-muted">{points(c.points)} pts</span>
                  {c.champion && c.finished && <span className="ml-auto text-xs font-black uppercase text-amber-300">{c.rounds === 1 ? "Winner" : "Champion"}</span>}
                  {!c.finished && <span className="ml-auto text-xs text-muted">running</span>}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function SeasonDetail({ driver, detail }) {
  const s = detail.stats;
  const st = detail.standing;
  const stats = [
    ["Wins", s.wins],
    ["Podiums", s.podiums],
    ["Poles", s.poles],
    ["Fastest laps", s.fastestLaps],
    ["Starts", s.starts],
    ["Best finish", s.bestFinish ? `P${s.bestFinish}` : "–"],
    ["Avg finish", s.avgFinish ?? "–"],
    ["Avg grid", s.avgGrid ?? "–"],
    ["Places gained", s.placesGained > 0 ? `+${s.placesGained}` : s.placesGained],
    ["DNFs", s.dnfs],
  ];
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <SeriesBadge series={detail.season.series} />
            <span className="eyebrow">{detail.season.name}</span>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="display text-5xl leading-none">{st ? `P${st.position}` : "–"}</span>
            {st && <span className="text-muted">of {st.of}</span>}
            <span className="display text-3xl leading-none">{st ? points(st.points) : 0}</span>
            <span className="text-muted">points</span>
            {st?.champion && <span className="rounded-full bg-amber-400 px-2.5 py-0.5 text-xs font-black uppercase text-black">Champion</span>}
          </div>
        </div>
      </div>

      <dl className="card grid grid-cols-3 gap-px overflow-hidden bg-line sm:grid-cols-5">
        {stats.map(([label, value]) => (
          <div key={label} className="flex flex-col-reverse bg-card px-4 py-3 sm:px-5 sm:py-4">
            <dt className="text-xs text-muted sm:text-sm">{label}</dt>
            <dd className="text-xl font-black italic tabular sm:text-2xl">{value}</dd>
          </div>
        ))}
      </dl>

      {detail.form.length === 0 ? (
        <Empty>No races in this season yet.</Empty>
      ) : (
        <>
          <RaceTable detail={detail} />
          {detail.form.length >= 3 && <FormChart key={detail.season.id} form={detail.form} />}
          {detail.rivals.length > 0 && <HeadToHead key={detail.season.id} driver={driver} detail={detail} />}
        </>
      )}
    </section>
  );
}

// Finishing positions round by round (top = P1): one line per race of the
// rounds, with the grid behind them.
const RACE_COLORS = ["rgb(var(--accent))", "#f97316", "#a855f7", "#22c55e"];
function FormChart({ form }) {
  const labels = form.map((f) => `R${f.round}`);
  const pos = (r) => (r && r.status === "FIN" ? r.position : null);
  const most = Math.max(1, ...form.map((f) => f.races.length));
  const lines = [
    ...Array.from({ length: most }, (_, i) => ({
      id: `race${i + 1}`,
      label: most > 1 ? `Race ${i + 1}` : "Race",
      color: RACE_COLORS[i % RACE_COLORS.length],
      dashed: i > 0,
      values: form.map((f) => pos(f.races[i])),
    })),
    ...(form.some((f) => f.grid != null) ? [{ id: "grid", label: "Grid", color: "#94a3b8", dashed: true, values: form.map((f) => f.grid) }] : []),
  ];
  return (
    <section className="card p-6">
      <h3 className="h2 mb-4">Form</h3>
      <LineChart labels={labels} lines={lines} invert height={220} valueLabel={(v) => `P${v}`} initialVisible={lines.length} />
    </section>
  );
}

function RaceTable({ detail }) {
  const most = Math.max(1, ...detail.form.map((f) => f.races.length));
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th className="w-14 pl-5">Rd</th>
            <th>Race</th>
            <th className="hidden text-center sm:table-cell">Quali</th>
            <th className="hidden text-center sm:table-cell">Grid</th>
            {Array.from({ length: most }, (_, i) => (
              <th key={i} className="text-center">
                {most > 1 ? `Race ${i + 1}` : "Finish"}
              </th>
            ))}
            <th className="pr-5 text-right">Points</th>
          </tr>
        </thead>
        <tbody>
          {detail.form.map((f) => (
            <tr key={f.raceId}>
              <td className="pl-5 font-black italic text-muted">{f.round}</td>
              <td>
                <Link to={`/races/${f.raceId}`} className="font-semibold hover:opacity-70">
                  {f.name}
                </Link>
                {f.pole && <span className="ml-2 text-[11px] font-black text-sky-300">POLE</span>}
                {f.fastestLap && <span className="ml-2 text-[11px] font-black text-fuchsia-400">FASTEST LAP</span>}
                {f.track && <div className="text-xs text-muted lg:text-sm">{f.track}</div>}
              </td>
              <td className="hidden text-center tabular text-muted sm:table-cell">{f.quali ? `P${f.quali}` : "–"}</td>
              <td className="hidden text-center tabular text-muted sm:table-cell">{f.grid ?? "–"}</td>
              {Array.from({ length: most }, (_, i) => (
                <td key={i} className="text-center">
                  {f.races[i] ? <Position value={f.races[i].position} status={f.races[i].status} /> : <span className="text-muted">–</span>}
                </td>
              ))}
              <td className="pr-5 text-right font-black tabular lg:text-lg">{points(f.points)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HeadToHead({ driver, detail }) {
  const [other, setOther] = useState(detail.rivals[0]?.id ?? null);
  const { data } = useApi(other ? `/drivers/${driver.id}/h2h?season=${detail.season.id}&other=${other}` : null);
  const bar = (a, b, label) => {
    const total = a + b || 1;
    return (
      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <b className="display text-2xl leading-none">{a}</b>
          <span className="text-sm text-muted">{label}</span>
          <b className="display text-2xl leading-none text-muted">{b}</b>
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-line">
          <div className="h-full bg-accent transition-[width] duration-700 ease-out" style={{ width: `${(a / total) * 100}%` }} />
          <div className="h-full bg-white/30 transition-[width] duration-700 ease-out" style={{ width: `${(b / total) * 100}%` }} />
        </div>
      </div>
    );
  };
  return (
    <section className="card p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h3 className="h2">Head to head</h3>
        <select className="input w-auto" value={other ?? ""} onChange={(e) => setOther(Number(e.target.value))} aria-label="Compare with">
          {detail.rivals.map((r) => (
            <option key={r.id} value={r.id}>
              vs {r.name}
            </option>
          ))}
        </select>
      </div>
      {!data ? null : data.rounds.length === 0 ? (
        <p className="text-sm text-muted">No round where both took the start.</p>
      ) : (
        <div className="space-y-5">
          <div className="flex justify-between font-bold">
            <span>{driver.name}</span>
            <span className="text-muted">{data.other.name}</span>
          </div>
          {bar(data.race.a, data.race.b, "Ahead in the race")}
          {data.quali.a + data.quali.b > 0 && bar(data.quali.a, data.quali.b, "Ahead in qualifying")}
          {bar(data.points.a, data.points.b, "Points")}
          <p className="text-xs text-muted">Over the {data.rounds.length === 1 ? "round" : `${data.rounds.length} rounds`} both started.</p>
        </div>
      )}
    </section>
  );
}
