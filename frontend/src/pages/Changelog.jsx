import { useEffect } from "react";
import { PageHeader } from "../components/ui.jsx";
import { useSpecificTitle } from "../utils/pageTitle.js";
import { CHANGELOG, CHANGELOG_COMMITS } from "../data/changelog.js";
import { markChangelogSeen } from "../hooks/useChangelogSeen.js";

// ---------------------------------------------------------------------------
// /changelog — what changed on the site, newest first.
//
// The site changes most days, and until now the only way to find out what had
// was to stumble on it. The list itself is data/changelog.js; this page only
// draws it. Opening it clears the "New" mark in Settings.
//
// Public and login-free: a visitor deciding whether the league is alive is as
// much a reader of this as a member is.
// ---------------------------------------------------------------------------

const TAGS = {
  new: { label: "New", className: "bg-brand/15 text-eyebrow" },
  better: { label: "Better", className: "bg-link/10 text-link" },
  fixed: { label: "Fixed", className: "bg-ok/10 text-ok" },
};

// Noon, so no time zone can push the day over the edge either way.
const day = (iso) => new Date(`${iso}T12:00:00`);
const DATE_FMT = { day: "numeric", month: "long", year: "numeric" };

// One day, or a few days as a range ("15 – 17 September 2026").
function formatDate(from, to) {
  const end = day(to);
  if (Number.isNaN(end.getTime())) return to;
  const fmt = new Intl.DateTimeFormat(undefined, DATE_FMT);
  const start = from ? day(from) : null;
  if (!start || Number.isNaN(start.getTime()) || from === to) return fmt.format(end);
  return typeof fmt.formatRange === "function" ? fmt.formatRange(start, end) : `${fmt.format(start)} – ${fmt.format(end)}`;
}

const fmtNumber = (n) => new Intl.NumberFormat(undefined).format(n);

export default function Changelog() {
  useSpecificTitle("What's new · NABS Racing League");
  useEffect(() => markChangelogSeen(), []);

  return (
    <div className="content-in mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Changelog"
        title="What's new"
        subtitle="Recent updates to the site."
        rightInline
        right={
          CHANGELOG_COMMITS > 0 && (
            <div className="shrink-0 text-right">
              <div className="font-mono text-2xl font-bold tabular-nums text-dark">#{fmtNumber(CHANGELOG_COMMITS)}</div>
              <div className="text-xs text-light">commits so far</div>
            </div>
          )
        }
      />

      <ol className="relative space-y-6 border-l border-border pl-5 sm:pl-7">
        {CHANGELOG.map((entry, i) => (
          <li key={entry.date} className="relative">
            {/* The dot on the timeline. The newest one is filled in. */}
            <span
              className={`absolute -left-[26px] top-1.5 h-3 w-3 rounded-full border-2 border-bg sm:-left-[34px] ${
                i === 0 ? "bg-brand" : "bg-border"
              }`}
              aria-hidden="true"
            />
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <time dateTime={entry.date} className="font-mono text-[11px] font-bold uppercase tracking-wider text-eyebrow">
                {formatDate(entry.from, entry.date)}
              </time>
              {/* The commit count by the end of this entry, as its number. */}
              {entry.commits > 0 && (
                <span className="font-mono text-[11px] font-bold tabular-nums text-faint" title={`${entry.commits} commits by then`}>
                  #{fmtNumber(entry.commits)}
                </span>
              )}
            </div>
            <div className="card mt-2 px-5 py-4">
              {entry.title && (
                <h2 className="font-display text-lg font-extrabold uppercase tracking-tight text-dark">{entry.title}</h2>
              )}
              <ul className={`space-y-2.5 ${entry.title ? "mt-3" : ""}`}>
                {entry.items.map((item, j) => {
                  const tag = TAGS[item.tag] || TAGS.better;
                  return (
                    <li key={j} className="flex items-start gap-3 text-sm leading-relaxed text-medium">
                      <span
                        className={`mt-0.5 w-14 shrink-0 rounded-md py-0.5 text-center font-mono text-[10px] font-bold uppercase tracking-wider ${tag.className}`}
                      >
                        {tag.label}
                      </span>
                      <span className="min-w-0">{item.text}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
