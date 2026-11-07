import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Flag as FlagMark } from "lucide-react";
import { MEDAL, MEDAL_TEXT, sizedAvatarUrl } from "../ui.jsx";
import TeamLogo from "../TeamLogo.jsx";
import Flag from "../Flag.jsx";
import CircuitMap from "../CircuitMap.jsx";
import SlidingTabs from "../SlidingTabs.jsx";
import { hasOutline, useTrackOutlines } from "../../data/trackOutlines.js";
import { useSwapClass } from "../../hooks/motion.js";
import { winnerOf } from "./shared.js";
import "./lookGala.css";

// ---------------------------------------------------------------------------
// Season awards, look "gala" (Hall of Fame preview, ?look=gala).
//
// The section is a dark stage in both themes (`dark` + bg-ink, like the top
// list further down the page). The first award of the picked season is the
// headline: admins put the one they want up front first, so it gets the
// spotlight, a big picture in a gold ring and the name in large type. The
// name is set no larger than the reigning champion's in the section above,
// though: that is still the biggest name in the Hall of Fame. The rest sit
// underneath as gold-framed tiles. The season switch is part of the panel.
// ---------------------------------------------------------------------------

// shared.js hands a driver's flag over as a plain country code but a race's
// as flagFor()'s { country, countryName } object; Flag wants the code.
const flagCode = (f) => (typeof f === "string" ? f : f?.country) || null;

// Whether the window is at least `px` wide, kept live. The pictures take
// their size in pixels (photo thumbnails are picked by it) and the tiles
// their layout from the number of tiles to a row, so the breakpoints are read
// here instead of in a class.
function useMinWidth(px) {
  const query = `(min-width: ${px}px)`;
  const [on, setOn] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return undefined;
    const sync = () => setOn(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [query]);
  return on;
}

// Turns true once, when at least `share` of the element is on screen.
function useSeen(ref, share) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        // The first report comes straight away, and can be for a sliver; the
        // hundredth spares a ratio that rounds to just under the threshold.
        if (entry.isIntersecting && entry.intersectionRatio >= share - 0.01) setSeen(true);
      },
      { threshold: share }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, share, seen]);
  return seen;
}

// How many cells a last row leaves empty with `cols` tiles to a row; a tile
// left alone on its row counts one extra, as it reads worst.
const emptyCells = (n, cols) => {
  const r = n % cols;
  return r === 0 ? 0 : cols - r + (r === 1 ? 1 : 0);
};

// From xl up the tiles run three or four to a row, whichever leaves the fuller
// last row, and on a tie the one that takes fewer rows: four tiles as one row
// rather than three and a lone one, seven as four and three, ten as 4-4-2
// rather than 3-3-3-1, eleven as 4-4-3 rather than 3-3-3-2.
function xlColumns(n) {
  if (n <= 3) return 3;
  const four = emptyCells(n, 4);
  const three = emptyCells(n, 3);
  if (four !== three) return four < three ? 4 : 3;
  return Math.ceil(n / 4) < Math.ceil(n / 3) ? 4 : 3;
}

// From lg to xl a row only has room for three, so the other choice is two:
// taken where three would leave a tile alone and two would not, as long as it
// costs no extra row. In practice four tiles as two and two; seven and ten
// keep three to a row, since two would stack them a row higher.
function lgColumns(n) {
  const lone = (cols) => n > cols && n % cols === 1;
  return lone(3) && !lone(2) && Math.ceil(n / 2) === Math.ceil(n / 3) ? 2 : 3;
}

// Tiles to a row at the window's width: one on a phone, two from sm, then
// lgColumns and xlColumns.
function columnsFor(n, sm, lg, xl) {
  if (!sm) return 1;
  if (!lg) return 2;
  return xl ? xlColumns(n) : lgColumns(n);
}

// The pieces of a name a line can break between: words, and a hyphenated
// word after its hyphen ("Featherstonehaugh-" + "Smythe"). The CSS sizes the
// name so the longest of them fits the box (see .aw-gala-fit in the CSS).
const pieces = (name) =>
  String(name || "")
    .split(/\s+/)
    .flatMap((word) => word.match(/[^-]+-?|-/g) || []);
