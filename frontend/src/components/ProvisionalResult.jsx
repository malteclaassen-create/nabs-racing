import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Flag from "./Flag.jsx";
import { TyreBadge } from "./TyreStrategy.jsx";
import { MEDAL_TEXT } from "./ui.jsx";
import { useScrollLock } from "./overlay.jsx";
import { motionOff } from "../hooks/motion.js";
import { NO_VALUE } from "../utils/format.js";
import { formatLap, formatRaceGap, countryCodeFromName, tyreCompound } from "../data/liveTiming.js";

// The result of a race that ran earlier, straight off the live board, shown on
// the live page while the server has long moved on. Two pieces: the BANNER
// that says there is one, and the RESULT itself as an overlay over the page.
//
// It is provisional and says so in three places, because the one thing this
// must never be mistaken for is the league's result: no penalties, no
// stewarding, the server's own driver names, the board's own order. The
// official classification is what the admins import, hours later.

// "Fri 20:47" — the finish, in the viewer's own clock. Today's result reads
// as a time, yesterday's as a day and a time.
function whenLabel(iso) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  const sameDay = t.toDateString() === new Date().toDateString();
  const time = t.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  return `${t.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
}

function CheckerIcon({ className = "h-4 w-4" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 22V3" />
      <path d="M4 3h14l-2 5 2 5H4" />
      <path d="M8 3v10M12 3v10M4 6.5h14M4 9.5h14" opacity="0.5" />
    </svg>
  );
}

// One line under the page header: the latest result, and a button to see it.
export function ProvisionalBanner({ results, onOpen }) {
  const r = results[0];
  if (!r) return null;
  const code = countryCodeFromName(r.country);
  const more = results.length - 1;
  return (
    <div className="reveal card relative mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 overflow-hidden px-4 py-3 sm:mb-6 sm:px-5">
      <span className="absolute inset-y-0 left-0 w-1 bg-fl" aria-hidden />
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-fl/15 text-fl">
        <CheckerIcon />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">
            Provisional result
          </span>
          <span className="pill bg-amber-500/15 text-warn">Not official</span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2">
          {code && <Flag code={code} title={r.country} w={20} h={15} />}
          <span className="truncate font-display text-base font-bold uppercase tracking-tight text-dark">
            {r.trackName}
          </span>
          <span className="shrink-0 font-mono text-xs text-light">
            {r.laps} laps · finished {whenLabel(r.finishedAt)}
            {more > 0 ? ` · +${more} more` : ""}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onOpen(r.id)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-wider text-ink transition hover:brightness-105"
      >
        View result
      </button>
    </div>
  );
}

// Retired, as far as the board can tell: not out there any more (left the
// server or parked in the garage) and short of the distance by more than a
// lapped finisher would be. A finisher who logged off after the flag has the
// full lap count and stays classified.
function retired(e, r) {
  if (!r.raceLaps) return false;
  return (e.lapCount || 0) < r.raceLaps - 1 && (!e.onTrack || e.inPits);
}

function Stints({ stints }) {
  if (!stints?.length) return <span className="text-faint">{NO_VALUE}</span>;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {stints.map((s, i) => {
        const t = tyreCompound(s.tyre);
        return (
          <span key={i} className="flex items-center gap-1" title={`${t.name}, ${s.laps} ${s.laps === 1 ? "lap" : "laps"}`}>
            {i > 0 && <span className="text-faint" aria-hidden>›</span>}
            <TyreBadge t={t} size={18} />
            <span className="font-mono text-[11px] tabular-nums text-medium">{s.laps}</span>
          </span>
        );
      })}
    </span>
  );
}

export function ProvisionalResult({ results, openId, match, onPick, onClose, isAdmin = false, onRemove = null }) {
  const r = useMemo(() => results.find((x) => x.id === openId) || results[0], [results, openId]);
  useScrollLock(true);
  const [leaving, setLeaving] = useState(false);
  const leave = () => {
    if (motionOff()) return onClose();
    setLeaving(true);
    setTimeout(onClose, 140);
  };
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") leave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Classified by the line: laps first, then the gap at the flag. The board
  // now saves them in this order itself; sorting again here also puts right
  // a result taken before it did (Most, 2026-09-04, which had the running
  // order of the cool-down lap). A car without a gap on the same lap keeps
  // its saved place behind those with one.
  const rows = useMemo(() => {
    const list = (r?.entries || []).filter((e) => !e.isSafetyCar).map((e, i) => ({ e, i }));
    list.sort((a, b) => {
      const la = a.e.lapCount || 0;
      const lb = b.e.lapCount || 0;
      if (la !== lb) return lb - la;
      const ga = a.e.gapToLeaderMs;
      const gb = b.e.gapToLeaderMs;
      if (ga != null && gb != null && ga !== gb) return ga - gb;
      if (ga != null && gb == null) return -1;
      if (gb != null && ga == null) return 1;
      return a.i - b.i;
    });
    return list.map((x) => x.e);
  }, [r]);
  if (!r) return null;
  const code = countryCodeFromName(r.country);
  const leaderLaps = rows[0]?.lapCount || 0;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Provisional result, ${r.trackName}`}
      className={`fixed inset-0 z-overlay flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6 ${
        leaving ? "fade-out" : "content-in"
      }`}
      onClick={leave}
    >
      <div
        className="card relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-b-none sm:rounded-b-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <span aria-hidden className="h-[3px] shrink-0 bg-gradient-to-r from-primary via-amber-500 to-sky-600" />
        {/* ===== Head: what race, and the warning that this is not the result ===== */}
        <div className="flex shrink-0 items-start gap-3 border-b border-border px-4 py-4 sm:px-6">
          {code && <Flag code={code} title={r.country} w={34} h={25} className="mt-1" />}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">
                Provisional result
              </span>
              <span className="pill bg-amber-500/15 text-warn">Not official</span>
              {!r.completed && <span className="pill bg-surface2 text-medium">Stopped early</span>}
            </div>
            <div className="mt-0.5 truncate font-display text-xl font-extrabold uppercase tracking-tight text-dark sm:text-2xl">
              {r.trackName}
            </div>
            <div className="mt-0.5 font-mono text-xs text-light">
              {r.laps}
              {r.raceLaps ? ` of ${r.raceLaps}` : ""} laps · {r.drivers} drivers · finished {whenLabel(r.finishedAt)}
              {r.serverName ? ` · ${r.serverName}` : ""}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Admins only: off the page for good. The provisional result has
                no business outliving the official one, and sometimes it
                should not have been shown at all. */}
            {isAdmin && onRemove && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Remove this provisional result (${r.trackName}) from the live page? This cannot be undone.`)) {
                    onRemove(r.id);
                  }
                }}
                className="rounded-lg border border-red-500/40 px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-bad transition hover:bg-red-500/10"
                title="Take this result off the live page (admins)"
              >
                Remove
              </button>
            )}
            <button
              type="button"
              onClick={leave}
              className="shrink-0 rounded-lg border border-border px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-light transition hover:bg-surface2 hover:text-dark"
              title="Close (Esc)"
            >
              Close
            </button>
          </div>
        </div>

        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-warn sm:px-6">
          Taken straight from the live timing when the flag fell. No penalties, no stewarding, no checks.
          The official result is published by the admins after the race.
        </div>

        {/* A double-header: pick the running. */}
        {results.length > 1 && (
          <div className="flex shrink-0 flex-wrap gap-2 border-b border-border px-4 py-2.5 sm:px-6">
            {results.map((x) => (
              <button
                key={x.id}
                type="button"
                onClick={() => onPick(x.id)}
                className={`rounded-lg border px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-wider transition ${
                  x.id === r.id
                    ? "border-brand/60 bg-brand/10 text-dark"
                    : "border-border text-light hover:bg-surface2 hover:text-dark"
                }`}
              >
                {x.trackName} · {whenLabel(x.finishedAt)}
              </button>
            ))}
          </div>
        )}

        {/* ===== The classification. Phones drop the lap and pit counts: the
            tyre strip says both (its laps add up to the distance, its arrows
            are the stops), and the table has to fit the screen without a
            sideways scroll nothing announces. ===== */}
        <div className="scrollbar-slim min-h-0 flex-1 overflow-auto">
          <table className="w-full sm:min-w-[560px]">
            <thead>
              <tr className="text-left font-mono text-[11px] font-bold uppercase tracking-widest text-light">
                <th className="sticky top-0 z-10 bg-card py-2.5 pl-4 pr-2 text-center shadow-[inset_0_-1px_0_var(--c-border)] sm:pl-6">Pos</th>
                <th className="sticky top-0 z-10 bg-card py-2.5 pl-1 shadow-[inset_0_-1px_0_var(--c-border)]">Driver</th>
                <th className="sticky top-0 z-10 bg-card py-2.5 pr-4 text-right shadow-[inset_0_-1px_0_var(--c-border)]">Gap</th>
                <th className="sticky top-0 z-10 bg-card py-2.5 pr-4 text-right shadow-[inset_0_-1px_0_var(--c-border)]">Best lap</th>
                <th className="sticky top-0 z-10 hidden bg-card py-2.5 pr-4 text-center shadow-[inset_0_-1px_0_var(--c-border)] sm:table-cell">Laps</th>
                <th className="sticky top-0 z-10 hidden bg-card py-2.5 pr-4 text-center shadow-[inset_0_-1px_0_var(--c-border)] sm:table-cell">Pits</th>
                <th className="sticky top-0 z-10 bg-card py-2.5 pr-4 shadow-[inset_0_-1px_0_var(--c-border)] sm:pr-6">Tyres</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e, i) => {
                const m = match ? match(e.name) : null;
                const out = retired(e, r);
                const fl = r.fastestLapMs && e.bestLapMs === r.fastestLapMs;
                const medal = !out && i < 3 && r.completed ? MEDAL_TEXT[i] : "";
                return (
                  <tr key={e.guid} className={`border-b border-border last:border-0 ${out ? "opacity-60" : ""}`}>
                    <td className="py-2.5 pl-4 pr-2 text-center sm:pl-6">
                      <span
                        className={`inline-flex h-8 w-8 items-center justify-center rounded-md font-display text-base font-black tabular-nums ${
                          i === 0 && !out ? "bg-brand text-ink" : medal || "text-medium"
                        }`}
                      >
                        {i + 1}
                      </span>
                    </td>
                    <td className="py-2.5 pl-1 pr-3">
                      <div className="flex items-center gap-2 sm:gap-3">
                        <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: m?.teamColor || "var(--c-border)" }} />
                        {m?.country ? (
                          <Flag code={m.country} title={m.teamName} className="hidden sm:block" />
                        ) : (
                          <span className="hidden h-[15px] w-5 shrink-0 sm:block" />
                        )}
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate font-display text-base font-bold uppercase tracking-tight text-dark" title={e.name}>
                              {m?.nabsName || e.name}
                            </span>
                            {fl && <span className="pill bg-fl/20 text-fl">FL</span>}
                            {out && <span className="pill bg-surface2 text-medium">DNF</span>}
                          </span>
                          <span className="block truncate text-xs text-light">{m?.teamName || e.carName || NO_VALUE}</span>
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono text-sm tabular-nums text-medium">
                      {i === 0 ? (
                        <span className="text-light">Winner</span>
                      ) : out ? (
                        <span className="text-light">{leaderLaps - (e.lapCount || 0)} laps short</span>
                      ) : (
                        formatRaceGap(e.gapToLeaderMs, e.lapsDown)
                      )}
                    </td>
                    <td className={`py-2.5 pr-4 text-right font-mono text-sm font-bold tabular-nums ${fl ? "text-fl" : "text-dark"}`}>
                      {formatLap(e.bestLapMs)}
                    </td>
                    <td className="hidden py-2.5 pr-4 text-center font-mono text-sm tabular-nums text-medium sm:table-cell">{e.lapCount}</td>
                    <td className="hidden py-2.5 pr-4 text-center font-mono text-sm tabular-nums text-medium sm:table-cell">{e.numPits ?? 0}</td>
                    <td className="py-2.5 pr-4 sm:pr-6">
                      <Stints stints={e.stints} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="shrink-0 border-t border-border px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider text-light sm:px-6">
          {r.fastestBy ? (
            <>
              <span className="text-fl">Fastest lap {formatLap(r.fastestLapMs)}</span> · {r.fastestBy}
            </>
          ) : (
            "No lap times recorded"
          )}
          {r.final ? " · Final board" : " · Field still finishing"}
        </div>
      </div>
    </div>,
    document.body
  );
}
