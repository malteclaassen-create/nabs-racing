import { useState } from "react";
import TrainingBar from "./TrainingBar.jsx";
import { usePracticeWeek } from "../hooks/usePracticeWeek.js";

// ---------------------------------------------------------------------------
// Your own training week, on the live page: one line that says how many laps
// you have done this week, and opens into the bar.
//
// Closed by default, because the live page belongs to the session rather than
// to any one viewer, and because most people watching it are not the ones
// driving. Open it once and the browser remembers, so a driver who wants it
// there has it there every evening.
//
// It asks the shared store faster while it is open (hooks/usePracticeWeek):
// somebody sitting in the pits with the page on a second screen watches their
// own lap count go up.
// ---------------------------------------------------------------------------
const OPEN_KEY = "nabs_training_panel_open";

function readOpen() {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

export default function TrainingPanel() {
  const [open, setOpen] = useState(readOpen);
  const week = usePracticeWeek(open ? 20000 : 120000);
  if (!week) return null;

  const toggle = () => {
    setOpen((was) => {
      try {
        localStorage.setItem(OPEN_KEY, was ? "0" : "1");
      } catch {
        /* nothing to remember it with: it just closes again next time */
      }
      return !was;
    });
  };

  return (
    <section className="reveal card overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 px-5 py-3 text-left transition hover:bg-surface2/60"
      >
        <span className="flex min-w-0 items-baseline gap-3">
          <span className="font-mono text-[12px] font-bold uppercase tracking-[0.2em] text-eyebrow">Your training</span>
          <span className="truncate text-sm text-light">
            <span className="font-mono font-bold tabular-nums text-dark">{week.laps || 0}</span>{" "}
            {week.laps === 1 ? "lap" : "laps"} this week
          </span>
        </span>
        <svg
          viewBox="0 0 24 24"
          className={`h-4 w-4 shrink-0 text-light transition-transform duration-quick ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-border px-5 py-4">
          <div className="mb-2 text-xs text-light">{week.label}</div>
          <TrainingBar week={week} compact />
        </div>
      )}
    </section>
  );
}
