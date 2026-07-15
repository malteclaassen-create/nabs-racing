import { useEffect, useRef, useState } from "react";
import RatingCard, { cardPhotoFraming } from "./RatingCard.jsx";

// ---------------------------------------------------------------------------
// The pieces of the "Edit Driver Card" page, factored out of the old /profile
// editor: the live card preview with a draggable picture + framing sliders, and
// the unlockable-edition picker (with a first-visit "locks removed" reveal).
// ---------------------------------------------------------------------------

// Card photo editor: the driver's OWN rating card as a live preview, with the
// picture draggable right on the card and zoom / colour / tint sliders. Writes
// Driver.cardPhotoPos ({x,y,z,s,t}), which every card render site-wide uses.
export function CardPhotoEditor({
  driver, rating, pos, setPos, onReset, resetting,
  cardPhotoUrl, onPickCardPhoto, onResetCardPhoto, cardUploading,
}) {
  const boxRef = useRef(null);
  const dragRef = useRef(null);
  const cardFileRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const p = cardPhotoFraming(pos);
  const round1 = (n) => Math.round(n * 10) / 10;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function onPointerDown(e) {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    dragRef.current = { sx: e.clientX, sy: e.clientY, x: p.x, y: p.y };
    setDragging(true);
  }
  function onPointerMove(e) {
    const d = dragRef.current;
    const box = boxRef.current?.getBoundingClientRect();
    if (!d || !box) return;
    const nx = clamp(d.x - (((e.clientX - d.sx) / box.width) * 100) / p.z, 0, 100);
    const ny = clamp(d.y - (((e.clientY - d.sy) / box.height) * 100) / p.z, 0, 100);
    setPos({ x: round1(nx), y: round1(ny), z: p.z, s: p.s, t: p.t });
  }
  function onPointerUp() {
    dragRef.current = null;
    setDragging(false);
  }

  const accent = driver.team?.color || "#e5548f";
  return (
    <div className="space-y-3">
      <div className="relative">
        <RatingCard driver={{ ...driver, photoPos: p, cardPhotoUrl: cardPhotoUrl || driver.photoUrl }} rating={rating} />
        {/* Invisible drag surface over the card's photo area (top two thirds). */}
        <div
          ref={boxRef}
          role="slider"
          aria-label="Drag to position your picture on the card"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="absolute left-0 top-0 h-[66%] w-full touch-none select-none"
          style={{ cursor: dragging ? "grabbing" : "grab" }}
          title="Drag to position your picture"
        />
      </div>

      {/* Card picture: a separate image just for the card (falls back to the
          profile picture). Uploaded on pick, like the profile avatar. */}
      <input ref={cardFileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onPickCardPhoto} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
        <button
          type="button"
          onClick={() => cardFileRef.current?.click()}
          disabled={cardUploading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 font-semibold text-medium transition hover:bg-surface2"
        >
          {cardUploading ? "Uploading…" : cardPhotoUrl ? "Change card picture" : "Use a different picture on the card"}
        </button>
        {cardPhotoUrl && (
          <button type="button" onClick={onResetCardPhoto} disabled={cardUploading} className="font-semibold text-light transition hover:text-dark">
            Use profile picture
          </button>
        )}
      </div>

      <label className="block">
        <span className="mb-1.5 flex items-center justify-between font-mono text-[11px] font-bold uppercase tracking-wider text-medium">
          Zoom
          <span className="tabular-nums text-light">{p.z.toFixed(2)}×</span>
        </span>
        <input
          type="range" min="1" max="2.5" step="0.05" value={p.z}
          onChange={(e) => setPos({ x: p.x, y: p.y, z: Number(e.target.value), s: p.s, t: p.t })}
          className="w-full" style={{ accentColor: accent }} aria-label="Zoom"
        />
      </label>
      <label className="block">
        <span className="mb-1.5 flex items-center justify-between font-mono text-[11px] font-bold uppercase tracking-wider text-medium">
          Photo colour
          <span className="tabular-nums text-light">{Math.round(p.s * 100)}%</span>
        </span>
        <input
          type="range" min="0" max="1" step="0.05" value={p.s}
          onChange={(e) => setPos({ x: p.x, y: p.y, z: p.z, s: Number(e.target.value), t: p.t })}
          className="w-full" style={{ accentColor: accent }} aria-label="Photo colour"
        />
      </label>
      <label className="block">
        <span className="mb-1.5 flex items-center justify-between font-mono text-[11px] font-bold uppercase tracking-wider text-medium">
          Photo takes card colour
          <span className="tabular-nums text-light">{Math.round(p.t * 100)}%</span>
        </span>
        <input
          type="range" min="0" max="1" step="0.05" value={p.t}
          onChange={(e) => setPos({ x: p.x, y: p.y, z: p.z, s: p.s, t: Number(e.target.value) })}
          className="w-full" style={{ accentColor: accent }} aria-label="Photo takes card colour"
        />
      </label>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-light">Drag to position · let the photo take the card colour so it blends in.</span>
        <button type="button" onClick={onReset} disabled={resetting} className="shrink-0 font-semibold text-light transition hover:text-dark">
          Reset framing
        </button>
      </div>
    </div>
  );
}

// Swatch gradients per edition — mirror the CSS palettes in index.css
// (.rcard-frame[data-edition=…]). Presentational only; "classic" falls back to
// the driver's team colour, passed in.
const EDITION_COLORS = {
  nabs: ["#e5548f", "#ff8fbd"],
  mono: ["#8b95a3", "#dfe5ec"],
  rookie: ["#2f6d4f", "#6ec99a"],
  veteran: ["#3f4a58", "#9fb0c4"],
  legend: ["#171a21", "#e9bc42"],
  winner: ["#1d2430", "#ffffff"],
  dominator: ["#7a1220", "#ff6b6b"],
  podium: ["#2a3a55", "#8fb6ff"],
  poleman: ["#4c2a7a", "#b78cff"],
  qualiking: ["#2a1a5e", "#c9a6ff"],
  vice: ["#7e8a9a", "#eef2f7"],
  bronze: ["#7e5426", "#e8c49a"],
  teamchamp: ["#0e6b5a", "#62e0c4"],
  champion: ["#a8770e", "#f8e08e"],
};

function LockIcon({ className = "h-3.5 w-3.5" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </svg>
  );
}

function CheckIcon({ className = "h-3.5 w-3.5" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}

// One-line requirement for a LOCKED edition. Milestones show a progress bar
// instead (have/need), so this is really for the title editions.
function requirementText(e) {
  const r = e.requirement;
  if (!r || r.stat) return null;
  if (r.badge === "champion") return "Win the championship this season";
  if (r.badge === "vice") return "Finish runner-up this season";
  if (r.badge === "third") return "Finish P3 this season";
  if (r.teamBadge != null) return "Win the team championship this season";
  return "Earned in a title season";
}

// Sort: free first, then unlocked, then locked by progress (share of the way
// there) descending — the closest-to-earned locked ones surface first.
function sortEditions(list) {
  const progress = (e) => (e.need ? Math.min(1, (e.have || 0) / e.need) : e.unlocked ? 1 : 0);
  const rank = (e) => (!e.requirement ? 0 : e.unlocked ? 1 : 2);
  return [...list].sort((a, b) => rank(a) - rank(b) || progress(b) - progress(a));
}

const seenKey = (driverId) => `nabs.cardSeen.${driverId}`;
function readSeen(driverId) {
  try {
    const v = JSON.parse(localStorage.getItem(seenKey(driverId)) || "null");
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

// The card-edition picker: season chips + a swatch grid. Locked editions stay
// visible (dimmed, padlocked, with their progress / requirement) so the goal is
// in sight; unlocked ones are pickable and marked with a check. Newly-earned
// editions play a one-shot "lock removed" reveal the first time you see them
// (tracked per driver row in localStorage) — including everything already earned
// on your very first visit.
export function CardEditionPicker({ seasons, activeDriverId, onPickSeason, editions, current, onPick, teamColor, loading }) {
  const ordered = sortEditions(editions || []);

  // Which earned+unlocked editions to play the reveal on right now.
  const [reveal, setReveal] = useState(() => new Set());
  useEffect(() => {
    if (!editions || !editions.length) {
      setReveal(new Set());
      return;
    }
    const earnedUnlocked = editions.filter((e) => e.unlocked && e.requirement).map((e) => e.key);
    const stored = readSeen(activeDriverId);
    // First visit (no record): reveal everything already earned. Otherwise just
    // the ones earned since last time.
    const fresh = stored === null ? earnedUnlocked : earnedUnlocked.filter((k) => !stored.includes(k));
    try {
      localStorage.setItem(seenKey(activeDriverId), JSON.stringify(earnedUnlocked));
    } catch {
      /* private mode etc. — the reveal simply won't persist */
    }
    if (fresh.length) {
      setReveal(new Set(fresh));
      // Stay mounted until the last (staggered) padlock has finished lifting.
      const t = setTimeout(() => setReveal(new Set()), 1000 + fresh.length * 140);
      return () => clearTimeout(t);
    }
    setReveal(new Set());
  }, [activeDriverId, editions]);

  // Reveal the padlocks one after another (a nicer cascade than all at once).
  const revealOrder = ordered.filter((e) => reveal.has(e.key)).map((e) => e.key);
  const revealDelay = (key) => `${Math.max(0, revealOrder.indexOf(key)) * 130}ms`;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-medium">Card edition</span>
        <span className="text-xs text-light">
          Pick your rating-card design. Most editions are earned through starts, wins, poles and titles.
        </span>
      </div>

      {seasons.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {seasons.map((s) => (
            <button
              key={s.driverId}
              type="button"
              onClick={() => onPickSeason(s.driverId)}
              className={`rounded-lg px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-wide transition ${
                s.driverId === activeDriverId ? "bg-brand text-ink" : "bg-surface2 text-light hover:text-dark"
              }`}
            >
              S{s.seasonNumber}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-light">Loading editions…</p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {ordered.map((e) => {
            const [c1, c2] = EDITION_COLORS[e.key] || [teamColor || "#3b4254", "#ffffff"];
            const selected = (current || "classic") === e.key;
            const locked = !e.unlocked;
            const earned = !!e.requirement; // not one of the always-free three
            const revealing = reveal.has(e.key);
            const req = locked ? requirementText(e) : null;
            return (
              <button
                key={e.key}
                type="button"
                disabled={locked}
                aria-pressed={selected}
                onClick={() => !locked && onPick(e.key)}
                style={revealing ? { animationDelay: revealDelay(e.key) } : undefined}
                className={`relative flex items-center gap-2.5 overflow-hidden rounded-xl border p-2.5 text-left transition ${
                  revealing ? "card-revealing " : ""
                }${
                  selected
                    ? "border-brand ring-2 ring-brand/40"
                    : locked
                    ? "cursor-not-allowed border-border opacity-70"
                    : "border-border hover:border-brand/50"
                }`}
              >
                <span
                  className="h-9 w-9 shrink-0 rounded-lg ring-1 ring-black/10"
                  style={{ background: `linear-gradient(135deg, ${c1}, ${c2})`, filter: locked ? "grayscale(0.7)" : undefined }}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 font-display text-sm font-bold uppercase tracking-tight text-dark">
                    {e.name}
                    {locked ? (
                      <span className="text-light"><LockIcon /></span>
                    ) : earned ? (
                      <span className="text-emerald-500" title="Unlocked"><CheckIcon /></span>
                    ) : null}
                  </span>
                  <span className="block truncate text-[11px] text-light">{e.tagline}</span>
                  {locked && e.need != null && (
                    <span className="mt-1 block">
                      <span className="flex h-1 w-full overflow-hidden rounded-full bg-surface2">
                        <span
                          className="h-full rounded-full bg-brand/70"
                          style={{ width: `${Math.min(100, Math.round(((e.have || 0) / e.need) * 100))}%` }}
                        />
                      </span>
                      <span className="mt-0.5 block font-mono text-[10px] tabular-nums text-light">
                        {e.have || 0} / {e.need}
                      </span>
                    </span>
                  )}
                  {locked && e.need == null && req && (
                    <span className="mt-1 block text-[10px] leading-tight text-light">{req}</span>
                  )}
                </span>
                {/* One-shot "lock removed" reveal overlay for a freshly-earned card. */}
                {revealing && (
                  <span className="card-reveal-lock" aria-hidden style={{ animationDelay: revealDelay(e.key) }}>
                    <LockIcon className="h-6 w-6" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
