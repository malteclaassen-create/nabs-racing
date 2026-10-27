import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { DriverAvatar, ErrorBox, Spinner } from "../components/ui.jsx";
import Flag from "../components/Flag.jsx";
import { flagFor } from "../data/circuits.js";
import NewsBody from "../components/NewsBody.jsx";
import NewsComments from "../components/NewsComments.jsx";
import { useSpecificTitle } from "../utils/pageTitle.js";
import { fmtDateLong, fmtStamp } from "../utils/format.js";
import { CategoryChip, NewsCover, useNewsDeskAccess } from "./News.jsx";

// /news/:slug — one published article, what members said about it, and three
// more to read next.
export default function NewsArticle() {
  const { slug } = useParams();
  const access = useNewsDeskAccess();
  const { data, error, reload } = useApi(useCallback(() => api.newsArticle(slug), [slug]));
  const article = data?.article;
  // Every opening counts, signed in or not; the answer is the total, this one
  // included.
  const [views, setViews] = useState(null);
  const articleId = article?.id;
  useEffect(() => {
    if (!articleId) return undefined;
    let alive = true;
    setViews(null);
    api
      .viewNewsArticle(articleId)
      .then((d) => alive && setViews(d.views))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [articleId]);
  const viewCount = views ?? article?.views ?? 0;
  useSpecificTitle(article ? `${article.title} · NABS News` : "News · NABS Racing League");

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorBox message={error} onRetry={reload} title="That article didn't load" />
        <Link to="/news" className="mt-4 inline-block text-sm font-semibold text-link">
          ← All news
        </Link>
      </div>
    );
  }
  if (!article) return <Spinner />;

  return (
    <article className="content-in mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link to="/news" className="font-mono text-[11px] font-bold uppercase tracking-widest text-eyebrow hover:underline">
          ← News
        </Link>
        {access.canWrite && (
          <Link to={`/news/desk/${article.id}`} className="btn-secondary py-1 text-xs">
            Edit
          </Link>
        )}
      </div>

      <CategoryChip category={article.category} label={article.categoryLabel} />
      <h1 className="mt-3 font-display text-3xl font-extrabold leading-tight tracking-tight text-dark sm:text-4xl">
        {article.title}
      </h1>
      {article.summary && <p className="mt-3 text-lg leading-relaxed text-light">{article.summary}</p>}
      {/* Who wrote it and when on the left, the round it is about as a card of
          its own on the right (under it on a phone): the way to the full
          results was a run-on link at the end of the byline. */}
      <div className="mt-5 flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <DriverAvatar name={article.authorName || "NABS News"} size={40} />
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-dark">{article.authorName || "NABS News"}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-light">
              {/* The date is a line of its own on a phone, so neither line
                  starts or ends on a lone separator. */}
              <time dateTime={article.publishedAt} className="w-full sm:w-auto">
                {fmtDateLong(article.publishedAt)}
              </time>
              <span className="whitespace-nowrap">
                <span aria-hidden="true" className="hidden sm:inline">
                  ·{" "}
                </span>
                {article.readingMinutes} min read
              </span>
              {viewCount > 0 && (
                <>
                  <span className="inline-flex items-center gap-1 whitespace-nowrap">
                    <span aria-hidden="true">·</span>
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" strokeLinejoin="round" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    {viewCount.toLocaleString("en-US")} {viewCount === 1 ? "view" : "views"}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        {data.race && (
          <Link
            to={`${data.race.seriesSlug ? `/s/${data.race.seriesSlug}` : ""}/results?race=${encodeURIComponent(data.race.id)}`}
            className="group flex shrink-0 items-center gap-3 rounded-xl border border-border bg-surface2/50 px-3.5 py-2.5 transition hover:border-brand/50 hover:bg-surface2"
          >
            <Flag code={flagFor(data.race.track)?.country} w={24} h={18} className="shrink-0 rounded-sm" />
            <span className="min-w-0">
              <span className="block font-mono text-[10px] font-bold uppercase tracking-widest text-light">
                {data.race.number != null ? `Round ${data.race.number} · ` : ""}Full results
              </span>
              <span className="block truncate text-sm font-bold text-dark">{data.race.track}</span>
            </span>
            <span aria-hidden="true" className="ml-auto pl-2 text-lg leading-none text-link transition group-hover:translate-x-0.5">
              →
            </span>
          </Link>
        )}
      </div>

      {article.coverUrl && (
        <div className="mt-6 aspect-[16/9] overflow-hidden rounded-xl border border-border">
          <NewsCover article={article} />
        </div>
      )}

      <div className="mt-6">
        <NewsBody text={article.body} />
      </div>

      <NewsComments articleId={article.id} />

      {data.more?.length > 0 && (
        <section className="mt-12 border-t border-border pt-6">
          <h2 className="font-mono text-[11px] font-bold uppercase tracking-widest text-eyebrow">Read next</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {data.more.map((a) => (
              <Link key={a.id} to={`/news/${a.slug}`} className="card group overflow-hidden hover:border-brand/50">
                <div className="aspect-[16/9] overflow-hidden bg-surface2">
                  <NewsCover article={a} />
                </div>
                <div className="p-3">
                  <div className="font-mono text-[10px] text-light">{fmtStamp(a.publishedAt)}</div>
                  <div className="mt-1 text-sm font-bold leading-snug text-dark group-hover:underline">{a.title}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
