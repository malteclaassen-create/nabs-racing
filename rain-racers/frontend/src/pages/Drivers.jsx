import { useState } from "react";
import { useSite, useApi } from "../site.jsx";
import { Loading, ErrorBox, Empty, PageHeader, SeasonPicker, DriverName, TeamName, rise } from "../components/ui.jsx";
import LineChart from "../components/LineChart.jsx";
import { points } from "../format.js";

// The colour of a race's cell: podiums stand out, a DNF is dimmed.
function cellTone(r) {
  if (!r || r.status !== "FIN") return "text-muted";
  if (r.position === 1) return "bg-amber-400/20 text-amber-300";
  if (r.position <= 3) return "bg-accent/15 text-ink";
  return "";
}

const place = (r) => (!r ? "–" : r.status === "FIN" ? r.position : r.status);

// A round in the table: the finish of each of its races, side by side, with
// the pole, fastest laps and a dropped round marked.
function RoundCell({ r }) {
  if (!r) return <span className="text-muted/40">·</span>;
  const races = r.races || [];
  const title = [
    `${points(r.points)} pts`,
    ...(races.length > 1 ? races.map((x, i) => `race ${i + 1}: ${x ? (x.status === "FIN" ? `P${x.position}` : x.status) : "–"}`) : []),
    r.qualiPoints ? `${points(r.qualiPoints)} qualifying pts` : null,
    r.pole ? "pole" : null,
    races.some((x) => x?.fastestLap) ? "fastest lap" : null,
    r.dropped ? "dropped" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className={`inline-flex gap-0.5 ${r.dropped ? "opacity-50" : ""}`} title={title}>
      {(races.length ? races : [null]).map((x, i) => (
        <span key={i} className={`inline-flex min-w-7 items-center justify-center rounded px-1 py-0.5 text-xs font-bold tabular lg:min-w-9 lg:py-1 lg:text-sm ${cellTone(x)} ${r.dropped ? "line-through" : ""}`}>
          {place(x)}
          {x?.fastestLap && <span className="text-fuchsia-400">•</span>}
          {i === 0 && r.pole && <span className="ml-0.5 text-[9px] text-sky-300 lg:text-[11px]">P</span>}
        </span>
      ))}
    </span>
  );
}

export default function Drivers() {
  const { series, scope } = useSite();
  const { data, error, loading } = useApi(series ? `/standings${scope}` : null);
  const [view, setView] = useState("table");
  if (!series || (loading && !data)) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const rounds = data.rounds.filter((r) => r.done);
  const prog = data.progression;
  const multi = rounds.some((r) => r.raceCount > 1);
  const teams = data.drivers.some((d) => d.team);

  return (
    <div>
      <PageHeader eyebrow={`${series.name} · ${data.season?.name ?? ""}`} title="Driver standings">
        <div className="flex flex-wrap items-center gap-2">
          {prog.rounds.length > 1 && (
            <div className="flex rounded-full border border-line p-0.5 text-sm font-bold">
              {["table", "chart"].map((v) => (
                <button key={v} onClick={() => setView(v)} className={`rounded-full px-3 py-1 capitalize ${view === v ? "bg-accent text-accent-ink" : "text-muted"}`}>
                  {v}
                </button>
              ))}
            </div>
          )}
          <SeasonPicker />
        </div>
      </PageHeader>

      {data.drivers.length === 0 ? (
        <Empty>
          {series.archived || (data.season && !data.season.isCurrent)
            ? "No results on record for this season. Recordings of its races are in the calendar."
            : "No results yet. The standings appear after the first race."}
        </Empty>
      ) : view === "chart" ? (
        <section className="card rise p-6">
          <h2 className="h2 mb-4">Points after each round</h2>
          <LineChart
            key={data.season?.id}
            labels={prog.rounds.map((r) => `R${r.round}`)}
            lines={prog.drivers.map((d) => ({ id: d.id, label: d.name, color: d.color, values: d.values }))}
            initialVisible={10}
          />
        </section>
      ) : (
        <div className="card rise overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="w-12 pl-5">Pos</th>
                <th>Driver</th>
                {teams && <th className="hidden sm:table-cell">Team</th>}
                {rounds.map((r) => (
                  <th key={r.id} className="hidden text-center lg:table-cell" title={`${r.name}${r.track ? ` (${r.track})` : ""}`}>
                    R{r.round}
                  </th>
                ))}
                <th className="hidden text-center sm:table-cell">Wins</th>
                <th className="hidden text-center sm:table-cell">Podiums</th>
                <th className="pr-5 text-right">Points</th>
              </tr>
            </thead>
            <tbody>
              {data.drivers.map((d) => (
                <tr key={d.id} {...rise(d.position, 35)}>
                  <td className="pl-5 font-black tabular lg:text-lg">{d.position}</td>
                  <td>
                    <span className="inline-flex items-center gap-2">
                      <DriverName driver={d} />
                      {d.champion && (
                        <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-black uppercase text-black" title={d.championNote || "Champion"}>
                          Champion
                        </span>
                      )}
                    </span>
                  </td>
                  {teams && (
                    <td className="hidden sm:table-cell">
                      <TeamName team={d.team} />
                    </td>
                  )}
                  {rounds.map((r) => (
                    <td key={r.id} className="hidden px-1 text-center lg:table-cell">
                      <RoundCell r={d.rounds[r.id]} />
                    </td>
                  ))}
                  <td className="hidden text-center tabular sm:table-cell">{d.wins}</td>
                  <td className="hidden text-center tabular sm:table-cell">{d.podiums}</td>
                  <td className="pr-5 text-right text-base font-black tabular lg:text-xl">
                    {points(d.points)}
                    {d.manual !== 0 && (
                      <span className="ml-1 align-super text-[10px] font-bold text-sky-300" title={`Manual points: ${points(d.manual)}${d.manualNotes.length ? ` (${d.manualNotes.join(", ")})` : ""}`}>
                        M
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.drivers.length > 0 && view === "table" && (
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted lg:text-sm">
          <span>
            <span className="text-fuchsia-400">•</span> fastest lap
          </span>
          <span>
            <span className="text-sky-300">P</span> pole
          </span>
          {multi && <span>one cell per race of a round</span>}
          {data.dropWorst > 0 && (
            <span>
              <span className="line-through">struck out</span>: dropped (worst {data.dropWorst} {data.dropWorst === 1 ? "round" : "rounds"} per driver)
            </span>
          )}
          <span>
            <span className="text-sky-300">M</span> manual points
          </span>
        </p>
      )}
    </div>
  );
}
