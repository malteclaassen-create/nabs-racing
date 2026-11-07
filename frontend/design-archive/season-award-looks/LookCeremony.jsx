import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { sizedAvatarUrl } from "../ui.jsx";
import TeamLogo from "../TeamLogo.jsx";
import Flag from "../Flag.jsx";
import CircuitMap from "../CircuitMap.jsx";
import SlidingTabs from "../SlidingTabs.jsx";
import { useSwapClass } from "../../hooks/motion.js";
import { countryNameOf } from "../../data/circuits.js";
import { hasOutline, useTrackOutlines } from "../../data/trackOutlines.js";
import { winnerOf } from "./shared.js";
import "./lookCeremony.css";

// ---------------------------------------------------------------------------
// Season awards, look "ceremony" (Hall of Fame preview, ?look=ceremony).
//
// Set like the printed programme of an awards night: one full-width row per
// award, numbered in the order the admins put them in, the award's name in
// big outlined type and the winner beside it, thin gold rules in between.
// The season switch is set in the same outlined type. The outlines, the rules
// and the row grid are in lookCeremony.css.
// ---------------------------------------------------------------------------

// A season with more awards than LONG_SEASON shows the first PREVIEW until
// "Show all" is pressed: a dozen rows of big type would otherwise push the
// rest of the Hall of Fame a couple of screens further down.
const PREVIEW = 6;
const LONG_SEASON = 8;

// The widths of the award list, in rem, at which its layout changes. The
// @container rules in lookCeremony.css use the same numbers; they are here
// as well because TeamLogo takes its size in pixels, so the size of the
// winner's picture has to be picked to match the layout.
const MID = 30; // the number gets a column of its own
const SPLIT = 38; // the winner moves to the right of the award
const WIDE = 60; // ...and back beside its picture
// The picture's size in each of those layouts. Under SMALL (a phone under
// about 400px) it is a size smaller, to keep the rows short.
const SMALL = 21;
const MEDAL_PX = { small: 44, narrow: 48, mid: 64, split: 56, wide: 64 };

// shared.js hands a driver's flag over as a country code but a race's as
// flagFor()'s { country, countryName } object; Flag wants the code.
const flagCode = (f) => (typeof f === "string" ? f : f?.country) || null;

// Written as an escape: a literal no-break space looks like a plain one in
// an editor, and a formatter or a copy and paste can quietly swap it.
const NBSP = " ";

// Glues the short pieces of a phrase to their neighbour with a no-break
// space: a number to the word before it ("Tier 2", so no line starts with
// "2 Driver") and an initial to the name after it ("J. Yamanaka", so a
// narrow column never leaves "J." on a line of its own).
const bind = (text) =>
  String(text || "")
    .replace(/ (\d+)\b/g, `${NBSP}$1`)
    .replace(/(\p{Lu}\.) +(?=\S)/gu, `$1${NBSP}`);

// Letters in the longest word. The big type is sized so that this word still
// fits on one line of its column (see the CSS): a title like "Sportsmanship
// award" would otherwise break mid-word on a phone. Split on plain spaces
// only, as \s would also split at the spaces bind() glued, and after a
// hyphen, where a line can break: "Habsburg-Lothringen" is sized as
// "Habsburg-", instead of shrinking the whole name to fit it as one word.
const longestWord = (text) =>
  Math.max(
    1,
    ...String(text || "")
      .replace(/-/g, "- ")
      .split(/[ \t\r\n]+/)
      .map((w) => w.length)
  );

// The flag after a name, counted in letters of the name: it is half the
// type's height tall, at most twice that wide, and has a small gap before it.
const FLAG_LETTERS = 2;
// A name that needs more room than this (a long gamer tag) is left out when
// the season's name size is worked out, and shrinks on its own instead of
// taking every other name in the season down with it.
const NAME_OUTLIER = 14;

// The award list's layout, from its width (see MID, SPLIT and WIDE), kept
// live. Measured before the first paint, so the pictures never jump a size.
function useListBand(ref) {
  const [band, setBand] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const read = () => {
      const cs = getComputedStyle(el);
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const w = (el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) / rem;
      setBand(w >= WIDE ? "wide" : w >= SPLIT ? "split" : w >= MID ? "mid" : w >= SMALL ? "narrow" : "small");
    };
    read();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(read) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [ref]);
  return band;
}

