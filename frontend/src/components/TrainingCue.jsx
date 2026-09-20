import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import TokenIcon from "./TokenIcon.jsx";
import { usePracticeWeek } from "../hooks/usePracticeWeek.js";

// ---------------------------------------------------------------------------
// "20 training laps. +10." — the line that slides in along the bottom edge
// when a training milestone has just paid.
//
// Deliberately NOT a bell notification. The bell is for things somebody has to
// come back to: a report, a seat, an answer. This is a pat on the back for
// something they did five minutes ago, and it belongs in the same place as the
// "new version of the site" line: down there, briefly, then gone.
//
// WHEN IT FIRES. Only for a payment from the last few hours, and only once per
// browser: without the first rule, a Sunday visit would celebrate a week of
// milestones at once; without the second, every page load would celebrate the
// same one again. While the counting is switched off nothing pays, so nothing
// pops up, which is the honest thing for a trial that is not paying yet.
// ---------------------------------------------------------------------------

// How fresh a payment has to be to still be worth celebrating.
const FRESH_MS = 3 * 60 * 60 * 1000;
// How long the line stays before it takes itself away.
const SHOW_MS = 9000;
// The milestones this browser has already celebrated, newest last.
const SEEN_KEY = "nabs_training_cue";
const SEEN_MAX = 12;

function readSeen() {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]");
    return Array.isArray(raw) ? raw.map(String) : [];
  } catch {
    return []; // private mode: the line may show twice, which is the kinder failure
  }
}

function remember(key) {
  try {
    const next = [...readSeen().filter((k) => k !== key), key].slice(-SEEN_MAX);
    localStorage.setItem(SEEN_KEY, JSON.stringify(next));
  } catch {
    /* nothing to remember it with */
  }
}

export default function TrainingCue() {
  // No clock of its own: this sits on every page of the site, and the person
  // who has just driven twenty laps is coming back to the browser, which is a
  // page load or a focus either way (hooks/usePracticeWeek).
  const week = usePracticeWeek(0);
  const [shown, setShown] = useState(null);
  const timer = useRef(null);

  // The freshest milestone that has paid, is recent, and has not been shown in
  // this browser yet.
  const due = useMemo(() => {
    if (!week?.period) return null;
    const seen = readSeen();
    const now = Date.now();
    let best = null;
    for (const tier of week.tiers || []) {
      if (!tier.done || !tier.paidAt) continue;
      // SQLite hands its timestamps over as "YYYY-MM-DD HH:MM:SS" in UTC, and
      // a row written with an explicit time comes through as ISO. Read both,
      // and treat a bare one as UTC rather than as this browser's clock.
      const stamp = String(tier.paidAt);
      const at = Date.parse(stamp.replace(" ", "T") + (/[Z+]|[+-]\d\d:\d\d$/.test(stamp) ? "" : "Z"));
      if (!Number.isFinite(at) || now - at > FRESH_MS) continue;
      const key = `${week.series}:${week.period}:${tier.key || tier.laps}`;
      if (seen.includes(key)) continue;
      if (!best || tier.laps > best.tier.laps) best = { key, tier, at };
    }
    return best;
  }, [week]);

  useEffect(() => {
    if (!due || shown) return undefined;
    remember(due.key); // written when it appears, so a reload mid-show is not a second show
    setShown(due);
    timer.current = setTimeout(() => setShown(null), SHOW_MS);
    return () => clearTimeout(timer.current);
  }, [due, shown]);

  if (!shown) return null;

  // Portalled to the body: every route sits inside a wrapper that holds a
  // transform for its entrance, and a transformed ancestor makes `fixed`
  // resolve against IT rather than against the window (see SeatCue.jsx).
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-chrome flex justify-center px-4">
      <div className="content-in pointer-events-auto flex items-center gap-3 rounded-2xl border border-ok/40 bg-card px-4 py-3 shadow-lg shadow-ink/20">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ok/15 text-ok">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
        <span className="min-w-0 text-sm text-dark">
          <strong className="font-semibold">{shown.tier.laps} training laps</strong>
          <span className="text-light"> this week. </span>
          <Link to="/profile?tab=tokens" className="inline-flex items-baseline gap-1 font-semibold text-dark underline decoration-border underline-offset-2 hover:decoration-brand">
            <TokenIcon className="h-3.5 w-3.5 translate-y-0.5" />
            <span className="font-mono tabular-nums">+{shown.tier.points}</span>
          </Link>
        </span>
        <button
          type="button"
          onClick={() => setShown(null)}
          aria-label="Dismiss"
          className="shrink-0 rounded-lg border border-border px-2 py-1 font-mono text-[11px] font-bold uppercase tracking-wider text-light transition hover:bg-surface2 hover:text-dark"
        >
          Ok
        </button>
      </div>
    </div>,
    document.body
  );
}
