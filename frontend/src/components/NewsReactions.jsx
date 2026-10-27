import { useRef, useState } from "react";
import { useDismiss } from "./overlay.jsx";

// ---------------------------------------------------------------------------
// The emoji reactions under a news article and under each comment (backend
// lib/newsReactions.js). The ones already there are chips with their count,
// the viewer's own ringed; a press puts the viewer's on or takes it off. The
// smiley at the end opens the set to add one. Logged out, the chips are there
// to read and the smiley is not.
// ---------------------------------------------------------------------------

function SmileyPlus() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-6.2-8.56" strokeLinecap="round" />
      <path d="M8.5 14.5s1.2 1.5 3.5 1.5 3.5-1.5 3.5-1.5" strokeLinecap="round" />
      <path d="M9 9.5h.01M15 9.5h.01" strokeLinecap="round" strokeWidth="2.6" />
      <path d="M19 2v5M16.5 4.5h5" strokeLinecap="round" />
    </svg>
  );
}

export default function NewsReactions({ reactions = [], reactionSet = [], canReact, onToggle, size = "md" }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const wrapRef = useRef(null);
  useDismiss(open, () => setOpen(false), { ref: wrapRef });

  async function toggle(emoji) {
    if (!canReact || busy) return;
    setOpen(false);
    setBusy(emoji);
    try {
      await onToggle(emoji);
    } finally {
      setBusy("");
    }
  }

  const chip = size === "sm" ? "h-6 px-1.5 text-xs" : "h-8 px-2.5 text-sm";
  if (!reactions.length && !canReact) return null;
  return (
    <div ref={wrapRef} className="relative flex flex-wrap items-center gap-1.5">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => toggle(r.emoji)}
          disabled={!canReact || !!busy}
          aria-pressed={r.mine}
          aria-label={`${r.emoji} ${r.count}${r.mine ? ", yours" : ""}`}
          title={canReact ? (r.mine ? "Take yours off" : "Add yours") : "Sign in to react"}
          className={`inline-flex items-center gap-1 rounded-full border font-semibold tabular-nums transition disabled:cursor-default ${chip} ${
            r.mine
              ? "border-brand/60 bg-brand/15 text-dark"
              : "border-border bg-surface2/60 text-medium enabled:hover:border-brand/40"
          }`}
        >
          <span className="leading-none">{r.emoji}</span>
          <span className="font-mono text-[11px]">{r.count}</span>
        </button>
      ))}
      {canReact && reactionSet.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label="Add a reaction"
          title="Add a reaction"
          className={`inline-flex items-center justify-center rounded-full border border-border bg-surface2/40 text-light transition hover:border-brand/40 hover:text-dark ${
            size === "sm" ? "h-6 w-7" : "h-8 w-9"
          }`}
        >
          <SmileyPlus />
        </button>
      )}
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-20 mb-1.5 flex gap-0.5 rounded-xl border border-border bg-card p-1 shadow-lg"
        >
          {reactionSet.map((emoji) => (
            <button
              key={emoji}
              type="button"
              role="menuitem"
              onClick={() => toggle(emoji)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-xl transition hover:scale-110 hover:bg-surface2"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
