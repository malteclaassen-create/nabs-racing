import { Link } from "react-router-dom";

// 404 page in the site's racing voice: big "404" wordmark, a one-liner, and
// the two places a lost visitor most likely wants to go.
export default function NotFound() {
  return (
    <section className="card relative overflow-hidden p-8 text-center sm:p-16">
      {/* faint oversized chequers-style backdrop, same corner-flourish idea as the number tiles */}
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-10 -right-10 h-64 w-64 text-brand opacity-[0.07]"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <path d="M5 21V4M5 4c3-1.5 6 1.5 9 0s4-1 4-1v9s-1 .5-4 1-6-1.5-9 0" />
      </svg>

      <div className="font-mono text-[12px] font-bold uppercase tracking-[0.25em] text-eyebrow">
        Off track
      </div>
      <div className="mt-3 font-display text-7xl font-black leading-none tracking-tight text-dark sm:text-8xl">
        4<span className="text-brand">0</span>4
      </div>
      <p className="mx-auto mt-4 max-w-md text-medium">
        You&rsquo;ve run wide. This page doesn&rsquo;t exist, so rejoin the track below.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          to="/"
          className="shine group inline-flex items-center gap-2 rounded-lg bg-brand px-6 py-3 text-sm font-bold uppercase tracking-wide text-ink shadow-lg shadow-brand/30 transition hover:brightness-105"
        >
          Back to Home
          <span className="transition group-hover:translate-x-0.5">→</span>
        </Link>
        <Link
          to="/races"
          className="inline-flex items-center rounded-lg border border-border bg-surface2 px-6 py-3 text-sm font-bold uppercase tracking-wide text-dark transition hover:bg-border/60"
        >
          Race Calendar
        </Link>
      </div>
    </section>
  );
}
