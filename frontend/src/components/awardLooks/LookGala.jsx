import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { Flag as FlagMark } from "lucide-react";
import { DriverAvatar, MEDAL, MEDAL_TEXT } from "../ui.jsx";
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
// rest sit underneath as gold-framed tiles. The season switch is part of the
// panel.
// ---------------------------------------------------------------------------

// shared.js hands a driver's flag over as a plain country code but a race's
// as flagFor()'s { country, countryName } object; Flag wants the code.
const flagCode = (f) => (typeof f === "string" ? f : f?.country) || null;

// Whether the window is at least `px` wide, kept live. DriverAvatar and
// TeamLogo take their size in pixels, so the phone and desktop sizes of the
// pictures are picked here instead of in a class.
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

// From xl up the tiles run three or four to a row, whichever leaves the fuller
// last row: four tiles as one row rather than three and a lone one, seven as
// four and three, ten as 4-4-2 rather than 3-3-3-1. Below xl the CSS sets the
// columns on its own (see .aw-gala-grid).
function xlColumns(n) {
  const empty = (cols) => {
    const r = n % cols;
    return r === 0 ? 0 : cols - r + (r === 1 ? 1 : 0);
  };
  return n > 3 && empty(4) < empty(3) ? 4 : 3;
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
// so "J. Yamanaka" never leaves the initial on a line of its own.
function headlineFit(name) {
  const n = String(name || "").length;
  const max =
    n > 40
      ? "[--aw-max:1.625rem] sm:[--aw-max:2.5rem] xl:[--aw-max:3rem]"
      : n > 20
        ? "[--aw-max:1.875rem] sm:[--aw-max:3rem] xl:[--aw-max:3.75rem]"
        : n > 12
          ? "[--aw-max:2.25rem] sm:[--aw-max:3.75rem] xl:[--aw-max:4.5rem]"
          : "[--aw-max:2.75rem] sm:[--aw-max:4.5rem] xl:[--aw-max:6rem]";
  return { max, len: Math.max(n <= 14 ? n : 0, longestPiece(name)) };
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

// The picture in its gold ring: the driver (photo, or initials on the team
// colour), the team's logo, the circuit for a race, or the wreath for a typed
// name. `size` is the picture's own diameter in pixels, ring not included.
function Medallion({ w, size, big = false }) {
  useTrackOutlines(); // re-render once uploaded circuit outlines are in
  let picture;
  if (w.kind === "driver") {
    picture = <DriverAvatar name={w.name} photoUrl={w.driver.photoUrl} color={w.color || "#64748b"} size={size} />;
  } else {
    let mark;
    if (w.kind === "team") {
      mark = (
        <TeamLogo id={w.team.id} name={w.name} color={w.color || "#64748b"} logoUrl={w.team.logoUrl} size={Math.round(size * 0.56)} />
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
        className="aw-gala-disc"
        style={{
          width: size,
          height: size,
          // A team's own colour glows faintly behind its logo.
          backgroundColor: w.kind === "team" && w.color ? `${w.color}26` : undefined,
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
      <span className="relative mb-9 inline-flex sm:mb-11">
        <span aria-hidden="true" className="aw-gala-halo" />
        <Medallion w={w} size={wide ? 168 : 124} big />
      </span>
      <span
        className="flex items-center justify-center gap-3 font-mono text-[11px] font-bold uppercase tracking-[0.3em] sm:text-xs"
        style={{ color: MEDAL_TEXT[0] }}
      >
        <span aria-hidden="true" className="aw-gala-rule" />
        <span className="min-w-0 text-balance pl-[0.3em]">{award.title}</span>
        <span aria-hidden="true" className="aw-gala-rule aw-gala-rule-r" />
      </span>
      <span
        className={`aw-gala-name aw-gala-hl-name aw-gala-glint mt-3 block max-w-full text-balance font-display font-black uppercase leading-[0.95] tracking-tight [overflow-wrap:anywhere] ${fit.max}`}
        style={{ "--aw-len": fit.len }}
      >
        {w.name}
      </span>
      <SubLine w={w} big withFlag className="mt-3 justify-center sm:mt-4" />
    </>
  );
  const cls = "relative flex max-w-full flex-col items-center rounded-xl px-2 text-center";
  return (
    <div className="aw-gala-fit relative flex flex-col items-center pt-12 sm:pt-14">
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
        style={{ color: MEDAL_TEXT[0], "--aw-tlen": award.title.length }}
      >
        <span aria-hidden="true" className="aw-gala-rule aw-gala-rule-sm hidden sm:block" />
        <span className="min-w-0 sm:pl-[0.22em]">{award.title}</span>
        <span aria-hidden="true" className="aw-gala-rule aw-gala-rule-r aw-gala-rule-sm hidden sm:block" />
      </span>
      <span className="mt-3 flex items-center gap-3.5 sm:mt-4 sm:flex-col sm:gap-3">
        <Medallion w={w} size={wide ? 68 : 52} />
        <span className="aw-gala-fit flex min-w-0 flex-1 flex-col sm:w-full sm:flex-none sm:items-center sm:text-center">
          <span
            className="aw-gala-tile-name max-w-full font-display font-black uppercase leading-tight tracking-tight text-dark [--aw-max:1.125rem] [overflow-wrap:anywhere] sm:[--aw-max:1.25rem]"
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
          <SubLine w={w} className="mt-1 sm:justify-center" />
        </span>
      </span>
      {award.note && <span className="mt-3 block text-sm leading-relaxed text-medium sm:text-center">{award.note}</span>}
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
  const [first, ...rest] = season.awards;
  const seasonName = season.seasonName || `Season ${season.seasonNumber}`;

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
              wrapClassName="inline-flex flex-wrap rounded-xl bg-white/[0.06] p-1 ring-1 ring-gold/30"
              btnClassName="min-w-[3rem] px-3.5 py-1.5 text-sm font-semibold"
              pillClassName="rounded-lg bg-gradient-to-b from-[#FDE68A] to-gold shadow"
              activeClassName="text-ink"
              idleClassName="text-white/60 hover:text-[#FDE68A]"
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
              <div aria-hidden="true" className="aw-gala-divider my-9 sm:my-10">
                <span />
              </div>
              <div className="aw-gala-grid cascade" data-cols={xlColumns(rest.length)}>
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
