// ---------------------------------------------------------------------------
// Season awards on the Hall of Fame: the awards the league hands out by vote
// at the end of a season (backend lib/seasonAwards.js).
//
// Every award is a trophy card in the language of the driver rating cards
// (RatingCard.jsx and the .rcard-* rules in index.css): chamfered corners, the
// gold metal frame the champion edition wears, a dark face in both themes. The
// award's name rides on a ribbon at the top, the winner sits in a laurel in the
// middle, the name, the team and the reason follow underneath, and the card
// signs off with the rating cards' "NABS RACING" line at its foot.
//
// A phone swipes through the cards in a rail of their own (the page itself
// never scrolls sideways); anything wider shows them as a centred display, in
// rows as even as the count allows. The material lives in seasonAwardCards.css.
// ---------------------------------------------------------------------------
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Trophy } from "lucide-react";
import { MEDAL, readableInkOn, sizedAvatarUrl } from "./ui.jsx";
import Flag from "./Flag.jsx";
import TeamLogo from "./TeamLogo.jsx";
import CircuitMap from "./CircuitMap.jsx";
import SlidingTabs from "./SlidingTabs.jsx";
import { hasOutline, useTrackOutlines } from "../data/trackOutlines.js";
import { motionOff, useSwapClass } from "../hooks/motion.js";
import { winnerOf } from "./seasonAwardWinner.js";
import "./seasonAwardCards.css";

// The champion edition's gold (index.css, .rcard-frame[data-edition="champion"]),
// so the laurel and the track are the same metal as the frame and the ribbon.
const GOLD_HI = "#fbe6a8";
const GOLD = "#e9bc42";
const GOLD_DEEP = "#a8770e";

// More awards than this and the phone rail counts ("3 / 24") instead of
// showing a dot per card: forty dots no longer fit a phone and came out as
// slivers.
const MAX_DOTS = 12;

// A logo whose drawing is more than this many times wider than tall (a
// wordmark such as Toro Rosso's) is too thin to read in the round: the card
// shows the team's initials in its place.
const WORDMARK = 3;

const r2 = (v) => Math.round(v * 100) / 100;

// The laurel round the portrait: two branches that rise from the foot of the
// ring and stop short of the season tag at the top. Each is a thin stem along
// a circle with leaves growing from it, outside and inside by turns, all
// pointing up the branch and smaller toward its tip. The podium seal's ring of
// loose leaves (ChampionBadge.jsx) works at 40px; at the size of a portrait it
// read as a ring of gold beans. `clasp` leaves a gap at the foot for the flag
// pinned there.
function laurel(clasp) {
  const R = 40.5; // the stem's circle, in a 100 x 100 box
  const base = clasp ? 158 : 170; // degrees round from 12 o'clock
  const tip = 38;
  const N = 13; // leaves per branch, the last one on the tip
  const stems = [];
  const leaves = [];
  for (const side of [1, -1]) {
    const at = (deg) => [50 + side * R * Math.sin((deg * Math.PI) / 180), 50 - R * Math.cos((deg * Math.PI) / 180)];
    const [x0, y0] = at(base);
    const [x1, y1] = at(tip + 2);
    stems.push(`M${r2(x0)} ${r2(y0)}A${R} ${R} 0 0 ${side > 0 ? 0 : 1} ${r2(x1)} ${r2(y1)}`);
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1); // 0 at the foot, 1 at the tip
      const deg = base - t * (base - tip);
      const size = 1 - 0.42 * t;
      const ry = 5.8 * size; // half the leaf's length
      const w = 3.2 * size; // its curves' pull, about 1.3 times its half-width
      // Which way the leaf points, clockwise from 12 o'clock: along the stem
      // toward the tip (deg - 90), turned out or in by 38 degrees.
      const lean = i === N - 1 ? 0 : i % 2 ? -38 : 38;
      const phi = side * (deg - 90 + lean);
      const ux = Math.sin((phi * Math.PI) / 180);
      const uy = -Math.cos((phi * Math.PI) / 180);
      const [px, py] = at(deg);
      leaves.push({
        key: `${side}-${i}`,
        // Base at (0, ry) on the stem, tip at (0, -ry), widest nearer the base.
        d: `M0 ${r2(ry)}C${r2(w)} ${r2(ry * 0.55)} ${r2(w)} ${r2(-ry * 0.35)} 0 ${r2(-ry)}C${r2(-w)} ${r2(-ry * 0.35)} ${r2(-w)} ${r2(ry * 0.55)} 0 ${r2(ry)}Z`,
        transform: `translate(${r2(px + ux * ry * 0.92)} ${r2(py + uy * ry * 0.92)}) rotate(${r2(phi)})`,
      });
    }
  }
  return { stems, leaves };
}
const LAURELS = { clasp: laurel(true), full: laurel(false) };

