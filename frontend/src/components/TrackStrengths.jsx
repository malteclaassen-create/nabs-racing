import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import SlidingTabs from "./SlidingTabs.jsx";
import CircuitMap from "./CircuitMap.jsx";
import { Skeleton } from "./ui.jsx";
import { circuitFor } from "../data/circuits.js";
import { isIdleReserve } from "../utils/standingsRow.js";

// ---------------------------------------------------------------------------
// Track strengths on the driver profile: which KIND of circuit this driver
// goes best on, out of every race they drove (backend
// services/trackStrengthService.js has the arithmetic). A radar of the six
// circuit types, the same numbers as rows with the circuits behind each, and
// every circuit on its own underneath.
//
// 50 is the field's average by construction (each race is a rank inside its
// own grid), so the dashed ring is "as good as the people around them", and
// the numbers of two drivers can be laid over each other: pick a rival.
// ---------------------------------------------------------------------------

// The rival is drawn in their own team colour, unless that is too close to
// this driver's to tell apart on the radar (a team mate, two blue teams):
// then in the neutral text tone, which no team colour is.
const NEUTRAL = "var(--c-text2)";
function rgbOf(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rivalColour(mine, theirs) {
  const a = rgbOf(mine);
  const b = rgbOf(theirs);
  if (!a || !b) return NEUTRAL;
  const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  return d < 110 ? NEUTRAL : theirs;
}
// A number is only coloured when it says something: clearly ahead of the
// field, or clearly behind it. The middle stays in the text colour.
const tone = (v) => (v == null ? "var(--c-faint)" : v >= 60 ? "rgb(var(--c-ok))" : v < 45 ? "rgb(var(--c-bad))" : "var(--c-text)");
const toneTile = (v) => (v >= 60 ? "rgb(var(--c-ok))" : v < 45 ? "rgb(var(--c-bad))" : "rgb(var(--c-warn))");
const races = (n) => `${n} race${n === 1 ? "" : "s"}`;
const gap = (pct) => (pct == null ? null : `+${pct.toFixed(2)}%`);

// The radar. Only the types with a race behind them get an axis: a spoke at
// zero for "never raced there" would read as "hopeless there".
function Radar({ axes, color, rivalColor }) {
  const n = axes.length;
  const R = 104;
  const at = (i, v) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [Math.cos(a) * (R * v) / 100, Math.sin(a) * (R * v) / 100];
  };
  const poly = (vals) => vals.map((v, i) => at(i, v).map((c) => c.toFixed(1)).join(",")).join(" ");
  const hasRival = axes.some((a) => a.rival != null);
  return (
    <svg viewBox="-235 -150 470 314" className="block w-full" role="img"
      aria-label={`Track strengths: ${axes.map((a) => `${a.label} ${a.me}`).join(", ")}`}>
      {[25, 50, 75, 100].map((l) => (
        <polygon key={l} points={poly(Array(n).fill(l))} fill={l === 100 ? "var(--c-surface2)" : "none"}
          stroke="var(--c-border)" strokeWidth="1" strokeDasharray={l === 50 ? "4 3" : undefined} />
      ))}
      {axes.map((a, i) => {
        const [x, y] = at(i, 100);
        return <line key={a.key} x1="0" y1="0" x2={x} y2={y} stroke="var(--c-border)" />;
      })}
      {/* The field's average, the reference every number is read against. */}
      <polygon points={poly(Array(n).fill(50))} fill="none" stroke="var(--c-faint)" strokeWidth="1.5" strokeDasharray="4 3" />
      {hasRival && (
        <polygon points={poly(axes.map((a) => a.rival ?? 50))} fill={rivalColor} fillOpacity="0.1" stroke={rivalColor} strokeWidth="1.8" strokeLinejoin="round" />
      )}
      <polygon points={poly(axes.map((a) => a.me))} fill={color} fillOpacity="0.22" stroke={color} strokeWidth="2.4" strokeLinejoin="round" />
      {axes.map((a, i) => {
        const [x, y] = at(i, a.me);
        return <circle key={a.key} cx={x} cy={y} r="3.6" fill={color} stroke="var(--c-card)" strokeWidth="1.5" />;
      })}
      {axes.map((a, i) => {
        const [x, y] = at(i, 118);
        const anchor = Math.abs(x) < 8 ? "middle" : x > 0 ? "start" : "end";
        const dy = y > 10 ? 10 : y < -10 ? -6 : 3;
        return (
          <g key={a.key}>
            <text x={x} y={y + dy} textAnchor={anchor} className="font-mono" fontSize="10" fontWeight="600" letterSpacing=".5" fill="var(--c-text3)">
              {a.short.toUpperCase()}
            </text>
            <text x={x} y={y + dy + 14} textAnchor={anchor} className="font-display" fontSize="14" fontWeight="900" fill="var(--c-text)">
              {a.me}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// Folded content that slides open, the same way the tyre-strategy drawer on
// the race results does: a one-row grid going 0fr -> 1fr, so the height
// animates to whatever the content is without measuring it. Always rendered,
// so opening it never pops.
function Drawer({ open, id, children }) {
  return (
    <div id={id} aria-hidden={!open} className={`ts-drawer grid transition-[grid-template-rows] duration-base ease-out-soft ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
      <div className="min-h-0 overflow-hidden" inert={open ? undefined : ""}>{children}</div>
    </div>
  );
}

// The chevron every fold on the card uses: down when closed, up when open.
const Chevron = ({ open, className = "" }) => (
  <ChevronDown className={`h-4 w-4 shrink-0 text-light transition-transform duration-base ${open ? "rotate-180" : ""} ${className}`} aria-hidden="true" />
);

// Whether the screen has room to show everything open: the card starts with
// the long parts folded on a phone and open on a desktop. Read once — a
// window resized afterwards keeps whatever the reader has opened.
const startsWide = () => {
  try {
    return window.matchMedia("(min-width: 1024px)").matches;
  } catch {
    return true;
  }
};

// Radar labels have a spoke's worth of room; the rows say it in full.
const SHORT = { highspeed: "High-speed", braking: "Braking", power: "Power", flowing: "Flowing", technical: "Technical", street: "Street" };

// One sentence a visitor can take away, out of the numbers themselves. Says
// nothing it cannot back: no strongest kind is named when the kinds are level.
function summary(data, name) {
  const byKey = Object.fromEntries(data.types.map((t) => [t.key, t]));
  const best = data.strongest ? byKey[data.strongest] : null;
  const worst = data.weakest ? byKey[data.weakest] : null;
  if (!best && !worst) return `${name} goes about as well on every kind of circuit: no type stands out from the others.`;
  const names = (t) => t.tracks.slice(0, 3).map((x) => x.name).join(", ");
  const parts = [];
  if (best) parts.push(`Strongest on ${best.label.toLowerCase()} circuits (${names(best)}), at ${best.score}`);
  if (worst) parts.push(`weakest on ${worst.label.toLowerCase()} ones (${names(worst)}), at ${worst.score}`);
  const s = parts.join("; ");
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

export default function TrackStrengths({ driver, color, standings = [] }) {
  const [scope, setScope] = useState("all");
  const [rivalId, setRivalId] = useState("");
  // What is unfolded: the detail of each circuit type (none to start with —
  // the bar and the number say the most), the circuit tiles (open on a
  // desktop, folded on a phone, where they are a long scroll) and the note on
  // how it is measured.
  const [openTypes, setOpenTypes] = useState(() => new Set());
  const [tracksOpen, setTracksOpen] = useState(startsWide);
  const [aboutOpen, setAboutOpen] = useState(false);
  const toggleType = (key) =>
    setOpenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const { data, loading, error } = useApi(useCallback(() => api.driverTrackStrengths(driver.id, scope), [driver.id, scope]));
  // The rival is read for the same scope, so the two shapes on the radar
  // are always measured over the same stretch of seasons.
  const [rival, setRival] = useState(null);
  useEffect(() => {
    setRival(null);
    if (!rivalId) return undefined;
    let alive = true;
    api.driverTrackStrengths(rivalId, scope).then((d) => alive && setRival(d)).catch(() => alive && setRival(null));
    return () => {
      alive = false;
    };
  }, [rivalId, scope]);

  // The rival list: this season's field, same rule as the head-to-head
  // picker — anyone who scored, never the idle reserve pool.
  const others = useMemo(
    () =>
      standings
        .filter((s) => s.driverId !== driver.id && s.total > 0 && !isIdleReserve(s))
        .sort((a, b) => a.position - b.position),
    [standings, driver.id]
  );
  const rivalRow = others.find((o) => o.driverId === rivalId) || null;
  const rivalName = rivalRow?.name || null;
  const RIVAL = rivalColour(color, rivalRow?.team?.color);

  // Nothing to say about a driver with a race or two to their name, in any
  // season of the league: the card stays away rather than printing noise. A
  // thin single season, on the other hand, says so (below) — the switch to
  // All seasons is right there.
  if (loading && !data) return <Skeleton className="h-[28rem] rounded-xl" />;
  if (error || !data) return null;
  if (scope === "all" && data.races < 3) return null;

  const scored = data.types.filter((t) => t.score != null);
  const rivalBy = Object.fromEntries((rival?.types || []).map((t) => [t.key, t]));
  const axes = scored.map((t) => ({ key: t.key, label: t.label, short: SHORT[t.key] || t.label, me: t.score, rival: rivalBy[t.key]?.score ?? null }));
  const showRadar = axes.length >= 3;
  // The two biggest differences to the rival, either way.
  const diffs = rival
    ? axes.filter((a) => a.rival != null).map((a) => ({ ...a, d: a.me - a.rival })).sort((x, y) => y.d - x.d)
    : [];
  const ahead = diffs.find((x) => x.d >= 5);
  const behind = [...diffs].reverse().find((x) => x.d <= -5);

  return (
    <div className="reveal card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b border-border px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-extrabold uppercase tracking-tight text-dark sm:text-xl">Track Strengths</h2>
          <p className="mt-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-light">
            Which kind of circuit suits {driver.name} · 50 = the field&rsquo;s average
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SlidingTabs
            items={[
              { key: "all", label: "All seasons" },
              { key: "season", label: `Season ${driver.seasonNumber ?? ""}`.trim() },
            ]}
            value={scope}
            onChange={setScope}
            btnClassName="px-3 py-1.5 text-xs font-bold uppercase tracking-wider"
          />
          {others.length > 0 && (
            <select aria-label="Compare with another driver" className="input w-auto py-1.5 text-xs font-semibold" value={rivalId} onChange={(e) => setRivalId(e.target.value)}>
              <option value="">Compare with…</option>
              {others.map((o) => (
                <option key={o.driverId} value={o.driverId}>vs {o.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {data.races === 0 || !scored.length ? (
        <p className="px-5 py-8 text-center text-sm text-light sm:px-6">
          {data.races === 0 ? "No races finished in this stretch yet." : "None of the circuits raced here has a type yet."}
        </p>
      ) : (
        <>
          <div className={`grid ${showRadar ? "lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]" : ""}`}>
            {showRadar && (
              <div className="border-b border-border px-4 pb-4 pt-3 lg:border-b-0 lg:border-r">
                <Radar axes={axes} color={color} rivalColor={RIVAL} />
                <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs font-semibold text-medium">
                  <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full" style={{ background: color }} />{driver.name}</span>
                  {rival && rivalName && <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full" style={{ background: RIVAL }} />{rivalName}</span>}
                  <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-faint" />Field average</span>
                </div>
                <div className="mx-1 mt-4 rounded-lg border border-border bg-surface2 px-3.5 py-3">
                  <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-eyebrow">In short</div>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-medium">{summary(data, driver.name)}</p>
                  {rival && rivalName && (ahead || behind) && (
                    <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-light">
                      vs {rivalName}:{" "}
                      {ahead && <span className="text-ok">+{ahead.d} {ahead.short.toLowerCase()}</span>}
                      {ahead && behind && " · "}
                      {behind && <span className="text-bad">{behind.d} {behind.short.toLowerCase()}</span>}
                    </p>
                  )}
                </div>
              </div>
            )}
            <ul className="divide-y divide-border">
              {data.types.map((t) => {
                const none = t.score == null;
                const open = openTypes.has(t.key);
                const panel = `ts-type-${t.key}`;
                return (
                  <li key={t.key} className={none ? "opacity-60" : ""}>
                    {/* The row is the switch: tap it for the races, the
                        average finish and the circuits behind the number. */}
                    <button type="button" onClick={() => toggleType(t.key)} aria-expanded={open} aria-controls={panel}
                      className="grid w-full grid-cols-[minmax(0,1fr)_3.5rem_1rem] items-center gap-x-3 px-5 py-3 text-left transition hover:bg-surface2/60 sm:px-6">
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-display text-sm font-bold uppercase tracking-tight text-dark" title={t.hint}>{t.label}</span>
                          {data.strongest === t.key && <span className="pill bg-ok/15 text-ok">Strongest</span>}
                          {data.weakest === t.key && <span className="pill bg-bad/15 text-bad">Weakest</span>}
                          {rivalBy[t.key]?.score != null && !none && (
                            <span className="font-mono text-[11px] font-semibold tabular-nums" style={{ color: RIVAL }} title={`${rivalName}: ${rivalBy[t.key].score}`}>
                              {rivalName?.split(" ")[0]} {rivalBy[t.key].score}
                            </span>
                          )}
                        </span>
                        <span className="relative mt-2 block h-[7px] rounded-full bg-surface2">
                          {!none && <span className="block h-full rounded-full" style={{ width: `${t.score}%`, background: color }} />}
                          {/* The field's average, where every bar is read from. */}
                          <span className="absolute -bottom-[3px] -top-[3px] left-1/2 w-0.5 rounded bg-faint" aria-hidden="true" />
                        </span>
                      </span>
                      <span className="text-right font-display text-2xl font-black tabular-nums" style={{ color: tone(t.score) }}>
                        {none ? "–" : t.score}
                      </span>
                      <Chevron open={open} />
                    </button>
                    <Drawer open={open} id={panel}>
                      <div className="px-5 pb-3 sm:px-6">
                        <div className="font-mono text-[11px] tracking-wide text-light">
                          {none ? (
                            "no races on this kind of circuit yet"
                          ) : (
                            <>
                              <span className="text-medium">{races(t.races)}</span>
                              {t.avgFinish != null && <> · avg finish <span className="text-medium">P{t.avgFinish}</span></>}
                              {t.avgGapPct != null && <> · gap to fastest lap <span className="text-medium">{gap(t.avgGapPct)}</span></>}
                            </>
                          )}
                        </div>
                        {t.hint && <div className="mt-1 text-xs text-light">{t.hint}</div>}
                        {t.tracks.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {t.tracks.map((x) => (
                              <span key={x.key} className="rounded-md border border-border bg-surface2 px-1.5 py-px text-[11px] font-semibold text-medium">{x.name}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </Drawer>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="border-t border-border">
            <button type="button" onClick={() => setTracksOpen((o) => !o)} aria-expanded={tracksOpen} aria-controls="ts-tracks"
              className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-5 py-4 text-left transition hover:bg-surface2/60 sm:px-6">
              <span className="flex items-baseline gap-2">
                <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">By track</h3>
                <span className="font-mono text-[11px] font-semibold text-light">{data.tracks.length}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="hidden font-mono text-[11px] font-semibold uppercase tracking-wider text-light sm:inline">best first · avg finish · gap to fastest lap</span>
                <Chevron open={tracksOpen} />
              </span>
            </button>
            <Drawer open={tracksOpen} id="ts-tracks">
            <div className="grid grid-cols-2 gap-2.5 px-5 pb-4 sm:grid-cols-3 sm:px-6 lg:grid-cols-6">
              {data.tracks.map((t) => {
                const c = toneTile(t.score);
                return (
                  <div key={t.key} className="relative overflow-hidden rounded-lg border border-border bg-surface2 px-2.5 pb-2 pt-2.5" title={`${t.name}: ${races(t.races)}`}>
                    <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: c }} aria-hidden="true" />
                    <div className="flex h-14 items-center justify-center">
                      {circuitFor(t.key) || circuitFor(t.name) ? (
                        <CircuitMap track={circuitFor(t.key) ? t.key : t.name} stroke={c} strokeWidth={2} className="h-14 w-full" />
                      ) : (
                        <span className="font-mono text-[10px] uppercase tracking-wider text-faint">no outline</span>
                      )}
                    </div>
                    <div className="mt-1.5 flex items-baseline justify-between gap-1">
                      <span className="truncate font-display text-[13px] font-extrabold uppercase tracking-tight text-dark">{t.name}</span>
                      <span className="font-display text-base font-black tabular-nums" style={{ color: c }}>{t.score}</span>
                    </div>
                    <div className="truncate text-[10px] font-semibold text-light">
                      {t.types.length ? t.types.map((k) => SHORT[k] || k).join(" · ") : "no type set"}
                    </div>
                    <div className="mt-1.5 flex justify-between font-mono text-[11px] tabular-nums text-medium">
                      <span>{t.avgFinish != null ? `P${t.avgFinish}` : "DNF"}</span>
                      <span>{gap(t.avgGapPct) || "–"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            </Drawer>
          </div>
        </>
      )}

      <div className="border-t border-border">
      <button type="button" onClick={() => setAboutOpen((o) => !o)} aria-expanded={aboutOpen} aria-controls="ts-about"
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left text-xs font-semibold text-light transition hover:bg-surface2/60 hover:text-dark sm:px-6">
        <span>
          {races(data.races)}
          {data.seasons?.length ? ` · Season${data.seasons.length === 1 ? "" : "s"} ${data.seasons.join(", ")}` : ""} · How is this measured?
        </span>
        <Chevron open={aboutOpen} />
      </button>
      <Drawer open={aboutOpen} id="ts-about">
      <p className="px-5 pb-3 text-xs leading-relaxed text-faint sm:px-6">
        {races(data.races)}
        {data.seasons?.length ? ` across Season${data.seasons.length === 1 ? "" : "s"} ${data.seasons.join(", ")}` : ""}. Every race is
        measured against its own field: where the driver finished among the finishers and where their best lap ranked. The
        average driver of a grid scores 50, so a number over 50 means ahead of the people they raced. Each circuit carries up
        to three types, set per track in the admin area.
        {data.untyped > 0 && ` ${races(data.untyped)} at circuits without a type count in the track list only.`}
      </p>
      </Drawer>
      </div>
    </div>
  );
}
