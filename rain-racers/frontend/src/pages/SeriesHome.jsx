import { Link } from "react-router-dom";
import { useSite, useApi } from "../site.jsx";
import { Loading, ErrorBox, SeasonPicker, Streaks, rise } from "../components/ui.jsx";
import { NextRace, LastRace, TopDrivers, TopTeams } from "../components/RaceCards.jsx";
import LineChart from "../components/LineChart.jsx";

// The home of one series: its next race, last result, the top of both tables
// and how the title fight has gone so far.
export default function SeriesHome() {
  const { series, scope, seriesPath } = useSite();
  const { data, error, loading } = useApi(series ? `/home${scope}` : null);
  if (!series || (loading && !data)) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const prog = data.progression;

  return (
    <div className="space-y-8">
      <section className="card relative overflow-hidden">
        <Streaks opacity={0.05} />
        <div className="relative flex flex-wrap items-end justify-between gap-6 px-6 py-10 sm:px-10">
          <div>
            <div className="eyebrow rise mb-3">
              {data.season?.name}
              {data.roundsTotal > 0 && ` · Round ${data.roundsDone} of ${data.roundsTotal}`}
            </div>
            <h1 className="display flex items-center gap-4 text-5xl sm:text-7xl">
              <span className="logo-in inline-block h-8 w-8 shrink-0 rounded-full sm:h-10 sm:w-10" style={{ background: series.color || "rgb(var(--accent))" }} />
              <span className="title-line">
                <span style={{ "--d": "100ms" }}>{series.name}</span>
              </span>
            </h1>
            {series.schedule && (
              <div {...rise(3, 80)} className="display rise mt-3 text-lg text-muted">
                {series.schedule}
              </div>
            )}
            {series.description && (
              <p {...rise(4, 80)} className="rise mt-3 max-w-xl text-muted">
                {series.description}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <SeasonPicker />
            <Link to={seriesPath("/races")} className="btn-ghost">
              Calendar
            </Link>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <div {...rise(1, 90)}>
          <NextRace race={data.nextRace} />
        </div>
        <div {...rise(2, 90)}>
          <LastRace race={data.lastRace} />
        </div>
      </div>

      {prog.rounds.length > 1 && (
        <section {...rise(3, 90)} className="card rise p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="h2">Title fight</h2>
            <Link to={seriesPath("/drivers")} className="text-sm text-muted hover:opacity-70">
              Full standings →
            </Link>
          </div>
          <LineChart
            key={data.season?.id}
            labels={prog.rounds.map((r) => `R${r.round}`)}
            lines={prog.drivers.map((d) => ({ id: d.id, label: d.name, color: d.color, values: d.values }))}
          />
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div {...rise(4, 90)}>
          <TopDrivers rows={data.drivers} more={seriesPath("/drivers")} />
        </div>
        <div {...rise(5, 90)}>
          <TopTeams rows={data.teams} more={seriesPath("/teams")} />
        </div>
      </div>
    </div>
  );
}