// A laurel wreath, for a winner typed in by hand ("The whole Tier 2 grid", a
// pair of names): there is no picture or logo to show, and the initials of a
// phrase would mean nothing. Seven leaves a side along a circle, open at the
// top; the angle is counted up from the bottom of the circle.
const LEAF = "M0 0C1.9-1.6 2-4.6 0-7C-2-4.6-1.9-1.6 0 0Z";
const LAUREL_LEAVES = Array.from({ length: 7 }, (_, i) => {
  const a = 22 + i * 19;
  const rad = (a * Math.PI) / 180;
  return { x: 24 - 15 * Math.sin(rad), y: 25 + 15 * Math.cos(rad), r: a - 114 };
});

function Laurel({ size }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" className="aw-ceremony-laurel">
      <path d="M21.4 39.8A15 15 0 0 1 16.5 12M26.6 39.8A15 15 0 0 0 31.5 12" fill="none" stroke="currentColor" strokeWidth="1.2" />
      {LAUREL_LEAVES.map((l, i) => (
        <g key={i} fill="currentColor">
          <path d={LEAF} transform={`translate(${l.x.toFixed(2)} ${l.y.toFixed(2)}) rotate(${l.r})`} />
          <path d={LEAF} transform={`translate(${(48 - l.x).toFixed(2)} ${l.y.toFixed(2)}) rotate(${-l.r})`} />
        </g>
      ))}
    </svg>
  );
}

// A driver's initials: the first letter of the first and of the last word
// ("J. Yamanaka" JY). Letters only, so a tag that starts with a number
// ("13bot") does not get a lone digit, which in a gold ring reads as P1.
function initialsOf(name) {
  const letters = String(name || "")
    .split(/\s+/)
    .map((w) => w.match(/\p{L}/u)?.[0])
    .filter(Boolean);
  const picked = letters.length > 1 ? letters[0] + letters[letters.length - 1] : letters[0];
  return (picked || String(name || "?").trim().charAt(0) || "?").toUpperCase();
}

// A driver's picture: the photo filling the disc, or without one the
// initials in gold on the dark disc, like the circuit and the laurel of the
// other winners, with the team's colour as a thin ring inside the gold one.
// Initials on a disc in the full team colour were the loudest thing in each
// row and made the column read like any driver list on the site. A photo
// that fails to load falls back to the initials.
function Portrait({ name, photoUrl, color, size }) {
  const [broken, setBroken] = useState(null);
  const photo = photoUrl && photoUrl !== broken ? photoUrl : null;
  return (
    <span
      className={`aw-ceremony-disc${photo ? "" : " aw-ceremony-mono"}`}
      style={{ width: size, height: size, "--aw-ceremony-team": color || undefined }}
    >
      {photo ? (
        <img
          src={sizedAvatarUrl(photo, size)}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => setBroken(photo)}
        />
      ) : (
        <span className="aw-ceremony-initials font-display" style={{ fontSize: Math.round(size * 0.36) }}>
          {initialsOf(name)}
        </span>
      )}
    </span>
  );
}

// The winner's picture in a thin gold ring: the driver's photo or initials,
// the team's logo (or its monogram in gold), the outline of the race's
// circuit drawn in gold, or the laurel for a typed-in name. A flag is not
// used here: blown up to fill a circle it went blurry and lost the part of
// the flag that tells many of them apart (the UAE's red bar, Qatar's white
// band), so the flag goes after the track's name like a driver's does. The
// name beside the picture says the same thing in words, so the picture is
// hidden from screen readers.
function Medallion({ w, size }) {
  // Outlines an admin uploaded arrive after the first paint; this re-renders
  // the medallion when they do, so a race picks its circuit up.
  useTrackOutlines();
  const disc = { width: size, height: size };
  let inner;
  if (w.kind === "driver") {
    inner = <Portrait name={w.name} photoUrl={w.driver?.photoUrl} color={w.color} size={size} />;
  } else if (w.kind === "team") {
    // TeamLogo gets the whole disc: a logo is padded in from the edge by the
    // CSS. A team with no logo gets its monogram, which the CSS sets in gold
    // on the dark disc like a driver's initials (hence no colour here) with
    // the team's colour as the inner ring.
    inner = (
      <span className="aw-ceremony-disc" style={{ ...disc, "--aw-ceremony-team": w.team.color || undefined }}>
        <TeamLogo
          id={w.team.id}
          name={w.team.name}
          color="transparent"
          logoUrl={w.team.logoUrl}
          size={size}
          className="aw-ceremony-crest"
        />
      </span>
    );
  } else if (w.kind === "race" && hasOutline(w.race?.track)) {
    const box = Math.round(size * 0.7);
    inner = (
      <span className="aw-ceremony-disc" style={disc}>
        <CircuitMap
          track={w.race.track}
          strokeWidth={size > 56 ? 2 : 1.75}
          className="aw-ceremony-circuit"
          style={{ width: box, height: box }}
        />
      </span>
    );
  } else {
    inner = (
      <span className="aw-ceremony-disc" style={disc}>
        <Laurel size={Math.round(size * 0.74)} />
      </span>
    );
  }
  return (
    <span className="aw-ceremony-medal" style={{ "--aw-ceremony-size": `${size}px` }} aria-hidden="true">
      {inner}
    </span>
  );
}

