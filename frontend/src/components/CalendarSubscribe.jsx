import { useState } from "react";
import { withApiBase } from "../api/client.js";

// ---------------------------------------------------------------------------
// "Add to calendar" for the season's rounds, next to the calendar grid on the
// Races page. Points at /api/races/calendar.ics (see backend/src/lib/ics.js).
//
// Two buttons rather than one, because no single action works everywhere:
//
//   Add to calendar  opens the .ics itself. On a phone this is the good path:
//                    iOS shows its "Add All" sheet, Android hands it to the
//                    calendar app. On a desktop it imports the rounds once.
//                    The catch is that an import is a COPY, so a round that
//                    moves later does not move in your calendar.
//
//   Copy link        copies the same URL for pasting into "Add by URL" (Google
//                    Calendar) or "Subscribe to calendar" (Apple, Outlook).
//                    That keeps it in sync forever, which for a race calendar
//                    is the one that actually matters.
//
// The obvious third option, a webcal:// link that subscribes in one tap, is
// deliberately not here: it works on iOS and does nothing at all on most
// Android setups, where Google Calendar can only subscribe from its web UI.
// A button that silently does nothing for half the league is worse than a
// button that says "copy this".
// ---------------------------------------------------------------------------

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 007.5.5l2-2a5 5 0 00-7-7l-1 1" />
      <path d="M14 11a5 5 0 00-7.5-.5l-2 2a5 5 0 007 7l1-1" />
    </svg>
  );
}

export default function CalendarSubscribe({ season, slug }) {
  const [copied, setCopied] = useState(false);

  // Same two parameters the JSON endpoints take, so the feed is the season and
  // series you are actually looking at rather than whatever is active today.
  const params = new URLSearchParams();
  if (season != null) params.set("season", String(season));
  if (slug) params.set("series", slug);
  // Rooted at /api, because withApiBase only prepends the API ORIGIN (empty
  // when the two share one, as they do in dev behind the Vite proxy). Handing
  // it a bare "/races/…" produced a link to the SPA's own route, which answers
  // 200 with the page's HTML: a button that looked like it worked and put a
  // web page in your calendar app.
  const path = `/api/races/calendar.ics${params.toString() ? `?${params}` : ""}`;
  // An absolute URL, because this one gets pasted into Google Calendar on
  // another machine. withApiBase covers the split-origin dev setup; new URL
  // against the current page turns whatever it returns into something a
  // stranger's server can fetch.
  const href = new URL(withApiBase(path), window.location.origin).toString();

  async function copy() {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused (insecure origin, a locked-down
      // browser). Falling back to selecting the URL would need a visible
      // field; opening it at least gets the address into the address bar.
      window.open(href, "_blank", "noopener");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={href}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-medium transition hover:bg-surface2 hover:text-dark"
        title="Put this season's rounds in your calendar app"
      >
        <CalendarIcon />
        Add to calendar
      </a>
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-medium transition hover:bg-surface2 hover:text-dark"
        title="Copy the feed URL, for a calendar that should stay in sync when a round moves"
      >
        <LinkIcon />
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}
