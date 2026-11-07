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
// spotlight, a big picture in a gold ring and the name in large type. It stays
// a size below the reigning champion in the section above, though: that is
// still the biggest name in the Hall of Fame. The rest sit underneath as
// gold-framed tiles. The season switch is part of the panel.
// ---------------------------------------------------------------------------

// shared.js hands a driver's flag over as a plain country code but a race's
// as flagFor()'s { country, countryName } object; Flag wants the code.
const flagCode = (f) => (typeof f === "string" ? f : f?.country) || null;

// Whether the window is at least `px` wide, kept live. The pictures take
// their size in pixels (photo thumbnails are picked by it), so the phone and
// desktop sizes are chosen here instead of in a class.
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

// How many cells a last row leaves empty with `cols` tiles to a row; a tile
// left alone on its row counts one extra, as it reads worst.
const emptyCells = (n, cols) => {
  const r = n % cols;
  return r === 0 ? 0 : cols - r + (r === 1 ? 1 : 0);
};

// From xl up the tiles run three or four to a row, whichever leaves the fuller
// last row: four tiles as one row rather than three and a lone one, seven as
// four and three, ten as 4-4-2 rather than 3-3-3-1.
function xlColumns(n) {
  return n > 3 && emptyCells(n, 4) < emptyCells(n, 3) ? 4 : 3;
}