function Laurel({ clasp }) {
  // One gradient per card: two cards must not share an id, or the second one's
  // leaves would point at the first one's gradient.
  const id = useId().replace(/:/g, "");
  const { stems, leaves } = clasp ? LAURELS.clasp : LAURELS.full;
  return (
    <svg className="aw-cards-laurel" viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-leaf`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={GOLD_HI} />
          <stop offset="0.5" stopColor={GOLD} />
          <stop offset="1" stopColor={GOLD_DEEP} />
        </linearGradient>
      </defs>
      <g fill="none" stroke={`url(#${id}-leaf)`} strokeWidth={1.1} strokeLinecap="round">
        {stems.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <g fill={`url(#${id}-leaf)`}>
        {leaves.map((l) => (
          <path key={l.key} d={l.d} transform={l.transform} />
        ))}
      </g>
    </svg>
  );
}

// Rows as even as the count allows, `cols` across at most and the longer rows
// first: thirteen awards four across come out 4, 3, 3, 3 rather than three
// full rows and one card on its own, and six come out as two rows of three.
function rowSizes(n, cols) {
  const rows = Math.ceil(n / cols);
  const base = Math.floor(n / rows);
  return Array.from({ length: rows }, (_, r) => base + (r < n % rows ? 1 : 0));
}

// The display is a grid of half-card columns, so that a shorter row can sit
// centred under a longer one: its first card starts half a card further in for
// every card the row is short. Gives the number of half columns and, for every
// card, the column it starts on (null: straight after the card before it).
function gridPlan(n, cols) {
  if (!n) return { halves: 2, starts: [] };
  const sizes = rowSizes(n, cols);
  const widest = sizes[0];
  const starts = sizes.flatMap((size) =>
    Array.from({ length: size }, (_, i) => (i === 0 && size < widest ? 1 + widest - size : null)),
  );
  return { halves: widest * 2, starts };
}

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

// A team's initials, up to three: "Scuderia Torro Rosso Junior Team" reads
// "STR". For the disc of a team whose logo cannot be shown there.
function teamInitials(name) {
  return String(name || "?")
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 3)
    .join("")
    .toUpperCase();
}

// Where the drawing in a logo file actually is, in the file's own pixels.
// Several of the league's logos are square files with the mark in a band
// across the middle (Super Aguri, NCB Mugen, Jaguar, McLaren), so sized by
// the file they came out a third of the size of the others. Read once per
// picture from a small copy; a picture from another site cannot be read back,
// and then all of it counts.
const logoShapes = new Map();
function logoShape(img) {
  const key = img.currentSrc || img.src;
  if (logoShapes.has(key)) return logoShapes.get(key);
  const nw = img.naturalWidth || 1;
  const nh = img.naturalHeight || 1;
  let box = [0, 0, nw, nh];
  try {
    const k = Math.min(1, 160 / Math.max(nw, nh));
    const w = Math.max(1, Math.round(nw * k));
    const h = Math.max(1, Math.round(nh * k));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data;
    let [x0, y0, x1, y1] = [w, h, -1, -1];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (px[(y * w + x) * 4 + 3] > 24) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    if (x1 >= x0) box = [x0 / k, y0 / k, (x1 + 1) / k, (y1 + 1) / k];
  } catch {
    // tainted or undrawable: keep the whole file
  }
  const [x0, y0, x1, y1] = box;
  const shape = { nw, nh, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  logoShapes.set(key, shape);
  return shape;
}

// The numbers seasonAwardCards.css sizes a logo by (.aw-cards-logo, .aw-cards-sublogo):
// the drawing's width in file pixels (a logo is never drawn larger than its
// file), its proportions, and where it sits in the file.
function shapeVars(s) {
  return {
    "--lw": r2(s.w),
    "--lr": r2(s.w / s.h),
    "--lcos": r2(s.w / Math.hypot(s.w, s.h)),
    "--lsx": r2(s.nw / s.w),
    "--lsy": r2(s.nh / s.h),
    "--lox": r2(s.x / s.w),
    "--loy": r2(s.y / s.h),
  };
}

// A picture that loads without a size of its own (an uploaded SVG with only a
// viewBox, in some browsers): drawn as a square, at whatever size fits.
const UNSIZED = { nw: 1000, nh: 1000, x: 0, y: 0, w: 1000, h: 1000 };

// The shape of the logo TeamLogo draws inside `ref`, once it has loaded. Null
// until then, and for a team without a picture (TeamLogo's own badge).
function useLogoShape(key) {
  const ref = useRef(null);
  const [shape, setShape] = useState(null);
  useLayoutEffect(() => {
    const img = ref.current?.querySelector("img");
    if (!img) return undefined;
    // Called once straight away (a picture already in the cache is sized
    // before the first paint) and again on load. A complete picture with no
    // size before its load event may yet turn out broken, which TeamLogo
    // handles; one that has loaded and still has no size is UNSIZED.
    const read = (e) => {
      if (!img.complete) return;
      if (img.naturalWidth) setShape(logoShape(img));
      else if (e) setShape(UNSIZED);
    };
    read();
    img.addEventListener("load", read);
    return () => img.removeEventListener("load", read);
  }, [key]);
  return [ref, shape];
}

// Fits a line of type to its card: starting from the size the stylesheet gives
// it, steps down until no word runs past the edge and the text takes at most
// `lines` lines. A long one-word handle would otherwise be cut off at the card
// edge, and a long typed name would push the rest of the card down by three or
// four lines. Text that fits in `lines` lines keeps its full size and wraps.
// Runs before paint, so nothing jumps. Text still too long at the smallest
// size gets data-over (the ribbon gives a third line room, the sub line closes
// up its letter spacing), and a word still too wide then breaks mid-word.
function useFitText(text, min, lines) {
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
      el.removeAttribute("data-over");
      const cs = getComputedStyle(el);
      let size = parseFloat(cs.fontSize);
      const lineRatio = parseFloat(cs.lineHeight) / size;
      // Lines are counted, not compared in pixels: with a line height under 1
      // the last line's letters reach a pixel or two below the box, and an
      // honest two lines measured as more than two.
      const count = () => Math.round(el.scrollHeight / (size * lineRatio));
      const over = () => el.scrollWidth > el.clientWidth + 1 || count() > lines;
      while (size > min && over()) {
        size = Math.max(min, size - 0.5);
        el.style.fontSize = `${size}px`;
      }
      const tooWide = el.scrollWidth > el.clientWidth + 1;
      el.toggleAttribute("data-over", tooWide || count() > lines);
      if (tooWide) el.style.overflowWrap = "anywhere";
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
  }, [text, min, lines]);
  return ref;
}

