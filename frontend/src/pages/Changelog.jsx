import { useEffect } from "react";
import { PageHeader } from "../components/ui.jsx";
import { useSpecificTitle } from "../utils/pageTitle.js";
import { CHANGELOG } from "../data/changelog.js";
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

function formatDate(iso) {
  // Noon, so no time zone can push the day over the edge either way.
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

export default function Changelog() {
  useSpecificTitle("What's new · NABS Racing League");
  useEffect(() => markChangelogSeen(), []);

  return (
    <div className="content-in mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Changelog"
        title="What's new"
        subtitle="Recent updates to the site."
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
            <time dateTime={entry.date} className="font-mono text-[11px] font-bold uppercase tracking-wider text-eyebrow">
              {formatDate(entry.date)}
            </time>
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
