import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { DriverAvatar } from "../ui.jsx";
import TeamLogo from "../TeamLogo.jsx";
import Flag from "../Flag.jsx";
import SlidingTabs from "../SlidingTabs.jsx";
import { useSwapClass } from "../../hooks/motion.js";
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

// shared.js hands a driver's flag over as a country code but a race's as
// flagFor()'s { country, countryName } object; Flag wants the code.
const flagCode = (f) => (typeof f === "string" ? f : f?.country) || null;

// Letters in the longest word. The big type is sized so that this word still
// fits on one line of its column (--aw-ceremony-longest in the CSS): a title
// like "Sportsmanship award" would otherwise break mid-word on a phone.
const longestWord = (text) => Math.max(1, ...String(text || "").split(/\s+/).map((w) => w.length));

// Whether the window is at least `px` wide, kept live. DriverAvatar, TeamLogo
// and Flag take their size in pixels, so the phone and desktop sizes of the
// winner's picture are picked here instead of in a class.
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

// The winner's picture in a thin gold ring: the driver's photo (initials on
// the team colour when there is none), the team's logo, the flag of the race's
// country, or the laurel for a typed-in name. The name beside it says the
// same thing in words, so the picture is hidden from screen readers.
function Medallion({ w, size }) {
  let inner;
  if (w.kind === "driver") {
    inner = <DriverAvatar name={w.name} photoUrl={w.driver?.photoUrl} color={w.color || "#64748b"} size={size} />;
  } else if (w.kind === "team") {
    inner = (
      <span className="flex items-center justify-center rounded-full bg-surface2" style={{ width: size, height: size }}>
        <TeamLogo id={w.team.id} name={w.team.name} color={w.team.color} logoUrl={w.team.logoUrl} size={Math.round(size * 0.62)} />
      </span>
    );
  } else if (w.kind === "race" && flagCode(w.flag)) {
    inner = (
      // A flex box, so the flag sits flush in the circle with no line gap
      // under it (Flag itself is an inline-block image).
      <span className="flex overflow-hidden rounded-full" style={{ width: size, height: size }}>
        <Flag code={flagCode(w.flag)} w={size} h={size} />
      </span>
    );
  } else {
    inner = (
      <span className="flex items-center justify-center rounded-full bg-surface2" style={{ width: size, height: size }}>
        <Laurel size={Math.round(size * 0.74)} />
      </span>
    );
  }
  return (
    <span className="aw-ceremony-medal" aria-hidden="true">
      {inner}
    </span>
  );
}

// The line under the winner's name: the driver's team with its logo, or the
// tier of a team, or the round and the day of a race.
function WinnerSub({ w }) {
  if (w.kind === "driver" && w.team) {
    return (
      <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-medium">
        <TeamLogo id={w.team.id} name={w.team.name} color={w.team.color} logoUrl={w.team.logoUrl} size={18} />
        <span className="min-w-0">{w.sub}</span>
      </div>
    );
  }
  if (!w.sub) return null;
  return <div className="mt-2 font-mono text-[11px] font-bold uppercase tracking-wider text-light">{w.sub}</div>;
}

function AwardRow({ award, index, seasonNumber, wide }) {
  const w = winnerOf(award, seasonNumber);
  const flag = w.kind === "driver" ? flagCode(w.flag) : null;
  return (
    <li className={`aw-ceremony-row${w.to ? " aw-ceremony-linked" : ""}`} style={{ "--i": Math.min(index, 12) }}>
      {/* The list numbers itself for a screen reader; this is the printed one. */}
      <div className="aw-ceremony-num font-mono" aria-hidden="true">
        {String(index + 1).padStart(2, "0")}
      </div>
      <h3 className="aw-ceremony-head">
        <span className="aw-ceremony-title font-display" style={{ "--aw-ceremony-longest": longestWord(award.title) }}>
          {award.title}
        </span>
      </h3>
      <div className="aw-ceremony-winner">
        <div className="aw-ceremony-label font-mono">Winner</div>
        <div className="flex items-center gap-4 sm:gap-5">
          <Medallion w={w} size={wide ? 80 : 56} />
          <div className="min-w-0 flex-1">
            <div
              className={`aw-ceremony-name font-display${String(w.name || "").length > 22 ? " aw-ceremony-long" : ""}`}
              style={{ "--aw-ceremony-longest": longestWord(w.name) }}
            >
              {/* The name is the link; its ::after stretches over the whole
                  row, so the row is one big target with a short link text. */}
              {w.to ? (
                <Link to={w.to} className="aw-ceremony-link">
                  {w.name}
                </Link>
              ) : (
                w.name
              )}
              {flag && <Flag code={flag} w={wide ? 24 : 20} h={wide ? 17 : 14} className="aw-ceremony-flag" />}
            </div>
            <WinnerSub w={w} />
          </div>
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
    check();
    strip.addEventListener("scroll", check, { passive: true });
    // The numbers change width when the font arrives without the strip
    // itself changing size, so the buttons are watched too.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(check) : null;
    ro?.observe(strip);
    strip.querySelectorAll("button").forEach((b) => ro?.observe(b));
    return () => {
      strip.removeEventListener("scroll", check);
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
  const season = seasons.find((s) => s.seasonNumber === picked) || seasons[0];
  // The rows fade over when another season is picked; the masthead stays.
  const swap = useSwapClass(season?.seasonNumber);
  const wide = useMinWidth(640);
  if (!season) return null;
  const seasonName = season.seasonName || `Season ${season.seasonNumber}`;
  const count = season.awards.length;

  return (
    <section
      data-awards-look="ceremony"
      className="aw-ceremony reveal overflow-hidden rounded-2xl border border-border bg-card shadow-card"
    >
      <div className="px-5 pt-6 sm:px-10 sm:pt-9">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <div className="min-w-0">
            <div className="font-mono text-[11px] font-bold uppercase tracking-widest text-eyebrow sm:text-[13px] sm:tracking-[0.2em]">
              {seasonName} · {count} {count === 1 ? "award" : "awards"}
            </div>
            <h2 className="mt-2 font-display text-3xl font-black uppercase leading-none tracking-tight text-dark sm:text-[2.5rem]">
              Season awards
            </h2>
          </div>
          {seasons.length > 1 && <SeasonSwitch seasons={seasons} value={season.seasonNumber} onChange={setPicked} />}
        </div>
        <div className="aw-ceremony-double mt-6 sm:mt-8" aria-hidden="true" />
      </div>

      <div key={season.seasonNumber} className={swap}>
        <ol role="list" className="cascade px-5 sm:px-10">
          {season.awards.map((a, i) => (
            <AwardRow key={a.id} award={a} index={i} seasonNumber={season.seasonNumber} wide={wide} />
          ))}
        </ol>
      </div>
      {/* The end of the programme: the double rule again, with a small laurel
          in the middle of it. */}
      <div className="aw-ceremony-coda mx-5 mb-6 sm:mx-10 sm:mb-9" aria-hidden="true">
        <span className="aw-ceremony-double aw-ceremony-end" />
        <Laurel size={34} />
        <span className="aw-ceremony-double aw-ceremony-end" />
      </div>
    </section>
  );
}