const longestPiece = (name) => Math.max(1, ...pieces(name).map((p) => p.length));

// The headline name: how large it may get by breakpoint (smaller as the name
// gets longer, so a long one does not run to four lines), and how many
// letters must fit on one line. A short name is kept on a single line whole,
// so "J. Yamanaka" never leaves the initial on a line of its own. The largest
// size (48px) is the reigning champion's own in the section above: an award
// winner set larger than the champion made the champion look like the side
// award.
function headlineFit(name) {
  const n = String(name || "").length;
  const max =
    n > 40
      ? "[--aw-max:1.375rem] sm:[--aw-max:1.75rem] xl:[--aw-max:2rem]"
      : n > 20
        ? "[--aw-max:1.5rem] sm:[--aw-max:2rem] xl:[--aw-max:2.25rem]"
        : n > 12
          ? "[--aw-max:1.75rem] sm:[--aw-max:2.5rem] xl:[--aw-max:2.75rem]"
          : "[--aw-max:2rem] sm:[--aw-max:3rem]";
  return { max, len: Math.max(n <= 14 ? n : 0, longestPiece(name)) };
}

// The letters for a winner without a picture: the first letter of the first
// two words ("J. Yamanaka" is JY, "Pink Panthers Racing" PP). A clan tag or
// anything else in brackets ("[NABS] Ünal") is left out, so the letters are
// the name's own. A one-word name that starts with a digit keeps its first
// two characters, so "13bot" reads 13 and not a lone 1 that looks like a
// first-place medal. Other symbols in front of a word are skipped.
function initialsOf(name) {
  const full = String(name || "");
  const bare = full.replace(/[[({<][^\])}>]*[\])}>]/g, " ");
  const words = (bare.trim() ? bare : full)
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+/u, ""))
    .filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1 && /^\p{N}/u.test(words[0])) return Array.from(words[0]).slice(0, 2).join("").toUpperCase();
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join("")
    .toUpperCase();
}

// Tiles standing side by side (the "stack" layout, see Tile) line their
// pictures up, and a title that wraps onto a second line would push its
// picture below its neighbours'. So every such title block is made as tall
// as the tallest title (--aw-title-h, read in the CSS), measured after layout
// and again whenever one of them changes size: fonts landing, the window
// resized. `key` changes with the season and the tiles to a row.
function useEqualTitles(ref, key) {
  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid) return undefined;
    const texts = [...grid.querySelectorAll(".aw-gala-tile-stack .aw-gala-tile-title-text")];
    const sync = () => {
      const h = Math.max(0, ...texts.map((t) => t.offsetHeight));
      if (h) grid.style.setProperty("--aw-title-h", `${h}px`);
    };
    sync();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(sync);
    texts.forEach((t) => ro.observe(t));
    return () => ro.disconnect();
  }, [ref, key]);
}

