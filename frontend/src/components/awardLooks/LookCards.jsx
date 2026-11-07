// ---------------------------------------------------------------------------
// Season awards, look "cards" (Hall of Fame preview, ?look=cards).
//
// Every award is a trophy card in the language of the driver rating cards
// (RatingCard.jsx and the .rcard-* rules in index.css): chamfered corners, the
// gold metal frame the champion edition wears, a dark face in both themes. The
// award's name rides on a ribbon at the top, the winner sits in a laurel in the
// middle, and the name, the team and the reason follow underneath.
//
// A phone swipes through the cards in a rail of their own (the page itself
// never scrolls sideways); anything wider shows them as a centred display, in
// rows as even as the count allows. The material lives in lookCards.css.
// ---------------------------------------------------------------------------
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Trophy } from "lucide-react";
import { MEDAL, readableInkOn, sizedAvatarUrl } from "../ui.jsx";
import Flag from "../Flag.jsx";
import TeamLogo from "../TeamLogo.jsx";
import CircuitMap from "../CircuitMap.jsx";
import SlidingTabs from "../SlidingTabs.jsx";
import { hasOutline, useTrackOutlines } from "../../data/trackOutlines.js";
import { useSwapClass } from "../../hooks/motion.js";
import { winnerOf } from "./shared.js";
import "./lookCards.css";

// The champion edition's gold (index.css, .rcard-frame[data-edition="champion"]),
// so the laurel and the track are the same metal as the frame and the ribbon.
const GOLD_HI = "#fbe6a8";
const GOLD = "#e9bc42";
const GOLD_DEEP = "#a8770e";

// The laurel round the portrait. The podium seal's recipe (wreathLeaves in
// ChampionBadge.jsx): two mirrored branches of leaves along a circle, open at
// the top and meeting at the bottom, each leaf tilted off its radius so it lies
// along the branch. Drawn on a wider circle with slimmer leaves here, so a
// whole portrait fits inside it rather than a two-letter season tag.
function laurelLeaves() {
  const leaves = [];
  const N = 9;
  for (const side of [1, -1]) {
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const deg = side * (40 + t * (166 - 40));
      const rad = (deg * Math.PI) / 180;
      const scale = 0.6 + 0.4 * t; // small at the top, full at the bottom
      const x = 50 + 41 * Math.sin(rad);
      const y = 50 - 41 * Math.cos(rad);
      leaves.push({ key: `${side}-${i}`, x, y, rx: 2.6 * scale, ry: 6.4 * scale, rot: side * (Math.abs(deg) + 112) });
    }
  }
  return leaves;
}
const LEAVES = laurelLeaves();

function Laurel() {
  // One gradient per card: two cards must not share an id, or the second one's
  // leaves would point at the first one's gradient.
  const id = useId().replace(/:/g, "");
  return (
    <svg className="aw-cards-laurel" viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-leaf`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={GOLD_HI} />
          <stop offset="0.5" stopColor={GOLD} />
          <stop offset="1" stopColor={GOLD_DEEP} />
        </linearGradient>
      </defs>
      <g fill={`url(#${id}-leaf)`}>
        {LEAVES.map((l) => (
          <ellipse key={l.key} cx={l.x} cy={l.y} rx={l.rx} ry={l.ry} transform={`rotate(${l.rot} ${l.x} ${l.y})`} />
        ))}
      </g>
    </svg>
  );
}

// Rows as even as the count allows, at most `cols` across: six awards on a
// screen that fits four are two rows of three, not four and a lonely two.
const perRow = (n, cols) => Math.max(1, Math.ceil(n / Math.ceil(n / cols)));

// Two letters for a portrait, the way DriverAvatar writes them. A handle that
// starts with a number keeps the number: "13bot" reads "13", not a lone "1".
function initialsOf(name) {
  const digits = String(name || "").match(/^\d{1,2}/);
  if (digits) return digits[0];
  return String(name || "?")
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// The mark for a name typed in by hand. Two people ("Maltegoat and Pizd") get
// both initials, a plain name its own; a longer phrase ("The whole Tier 2
// grid") has no letters worth showing and gets the trophy instead.
function monogramOf(text) {
  const t = String(text || "").trim();
  const people = t.split(/\s*(?:&|\+|,|\band\b)\s*/i).filter(Boolean);
  if (people.length === 2) return people.map((p) => p[0].toUpperCase()).join("&");
  if (people.length === 1 && t.split(/\s+/).length <= 2) return initialsOf(t);
  return null;
}

// Fits a line of type to its card: starting from the size the stylesheet gives
// it, steps down until no word runs past the edge and the text takes at most
// `lines` lines. A long one-word handle would otherwise be cut off at the card
// edge, and a long typed name would push the rest of the card down by three or
// four lines. Runs before paint, so nothing jumps; a name still too long at the
// smallest size may then break mid-word. `orFull`: when even the smallest size
// does not fit, go back to the full size and let it wrap (an award title that
// needs two lines anyway reads better large).
function useFitText(text, min, lines, orFull = false) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let cancelled = false;
    let width = 0;
    const fit = () => {
      if (cancelled) return;
      width = el.clientWidth;
      el.style.fontSize = "";
      el.style.overflowWrap = "normal";
      const cs = getComputedStyle(el);
      let size = parseFloat(cs.fontSize);
      const lineRatio = parseFloat(cs.lineHeight) / size;
      const over = () => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > size * lineRatio * lines + 1;
      while (size > min && over()) {
        size = Math.max(min, size - 0.5);
        el.style.fontSize = `${size}px`;
      }
      if (orFull && over()) el.style.fontSize = "";
      if (el.scrollWidth > el.clientWidth + 1) el.style.overflowWrap = "anywhere";
    };
    fit();
    // Again once the display font is in: the fallback measures differently.
    document.fonts?.ready.then(fit);
    // And when the card changes width (the phone rail and the desktop display
    // use different card sizes, and a tablet can turn on its side).
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (el.clientWidth !== width) fit();
          })
        : null;
    ro?.observe(el);
    return () => {
      cancelled = true;
      ro?.disconnect();
    };
  }, [text, min, lines, orFull]);
  return ref;
}