// The winner's name with the flag after it. The last word and the flag are
// one piece, so a name that wraps never leaves the flag alone under it. Only
// a word too long to share a line with the flag at all (a long gamer tag on
// a small phone) lets the flag go to the next line, rather than the word
// being cut in two.
function NameWithFlag({ name, flag }) {
  if (!flag) return name;
  const cut = name.lastIndexOf(" ");
  return (
    <>
      {name.slice(0, cut + 1)}
      <span className="aw-ceremony-tail">
        {name.slice(cut + 1)}
        {/* The size is set by the CSS (all flags the same height, in step
            with the name); these only hold the space until it loads. */}
        <Flag code={flag} title={countryNameOf(flag)} w={24} h={16} className="aw-ceremony-flag" />
      </span>
    </>
  );
}

// The line under the winner's name: the driver's team with its logo, or the
// tier of a team, or the round and the day of a race.
function WinnerSub({ w }) {
  if (w.kind === "driver" && w.team) {
    return (
      <div className="mt-1.5 flex items-center gap-2 text-sm font-semibold text-medium">
        <TeamLogo id={w.team.id} name={w.team.name} color={w.team.color} logoUrl={w.team.logoUrl} size={18} />
        <span className="min-w-0">{w.sub}</span>
      </div>
    );
  }
  if (!w.sub) return null;
  // "Round 7 · 29 May 2026": each part stays on one line, so a narrow phone
  // breaks after the dot and never inside the date.
  const parts = w.sub.split(" · ");
  return (
    <div className="mt-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-light">
      {parts.map((p, i) => (
        <span key={i}>
          <span className="whitespace-nowrap">{i < parts.length - 1 ? `${p} ·` : p}</span>
          {i < parts.length - 1 && " "}
        </span>
      ))}
    </div>
  );
}

// What a winner's name needs room for, in letters: its longest word and the
// flag after it. The whole season's names are set at one size, the one the
// most demanding of them allows (see .aw-ceremony-name in the CSS).
function nameNeed(award, seasonNumber) {
  const w = winnerOf(award, seasonNumber);
  const flagged = (w.kind === "driver" || w.kind === "race") && flagCode(w.flag);
  return longestWord(bind(w.name)) + (flagged ? FLAG_LETTERS : 0);
}

function AwardRow({ award, index, seasonNumber, size, landing }) {
  const w = winnerOf(award, seasonNumber);
  const title = bind(award.title);
  const name = bind(w.name);
  const flag = w.kind === "driver" || w.kind === "race" ? flagCode(w.flag) : null;
  const word = longestWord(name);
  return (
    <li
      className={`aw-ceremony-row${w.to ? " aw-ceremony-linked" : ""}`}
      style={{ "--i": Math.min(index, 12) }}
      // The first row "Show all" brings in takes the focus when it has no
      // link of its own to take it (see LookCeremony).
      tabIndex={landing ? -1 : undefined}
    >
      {/* The list numbers itself for a screen reader; this is the printed one. */}
      <div className="aw-ceremony-num font-mono" aria-hidden="true">
        {String(index + 1).padStart(2, "0")}
      </div>
      <h3 className="aw-ceremony-head">
        <span
          className={`aw-ceremony-title font-display${title.length > 28 ? " aw-ceremony-long" : ""}`}
          style={{ "--aw-ceremony-longest": longestWord(title) }}
        >
          {title}
        </span>
      </h3>
      <div className="aw-ceremony-winner">
        <Medallion w={w} size={size} />
        <div className="aw-ceremony-who">
          <div className="aw-ceremony-label font-mono">Winner</div>
          <div
            className={`aw-ceremony-name font-display${name.length > 22 ? " aw-ceremony-long" : ""}`}
            style={{ "--aw-ceremony-word": word, "--aw-ceremony-need": word + (flag ? FLAG_LETTERS : 0) }}
          >
            {/* The name is the link; its ::after stretches over the whole
                row, so the row is one big target with a short link text.
                With a flag inside, the label keeps the flag's country out of
                the link's name. */}
            {w.to ? (
              <Link to={w.to} className="aw-ceremony-link" aria-label={flag ? w.name : undefined}>
                <NameWithFlag name={name} flag={flag} />
              </Link>
            ) : (
              <NameWithFlag name={name} flag={flag} />
            )}
          </div>
          <WinnerSub w={w} />
        </div>
      </div>
      {award.note && <p className="aw-ceremony-note">{award.note}</p>}
    </li>
  );
}