// From lg to xl a row only has room for three, so the other choice is two:
// taken where three would leave a tile alone and two would not, as long as it
// costs no extra row. In practice four tiles as two and two; seven and ten
// keep three to a row, since two would stack them a row higher.
function lgColumns(n) {
  const lone = (cols) => n > cols && n % cols === 1;
  return lone(3) && !lone(2) && Math.ceil(n / 2) === Math.ceil(n / 3) ? 2 : 3;
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
// size stays under the reigning champion's in the section above.
function headlineFit(name) {
  const n = String(name || "").length;
  const max =
    n > 40
      ? "[--aw-max:1.375rem] sm:[--aw-max:2rem] xl:[--aw-max:2.25rem]"
      : n > 20
        ? "[--aw-max:1.5rem] sm:[--aw-max:2.25rem] xl:[--aw-max:2.5rem]"
        : n > 12
          ? "[--aw-max:1.75rem] sm:[--aw-max:2.75rem] xl:[--aw-max:3.25rem]"
          : "[--aw-max:2rem] sm:[--aw-max:3.5rem] xl:[--aw-max:4rem]";
  return { max, len: Math.max(n <= 14 ? n : 0, longestPiece(name)) };
}

// The letters for a driver without a photo: the first letter of the first two
// words ("J. Yamanaka" is JY). A one-word name that starts with a digit keeps
// its first two characters, so "13bot" reads 13 and not a lone 1 that looks
// like a first-place medal. Symbols in front of a word ("[NABS]") are skipped.
function initialsOf(name) {
  const words = String(name || "")
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

// From sm up the tiles stand side by side, and a title that wraps onto a
// second line would push its picture below its neighbours'. So every title
// block in the grid is made as tall as the tallest title (--aw-title-h, read
// in the CSS from sm up), measured after layout and again whenever one of
// them changes size: fonts landing, the window resized.
function useEqualTitles(ref, key) {
  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid) return undefined;
    const texts = [...grid.querySelectorAll(".aw-gala-tile-title-text")];
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

// A driver in the ring: the photo when there is one (a dead link falls back
// to the letters), otherwise the initials set in gold on the dark disc like
// the team, race and wreath marks. A disc of team colour with letters on it
// read as a coin or a big button under the light; the team colour stays as
// a faint tint behind the letters instead.
function Portrait({ w, size }) {
  const url = w.driver.photoUrl;
  const [failed, setFailed] = useState(null); // the photo that would not load
  const letters = initialsOf(w.name);
  return (
    <span className="aw-gala-disc aw-gala-tint" style={{ width: size, height: size, "--aw-team": w.color || undefined }}>
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
        <span
          className="font-display font-black leading-none tracking-tight"
          style={{ fontSize: Math.round(size * (letters.length > 1 ? 0.36 : 0.42)) }}
        >
          {letters}
        </span>
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
      // At most 72px: the bundled logos are small PNGs (44 to 128px) and go
      // soft when blown up further. A team without a logo gets TeamLogo's
      // monogram, restyled as gold letters by .aw-gala-team in the CSS.
      mark = (
        <TeamLogo
          id={w.team.id}
          name={w.name}
          color={w.color || "#64748b"}
          logoUrl={w.team.logoUrl}
          size={Math.min(72, Math.round(size * 0.56))}
          className="aw-gala-team"
        />
      );
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
        className="aw-gala-disc aw-gala-tint"
        style={{
          width: size,
          height: size,
          // A team's own colour glows faintly behind its logo.
          "--aw-team": (w.kind === "team" && w.color) || undefined,
          "--aw-mono": `${Math.round(size * 0.27)}px`,
        }}
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
function Headline({ award, seasonNumber, wide }) {
  const w = winnerOf(award, seasonNumber);
  const fit = headlineFit(w.name);
  const body = (
    <>
      <span className="relative mb-8 inline-flex sm:mb-9">
        <span aria-hidden="true" className="aw-gala-halo" />
        <Medallion w={w} size={wide ? 128 : 104} big />
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
          vertical margins, and the gap above comes from the title's mb-3. */}
      <span
        className={`aw-gala-name aw-gala-hl-name aw-gala-glint block max-w-full text-balance font-display font-black uppercase leading-[0.95] tracking-tight [overflow-wrap:anywhere] ${fit.max}`}
        style={{ "--aw-len": fit.len }}
      >
        {w.name}
      </span>
      <SubLine w={w} big withFlag className="mt-3 justify-center sm:mt-4" />
    </>
  );
  // The headline's box reaches up past the halos round the ring (pt-7) and a
  // little below the last line, so a keyboard focus ring goes round the whole
  // of it instead of cutting through the halos. The negative margins keep the
  // layout where it would be without that room; the minimum width keeps a
  // short name's box wider than the halos.
  const cls =
    "relative -mb-3 -mt-7 flex min-w-[min(100%,13.5rem)] max-w-full flex-col items-center rounded-2xl px-3 pb-3 pt-7 text-center";
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
        <p className="mt-4 max-w-xl text-pretty text-center text-[15px] leading-relaxed text-medium sm:mt-5 sm:text-base">
          {award.note}
        </p>
      )}
    </div>
  );
}

// One of the other awards. On a phone it reads as a row (picture left); from
// sm up it stands centred, like a small copy of the headline.
function Tile({ award, seasonNumber, wide }) {
  const w = winnerOf(award, seasonNumber);
  const code = flagCode(w.flag);
  // The flag rides on the last word, so the name is sized to leave room for
  // it on that line (20px wide plus its 8px margin, and a hair to spare).
  const parts = pieces(w.name);
  const fit = {
    "--aw-len": longestPiece(w.name),
    "--aw-tail": code ? Math.max(1, (parts[parts.length - 1] || "").length) : 1,
    "--aw-flag": code ? "30px" : "0px",
  };
  const inner = (
    <>
      <span
        className="aw-gala-tile-title flex items-center gap-2.5 font-mono font-bold uppercase tracking-[0.22em] sm:justify-center sm:text-center"
        style={{ color: MEDAL_TEXT[0] }}
      >
        <span aria-hidden="true" className="aw-gala-rule aw-gala-rule-sm hidden sm:block" />
        <span className="aw-gala-tile-title-text min-w-0 text-balance sm:pl-[0.22em]">{award.title}</span>
        <span aria-hidden="true" className="aw-gala-rule aw-gala-rule-r aw-gala-rule-sm hidden sm:block" />
      </span>
      <span className="mt-3 flex items-center gap-3.5 sm:mt-4 sm:flex-col sm:gap-3">
        <Medallion w={w} size={wide ? 68 : 52} />
        <span className="aw-gala-fit flex min-w-0 flex-1 flex-col sm:w-full sm:flex-none sm:items-center sm:text-center">
          <span
            className="aw-gala-tile-name max-w-full text-balance font-display font-black uppercase leading-tight tracking-tight text-dark [--aw-max:1.125rem] [overflow-wrap:anywhere] sm:[--aw-max:1.25rem]"
            style={fit}
          >
            {w.name}
            {/* A word joiner, so the flag never wraps onto a line alone. */}
            {code && (
              <>
                {"⁠"}
                <Flag code={code} w={20} h={14} className="ml-2 align-[-0.08em]" />
              </>
            )}
          </span>
          <SubLine w={w} className="mt-1 sm:justify-center" />
        </span>
      </span>
      {award.note && (
        <span className="mt-3 block text-pretty text-sm leading-relaxed text-medium sm:text-balance sm:text-center">
          {award.note}
        </span>
      )}
    </>
  );
  const cls = "aw-gala-tile block h-full p-4 sm:px-5 sm:py-6";
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
  const wide = useMinWidth(640);
  const headingId = useId();
  const gridRef = useRef(null);
  useEqualTitles(gridRef, season.seasonNumber);
  const [first, ...rest] = season.awards;
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

      <div className="relative px-5 pb-7 pt-7 sm:px-10 sm:pb-12 sm:pt-10">
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
            <Headline award={first} seasonNumber={season.seasonNumber} wide={wide} />
          ) : (
            <p className="py-16 text-center text-medium">No awards for this season yet.</p>
          )}
          {rest.length > 0 && (
            <>
              <div aria-hidden="true" className="aw-gala-divider my-8">
                <span />
              </div>
              <div
                ref={gridRef}
                className="aw-gala-grid cascade"
                data-cols-lg={lgColumns(rest.length)}
                data-cols={xlColumns(rest.length)}
                style={{ "--aw-tlen": longestTitle }}
              >
                {rest.map((a, i) => (
                  <div key={a.id} style={{ "--i": i }}>
                    <Tile award={a} seasonNumber={season.seasonNumber} wide={wide} />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