// Which card of the phone rail is in view, for the dots under it.
function useRailIndex(count) {
  const ref = useRef(null);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let frame = 0;
    const read = () => {
      frame = 0;
      const first = el.firstElementChild;
      if (!first) return;
      const step = first.getBoundingClientRect().width + (parseFloat(getComputedStyle(el).columnGap) || 0);
      // The last card cannot snap to the left edge (nothing comes after it),
      // so the end of the rail counts as the last card.
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
      setIndex(atEnd ? count - 1 : Math.min(count - 1, Math.round(el.scrollLeft / step)));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [count]);
  return [ref, index];
}

// A driver's photo, or their initials on the team colour when there is none
// (or the picture link has died, as Discord avatars do).
function DriverFace({ driver, color }) {
  const [broken, setBroken] = useState(false);
  if (driver.photoUrl && !broken)
    return (
      <img
        src={sizedAvatarUrl(driver.photoUrl, 112)}
        alt=""
        className="h-full w-full object-cover"
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
      />
    );
  return (
    <span className="aw-cards-initials font-display font-black leading-none tracking-tight" style={{ color: readableInkOn(color) }}>
      {initialsOf(driver.name)}
    </span>
  );
}

// The portrait in its laurel, with the season tag on top and the country flag
// pinned to the ring. All picture: a screen reader gets the award, the name and
// the team as text, and the season from the heading, rather than "S7" and two
// letters of initials on every card.
function Medal({ w, seasonNumber }) {
  useTrackOutlines(); // a track outline an admin uploaded arrives after boot
  const flag = typeof w.flag === "string" ? w.flag : w.flag?.country || null;
  const outline = w.kind === "race" && hasOutline(w.race.track);
  const trophy = <Trophy className="aw-cards-trophy" strokeWidth={1.6} aria-hidden="true" />;
  let face;
  // Same colour as the card's --aw-team, so the initials are worked out for the
  // disc they are actually drawn on (gold for a driver without a team).
  if (w.kind === "driver") face = <DriverFace driver={w.driver} color={w.color || MEDAL[0]} />;
  else if (w.kind === "team")
    face = <TeamLogo id={w.team.id} name={w.team.name} color={w.team.color} logoUrl={w.team.logoUrl} size={58} />;
  else if (w.kind === "race")
    face = outline ? (
      <CircuitMap track={w.race.track} className="aw-cards-track" stroke={GOLD_HI} strokeWidth={2.2} />
    ) : flag ? (
      <Flag code={flag} w={60} h={40} />
    ) : (
      trophy
    );
  else {
    const mono = monogramOf(w.name);
    face = mono ? (
      <span className="aw-cards-mono font-display font-black leading-none tracking-tight" data-len={mono.length}>
        {mono}
      </span>
    ) : (
      trophy
    );
  }
  // A race without an outline already shows its flag as the portrait.
  const pin = flag && (w.kind === "driver" || outline);
  return (
    <div className="aw-cards-medal" aria-hidden="true">
      <Laurel />
      <div className="aw-cards-ring">
        <div className="aw-cards-disc" data-kind={w.kind}>
          {face}
        </div>
      </div>
      <span className="aw-cards-season font-display text-[11px] font-black">S{seasonNumber}</span>
      {pin && (
        <span className="aw-cards-flag">
          <Flag code={flag} w={24} h={17} />
        </span>
      )}
    </div>
  );
}

