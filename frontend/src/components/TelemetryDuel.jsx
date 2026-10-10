import { useId, useState } from "react";
import { ArrowLeftRight, Trash2, X } from "lucide-react";
import TeamLogo from "./TeamLogo.jsx";
import { readableInkOn } from "./ui.jsx";
import { lapColor } from "./TelemetryCharts.jsx";
import { formatLapTime } from "../utils/telemetryAnalysis.js";

// ---------------------------------------------------------------------------
// Which two laps are compared, picked from the track's whole list: every
// recorded lap, fastest first, with a radio for A and one for B on each row.
// The choice is summed up above the list (both laps, the gap at the line and
// what the two could do together), so the list itself can stay a plain
// ranking. Comparing two of your own laps is two rows with your name on them.
// ---------------------------------------------------------------------------

// Rows shown before "Show all": enough for the front of the field, short
// enough that the comparison below is still in reach on a phone.
const FIRST_ROWS = 8;
const ORDINAL = ["best", "2nd", "3rd"];

// "5 Jun": which of a driver's laps this is, in a form that tells them apart
// when the times do not.
function recordedOn(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(d);
}

const gapText = (ms) => `+${(ms / 1000).toFixed(3)}`;

// One side's radio: a real input for the keyboard and screen readers, drawn
// as a dot in that lap's colour. The whole cell is the touch target.
function Pick({ name, side, on, color, label, disabled, onPick }) {
  return (
    <label className={`flex h-9 w-full items-center justify-center ${disabled ? "cursor-default opacity-40" : "cursor-pointer"}`} title={`Lap ${side}: ${label}`}>
      <input type="radio" name={name} className="peer sr-only" checked={on} disabled={disabled} onChange={onPick} aria-label={`Lap ${side}: ${label}`} />
      <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-border transition peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-1"
        style={on ? { borderColor: color, background: color } : undefined} aria-hidden="true">
        {on && <span className="h-1.5 w-1.5 rounded-full" style={{ background: readableInkOn(color) }} />}
      </span>
    </label>
  );
}

