import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox, Spinner } from "../components/ui.jsx";
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
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border pb-4 text-xs text-light">
        {article.authorName && <span className="font-semibold text-medium">{article.authorName}</span>}
        <time dateTime={article.publishedAt}>{fmtDateLong(article.publishedAt)}</time>
        <span>· {article.readingMinutes} min read</span>
        {viewCount > 0 && (
          <span>
            · {viewCount.toLocaleString("en-US")} {viewCount === 1 ? "view" : "views"}
          </span>
        )}
        {data.race && (
          <Link
            to={`${data.race.seriesSlug ? `/s/${data.race.seriesSlug}` : ""}/results?race=${encodeURIComponent(data.race.id)}`}
            className="ml-auto font-semibold text-link hover:underline"
          >
            {data.race.number != null ? `Round ${data.race.number}, ` : ""}
            {data.race.track}: results →
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
