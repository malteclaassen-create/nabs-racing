import { Link } from "react-router-dom";
import { Newspaper } from "lucide-react";
import { fmtStamp } from "../utils/format.js";
import { NewsCover } from "../pages/News.jsx";

// The news written about this round: published articles a writer tied to it
// on the News desk (the "Round" picker of a Races article). Sits with the race
// facts and the photos under the classification. Nothing at all for a round
// nobody has written about.
export default function RaceNews({ articles }) {
  if (!articles?.length) return null;

  return (
    <div className="card mt-6 overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-surface2/50 px-5 py-3">
        <h3 className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-widest text-light">
          <Newspaper className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          News
        </h3>
        <span className="font-mono text-[11px] uppercase tracking-wider text-light">
          {articles.length} {articles.length === 1 ? "article" : "articles"}
        </span>
      </div>
      <ul className="divide-y divide-border">
        {articles.map((a) => (
          <li key={a.id}>
            <Link to={`/news/${a.slug}`} className="group flex items-start gap-4 p-3 hover:bg-surface2/60 sm:p-4">
              <div className="aspect-[16/9] w-24 shrink-0 overflow-hidden rounded-md bg-surface2 sm:w-36">
                <NewsCover article={a} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[11px] text-light">
                  {fmtStamp(a.publishedAt)} · {a.readingMinutes} min read
                </div>
                <div className="mt-0.5 font-display text-base font-extrabold leading-tight tracking-tight text-dark group-hover:underline sm:text-lg">
                  {a.title}
                </div>
                {a.summary && <p className="mt-1 hidden text-sm leading-relaxed text-light sm:line-clamp-2">{a.summary}</p>}
                {a.authorName && <div className="mt-1 text-xs font-semibold text-medium">{a.authorName}</div>}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
