import { Link } from "react-router-dom";
import { CategoryChip, CommentCount, NewsCover } from "../pages/News.jsx";
import { fmtStamp } from "../utils/format.js";

// ---------------------------------------------------------------------------
// The latest news on the home page, as a row of cards under a hero that needs
// the full width (a finished season, a season still to start). A running
// season has its own news column beside the latest result (HomeTop), which
// borrows the headline line and the column header from here.
// ---------------------------------------------------------------------------

export function Headline({ article }) {
  return (
    <Link to={`/news/${article.slug}`} className="group flex items-center gap-3 px-4 py-3 transition hover:bg-surface2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 font-mono text-[10px] text-light">
          <span className="font-bold uppercase tracking-wider text-eyebrow">{article.categoryLabel}</span>
          <span>{fmtStamp(article.publishedAt)}</span>
          {article.commentCount > 0 && <CommentCount count={article.commentCount} />}
        </div>
        <div className="mt-1 line-clamp-2 text-[15px] font-bold leading-snug text-dark group-hover:underline">
          {article.title}
        </div>
      </div>
      <div className="aspect-[4/3] w-24 shrink-0 overflow-hidden rounded-lg bg-surface2 sm:w-28">
        <NewsCover article={article} />
      </div>
    </Link>
  );
}

function Card({ article }) {
  return (
    <Link to={`/news/${article.slug}`} className="card group flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:border-brand/50">
      <div className="relative aspect-[16/9] overflow-hidden bg-surface2">
        <NewsCover article={article} className="transition duration-300 group-hover:scale-[1.03]" />
        <CategoryChip category={article.category} label={article.categoryLabel} className="absolute left-3 top-3" />
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-center gap-3 font-mono text-[11px] text-light">
          <span>{fmtStamp(article.publishedAt)}</span>
          {article.commentCount > 0 && <CommentCount count={article.commentCount} className="ml-auto" />}
        </div>
        <h3 className="mt-1.5 line-clamp-3 font-display text-base font-extrabold leading-tight tracking-tight text-dark">
          {article.title}
        </h3>
      </div>
    </Link>
  );
}

// The label over a home-page column and its "see all" link. The latest-result
// column beside the news wears the same one, so the two line up.
export function ColumnHeader({ title, to, cta }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-2">
      <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">{title}</div>
      <Link to={to} className="group text-sm font-semibold text-link">
        {cta} <span className="inline-block transition group-hover:translate-x-0.5">→</span>
      </Link>
    </div>
  );
}

const Header = () => <ColumnHeader title="Latest news" to="/news" cta="All news" />;

export default function HomeNews({ news, className = "" }) {
  const { data, error } = news || {};
  const articles = data?.articles || [];

  if (error || (data && !articles.length)) return null;

  if (!data) {
    return (
      <section className={className} aria-busy="true">
        <Header />
        <div className="skeleton aspect-[16/10] w-full rounded-2xl" />
      </section>
    );
  }

  return (
    <section className={`reveal ${className}`}>
      <Header />
      <div className="cascade grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {articles.slice(0, 4).map((a) => (
          <Card key={a.id} article={a} />
        ))}
      </div>
    </section>
  );
}