// The seasons as big outlined numbers, the picked one filled in with a gold
// line under it. SlidingTabs slides the line from number to number and keeps
// the picked one in view when a long list scrolls sideways on a phone.
function SeasonSwitch({ seasons, value, onChange }) {
  const ref = useRef(null);
  // Which ends of the strip have seasons scrolled out of sight ("start",
  // "end" or both), so that end fades out instead of cutting a number in half
  // with nothing to say there is more.
  const [more, setMore] = useState("");
  useEffect(() => {
    const strip = ref.current?.querySelector(".aw-ceremony-switch");
    if (!strip) return undefined;
    const check = () => {
      const rest = strip.scrollWidth - strip.clientWidth - strip.scrollLeft;
      setMore([strip.scrollLeft > 2 ? "start" : "", rest > 2 ? "end" : ""].filter(Boolean).join(" "));
    };
    // A mouse wheel only turns up and down, and the strip has no scrollbar,
    // so a desktop with more seasons than fit had no way to the oldest ones
    // short of Shift and the wheel. Over the strip the wheel moves it
    // sideways instead, until it reaches that end; from there on the page
    // scrolls as usual. Sideways swipes on a touchpad are left alone.
    const onWheel = (e) => {
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      const room = strip.scrollWidth - strip.clientWidth;
      if (room <= 1) return;
      const step = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaMode === 2 ? e.deltaY * strip.clientWidth : e.deltaY;
      const next = Math.max(0, Math.min(room, strip.scrollLeft + step));
      if (Math.abs(next - strip.scrollLeft) < 1) return;
      e.preventDefault();
      strip.scrollLeft = next;
    };
    check();
    strip.addEventListener("scroll", check, { passive: true });
    strip.addEventListener("wheel", onWheel, { passive: false });
    // The numbers change width when the font arrives without the strip
    // itself changing size, so the buttons are watched too.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(check) : null;
    ro?.observe(strip);
    strip.querySelectorAll("button").forEach((b) => ro?.observe(b));
    return () => {
      strip.removeEventListener("scroll", check);
      strip.removeEventListener("wheel", onWheel);
      ro?.disconnect();
    };
  }, [seasons.length]);
  return (
    <div
      ref={ref}
      // More than five seasons get smaller numbers, so a desktop still shows
      // them all on one line for a good while.
      className={`aw-ceremony-switch-wrap min-w-0 max-w-full${seasons.length > 5 ? " aw-ceremony-many" : ""}`}
      data-more={more || undefined}
      role="group"
      aria-label="Season"
    >
      <SlidingTabs
        items={seasons.map((s) => {
          const name = s.seasonName || `Season ${s.seasonNumber}`;
          return {
            key: s.seasonNumber,
            title: name,
            label: (
              <span data-awards-season={s.seasonNumber} className="aw-ceremony-numeral font-display">
                <span aria-hidden="true">S{s.seasonNumber}</span>
                <span className="sr-only">{name}</span>
              </span>
            ),
          };
        })}
        value={value}
        onChange={onChange}
        wrapClassName="aw-ceremony-switch scrollbar-none flex overflow-x-auto"
        btnClassName="aw-ceremony-season"
        pillClassName="aw-ceremony-switch-line"
        activeClassName=""
        idleClassName=""
      />
    </div>
  );
}

