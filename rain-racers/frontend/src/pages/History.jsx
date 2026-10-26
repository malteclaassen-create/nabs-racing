import { Link } from "react-router-dom";
import { useApi } from "../site.jsx";
import { Loading, ErrorBox, Empty, PageHeader, TeamDot, rise } from "../components/ui.jsx";
import { Img, PosterPanel, thumbnails } from "../components/Picture.jsx";
import { inkOn, monthYear, points } from "../format.js";

// Every season the league has run, newest first and grouped by year: the
// banner (or a round's poster or recording), when it ran, how many rounds
// and the top three of its table (so far, for one still running).
export default function History() {
  const { data, error, loading } = useApi("/history");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const years = [];
  for (const s of data) {
    const y = new Date(s.from).getFullYear();
    if (!years.length || years[years.length - 1].year !== y) years.push({ year: y, seasons: [] });
    years[years.length - 1].seasons.push(s);
  }

  return (
    <div>
      <PageHeader eyebrow={`${data.length} seasons · ${new Set(data.map((s) => s.series.slug)).size} series`} title="League history" />
      {data.length === 0 ? (
        <Empty>No seasons yet.</Empty>
      ) : (
        <div className="space-y-12">
          {years.map(({ year, seasons }) => (
            <section key={year}>
              <div className="mb-5 flex items-center gap-4">
                <h2 className="display text-4xl">{year}</h2>
                <span className="h-px flex-1 bg-line" />
              </div>
              <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {seasons.map((s, i) => (
                  <li key={s.season.id} {...rise(i, 60)}>
                    <SeasonCard s={s} />
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function SeasonCard({ s }) {
  const color = s.series.color || "#ffffff";
  return (
    <Link to={`/series/${s.series.slug}?season=${s.season.id}`} className="card lift group flex h-full flex-col overflow-hidden">
      <div className="relative aspect-video overflow-hidden">
        <Img
          sources={[s.imageUrl, ...thumbnails(s.videoUrl)]}
          className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-105"
          fallback={<PosterPanel color={color} label={s.season.name} className="absolute inset-0" />}
        />
        <span className="absolute inset-x-0 bottom-0 h-1.5" style={{ background: color }} />
        {s.running && (
          <span className="absolute left-3 top-3 rounded-full px-2.5 py-1 text-[10px] font-black uppercase italic shadow-lg" style={{ background: color, color: inkOn(color) }}>
            Running
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-5">
        <div className="eyebrow mb-1">
          {/* a season named after its year does not say the year twice */}
          {/^\d{4}$/.test(s.season.name) ? "" : `${s.season.name} · `}
          {monthYear(s.from)}
          {monthYear(s.from) !== monthYear(s.to) ? ` – ${monthYear(s.to)}` : ""}
        </div>
        <div className="display text-2xl leading-tight">{s.series.name}</div>
        <div className="mt-1 text-sm text-muted">
          {s.rounds} {s.rounds === 1 ? "round" : "rounds"}
          {s.roundsWithResults > 0 && s.roundsWithResults < s.rounds ? ` · ${s.roundsWithResults} with results` : ""}
        </div>
        <div className="mt-auto pt-4">
          {s.top.length > 0 ? (
            <>
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted">
                {s.running ? `Standings after ${s.roundsWithResults} of ${s.rounds}` : s.rounds === 1 ? "Result" : "Final standings"}
              </div>
              <ol className="space-y-1.5 text-sm">
                {s.top.map((d, i) => (
                  <li key={d.id} className="flex items-center gap-2.5">
                    {/* the winner in the series colour, second and third framed */}
                    <span
                      className="round-block h-6 w-6 shrink-0 text-xs"
                      style={i === 0 ? { background: color, color: inkOn(color) } : { boxShadow: "inset 0 0 0 1.5px rgb(var(--line))" }}
                    >
                      {i + 1}
                    </span>
                    {d.team && <TeamDot team={d.team} />}
                    <span className={`min-w-0 truncate ${i === 0 ? "font-bold" : "font-semibold"}`}>{d.name}</span>
                    {i === 0 && s.champion && s.rounds > 1 && <span className="text-[10px] font-black uppercase text-amber-300">Champion</span>}
                    <span className="ml-auto shrink-0 tabular text-muted">{points(d.points)} pts</span>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <div className="text-xs text-muted">{s.running ? "Under way" : "No results on record"}</div>
          )}
        </div>
      </div>
    </Link>
  );
}
