import { Link } from "react-router-dom";
import { useApi } from "../site.jsx";
import { Loading, ErrorBox, Empty, PageHeader, TeamDot, rise } from "../components/ui.jsx";
import { Img, PosterPanel, thumbnails } from "../components/Picture.jsx";
import { inkOn } from "../format.js";

const monthYear = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" });

// Every season the league has run, newest first and grouped by year: the
// banner (or a round's poster or recording), when it ran, how many rounds
// and who won it.
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
          {s.season.name} · {monthYear(s.from)}
          {monthYear(s.from) !== monthYear(s.to) ? ` – ${monthYear(s.to)}` : ""}
        </div>
        <div className="display text-2xl leading-tight">{s.series.name}</div>
        <div className="mt-1 text-sm text-muted">
          {s.rounds} {s.rounds === 1 ? "round" : "rounds"}
          {s.roundsWithResults > 0 && s.roundsWithResults < s.rounds ? ` · ${s.roundsWithResults} with results` : ""}
        </div>
        <div className="mt-auto pt-4">
          {s.champion ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-black uppercase text-black">{s.running ? "Leader" : "Champion"}</span>
              <TeamDot team={s.champion.team} />
              <span className="truncate font-bold">{s.champion.name}</span>
            </div>
          ) : (
            <div className="text-xs text-muted">{s.running ? "Under way" : "No results on record"}</div>
          )}
        </div>
      </div>
    </Link>
  );
}
