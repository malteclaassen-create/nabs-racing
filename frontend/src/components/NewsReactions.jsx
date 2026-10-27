import { lazy, Suspense, useRef, useState } from "react";
import { Modal } from "./overlay.jsx";

const EmojiPickerPanel = lazy(() => import("./EmojiPickerPanel.jsx"));

// ---------------------------------------------------------------------------
// The emoji reactions under a news article and under each comment (backend
// lib/newsReactions.js). The ones already there are chips with their count,
// the viewer's own ringed; a press puts the viewer's on or takes it off. Who
// reacted: hover a chip (the tooltip names them), or long-press it on a phone
// or right-click it, which opens the list, the way Discord does it. Logged
// out a press opens that list, since there is nothing to toggle. The smiley
// at the end opens the picker: a quick row, and every emoji behind its "+".
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

// "Siggsta, Steve and 3 others" for a tooltip.
function namesLine(r) {
  const shown = (r.names || []).slice(0, 3);
  const rest = r.count - shown.length;
  if (!shown.length) return `${r.count}`;
  return rest > 0 ? `${shown.join(", ")} and ${rest} other${rest === 1 ? "" : "s"}` : shown.join(", ");
}

const LONG_PRESS_MS = 450;

// Who put which emoji there: one tab per emoji, the names under it.
function WhoReacted({ reactions, open, initial, onClose }) {
  const [active, setActive] = useState(initial);
  const r = reactions.find((x) => x.emoji === active) || reactions[0];
  return (
    <Modal open={open} onClose={onClose} title="Reactions" variant="sheet" size="sm">
      {r && (
        <>
          <div className="-mx-1 flex gap-1 overflow-x-auto pb-2">
            {reactions.map((x) => (
              <button
                key={x.emoji}
                type="button"
                onClick={() => setActive(x.emoji)}
                aria-pressed={x.emoji === r.emoji}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold tabular-nums transition ${
                  x.emoji === r.emoji ? "border-brand/60 bg-brand/15 text-dark" : "border-border text-medium hover:border-brand/40"
                }`}
              >
                <span className="text-base leading-none">{x.emoji}</span>
                <span className="font-mono text-xs">{x.count}</span>
              </button>
            ))}
          </div>
          <ul className="mt-2 max-h-72 divide-y divide-border overflow-y-auto">
            {(r.names || []).map((name, i) => (
              <li key={`${name}-${i}`} className="flex items-center gap-3 py-2.5 text-sm font-semibold text-dark">
                <span className="text-lg leading-none" aria-hidden="true">
                  {r.emoji}
                </span>
                {name}
              </li>
            ))}
            {r.count > (r.names || []).length && (
              <li className="py-2.5 text-sm text-light">and {r.count - r.names.length} more</li>
            )}
          </ul>
        </>
      )}
    </Modal>
  );
}

export default function NewsReactions({ reactions = [], reactionSet = [], canReact, onToggle, size = "md" }) {
  const [picking, setPicking] = useState(false);
  const [who, setWho] = useState(null); // the emoji whose list is open
  const [busy, setBusy] = useState("");
  const press = useRef({ timer: null, long: false });

  async function toggle(emoji) {
    if (!canReact || busy) return;
    setPicking(false);
    setBusy(emoji);
    try {
      await onToggle(emoji);
    } finally {
      setBusy("");
    }
  }

  // A long press opens the list instead of toggling.
  const startPress = (emoji) => {
    press.current.long = false;
    clearTimeout(press.current.timer);
    press.current.timer = setTimeout(() => {
      press.current.long = true;
      setWho(emoji);
    }, LONG_PRESS_MS);
  };
  const endPress = () => clearTimeout(press.current.timer);

  const chip = size === "sm" ? "h-6 px-1.5 text-xs" : "h-8 px-2.5 text-sm";
  if (!reactions.length && !canReact) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onPointerDown={() => startPress(r.emoji)}
          onPointerUp={endPress}
          onPointerLeave={endPress}
          onPointerCancel={endPress}
          onContextMenu={(e) => {
            e.preventDefault();
            endPress();
            setWho(r.emoji);
          }}
          onClick={() => {
            if (press.current.long) return;
            if (canReact) toggle(r.emoji);
            else setWho(r.emoji);
          }}
          disabled={!!busy}
          aria-pressed={canReact ? r.mine : undefined}
          aria-label={`${r.emoji} ${r.count}: ${namesLine(r)}`}
          title={`${namesLine(r)} reacted with ${r.emoji}`}
          className={`inline-flex select-none items-center gap-1 rounded-full border font-semibold tabular-nums transition [-webkit-touch-callout:none] ${chip} ${
            r.mine ? "border-brand/60 bg-brand/15 text-dark" : "border-border bg-surface2/60 text-medium hover:border-brand/40"
          }`}
        >
          <span className="leading-none">{r.emoji}</span>
          <span className="font-mono text-[11px]">{r.count}</span>
        </button>
      ))}
      {canReact && (
        <button
          type="button"
          onClick={() => setPicking(true)}
          aria-label="Add a reaction"
          title="Add a reaction"
          className={`inline-flex items-center justify-center rounded-full border border-border bg-surface2/40 text-light transition hover:border-brand/40 hover:text-dark ${
            size === "sm" ? "h-6 w-7" : "h-8 w-9"
          }`}
        >
          <SmileyPlus />
        </button>
      )}

      <Modal open={picking} onClose={() => setPicking(false)} title="Add a reaction" variant="sheet" size="sm">
        <Suspense fallback={<div className="skeleton h-[380px] w-full rounded-xl" />}>
          {picking && <EmojiPickerPanel quick={reactionSet} onPick={toggle} />}
        </Suspense>
      </Modal>
      {who && <WhoReacted key={who} reactions={reactions} open initial={who} onClose={() => setWho(null)} />}
    </div>
  );
}
