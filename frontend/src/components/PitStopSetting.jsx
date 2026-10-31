import { useEffect, useRef, useState } from "react";
import { CircleDashed, Minus, Plus } from "lucide-react";
import SlidingTabs from "./SlidingTabs.jsx";
import { MIN_LOSS_MS, MAX_LOSS_MS } from "../utils/pitWindow.mjs";

export const secs = (ms) => (ms / 1000).toFixed(1);

// The stop cost typed in by hand, with half-second steps either side.
function OwnTime({ loss }) {
  const [draft, setDraft] = useState(secs(loss.ms));
  useEffect(() => setDraft(secs(loss.ms)), [loss.ms]);
  const commit = (text) => {
    const v = Number(String(text).replace(",", "."));
    if (Number.isFinite(v) && v > 0) loss.set(v * 1000);
    else setDraft(secs(loss.ms));
  };
  const btn = "grid h-9 w-9 place-items-center text-medium transition hover:bg-surface2 hover:text-dark disabled:opacity-40";
  return (
    <div className="flex items-center overflow-hidden rounded-lg border border-border">
      <button type="button" className={`${btn} border-r border-border`} onClick={() => loss.set(loss.ms - 500)} disabled={loss.ms <= MIN_LOSS_MS} title="Half a second less" aria-label="Half a second less">
        <Minus className="h-4 w-4" aria-hidden="true" />
      </button>
      <label className="flex items-baseline gap-0.5 px-2">
        <span className="sr-only">Time a pit stop costs, in seconds</span>
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="w-14 bg-transparent text-right font-mono text-base font-bold tabular-nums text-dark outline-none"
        />
        <span className="font-mono text-[11px] text-light">s</span>
      </label>
      <button type="button" className={`${btn} border-l border-border`} onClick={() => loss.set(loss.ms + 500)} disabled={loss.ms >= MAX_LOSS_MS} title="Half a second more" aria-label="Half a second more">
        <Plus className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

// Where the stop time comes from, in a few words.
export function lossNote(loss) {
  if (loss.source === "yours") return "Your own time for this circuit";
  if (loss.source === "learned") return `Learned from ${loss.learnedStops} ${loss.learnedStops === 1 ? "stop" : "stops"} in this race`;
  return "A first guess until somebody in the race stops";
}

// Header button on the Live page, beside TV mode: what a pit stop costs, set
// BEFORE the race. Nobody can click around a web page while driving, so this
// is where it is decided (Auto, learned from the race's own stops, or an own
// time for this circuit) and the map's pit window simply uses it.
export default function PitStopSetting({ loss, trackName }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (box.current && !box.current.contains(e.target)) setOpen(false);
    };
    const esc = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("touchstart", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("touchstart", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="What a pit stop costs, for the pit window on the map"
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider transition ${
          open ? "border-brand/60 bg-brand/10 text-dark" : "border-border text-light hover:bg-surface2 hover:text-dark"
        }`}
      >
        <CircleDashed className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
        Pit stop
        <span className="tabular-nums text-medium">{secs(loss.ms)} s</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-4 text-left shadow-lift">
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-light">Pit window</div>
          <p className="mt-1 text-sm leading-relaxed text-medium">
            How long a stop costs you, pit lane plus standstill. The ring on the map shows where you would come back out.
          </p>
          <SlidingTabs
            className="mt-3"
            wrapClassName="inline-flex rounded-lg border border-border bg-card p-0.5"
            btnClassName="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider"
            pillClassName="rounded-md bg-brand"
            items={[
              { key: "auto", label: "Auto", title: "Learned from the race's own stops" },
              { key: "own", label: "Own time", title: "Your own time for this circuit" },
            ]}
            value={loss.mode}
            onChange={loss.setMode}
          />
          <div className="mt-3 flex items-center gap-3">
            {loss.mode === "own" ? (
              <OwnTime loss={loss} />
            ) : (
              <span className="font-mono text-xl font-bold tabular-nums text-dark">{secs(loss.ms)} s</span>
            )}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-light">
            {lossNote(loss)}
            {loss.mode === "own" && trackName ? ` (${trackName}). Kept in this browser.` : "."}
          </p>
        </div>
      )}
    </div>
  );
}