// Whether a note runs past the lines the display gives it (see .aw-cards-note),
// so the card can carry the whole of it as a tooltip.
function useCutShort(text) {
  const ref = useRef(null);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const check = () => setCut(el.scrollHeight > el.clientHeight + 1);
    check();
    // The phone rail shows the whole note and the display does not, and the
    // font arriving late can add or take away a line.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(check) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [text]);
  return [ref, cut];
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

// The cards of a row share their ribbon and name heights: where one name in a
// row runs to two lines, every name in that row gets the room of that one
// (--aw-name-h, read by .aw-cards-name), and a title on three lines gives the
// row's ribbons its height (--aw-ribbon-h), so the medals, team lines and
// rules stay level across the row. A row of one-line names, the usual case,
// keeps them snug under the medal instead of holding an empty second line for
// each. Measured in pixels from the text itself, not lines and not the boxes
// these values stretch: a long name fitted down to 16px takes two lines of
// 16px, not two of the 26px the others are set in. The phone rail is one row.
function useRowHeights(ref, key) {
  useLayoutEffect(() => {
    const ul = ref.current;
    if (!ul) return undefined;
    let frame = 0;
    // Layout heights, which the cards' entrance (a scale) does not distort the
    // way it does a bounding box.
    const heightOf = (el) => (el ? parseFloat(getComputedStyle(el).height) || 0 : 0);
    const measure = () => {
      frame = 0;
      const lis = [...ul.children];
      const rows = new Map();
      for (const li of lis) {
        const ribbon = li.querySelector(".aw-cards-ribbon");
        const cs = ribbon && getComputedStyle(ribbon);
        const title = ribbon ? heightOf(ribbon.firstElementChild) + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) : 0;
        const row = rows.get(li.offsetTop) || { name: 0, title: 0 };
        row.name = Math.max(row.name, heightOf(li.querySelector(".aw-cards-name > span")));
        row.title = Math.max(row.title, title);
        rows.set(li.offsetTop, row);
      }
      for (const li of lis) {
        const row = rows.get(li.offsetTop) || { name: 0, title: 0 };
        li.style.setProperty("--aw-name-h", `${r2(row.name)}px`);
        li.style.setProperty("--aw-ribbon-h", `${r2(row.title)}px`);
      }
    };
    const later = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    // Again once the names have been fitted with the display font, and when
    // the rows change (a resize, a turned tablet).
    document.fonts?.ready.then(later);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(later) : null;
    ro?.observe(ul);
    return () => {
      ro?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [ref, key]);
}

// A card tabbed to in the phone rail slides fully into view: the browser only
// scrolled as far as the name, which left the card half off the screen.
function showInRail(e) {
  const li = e.currentTarget.closest("li");
  const rail = li?.parentElement;
  if (!rail || rail.scrollWidth <= rail.clientWidth + 1) return;
  li.scrollIntoView({ inline: "start", block: "nearest", behavior: motionOff() ? "auto" : "smooth" });
}

// A driver's photo, or their initials when there is none (or the picture link
// has died, as Discord avatars do): on the team colour, or in gold on the dark
// disc for a driver without a team, where gold letters on a gold disc inside
// a gold ring all ran together.
function DriverFace({ driver, color }) {
  // The pictures to try in order: the photo, then the fallbacks the server
  // hands along (the linked person's picture, the Discord avatar).
  const [broken, setBroken] = useState([]);
  const photo = [driver.photoUrl, ...(driver.photoFallbacks || [])].filter(Boolean).find((u) => !broken.includes(u));
  if (photo)
    return (
      <img
        key={photo}
        src={sizedAvatarUrl(photo, 112)}
        alt=""
        className="h-full w-full object-cover"
        loading="lazy"
        decoding="async"
        onError={() => setBroken((seen) => (seen.includes(photo) ? seen : [...seen, photo]))}
      />
    );
  if (!color)
    return (
      <span className="aw-cards-mono font-display font-black leading-none tracking-tight" data-len="2">
        {initialsOf(driver.name)}
      </span>
    );
  return (
    <span className="aw-cards-initials font-display font-black leading-none tracking-tight" style={{ color: readableInkOn(color) }}>
      {initialsOf(driver.name)}
    </span>
  );
}

// A team's logo on a cream enamel plate, so that dark marks (Toro Rosso's
// black lettering, NCB Mugen's flag) read inside the dark medal. The logo is
// sized by its drawing, not its file, and never past the file's own pixels.
// A wordmark too thin for the round, or a team with no logo at all, shows its
// initials in gold instead (seasonAwardCards.css).
function TeamFace({ team }) {
  const [ref, shape] = useLogoShape(team.logoUrl || team.id);
  const mark = teamInitials(team.name);
  return (
    <>
      <span
        ref={ref}
        className="aw-cards-plate"
        data-shaped={shape ? "" : undefined}
        data-wide={shape && shape.w / shape.h > WORDMARK ? "" : undefined}
        style={shape ? shapeVars(shape) : undefined}
      >
        <TeamLogo id={team.id} name={team.name} color={team.color} logoUrl={team.logoUrl} size={64} className="aw-cards-logo" />
      </span>
      <span className="aw-cards-mono aw-cards-teammono font-display font-black leading-none tracking-tight" data-len={mark.length}>
        {mark}
      </span>
    </>
  );
}

// The small logo before a driver's team name, sized by its drawing like the
// big one: a wordmark gets the width it needs (seasonAwardCards.css).
function SubLogo({ team }) {
  const [ref, shape] = useLogoShape(team.logoUrl || team.id);
  return (
    <span
      ref={ref}
      className="aw-cards-sublogo"
      data-shaped={shape ? "" : undefined}
      style={shape ? shapeVars(shape) : undefined}
      aria-hidden="true"
    >
      <TeamLogo id={team.id} name={team.name} color={team.color} logoUrl={team.logoUrl} size={16} className="aw-cards-logo" />
    </span>
  );
}

// The portrait in its laurel, with the season tag on top and the country flag
// pinned at the foot of the ring, where the two branches meet. All picture: a
// screen reader gets the award, the name and the team as text, and the season
// from the heading, rather than "S7" and two letters of initials on every card.
function Medal({ w, seasonNumber }) {
  useTrackOutlines(); // a track outline an admin uploaded arrives after boot
  const flag = typeof w.flag === "string" ? w.flag : w.flag?.country || null;
  const outline = w.kind === "race" && hasOutline(w.race.track);
  const trophy = <Trophy className="aw-cards-trophy" strokeWidth={1.6} aria-hidden="true" />;
  let face;
  // Same colour as the card's --aw-team, so the initials are worked out for the
  // disc they are actually drawn on.
  if (w.kind === "driver" && w.partner)
    // A shared award: both drivers, as two smaller overlapping discs.
    face = (
      <span className="aw-cards-pair">
        {[w.driver, w.partner].map((d) => (
          <span key={d.driverId} className="aw-cards-half" style={{ "--aw-half": d.team?.color || MEDAL[0] }}>
            <DriverFace driver={d} color={d.team?.color || null} />
          </span>
        ))}
      </span>
    );
  else if (w.kind === "driver") face = <DriverFace driver={w.driver} color={w.color} />;
  else if (w.kind === "team") face = <TeamFace team={w.team} />;
  else if (w.kind === "race")
    face = outline ? (
      <CircuitMap track={w.race.track} className="aw-cards-track" stroke={GOLD_HI} strokeWidth={2.2} />
    ) : flag ? (
      // At 40px, the size of the flag files (and of their 2x files on a sharp
      // screen): drawn any bigger, they came out soft.
      <span className="aw-cards-flagface">
        <Flag code={flag} w={40} h={28} />
      </span>
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
  const pin = Boolean(flag && (w.kind === "driver" || outline));
  return (
    <div className="aw-cards-medal" aria-hidden="true">
      <Laurel clasp={pin} />
      <div className="aw-cards-ring">
        <div
          className="aw-cards-disc"
          data-kind={w.kind}
          data-teamless={w.kind === "driver" && !w.color ? "" : undefined}
          data-pair={w.partner ? "" : undefined}
        >
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

function AwardCard({ award, seasonNumber, index, place }) {
  const w = winnerOf(award, seasonNumber);
  const titleRef = useFitText(award.title, 10, 2);
  // A name with a space wraps onto a second line before it shrinks far; a
  // one-word handle can only shrink, so it may go smaller before it breaks.
  const nameRef = useFitText(w.name, /\s/.test(String(w.name || "").trim()) ? 16 : 13, 2);
  const subRef = useFitText(w.sub, 9, 1);
  const [noteRef, noteCut] = useCutShort(award.note);
  return (
    <li style={{ "--i": Math.min(index, 12), ...place }}>
      {/* The team colour (gold where there is no team) tints the face, the
          sub line and the strip at the foot of the card. Only a card that
          opens something lifts on hover (data-link). A note cut short in the
          display reads in full as the card's tooltip. */}
      <div
        className="aw-cards-card"
        data-link={w.to ? "" : undefined}
        title={noteCut ? award.note : undefined}
        style={{ "--aw-team": w.color || MEDAL[0] }}
      >
        <div className="aw-cards-frame">
          <div className="aw-cards-body">
            <span className="aw-cards-foil" aria-hidden="true" />
            <span className="aw-cards-sheen" aria-hidden="true" />
            <h3 className="aw-cards-ribbon font-display font-extrabold uppercase leading-[1.1] tracking-[0.1em]">
              <span ref={titleRef}>{award.title}</span>
            </h3>
            <Medal w={w} seasonNumber={seasonNumber} />
            <p className="aw-cards-name font-display font-black uppercase leading-[0.95] tracking-tight">
              <span ref={nameRef}>
                {w.links ? (
                  // A shared award: each name opens its own driver.
                  w.links.map((l, i) => (
                    <span key={l.to}>
                      {i > 0 && " & "}
                      <Link to={l.to} className="aw-cards-link" onFocus={showInRail}>
                        {i === 0 && <span className="sr-only">{award.title}: </span>}
                        {l.name}
                      </Link>
                    </span>
                  ))
                ) : w.to ? (
                  <Link to={w.to} className="aw-cards-link" onFocus={showInRail}>
                    {/* Tabbing from card to card, a name on its own does not
                        say what it won (and one driver can win twice). */}
                    <span className="sr-only">{award.title}: </span>
                    {w.name}
                  </Link>
                ) : (
                  w.name
                )}
              </span>
            </p>
            {w.sub ? (
              <div className="aw-cards-sub font-display text-[11px] font-bold uppercase tracking-[0.14em]">
                {w.kind === "driver" && w.team && <SubLogo team={w.team} />}
                <span ref={subRef} className="truncate">
                  {w.sub}
                </span>
              </div>
            ) : (
              // An empty line of the same height (a typed name has no team or
              // date), so the rules and notes of a row stay level.
              <span className="aw-cards-sub" data-empty="" aria-hidden="true" />
            )}
            {/* The ornament is there with or without a reason, so it lines up
                across a row and a card without one still reads as finished. */}
            <span className="aw-cards-rule" aria-hidden="true" />
            {/* The winner's season in figures (worked out by the server:
                position, points, wins and poles; a race's contacts, overtakes
                and DNFs). A card without any keeps the line's room on
                the phone rail, like the reason below. */}
            {award.stats?.length ? (
              <p className="aw-cards-stats font-mono uppercase">
                {award.stats.map((x, i) => (
                  <span key={i}>
                    <b>{x.value}</b>
                    {x.label && ` ${x.label}`}
                  </span>
                ))}
              </p>
            ) : (
              <p className="aw-cards-stats" data-empty="" aria-hidden="true" />
            )}
            {award.note ? (
              <p ref={noteRef} className="aw-cards-note">
                {award.note}
              </p>
            ) : (
              // The phone rail keeps two lines for a reason on every card, so
              // a card without one is as tall as the rest (seasonAwardCards.css).
              <p className="aw-cards-note" data-empty="" aria-hidden="true" />
            )}
            {/* The rating cards' signature line. It sits at the foot of the
                card, so a card with a shorter note than its neighbours ends
                on it instead of on an empty band. */}
            <span className="aw-cards-brand font-mono uppercase" aria-hidden="true">
              <b>NABS</b> Racing
              <i />
              Season awards
            </span>
            <span className="aw-cards-strip" aria-hidden="true" />
          </div>
        </div>
      </div>
    </li>
  );
}

function AwardRail({ season, plans }) {
  const awards = season.awards;
  const n = awards.length;
  const [railRef, at] = useRailIndex(n);
  useRowHeights(railRef, season);
  const [two, three, four] = plans;
  return (
    <>
      <ul ref={railRef} role="list" data-count={n} className="aw-cards-rail cascade">
        {awards.map((a, i) => (
          <AwardCard
            key={a.id}
            award={a}
            seasonNumber={season.seasonNumber}
            index={i}
            place={{ "--aw-s2": two.starts[i], "--aw-s3": three.starts[i], "--aw-s4": four.starts[i] }}
          />
        ))}
      </ul>
      {n > 1 && n <= MAX_DOTS && (
        <div className="aw-cards-dots" aria-hidden="true">
          {awards.map((a, i) => (
            <span key={a.id} className={i === at ? "is-on" : undefined} />
          ))}
        </div>
      )}
      {n > MAX_DOTS && (
        <div className="aw-cards-count font-mono text-[11px] font-bold tracking-[0.2em] text-light" aria-hidden="true">
          {at + 1} / {n}
        </div>
      )}
    </>
  );
}

export default function SeasonAwardCards({ seasons }) {
  const [picked, setPicked] = useState(seasons[0]?.seasonNumber);
  const season = seasons.find((s) => s.seasonNumber === picked) || seasons[0];
  // A new season fades over instead of dealing every card in again.
  const swap = useSwapClass(season?.seasonNumber);
  if (!season) return null;
  const label = season.seasonName || `Season ${season.seasonNumber}`;
  const n = season.awards.length;
  // Two, three and four across; the stylesheet picks one by the room the
  // section has. The heading row reads the same plan, so it spans exactly the
  // cards below it.
  const plans = [2, 3, 4].map((cols) => gridPlan(n, cols));
  return (
    <section
      data-season-awards
      className="reveal aw-cards"
      style={{ "--aw-halves2": plans[0].halves, "--aw-halves3": plans[1].halves, "--aw-halves4": plans[2].halves }}
    >
      <div className="aw-cards-head mb-5 flex flex-wrap items-end justify-between gap-3 sm:mb-6">
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
      <div key={season.seasonNumber} className={swap}>
        <AwardRail season={season} plans={plans} />
      </div>
    </section>
  );
}