// The lap a side is on, as a chip: its letter in the lap's colour, the
// driver and the time. B can be emptied, which is a single-lap view.
function Choice({ side, lap, color, ordinal, onClear, placeholder }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-lg bg-card px-2.5 py-1.5 text-sm font-semibold text-dark ring-1 ring-border">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded font-mono text-[10px] font-black" style={{ background: color, color: readableInkOn(color) }} aria-hidden="true">{side}</span>
      {lap ? <>
        <span className="min-w-0 truncate">{lap.name}{ordinal && <span className="ml-1 text-[11px] font-normal text-light">({ordinal})</span>}</span>
        <span className="shrink-0 font-mono tabular-nums">{formatLapTime(lap.lapTimeMs)}</span>
        {onClear && (
          <button type="button" onClick={onClear} className="-mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-light transition hover:bg-surface2 hover:text-dark"
            aria-label="Clear lap B, show lap A on its own" title="Show lap A on its own">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </> : <span className="min-w-0 truncate font-normal text-light">{placeholder}</span>}
    </span>
  );
}

export default function TelemetryDuel({
  rows, pickOf, aId, bId, onPickA, onPickB, onSwap, onClearB, colorA, colorB, nameA, nameB, idealMs,
  myDriverId, canRemove = false, removing = false, onRemove,
}) {
  const uid = useId();
  const [all, setAll] = useState(false);
  const metaA = rows.find((l) => pickOf(l) === aId) || null;
  const metaB = rows.find((l) => pickOf(l) === bId) || null;
  const fastest = rows[0]?.lapTimeMs ?? null;
  const gap = metaA && metaB ? (metaB.lapTimeMs - metaA.lapTimeMs) / 1000 : null;
  const best = metaA && metaB ? Math.min(metaA.lapTimeMs, metaB.lapTimeMs) : null;
  const ordinalOf = (l) => (l && !l.only ? ORDINAL[l.rank] || `${l.rank + 1}th` : null);
  // The front of the list, plus whichever picked lap sits further down: a
  // chosen row must never be hidden behind "Show all".
  const shown = all ? rows : rows.filter((l, i) => i < FIRST_ROWS || pickOf(l) === aId || pickOf(l) === bId);
  const hidden = rows.length - shown.length;
  const label = (l) => `${l.name} ${formatLapTime(l.lapTimeMs)}${ordinalOf(l) ? ` (${ordinalOf(l)})` : ""}`;

  return (
    <section aria-label="Choose the laps" className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface2/60 px-3 py-2.5 sm:px-4">
        <Choice side="A" lap={metaA} color={colorA} ordinal={ordinalOf(metaA)} placeholder="Pick lap A from the list" />
        {gap != null && (
          <span className="font-mono text-xs font-bold tabular-nums" style={{ color: gap === 0 ? "var(--c-text3)" : gap > 0 ? colorA : colorB }}
            title={gap === 0 ? "Same recorded lap time" : `${gap > 0 ? nameA : nameB} is quicker by ${Math.abs(gap).toFixed(3)} s`}>
            {gap === 0 ? "level" : `${gap > 0 ? "+" : "−"}${Math.abs(gap).toFixed(3)}`}
          </span>
        )}
        <Choice side="B" lap={metaB} color={colorB} ordinal={ordinalOf(metaB)} onClear={metaB ? onClearB : null} placeholder="Pick lap B to compare" />
        <span className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-xs text-light sm:ml-auto sm:w-auto">
          <span className="hidden lg:inline">Pick A and B from the list</span>
          {idealMs != null && best != null && idealMs < best - 1 && (
            <span title="The quicker of the two through each sector, added up">
              <span className="hidden lg:inline">· </span>Best of both <span className="font-mono font-semibold tabular-nums text-dark">{formatLapTime(idealMs)}</span>
            </span>
          )}
          {metaA && metaB && (
            <button type="button" onClick={onSwap} className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-semibold text-medium transition hover:bg-surface2 hover:text-dark sm:ml-0">
              <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />Swap A / B
            </button>
          )}
        </span>
      </div>

      <div className="hidden grid-cols-[2rem_2.25rem_2.25rem_minmax(0,1fr)_6.5rem_5.5rem_6rem] gap-3 border-b border-border px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-light sm:grid" aria-hidden="true">
        <span>#</span><span className="text-center">A</span><span className="text-center">B</span><span>Driver</span><span className="text-right">Lap</span><span className="text-right">Gap</span><span>Recorded</span>
      </div>
      {/* The laps deal in top to bottom when the list first shows. */}
      <ul className="cascade divide-y divide-border">
        {shown.map((l, i) => {
          const id = pickOf(l);
          const pos = rows.indexOf(l);
          const isA = id === aId, isB = id === bId;
          const gapMs = fastest != null ? l.lapTimeMs - fastest : null;
          const ordinal = ordinalOf(l);
          return (
            <li key={id} style={{ "--i": Math.min(i, 12) }} className={`grid grid-cols-[1.25rem_2rem_2rem_minmax(0,1fr)_auto] items-center gap-x-2 px-3 py-1 sm:grid-cols-[2rem_2.25rem_2.25rem_minmax(0,1fr)_6.5rem_5.5rem_6rem] sm:gap-x-3 sm:px-4 ${isA || isB ? "bg-primary/10" : ""}`}>
              <span className="font-mono text-xs font-bold tabular-nums text-faint">{pos + 1}</span>
              <Pick name={`${uid}-a`} side="A" on={isA} color={colorA} label={label(l)} onPick={() => onPickA(id)} />
              <Pick name={`${uid}-b`} side="B" on={isB} color={colorB} label={label(l)} disabled={isA && !bId} onPick={() => onPickB(id)} />
              <span className="flex min-w-0 items-center gap-2">
                {l.team
                  ? <TeamLogo key={l.team.id} id={l.team.id} name={l.team.name} color={lapColor(l, "A")} logoUrl={l.team.logoUrl} size={20} />
                  : <span className="h-5 w-5 shrink-0" aria-hidden="true" />}
                <span className="min-w-0 truncate text-sm font-semibold text-dark" title={String(l.car || "").replaceAll("_", " ") || undefined}>{l.name}</span>
                {ordinal && <span className="shrink-0 text-[11px] text-light">({ordinal})</span>}
                {myDriverId && l.driverId === myDriverId && <span className="shrink-0 rounded bg-surface2 px-1 font-mono text-[9px] font-bold uppercase text-light">you</span>}
                {canRemove && (
                  <button type="button" onClick={() => onRemove(l)} disabled={removing}
                    className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded text-faint transition hover:bg-bad/10 hover:text-bad disabled:opacity-40"
                    aria-label={`Remove ${label(l)}`} title="Delete this lap from the site's store (admins only)">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </span>
              <span className="text-right font-mono text-sm font-bold tabular-nums text-dark">
                {formatLapTime(l.lapTimeMs)}
                <span className="block text-[10px] font-normal text-light sm:hidden">{gapMs ? gapText(gapMs) : "Best"}</span>
              </span>
              <span className="hidden text-right font-mono text-xs tabular-nums text-light sm:block">{gapMs ? gapText(gapMs) : "Best"}</span>
              <span className="hidden truncate text-xs text-light sm:block">{recordedOn(l.recordedAt)}</span>
            </li>
          );
        })}
      </ul>
      {(all || hidden > 0) && (
        <button type="button" onClick={() => setAll((v) => !v)} className="block w-full border-t border-border px-4 py-2.5 text-center text-xs font-semibold text-link transition hover:bg-surface2">
          {all ? "Show fewer laps" : `Show all ${rows.length} laps`}
        </button>
      )}
    </section>
  );
}
