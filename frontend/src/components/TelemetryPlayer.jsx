import { Keyboard, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { Kbd, Menu } from "./TelemetryUI.jsx";

// ---------------------------------------------------------------------------
// The transport, laid out like a player: play on the left, the lap as a
// slider with a section skip at either end, the speed and where the cursor is
// on the right. It stays pinned under the site's bar while the map and the
// traces scroll past, so scrubbing and playing never mean scrolling back up —
// and the gap at the cursor rides along, so the number the traces are
// explaining is always in view.
// ---------------------------------------------------------------------------

const RATES = [0.25, 0.5, 1, 2, 4];

function Shortcuts() {
  const rows = [
    [["Space"], "play / pause"],
    [["←", "→"], "step (Shift: ×10)"],
    [["[", "]"], "previous / next section"],
    [["Home", "End"], "start / finish"],
    [["F"], "full screen"],
  ];
  return (
    <Menu icon={Keyboard} label="Keyboard shortcuts and tips" summary={false} width="w-64">
      <div className="space-y-1.5 px-2.5 py-2 text-light">
        {rows.map(([keys, what]) => (
          <p key={what} className="flex items-center justify-between gap-3"><span className="flex gap-1">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span><span className="text-right">{what}</span></p>
        ))}
        <p className="border-t border-border pt-2">Select a point on the map or a trace to move the cursor. Drag across a trace to zoom into that stretch; double-click for the full lap.</p>
      </div>
    </Menu>
  );
}

export default function TelemetryPlayer({ playing, onToggle, playLabel, at, n, sections, activeN, onPick, onJump, hasPrev, hasNext, rate, onRate, position, gapAt, colorA, colorB }) {
  const leader = gapAt == null || Math.abs(gapAt) < 0.0005 ? null : gapAt > 0 ? "A" : "B";
  return (
    <div className="sticky z-20 -mx-1 px-1 py-1.5" style={{ top: "var(--tel-top, 84px)" }}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-border bg-card/90 px-2 py-2 shadow-lift backdrop-blur sm:gap-x-3 sm:px-3">
        {/* Pause keeps the cursor where it is; Play resumes from there. Only a
            lap that has run to the flag (or has no cursor yet) starts over. */}
        <button type="button" className="btn-primary h-9 shrink-0 gap-2 px-3 py-0 text-xs sm:min-w-[6.5rem]" onClick={onToggle} title="Space bar plays and pauses" aria-pressed={playing} aria-label={playLabel}>
          {playing ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
          <span className="hidden sm:inline">{playLabel}</span>
        </button>
        <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-medium transition hover:bg-surface2 disabled:opacity-30" onClick={() => onJump(-1)} disabled={!hasPrev} aria-label="Previous slow section" title="Previous slow section ( [ )"><SkipBack className="h-4 w-4" aria-hidden="true" /></button>
        <div className="relative min-w-0 flex-1 py-1">
          <input type="range" aria-label="Position around the lap" aria-valuetext={`${((at / (n - 1)) * 100).toFixed(1)} percent of lap`} min="0" max={n - 1} step="1" value={at} onChange={(e) => onPick(Number(e.target.value))} className="block w-full cursor-pointer accent-primary" />
          <div className="pointer-events-none absolute inset-x-2 bottom-0 h-1.5" aria-hidden="true">
            {sections.map((s) => <span key={s.n} className="absolute top-0 h-1.5 w-px" style={{ left: `${(s.apex / (n - 1)) * 100}%`, background: s.n === activeN ? "rgb(var(--c-accent))" : "var(--c-text3)" }} />)}
          </div>
        </div>
        <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-medium transition hover:bg-surface2 disabled:opacity-30" onClick={() => onJump(1)} disabled={!hasNext} aria-label="Next slow section" title="Next slow section ( ] )"><SkipForward className="h-4 w-4" aria-hidden="true" /></button>
        {/* A speed change restarts the run; the caller hands it the current
            cursor so the dot stays where it is. */}
        <select aria-label="Playback speed" className="h-8 shrink-0 rounded-lg border border-border bg-card px-2 text-xs font-semibold text-dark" value={rate} onChange={(e) => onRate(Number(e.target.value))}>
          {RATES.map((r) => <option key={r} value={r}>{r}×</option>)}
        </select>
        {/* Fixed widths: text that changes length here would reflow the whole
            bar with every frame of playback. */}
        <div className="flex basis-full items-center justify-between gap-3 font-mono text-[11px] tabular-nums sm:basis-auto sm:justify-end">
          <span className="whitespace-nowrap text-light sm:min-w-[7.5rem] sm:text-right">{position}</span>
          {gapAt != null && (
            <span className="whitespace-nowrap sm:min-w-[5.5rem] sm:text-right" title="Gap at the cursor (B − A)">
              <span className="text-light">Δ </span>
              <span className="font-semibold" style={{ color: leader === "A" ? colorA : leader === "B" ? colorB : "var(--c-text)" }}>{gapAt > 0 ? "+" : gapAt < 0 ? "−" : ""}{Math.abs(gapAt).toFixed(3)}</span>
            </span>
          )}
          <Shortcuts />
        </div>
      </div>
    </div>
  );
}