function AwardCard({ award, seasonNumber, index }) {
  const w = winnerOf(award, seasonNumber);
  const titleRef = useFitText(award.title, 10.5, 1, true);
  const nameRef = useFitText(w.name, 16, 2);
  return (
    <li style={{ "--i": Math.min(index, 12) }}>
      {/* The team colour (gold where there is no team) tints the face, the
          sub line and the strip at the foot of the card. */}
      <div className="aw-cards-card" style={{ "--aw-team": w.color || MEDAL[0] }}>
        <div className="aw-cards-frame">
          <div className="aw-cards-body">
            <span className="aw-cards-foil" aria-hidden="true" />
            <span className="aw-cards-sheen" aria-hidden="true" />
            <h3 className="aw-cards-ribbon font-display font-extrabold uppercase leading-[1.1] tracking-[0.1em]">
              <span ref={titleRef}>{award.title}</span>
            </h3>
            <Medal w={w} seasonNumber={seasonNumber} />
            <p ref={nameRef} className="aw-cards-name font-display font-black uppercase leading-[0.95] tracking-tight">
              {w.to ? (
                <Link to={w.to} className="aw-cards-link">
                  {w.name}
                </Link>
              ) : (
                w.name
              )}
            </p>
            {w.sub && (
              <div className="aw-cards-sub mt-1.5 flex max-w-full items-center justify-center gap-1.5 font-display text-[11px] font-bold uppercase tracking-[0.14em]">
                {w.kind === "driver" && w.team && (
                  <span aria-hidden="true">
                    <TeamLogo id={w.team.id} name={w.team.name} color={w.team.color} logoUrl={w.team.logoUrl} size={16} />
                  </span>
                )}
                <span className="truncate" title={w.sub}>
                  {w.sub}
                </span>
              </div>
            )}
            {/* The ornament is there with or without a reason, so it lines up
                across a row and a card without one still reads as finished. */}
            <span className="aw-cards-rule" aria-hidden="true" />
            {award.note ? <p className="aw-cards-note">{award.note}</p> : <span className="aw-cards-note" />}
            <span className="aw-cards-strip" aria-hidden="true" />
          </div>
        </div>
      </div>
    </li>
  );
}

function AwardRail({ season }) {
  const awards = season.awards;
  const n = awards.length;
  const [railRef, at] = useRailIndex(n);
  return (
    <>
      <ul ref={railRef} role="list" data-count={n} className="aw-cards-rail cascade">
        {awards.map((a, i) => (
          <AwardCard key={a.id} award={a} seasonNumber={season.seasonNumber} index={i} />
        ))}
      </ul>
      {n > 1 && (
        <div className="aw-cards-dots" aria-hidden="true">
          {awards.map((a, i) => (
            <span key={a.id} className={i === at ? "is-on" : undefined} />
          ))}
        </div>
      )}
    </>
  );
}

export default function LookCards({ seasons }) {
  const [picked, setPicked] = useState(seasons[0]?.seasonNumber);
  const season = seasons.find((s) => s.seasonNumber === picked) || seasons[0];
  // A new season fades over instead of dealing every card in again.
  const swap = useSwapClass(season?.seasonNumber);
  if (!season) return null;
  const label = season.seasonName || `Season ${season.seasonNumber}`;
  const n = season.awards.length;
  return (
    <section data-awards-look="cards" className="reveal">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 sm:mb-6">
        <div className="min-w-0">
          <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-eyebrow sm:text-[11px] sm:tracking-[0.2em]">
            {label} · {n} {n === 1 ? "award" : "awards"}
          </div>
          <h2 className="mt-1 font-display text-2xl font-extrabold uppercase tracking-tight text-dark sm:text-3xl">
            Season awards
          </h2>
        </div>
        {seasons.length > 1 && (
          <SlidingTabs
            items={seasons.map((s) => ({
              key: s.seasonNumber,
              label: <span data-awards-season={s.seasonNumber}>S{s.seasonNumber}</span>,
              title: s.seasonName || `Season ${s.seasonNumber}`,
            }))}
            value={season.seasonNumber}
            onChange={setPicked}
          />
        )}
      </div>
      <div
        key={season.seasonNumber}
        className={`aw-cards-stage ${swap}`}
        style={{ "--aw-per2": perRow(n, 2), "--aw-per3": perRow(n, 3), "--aw-per4": perRow(n, 4) }}
      >
        <AwardRail season={season} />
      </div>
    </section>
  );
}
