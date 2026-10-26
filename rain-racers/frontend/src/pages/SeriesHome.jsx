import { Link } from "react-router-dom";
import { useSite, useApi } from "../site.jsx";
import { Loading, ErrorBox, SeasonPicker, Streaks, rise } from "../components/ui.jsx";
import { NextRace, LastRace, TopDrivers, TopTeams, SeasonNumbers } from "../components/RaceCards.jsx";
import { Img, thumbnails } from "../components/Picture.jsx";
import LineChart from "../components/LineChart.jsx";

// The home of one series: its next race, last result, the top of both tables
// and how the title fight has gone so far.
export default function SeriesHome() {
  const { series, scope, seriesPath } = useSite();
  const { data, error, loading } = useApi(series ? `/home${scope}` : null);
  if (!series || (loading && !data)) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const prog = data.progression;
  // the season's banner; the series' one (which may be the current season's)
  // only for the current season; else a recording of the season
  const bannerSources = [
    data.season?.imageUrl,
    data.season?.isCurrent ? series.imageUrl : null,
    ...thumbnails(data.lastRace?.videoUrl),
  ].filter(Boolean);
  const banner = bannerSources.length > 0;
  const progress =
    data.roundsTotal === 0
      ? null
      : data.roundsDone > 0 && data.roundsDone < data.roundsTotal
        ? `Round ${data.roundsDone} of ${data.roundsTotal}`
        : `${data.roundsTotal} ${data.roundsTotal === 1 ? "round" : "rounds"}`;
  // the season's own words, else the series'; the first lines only
  const about = (data.season?.description || series.description || "").split("\n").slice(0, 2).join("\n");

  return (
    <div className="space-y-8">
      <section className="card relative overflow-hidden">
        <Streaks opacity={0.05} />
        <div className={`relative grid items-center gap-8 px-6 py-8 sm:px-10 sm:py-10 [&>*]:min-w-0 ${banner ? "lg:grid-cols-[1fr_1.1fr]" : ""}`}>
          <div>
            <div className="eyebrow rise mb-3">
              {data.season?.name}
              {progress && ` · ${progress}`}
            </div>
            {/* sized to the screen, so a long name like "Formula International
                Series" fits a phone */}
            <h1 className="display flex items-center gap-4 text-[clamp(2rem,9vw,3.75rem)] [overflow-wrap:anywhere]">
              <span className="hidden h-10 w-10 shrink-0 rounded-full sm:inline-block" style={{ background: series.color || "rgb(var(--accent))" }} />
              <span className="title-line min-w-0">
                <span style={{ "--d": "100ms" }}>{series.name}</span>
              </span>
            </h1>
            {series.schedule && (
              <div {...rise(3, 80)} className="display rise mt-3 text-lg" style={{ color: series.color || undefined }}>
                {series.schedule}
              </div>
            )}
            {about && (
              <p {...rise(4, 80)} className="rise mt-3 max-w-xl whitespace-pre-line text-muted">
                {about}
              </p>
            )}
            <div {...rise(5, 80)} className="rise mt-6 flex flex-wrap items-center gap-3">
              <SeasonPicker />
              <Link to={seriesPath("/races")} className="btn-ghost">
                Calendar
              </Link>
              <Link to={seriesPath("/drivers")} className="btn-ghost">
                Standings
              </Link>
            </div>
          </div>
          {banner && (
            <div {...rise(2, 80)} className="rise overflow-hidden rounded-2xl border border-line shadow-2xl">
              <Img sources={bannerSources} className="aspect-video w-full object-cover" />
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <div {...rise(1, 90)}>
          {!data.nextRace && data.numbers ? (
            <SeasonNumbers numbers={data.numbers} color={series.color} seasonId={data.season?.id} />
          ) : (
            <NextRace
              race={data.nextRace}
              color={series.color}
              emptyText={data.roundsTotal > 0 ? "This season is over. Every round is on the calendar." : "No race on the calendar yet."}
            />
          )}
        </div>
        <div {...rise(2, 90)}>
          <LastRace race={data.lastRace} color={series.color} />
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

      {series.hasTeams ? (
        <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          <div {...rise(4, 90)}>
            <TopDrivers rows={data.drivers} more={seriesPath("/drivers")} />
          </div>
          <div {...rise(5, 90)}>
            <TopTeams rows={data.teams} more={seriesPath("/teams")} />
          </div>
        </div>
      ) : (
        <div {...rise(4, 90)}>
          <TopDrivers rows={data.drivers} more={seriesPath("/drivers")} />
        </div>
      )}
    </div>
  );
}
