import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth } from "../hooks/useAuth.js";
import { PageHeader, ErrorBox, EmptyState, CardsSkeleton } from "../components/ui.jsx";
import { useSpecificTitle } from "../utils/pageTitle.js";
import { fmtStamp } from "../utils/format.js";

// ---------------------------------------------------------------------------
// /news — the league's articles, newest first (backend routes/news.js).
//
// Race reports, transfers, drivers, the odd word from the stewards. Public and
// login-free like the changelog. Writers (admins, and members an admin named a
// news writer) get a "News desk" button to write one.
// ---------------------------------------------------------------------------

export const CATEGORY_STYLE = {
  RACES: "bg-red-500/90 text-white",
  TRANSFERS: "bg-amber-500/90 text-black",
  DRIVERS: "bg-sky-500/90 text-white",
  TEAMS: "bg-violet-500/90 text-white",
  COMMUNITY: "bg-emerald-500/90 text-white",
  TECHNICAL: "bg-slate-600/90 text-white",
  LEAGUE: "bg-brand text-onbrand",
};

export function CategoryChip({ category, label, className = "" }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${
        CATEGORY_STYLE[category] || CATEGORY_STYLE.LEAGUE
      } ${className}`}
    >
      {label || category}
    </span>
  );
}

// The picture at the top of a card or an article. Without one, a quiet panel
// in the category's colour with the league's name, so a card never looks broken.
export function NewsCover({ article, className = "" }) {
  if (article.coverUrl) {
    return <img src={article.coverUrl} alt="" loading="lazy" className={`h-full w-full object-cover ${className}`} />;
  }
  return (
    <div className={`flex h-full w-full items-center justify-center bg-gradient-to-br from-surface2 to-border ${className}`}>
      <span className="font-display text-2xl font-black uppercase tracking-tight text-faint">NABS</span>
    </div>
  );
}

export function useNewsDeskAccess() {
  const { isLoggedIn } = useAuth();
  // `loaded` false until the server has answered, so a page can wait for it
  // before turning anybody away.
  const [access, setAccess] = useState({ canWrite: false, admin: false, loaded: false });
  useEffect(() => {
    let alive = true;
    api
      .newsDeskAccess()
      .then((a) => alive && setAccess({ canWrite: !!a?.canWrite, admin: !!a?.admin, loaded: true }))
      .catch(() => alive && setAccess({ canWrite: false, admin: false, loaded: true }));
    return () => {
      alive = false;
    };
  }, [isLoggedIn]);
  return access;
}

function ArticleCard({ article, i }) {
  return (
    <Link
      to={`/news/${article.slug}`}
      className="card group flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:border-brand/50"
      style={{ "--i": Math.min(i, 8) }}
    >
      <div className="relative aspect-[16/9] overflow-hidden bg-surface2">
        <NewsCover article={article} className="transition duration-300 group-hover:scale-[1.03]" />
        <CategoryChip category={article.category} label={article.categoryLabel} className="absolute left-3 top-3" />
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="font-mono text-[11px] text-light">
          {fmtStamp(article.publishedAt)} · {article.readingMinutes} min read
        </div>
        <h2 className="mt-1.5 font-display text-lg font-extrabold leading-tight tracking-tight text-dark">{article.title}</h2>
        {article.summary && <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-light">{article.summary}</p>}
        {article.authorName && <div className="mt-auto pt-3 text-xs font-semibold text-medium">{article.authorName}</div>}
      </div>
    </Link>
  );
}

export default function News() {
  useSpecificTitle("News · NABS Racing League");
  const access = useNewsDeskAccess();
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [extra, setExtra] = useState([]);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Search as you type, once the typing pauses.
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data, error, loading, reload } = useApi(useCallback(() => api.news({ category, q }), [category, q]));
  useEffect(() => {
    setExtra([]);
    setMore(!!data?.more);
  }, [data]);

  const articles = [...(data?.articles || []), ...extra];
  const categories = data?.categories || {};

  async function loadMore() {
    const last = articles[articles.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const next = await api.news({ category, q, before: last.publishedAt });
      setExtra((e) => [...e, ...(next.articles || [])]);
      setMore(!!next.more);
    } catch {
      /* the button stays, a second press tries again */
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="content-in">
      <PageHeader
        eyebrow="Latest · NABS Community"
        title="News & Updates"
        subtitle="Race reports, transfers, driver stories and everything else happening in the league."
        right={
          access.canWrite && (
            <Link to="/news/desk" className="btn-primary shrink-0">
              News desk
            </Link>
          )
        }
      />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Category">
          {[["", "All"], ...Object.entries(categories)].map(([key, label]) => (
            <button
              key={key || "all"}
              type="button"
              role="tab"
              aria-selected={category === key}
              onClick={() => setCategory(key)}
              className={`rounded-lg border px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider transition ${
                category === key
                  ? "border-brand bg-brand text-onbrand"
                  : "border-border bg-surface2/60 text-medium hover:border-brand/50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search news…"
          aria-label="Search news"
          className="input w-full py-1.5 text-sm sm:max-w-[16rem]"
        />
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && loading && <CardsSkeleton count={6} cols="sm:grid-cols-2 lg:grid-cols-3" />}
      {data && !articles.length && (
        <EmptyState
          title={q || category ? "Nothing found" : "No news yet"}
          hint={q || category ? "Try another category or search." : "The first race report lands here after the next round."}
        />
      )}
      {articles.length > 0 && (
        <div className="cascade grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {articles.map((a, i) => (
            <ArticleCard key={a.id} article={a} i={i} />
          ))}
        </div>
      )}
      {more && (
        <div className="mt-6 text-center">
          <button type="button" className="btn-secondary" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Older news"}
          </button>
        </div>
      )}
    </div>
  );
}
