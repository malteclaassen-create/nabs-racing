import { useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { useApi } from "../site.jsx";
import { Loading, ErrorBox, Empty, Position, TeamName, SeriesBadge, CountUp, rise } from "../components/ui.jsx";
import LineChart from "../components/LineChart.jsx";
import { flag, points } from "../format.js";

export default function DriverPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const season = params.get("season");
  const { data, error, loading } = useApi(`/drivers/${id}${season ? `?season=${season}` : ""}`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const { driver, career, detail } = data;
  const color = detail?.team?.color || "rgb(var(--accent))";

  return (
    <div className="space-y-6">
      <section className="card relative overflow-hidden p-6 sm:p-8">
        <div className="absolute inset-y-0 left-0 w-2" style={{ background: color }} />
        <div className="flex flex-wrap items-end justify-between gap-4 pl-2">
          <div>
            {detail && (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <SeriesBadge series={detail.season.series} />
                <span className="eyebrow">{detail.season.name}</span>
              </div>
            )}
            <h1 className="h1 flex flex-wrap items-center gap-3">
              {detail?.number != null && <span className="text-muted">#{detail.number}</span>}
              <span className="title-line">
                <span style={{ "--d": "80ms" }}>{driver.name}</span>
              </span>
              {driver.country && <span className="text-3xl not-italic">{flag(driver.country)}</span>}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <TeamName team={detail?.team} />
              {detail?.standing?.champion && <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-black uppercase text-black">Champion</span>}
            </div>
          </div>
          {career.length > 1 && (
            <select
              className="input w-auto"
              value={detail?.season.id ?? ""}
              onChange={(e) => setParams({ season: e.target.value })}
              aria-label="Season"
            >
              {career.map((c) => (
                <option key={c.season.id} value={c.season.id}>
                  {c.season.series.name} · {c.season.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {detail && <StatTiles detail={detail} />}
      </section>

      {!detail || detail.form.length === 0 ? (
        <Empty>No races yet.</Empty>
      ) : (
        <>
          <FormChart key={detail.season.id} form={detail.form} />
          <RaceTable detail={detail} />
          {detail.rivals.length > 0 && <HeadToHead key={detail.season.id} driver={driver} detail={detail} />}
        </>
      )}

      {career.length > 0 && <Career career={career} />}
    </div>
  );
}

function StatTiles({ detail }) {
  const s = detail.stats;
  const tiles = [
    ["Position", detail.standing ? `P${detail.standing.position}` : "—"],
    ["Points", detail.standing ? <CountUp value={detail.standing.points} format={points} /> : "0"],
    ["Wins", <CountUp value={s.wins} />],
    ["Podiums", <CountUp value={s.podiums} />],
    ["Poles", <CountUp value={s.poles} />],
    ["Fastest laps", <CountUp value={s.fastestLaps} />],
    ["Starts", <CountUp value={s.starts} />],
    ["Best finish", s.bestFinish ? `P${s.bestFinish}` : "—"],
    ["Avg finish", s.avgFinish ?? "—"],
    ["Avg grid", s.avgGrid ?? "—"],
    ["Places gained", s.placesGained > 0 ? `+${s.placesGained}` : s.placesGained],
    ["DNFs", s.dnfs],
  ];
  if (s.sprintWins || s.sprintPodiums) tiles.push(["Sprint wins", s.sprintWins], ["Sprint podiums", s.sprintPodiums]);
  return (
    <dl className="mt-6 grid grid-cols-2 gap-2 pl-2 sm:grid-cols-4 lg:grid-cols-6">
      {tiles.map(([label, value], i) => (
        <div key={label} {...rise(i, 40)} className="rise rounded-xl border border-transparent bg-bg px-4 py-3 transition-colors hover:border-line">
          <dt className="text-[10px] font-bold uppercase tracking-widest text-muted">{label}</dt>
          <dd className="text-2xl font-black italic tabular">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// Finishing positions round by round (top = P1), with the grid and the
// sprint behind them.
function FormChart({ form }) {
  const labels = form.map((f) => `R${f.round}`);
  const pos = (r) => (r && r.status === "FIN" ? r.position : null);
  const lines = [
    { id: "race", label: "Race", color: "rgb(var(--accent))", values: form.map((f) => pos(f.finish)) },
    ...(form.some((f) => f.grid != null) ? [{ id: "grid", label: "Grid", color: "#94a3b8", dashed: true, values: form.map((f) => f.grid) }] : []),
    ...(form.some((f) => f.sprint) ? [{ id: "sprint", label: "Sprint", color: "#f97316", dashed: true, values: form.map((f) => pos(f.sprint)) }] : []),
  ];
  return (
    <section className="card rise p-6">
      <h2 className="h2 mb-4">Season form</h2>
      <LineChart labels={labels} lines={lines} invert height={220} valueLabel={(v) => `P${v}`} initialVisible={3} />
    </section>
  );
}

function RaceTable({ detail }) {
  const anySprint = detail.form.some((f) => f.sprint);
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th className="hidden pl-5 sm:table-cell">Round</th>
            <th className="pl-5 sm:pl-3">Race</th>
            <th className="hidden text-center sm:table-cell">Quali</th>
            <th className="hidden text-center sm:table-cell">Grid</th>
            <th>Finish</th>
            {anySprint && <th>Sprint</th>}
            <th className="pr-5 text-right">Points</th>
          </tr>
        </thead>
        <tbody>
          {detail.form.map((f) => (
            <tr key={f.raceId}>
              <td className="hidden pl-5 text-muted sm:table-cell">R{f.round}</td>
              <td className="pl-5 sm:pl-3">
                <Link to={`/races/${f.raceId}`} className="font-semibold hover:opacity-70">
                  {f.track || f.name}
                </Link>
                {f.pole && <span className="ml-2 text-[10px] font-black text-sky-300">POLE</span>}
                {f.fastestLap && <span className="ml-2 text-[10px] font-black text-fuchsia-400">FL</span>}
              </td>
              <td className="hidden text-center tabular text-muted sm:table-cell">{f.quali ? `P${f.quali}` : "·"}</td>
              <td className="hidden text-center tabular text-muted sm:table-cell">{f.grid ?? "·"}</td>
              <td>{f.finish ? <Position value={f.finish.position} status={f.finish.status} /> : <span className="text-muted">·</span>}</td>
              {anySprint && <td>{f.sprint ? <Position value={f.sprint.position} status={f.sprint.status} /> : <span className="text-muted">·</span>}</td>}
              <td className="pr-5 text-right font-black tabular">{points(f.points)}</td>
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
        <div className="mb-1 flex justify-between text-sm">
          <b className="tabular">{a}</b>
          <span className="text-xs font-bold uppercase tracking-widest text-muted">{label}</span>
          <b className="tabular">{b}</b>
        </div>
        <div className="grow-x flex h-2.5 overflow-hidden rounded-full bg-line">
          <div className="h-full bg-accent transition-[width] duration-700 ease-out" style={{ width: `${(a / total) * 100}%` }} />
          <div className="h-full bg-white/30 transition-[width] duration-700 ease-out" style={{ width: `${(b / total) * 100}%` }} />
        </div>
      </div>
    );
  };
  return (
    <section className="card p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="h2">Head to head</h2>
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
        <div className="space-y-4">
          <div className="flex justify-between text-sm font-bold">
            <span>{driver.name}</span>
            <span className="text-muted">{data.other.name}</span>
          </div>
          {bar(data.race.a, data.race.b, "Race")}
          {data.quali.a + data.quali.b > 0 && bar(data.quali.a, data.quali.b, "Qualifying")}
          {bar(data.points.a, data.points.b, "Points")}
          <p className="text-xs text-muted">Over the {data.rounds.length} rounds both started.</p>
        </div>
      )}
    </section>
  );
}

function Career({ career }) {
  return (
    <section>
      <h2 className="h2 mb-3">Career</h2>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="pl-5">Series</th>
              <th>Season</th>
              <th className="hidden md:table-cell">Team</th>
              <th className="text-center">Pos</th>
              <th className="hidden text-center sm:table-cell">Starts</th>
              <th className="text-center">Wins</th>
              <th className="hidden text-center sm:table-cell">Podiums</th>
              <th className="hidden text-center sm:table-cell">Poles</th>
              <th className="pr-5 text-right">Points</th>
            </tr>
          </thead>
          <tbody>
            {career.map((c) => (
              <tr key={c.season.id}>
                <td className="pl-5">
                  <SeriesBadge series={c.season.series} />
                </td>
                <td>{c.season.name}</td>
                <td className="hidden md:table-cell">
                  <TeamName team={c.team} />
                </td>
                <td className="text-center font-black tabular">
                  {c.position ? `P${c.position}` : "—"}
                  {c.champion && <span className="ml-1 text-amber-300">★</span>}
                </td>
                <td className="hidden text-center tabular sm:table-cell">{c.starts}</td>
                <td className="text-center tabular">{c.wins}</td>
                <td className="hidden text-center tabular sm:table-cell">{c.podiums}</td>
                <td className="hidden text-center tabular sm:table-cell">{c.poles}</td>
                <td className="pr-5 text-right font-black tabular">{points(c.points)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