export default function LookCeremony({ seasons }) {
  const [picked, setPicked] = useState(seasons[0]?.seasonNumber);
  const [all, setAll] = useState(false);
  const listId = useId();
  const bodyRef = useRef(null);
  const listRef = useRef(null);
  const moreRef = useRef(null);
  // Where "Show fewer" sat on screen when it was pressed, and whether "Show
  // all" was just pressed; both are acted on once the rows have changed.
  const keepAt = useRef(null);
  const landNew = useRef(false);
  const season = seasons.find((s) => s.seasonNumber === picked) || seasons[0];
  // The rows fade over when another season is picked; the masthead stays.
  const swap = useSwapClass(season?.seasonNumber);
  const band = useListBand(bodyRef);

  useLayoutEffect(() => {
    // Folding takes away the rows the reader had just scrolled through, all
    // of them above the button, so the page stayed put and left them a
    // screen or more past the section. The button goes back to where it was
    // on screen instead, under the finger or pointer that pressed it, with
    // the end of the shorter list right above it. Done before the paint, so
    // there is no jump to see.
    if (keepAt.current != null) {
      const top = moreRef.current?.getBoundingClientRect().top;
      if (top != null) window.scrollBy(0, top - keepAt.current);
      keepAt.current = null;
    }
    // Unfolding adds the rows above the button, so the next Tab would leave
    // the section and skip them all. The focus moves to the first new row
    // (its link, or the row itself when it has none) where the button was;
    // a pointer press shows no ring for it.
    if (landNew.current) {
      landNew.current = false;
      const row = listRef.current?.children[PREVIEW];
      (row?.querySelector("a") || row)?.focus({ preventScroll: true });
    }
  }, [all]);

  if (!season) return null;
  const seasonName = season.seasonName || `Season ${season.seasonNumber}`;
  const count = season.awards.length;
  const long = count > LONG_SEASON;
  const shown = long && !all ? season.awards.slice(0, PREVIEW) : season.awards;
  // The room the season's names are sized for (see NAME_OUTLIER). Worked out
  // over the whole season, not just the rows on show, so the names do not
  // change size when "Show all" brings the rest in.
  const needs = season.awards.map((a) => nameNeed(a, season.seasonNumber));
  const usual = needs.filter((n) => n <= NAME_OUTLIER);
  const need = usual.length ? Math.max(...usual) : Math.min(...needs, NAME_OUTLIER);
  const size = MEDAL_PX[band] || MEDAL_PX.narrow;
  // Another season opens folded again, like the first one did.
  const pick = (n) => {
    setPicked(n);
    setAll(false);
  };
  const toggle = () => {
    if (all) keepAt.current = moreRef.current?.getBoundingClientRect().top ?? null;
    else landNew.current = true;
    setAll(!all);
  };

  return (
    <section
      data-awards-look="ceremony"
      className="aw-ceremony reveal overflow-hidden rounded-2xl border border-border bg-card shadow-card"
    >
      <div className="px-5 pt-6 sm:px-10 sm:pt-8">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-3">
          <div className="min-w-0">
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-eyebrow">
              {seasonName} · {count} {count === 1 ? "award" : "awards"}
            </div>
            <h2 className="mt-1 font-display text-3xl font-black uppercase leading-none tracking-tight text-dark sm:text-4xl">
              Season awards
            </h2>
          </div>
          {seasons.length > 1 && <SeasonSwitch seasons={seasons} value={season.seasonNumber} onChange={pick} />}
        </div>
        <div className="aw-ceremony-double mt-5 sm:mt-6" aria-hidden="true" />
      </div>

      {/* Not keyed by season like the list inside it, so the width it is
          measured by stays put when another season is picked. */}
      <div ref={bodyRef} className="px-5 sm:px-10">
        <div key={season.seasonNumber} className={swap}>
          <ol
            id={listId}
            ref={listRef}
            role="list"
            className="aw-ceremony-list cascade"
            style={{ "--aw-ceremony-names": need }}
          >
            {shown.map((a, i) => (
              <AwardRow
                key={a.id}
                award={a}
                index={i}
                seasonNumber={season.seasonNumber}
                size={size}
                landing={long && i === PREVIEW}
              />
            ))}
          </ol>
        </div>
      </div>
      {/* The end of the programme: the double rule again, with a small laurel
          in the middle of it, or the button that opens a long season. */}
      <div className="aw-ceremony-coda mx-5 mb-5 sm:mx-10 sm:mb-7">
        <span className="aw-ceremony-double aw-ceremony-end" aria-hidden="true" />
        {long ? (
          <button
            ref={moreRef}
            type="button"
            className="aw-ceremony-more font-mono"
            aria-expanded={all}
            aria-controls={listId}
            onClick={toggle}
          >
            {all ? "Show fewer" : `Show all ${count} awards`}
            <ChevronDown size={14} strokeWidth={2.5} aria-hidden="true" className="aw-ceremony-more-icon" />
          </button>
        ) : (
          <Laurel size={40} />
        )}
        <span className="aw-ceremony-double aw-ceremony-end" aria-hidden="true" />
      </div>
    </section>
  );
}