// A laurel wreath with a star: the mark for a winner that was typed in by hand
// (two drivers sharing an award, a whole grid) and has no picture of its own.
// The leaves are laid in pairs along an arc from the bottom up to the top
// left, and the right branch is the left one mirrored.
const WREATH = (() => {
  const cx = 24;
  const cy = 25;
  const r = 15;
  const rad = (d) => (d * Math.PI) / 180;
  const leaves = [];
  for (let i = 0; i < 6; i++) {
    const a = 106 + i * 21; // degrees on screen, 90 = straight down
    const px = cx + r * Math.cos(rad(a));
    const py = cy + r * Math.sin(rad(a));
    const rx = 4.7 - i * 0.28;
    // Along the branch toward its tip, then tilted off the stem either side.
    for (const tilt of [-36, 36]) {
      const deg = a + 90 + tilt;
      leaves.push({ x: px + rx * Math.cos(rad(deg)), y: py + rx * Math.sin(rad(deg)), rx, deg });
    }
  }
  const end = 106 + 6 * 21;
  const tip = { x: cx + r * Math.cos(rad(end)), y: cy + r * Math.sin(rad(end)) };
  leaves.push({ x: tip.x + 3.2 * Math.cos(rad(end + 90)), y: tip.y + 3.2 * Math.sin(rad(end + 90)), rx: 3.2, deg: end + 90 });
  const from = { x: cx + r * Math.cos(rad(100)), y: cy + r * Math.sin(rad(100)) };
  const stem = `M${from.x.toFixed(2)} ${from.y.toFixed(2)} A${r} ${r} 0 0 1 ${tip.x.toFixed(2)} ${tip.y.toFixed(2)}`;
  const star = Array.from({ length: 10 }, (_, k) => {
    const rr = k % 2 ? 2.5 : 5.8;
    const a = rad(-90 + k * 36);
    return `${(24 + rr * Math.cos(a)).toFixed(2)},${(23.5 + rr * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
  return { leaves, stem, star };
})();

function Wreath({ className = "" }) {
  const branch = (
    <>
      <path d={WREATH.stem} fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      {WREATH.leaves.map((l, i) => (
        <ellipse
          key={i}
          cx={l.x.toFixed(2)}
          cy={l.y.toFixed(2)}
          rx={l.rx.toFixed(2)}
          ry={(l.rx * 0.42).toFixed(2)}
          transform={`rotate(${l.deg.toFixed(1)} ${l.x.toFixed(2)} ${l.y.toFixed(2)})`}
        />
      ))}
    </>
  );
  return (
    <svg viewBox="0 0 48 48" className={className} fill="currentColor" aria-hidden="true">
      {branch}
      <g transform="matrix(-1 0 0 1 48 0)">{branch}</g>
      <polygon points={WREATH.star} />
    </svg>
  );
}

// A winner's letters in gold, sized to the disc (`size` px across): a single
// letter a little larger than two.
function Initials({ name, size }) {
  const letters = initialsOf(name);
  return (
    <span
      className="font-display font-black leading-none tracking-tight"
      style={{ fontSize: Math.round(size * (letters.length > 1 ? 0.36 : 0.42)) }}
    >
      {letters}
    </span>
  );
}

// A driver in the ring: the photo when there is one (a dead link falls back
// to the letters), otherwise the initials set in gold on the dark disc like
// the team, race and wreath marks. A disc of team colour with letters on it
// read as a coin or a big button under the light; the team colour stays as
// a faint glow and a hairline in the disc instead (see .aw-gala-disc).
function Portrait({ w, size }) {
  const url = w.driver.photoUrl;
  const [failed, setFailed] = useState(null); // the photo that would not load
  return (
    <span className="aw-gala-disc" style={{ width: size, height: size, "--aw-team": w.color || undefined }}>
      {url && url !== failed ? (
        <img
          src={sizedAvatarUrl(url, size)}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          onError={() => setFailed(url)}
        />
      ) : (
        <Initials name={w.name} size={size} />
      )}
    </span>
  );
}

// A team's logo in its disc. TeamLogo picks the file (the team's own upload,
// or the bundled /teams/<id>.png for older teams) and the CSS fits it into a
// wide box (.aw-gala-logo), so a logo up to about 2.5:1 (Red Bull's) spans
// the disc instead of shrinking into a square. Read off the picture here:
// - With no logo, a dead link, or a wordmark wider than 2.5:1, the team gets
//   gold initials like a driver ("PP", "TR"). TeamLogo's own fallback is the
//   first three letters of the name, which set large in the ring read as a
//   word ("PIN" for Pink Panthers); and a wordmark, Toro Rosso's at 5:1, can
//   be no taller than a strip inside a circle, its dark letters lost on the
//   dark disc.
// - A raster logo is drawn at most a quarter larger than its own size: the
//   bundled ones are small PNGs (Williams is 44px) and go soft blown up past
//   that. An SVG scales cleanly and keeps the whole box.
// Measured before paint where the picture is already in, so TeamLogo's three
// letters never show.
function TeamMark({ w, size }) {
  const box = useRef(null);
  const [initials, setInitials] = useState(false);
  const [cap, setCap] = useState(null); // [width, height] in px, or null
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const read = () => {
      const img = el.querySelector("img");
      if (!img) {
        setInitials(true);
        return;
      }
      if (!img.complete || !img.naturalWidth || !img.naturalHeight) return;
      if (img.naturalWidth / img.naturalHeight > 2.5) {
        setInitials(true);
        return;
      }
      const vector = /\.svg(?:[?#]|$)/i.test(img.currentSrc || img.src);
      setCap(vector ? null : [img.naturalWidth * 1.25, img.naturalHeight * 1.25]);
    };
    const fail = () => setInitials(true);
    read();
    // Neither load nor error bubbles; listening on the way down catches both.
    el.addEventListener("load", read, true);
    el.addEventListener("error", fail, true);
    return () => {
      el.removeEventListener("load", read, true);
      el.removeEventListener("error", fail, true);
    };
  }, []);
  return (
    <span
      ref={box}
      className="aw-gala-logo"
      style={cap ? { "--aw-cap-w": `${cap[0]}px`, "--aw-cap-h": `${cap[1]}px` } : undefined}
    >
      {initials ? (
        <Initials name={w.name} size={size} />
      ) : (
        <TeamLogo
          id={w.team.id}
          name={w.name}
          color={w.color || "#64748b"}
          logoUrl={w.team.logoUrl}
          size={Math.round(size * 0.56)}
          className="aw-gala-team"
        />
      )}
    </span>
  );
}

// The picture in its gold ring: the driver, the team's logo, the circuit for
// a race, or the wreath for a typed name. `size` is the picture's own
// diameter in pixels, ring not included.
function Medallion({ w, size, big = false }) {
  useTrackOutlines(); // re-render once uploaded circuit outlines are in
  let picture;
  if (w.kind === "driver") {
    picture = <Portrait w={w} size={size} />;
  } else {
    let mark;
    if (w.kind === "team") {
      // Keyed to the logo, so a changed one is read afresh.
      mark = <TeamMark key={`${w.team.id}|${w.team.logoUrl || ""}`} w={w} size={size} />;
    } else if (w.kind === "race") {
      mark = hasOutline(w.race.track) ? (
        <CircuitMap track={w.race.track} className="h-[62%] w-[62%]" stroke={MEDAL[0]} strokeWidth={big ? 3 : 2} />
      ) : (
        <FlagMark className="h-[42%] w-[42%]" strokeWidth={1.6} />
      );
    } else {
      mark = <Wreath className="h-[72%] w-[72%]" />;
    }
    picture = (
      <span
        className="aw-gala-disc"
        // A team's own colour glows faintly behind its logo.
        style={{ width: size, height: size, "--aw-team": (w.kind === "team" && w.color) || undefined }}
      >
        {mark}
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={`aw-gala-medal ${big ? "aw-gala-medal-big" : ""}`}>
      <span className="aw-gala-gap">{picture}</span>
    </span>
  );
}

// The line under the winner's name: the driver's team, the team's tier, the
// race's round and date. `withFlag` puts the flag in this line rather than
// next to the name (the headline keeps its big name centred on its own).
function SubLine({ w, big = false, withFlag = false, className = "" }) {
  const code = flagCode(w.flag);
  const flag = withFlag && code ? <Flag code={code} w={big ? 24 : 18} h={big ? 17 : 13} /> : null;
  if (w.kind === "driver" && w.team) {
    return (
      <span className={`flex min-w-0 items-center gap-2 ${className}`}>
        {flag && (
          <>
            {flag}
            <span aria-hidden="true" className="mx-0.5 h-1 w-1 shrink-0 rotate-45 bg-gold/70" />
          </>
        )}
        <TeamLogo
          id={w.team.id}
          name={w.team.name}
          color={w.team.color}
          logoUrl={w.team.logoUrl}
          size={big ? 20 : 16}
          showName
          className="min-w-0"
          nameClassName={`truncate ${big ? "text-[15px] font-semibold text-medium" : "text-[13px] text-light"}`}
        />
      </span>
    );
  }
  if (!w.sub && !flag) return null;
  return (
    <span className={`flex min-w-0 items-center gap-2 ${className}`}>
      {flag}
      {w.sub && (
        <span
          className={`truncate font-mono font-bold uppercase tracking-wider ${big ? "text-xs text-medium" : "text-[10px] text-light"}`}
        >
          {w.sub}
        </span>
      )}
    </span>
  );
}

// The first award, under the spotlight.
function Headline({ award, seasonNumber, sm }) {
  const w = winnerOf(award, seasonNumber);
  const fit = headlineFit(w.name);
  // The gold band runs through the name once the name itself is on screen.
  // Keyed to the section's reveal, it played on page load while the name was
  // still below the fold (the section's top shows first, under the champions
  // on a desktop), and nobody saw it.
  const nameRef = useRef(null);
  const lit = useSeen(nameRef, 0.75);
  const body = (
    <>
      <span className="relative mb-7 inline-flex">
        <span aria-hidden="true" className="aw-gala-halo" />
        <Medallion w={w} size={sm ? 112 : 96} big />
      </span>
      <span
        className="mb-3 flex items-center justify-center gap-3 font-mono text-[11px] font-bold uppercase tracking-[0.3em] sm:text-xs"
        style={{ color: MEDAL_TEXT[0] }}
      >
        <span aria-hidden="true" className="aw-gala-rule" />
        <span className="min-w-0 text-balance pl-[0.3em]">{award.title}</span>
        <span aria-hidden="true" className="aw-gala-rule aw-gala-rule-r" />
      </span>
      {/* No margin classes here: the clip fix in the CSS sets this box's
          vertical margins, and the gap above comes from the title's mb-3.
          Line height 1.05, not tighter: on two lines the marks of one line
          ran into the next (the cedilla of Ç into the ring of Å). */}
      <span
        ref={nameRef}
        className={`aw-gala-name aw-gala-hl-name aw-gala-glint block max-w-full text-balance font-display font-black uppercase leading-[1.05] tracking-tight [overflow-wrap:anywhere] ${fit.max} ${lit ? "is-lit" : ""}`}
        style={{ "--aw-len": fit.len }}
      >
        {w.name}
      </span>
      <SubLine w={w} big withFlag className="mt-3 justify-center sm:mt-4" />
    </>
  );
  // The headline's box reaches up past the halos round the ring (pt-6) and a
  // little below the last line, so a keyboard focus ring goes round the whole
  // of it instead of cutting through the halos. The negative margins keep the
  // layout where it would be without that room; the minimum width keeps a
  // short name's box wider than the halos.
  const cls =
    "relative -mb-3 -mt-6 flex min-w-[min(100%,13.5rem)] max-w-full flex-col items-center rounded-2xl px-3 pb-3 pt-6 text-center";
  return (
    <div className="aw-gala-fit relative flex flex-col items-center pt-9 sm:pt-8">
      {w.to ? (
        <Link
          to={w.to}
          className={`aw-gala-hl group ${cls} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70`}
        >
          {body}
        </Link>
      ) : (
        <div className={cls}>{body}</div>
      )}
      {award.note && (
        // overflow-wrap: a link or other long unbroken string in a note breaks
        // inside the box instead of running out past the panel's edge.
        <p className="mt-4 max-w-xl text-pretty text-center text-[15px] leading-relaxed text-medium [overflow-wrap:anywhere] sm:mt-5 sm:text-base">
          {award.note}
        </p>
      )}
    </div>
  );
}

// One of the other awards, laid out one of three ways:
// - "row", on a phone: the title on top, then the picture left of the name.
// - "stack", from sm up, side by side: centred like a small copy of the
//   headline. Tiles in a row share its height, so each ends on a small gold
//   mark at its foot: the room a short tile has left over then sits inside
//   the tile, above the mark, instead of reading as a blank.
// - "wide", for a tile that would be alone on the last row: it spans the row
//   instead, picture left of all its text, the two centred in the tile.
function Tile({ award, seasonNumber, layout }) {
  const w = winnerOf(award, seasonNumber);
  const code = flagCode(w.flag);
  const stack = layout === "stack";
  const wide = layout === "wide";
  // The flag rides on the last word, so the name is sized to leave room for
  // it on that line (20px wide plus its 8px margin, and a hair to spare).
  const parts = pieces(w.name);
  const fit = {
    "--aw-len": longestPiece(w.name),
    "--aw-tail": code ? Math.max(1, (parts[parts.length - 1] || "").length) : 1,
    "--aw-flag": code ? "30px" : "0px",
  };
  const title = (
    <span
      className={`aw-gala-tile-title flex items-center gap-2.5 font-mono font-bold uppercase tracking-[0.22em] ${
        stack ? "justify-center text-center" : wide ? "mb-1.5" : ""
      }`}
      style={{ color: MEDAL_TEXT[0] }}
    >
      {stack && <span aria-hidden="true" className="aw-gala-rule aw-gala-rule-sm" />}
      <span className={`aw-gala-tile-title-text min-w-0 text-balance ${stack ? "pl-[0.22em]" : ""}`}>{award.title}</span>
      {stack && <span aria-hidden="true" className="aw-gala-rule aw-gala-rule-r aw-gala-rule-sm" />}
    </span>
  );
  // overflow-wrap: a link or other long unbroken string in a note breaks
  // inside the tile instead of running out of it.
  const note = award.note && (
    <span
      className={`block min-w-0 text-sm leading-relaxed text-medium [overflow-wrap:anywhere] ${wide ? "mt-2" : "mt-3"} ${
        stack ? "text-balance text-center" : "text-pretty"
      }`}
    >
      {award.note}
    </span>
  );
  // In the wide layout the text takes only the room it needs (up to 28rem),
  // so picture and text centre as a pair; the name there is sized against
  // the whole tile, which is a container from sm up (see the CSS).
  const winner = (
    <span
      className={`flex min-w-0 flex-col ${
        stack ? "aw-gala-fit w-full items-center text-center" : wide ? "max-w-[28rem]" : "aw-gala-fit flex-1"
      }`}
    >
      {wide && title}
      <span
        className={`aw-gala-tile-name max-w-full text-balance font-display font-black uppercase leading-tight tracking-tight text-dark [overflow-wrap:anywhere] ${
          layout === "row" ? "[--aw-max:1.125rem]" : "[--aw-max:1.25rem]"
        }`}
        style={fit}
      >
        {w.name}
        {/* A word joiner, so the flag never wraps onto a line alone. */}
        {code && (
          <>
            {"\u2060"}
            <Flag code={code} w={20} h={14} className="ml-2 align-[-0.08em]" />
          </>
        )}
      </span>
      <SubLine w={w} className={`mt-1 ${stack ? "justify-center" : ""}`} />
      {wide && note}
    </span>
  );
  const inner = wide ? (
    <span className="flex items-center justify-center gap-5">
      <Medallion w={w} size={60} />
      {winner}
    </span>
  ) : (
    <>
      {title}
      <span className={stack ? "mt-4 flex flex-col items-center gap-3" : "mt-3 flex items-center gap-3.5"}>
        <Medallion w={w} size={stack ? 60 : 52} />
        {winner}
      </span>
      {note}
      {stack && (
        <span aria-hidden="true" className="aw-gala-end mt-auto pt-4">
          <span />
        </span>
      )}
    </>
  );
  const cls = stack
    ? "aw-gala-tile aw-gala-tile-stack flex h-full flex-col px-5 pb-4 pt-5"
    : `aw-gala-tile block h-full ${wide ? "p-5" : "p-4"}`;
  return w.to ? (
    <Link to={w.to} className={`${cls} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70`}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export default function LookGala({ seasons }) {
  const [picked, setPicked] = useState(seasons[0].seasonNumber);
  const season = seasons.find((s) => s.seasonNumber === picked) || seasons[0];
  // Switching seasons fades the stage over; the panel and its lights stay.
  const swap = useSwapClass(season.seasonNumber);
  const sm = useMinWidth(640);
  const lg = useMinWidth(1024);
  const xl = useMinWidth(1280);
  const headingId = useId();
  const gridRef = useRef(null);
  const [first, ...rest] = season.awards;
  const cols = columnsFor(rest.length, sm, lg, xl);
  // A tile that would sit alone on the last row spans that row instead (the
  // wide layout), so the grid never ends on a leftover.
  const spanLast = cols > 1 && rest.length % cols === 1;
  useEqualTitles(gridRef, `${season.seasonNumber}:${cols}:${spanLast}`);
  const seasonName = season.seasonName || `Season ${season.seasonNumber}`;
  // The tile titles of a season share one size (see .aw-gala-tile-title):
  // the one the longest of them needs to fit on a line, down to 10px.
  const longestTitle = Math.max(1, ...rest.map((a) => String(a.title || "").length));

  return (
    <section
      data-awards-look="gala"
      aria-labelledby={headingId}
      className="aw-gala dark reveal relative isolate overflow-hidden rounded-3xl bg-ink text-dark shadow-lift"
    >
      <div aria-hidden="true" className="aw-gala-vignette" />
      <div aria-hidden="true" className="aw-gala-beam" />
      <div aria-hidden="true" className="aw-gala-lamp" />
      <div aria-hidden="true" className="aw-gala-frame" />

      <div className="relative px-5 pb-7 pt-7 sm:px-10 sm:pb-11 sm:pt-10">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-eyebrow sm:text-[11px] sm:tracking-[0.25em]">
              {seasonName}
            </div>
            <h2 id={headingId} className="mt-1 font-display text-3xl font-black uppercase leading-none tracking-tight text-dark sm:text-4xl">
              Season awards
            </h2>
          </div>
          {seasons.length > 1 && (
            // The site's own switch, as on the top list's dark panel below:
            // gold on this stage is kept for the awards themselves.
            <SlidingTabs
              items={seasons.map((s) => ({
                key: s.seasonNumber,
                // The marker sits on the label, inside the button, so a click
                // on it is a click on the switch.
                label: <span data-awards-season={s.seasonNumber}>S{s.seasonNumber}</span>,
                title: s.seasonName || `Season ${s.seasonNumber}`,
              }))}
              value={season.seasonNumber}
              onChange={setPicked}
              wrapClassName="inline-flex flex-wrap rounded-xl bg-white/10 p-1 ring-1 ring-white/15"
              btnClassName="min-w-[3rem] px-3.5 py-1.5 text-sm font-semibold"
              pillClassName="rounded-lg bg-brand shadow"
              activeClassName="text-onbrand"
              idleClassName="text-white/60 hover:text-white"
            />
          )}
        </div>

        <div key={season.seasonNumber} className={swap}>
          {first ? (
            <Headline award={first} seasonNumber={season.seasonNumber} sm={sm} />
          ) : (
            <p className="py-16 text-center text-medium">No awards for this season yet.</p>
          )}
          {rest.length > 0 && (
            <>
              <div aria-hidden="true" className="aw-gala-divider my-7">
                <span />
              </div>
              <div
                ref={gridRef}
                className="aw-gala-grid cascade"
                style={{ "--aw-tlen": longestTitle, "--aw-cols": cols }}
              >
                {rest.map((a, i) => {
                  const span = spanLast && i === rest.length - 1;
                  return (
                    <div key={a.id} className={span ? "aw-gala-span" : undefined} style={{ "--i": i }}>
                      <Tile
                        award={a}
                        seasonNumber={season.seasonNumber}
                        layout={!sm ? "row" : span ? "wide" : "stack"}
                      />
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
