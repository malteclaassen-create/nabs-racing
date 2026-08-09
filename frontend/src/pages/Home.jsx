import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth } from "../hooks/useAuth.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { Skeleton, TableSkeleton, CountUp, Rank, MEDAL_TEXT, DriverAvatar, ErrorBox } from "../components/ui.jsx";
import { useParallax, useMagnetic } from "../hooks/motion.js";
import Flag from "../components/Flag.jsx";
import PointsChart from "../components/PointsChart.jsx";
import Podium from "../components/Podium.jsx";
import RaceCountdown from "../components/RaceCountdown.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import CircuitMap from "../components/CircuitMap.jsx";
import { circuitFor, flagFor } from "../data/circuits.js";
import { countryFor } from "../data/driverCountries.js";
import { fmtRaceTime, raceKickoff } from "../utils/raceTime.js";
import { heroFor, heroOnError, carFor } from "../utils/heroImage.js";
import { seasonGameLabel } from "../utils/seasonGame.js";
import NextSeasonTeaser from "../components/NextSeasonTeaser.jsx";
import SlidingTabs from "../components/SlidingTabs.jsx";
import SeasonPicker from "../components/SeasonPicker.jsx";
import { useSocial } from "../components/SocialLinks.jsx";
import SocialFeed from "../components/SocialFeed.jsx";
import { fmtRaceDate, fmtDateLong, fmtWeekday, isLapTime, NO_VALUE} from "../utils/format.js";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MEDAL = MEDAL_TEXT; // theme-aware gold/silver/bronze (text + accent bars)

// Line-icon paths (stroke = currentColor) for the "by the numbers" tiles.
const TILE_ICONS = {
  podium: "M4 21V11h5v10M9 21V5h6v16M15 21V9h5v12",
  trophy: "M8 21h8M12 17v4M7 4h10v4a5 5 0 01-10 0V4zM7 5H4v2a3 3 0 003 3M17 5h3v2a3 3 0 01-3 3",
  flag: "M5 21V4M5 4c3-1.5 6 1.5 9 0s4-1 4-1v9s-1 .5-4 1-6-1.5-9 0",
  trend: "M3 17l6-6 4 4 7-7M14 8h6v6",
  shield: "M12 3l7 3v5c0 4.6-3.1 7.3-7 9-3.9-1.7-7-4.4-7-9V6z",
  users: "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M22 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8",
  calendar: "M4 6a2 2 0 012-2h12a2 2 0 012 2v13a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM4 9h16M8 3v4M16 3v4",
};

// The championship battle while the title is still open: everyone who can
// still mathematically catch the leader, their gaps, and how many points are
// left on the table. Disappears once the maths (or the calendar) settle it.
//
// "Still in it" is EXACT under the season's drop rule: a chaser survives when
// their best-case final total (maximum points in every remaining round, then
// the N worst rounds dropped) at least matches the leader's guaranteed floor
// (zero in every remaining round, same drop rule). The per-round maximum is
// the best single-round haul seen this season.
function TitleFight({ standings, raceNumbers, dropWorst, completedNumbers, totalRounds, tableMax = 0 }) {
  const completedCount = completedNumbers.length;
  const remaining = totalRounds - completedCount;
  if (remaining <= 0 || completedCount < 1 || standings.length < 2) return null;

  const done = new Set(completedNumbers);
  // Points a round can pay at most: the season's OWN points table (P1's score —
  // admin-editable per season, so a rule change flows straight in here), or,
  // when the season runs on the league default (no stored table), the best
  // single-round haul actually seen. The observed value also wins if official/
  // bonus points ever exceeded the table.
  const maxPerRound = Math.max(
    tableMax || 0,
    ...standings.flatMap((d) =>
      Object.entries(d.perRace || {})
        .filter(([n]) => done.has(Number(n)))
        .map(([, r]) => r?.points || 0)
    )
  );
  if (!maxPerRound) return null;

  const dropN = Math.min(dropWorst ?? 0, raceNumbers.length);
  const dropSum = (vals) => vals.sort((a, b) => a - b).slice(dropN).reduce((s, v) => s + v, 0);
  // Current standing under the drop rule with the remaining rounds still at 0.
  // Recomputed (not read from d.total) so the demo's rewound rounds are
  // consistent too; on the live season this equals the server total.
  const floorTotal = (d) =>
    dropSum(raceNumbers.map((n) => (done.has(n) ? d.perRace?.[n]?.points ?? 0 : 0)));
  // Best possible final total: max points in every remaining round, then drop.
  const maxFinal = (d) =>
    dropSum(raceNumbers.map((n) => (done.has(n) ? d.perRace?.[n]?.points ?? 0 : maxPerRound)));

  const rows = standings
    .map((d) => ({ d, cur: floorTotal(d) }))
    .sort((a, b) => b.cur - a.cur);
  const leader = rows[0];
  if (!leader.cur) return null;
  const contenders = rows.filter((r) => r === leader || maxFinal(r.d) >= leader.cur).slice(0, 4);
  if (contenders.length < 2) return null;
  const potential = remaining * maxPerRound;
  return (
    <section className="reveal space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h3 className="section-title">Title fight</h3>
        <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">
          {remaining} {remaining === 1 ? "round" : "rounds"} to go · up to {potential} pts on the table
        </span>
      </div>
      <div className="cascade card divide-y divide-border overflow-hidden">
        {contenders.map(({ d, cur }, i) => {
          const gap = leader.cur - cur;
          // Full bar = level with the leader; empty = the gap eats the whole
          // remaining points pool. How alive their shot still is.
          const pct = Math.max(6, Math.round((1 - gap / potential) * 100));
          return (
            <Link
              key={d.driverId}
              to={`/drivers/${d.driverId}`}
              style={{ "--i": i }}
              className="flex items-center gap-2.5 px-3 py-3 transition hover:bg-surface2 sm:gap-4 sm:px-5"
            >
              {/* rank from the recomputed order (matters in the rewound demo) */}
              <Rank position={i + 1} />
              <DriverAvatar name={d.name} photoUrl={d.photoUrl} color={d.team.color} size={36} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-display text-base font-bold uppercase tracking-tight text-dark sm:text-lg">
                    {d.name}
                  </span>
                  <Flag code={countryFor(d.driverId, d.country)} />
                </div>
                <TeamLogo
                  id={d.team.id}
                  name={d.team.name}
                  color={d.team.color}
                  logoUrl={d.team.logoUrl}
                  size={16}
                  showName
                  nameClassName="truncate text-xs text-light sm:text-sm"
                />
              </div>
              <div className="hidden w-28 shrink-0 sm:block lg:w-44">
                <div className="h-1.5 overflow-hidden rounded-full bg-border">
                  <div className="bar-fill h-full rounded-full" style={{ "--w": `${pct}%`, backgroundColor: d.team.color }} />
                </div>
              </div>
              <div className="w-14 shrink-0 text-right sm:w-20">
                <div className="font-mono text-lg font-bold tabular-nums text-dark sm:text-xl">
                  <CountUp end={cur} />
                </div>
                <div className="font-mono text-[11px] tabular-nums text-light">
                  {gap === 0 ? "leader" : `−${gap}`}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function fmtFull(d) {
  return d ? fmtDateLong(d) : "Date TBA";
}

function pad2(n) {
  return String(n ?? 0).padStart(2, "0");
}

// One cell of the end-of-season honours band (below the hero), in the same
// quiet hairline-ruled language as the profile stat tiles. Driver awards carry
// the driver's flag and team mark; team awards lead with the team's logo. The
// award's headline figure (`stat`, with its small `note` underneath) is parked
// big on the cell's right edge — every current and future award reads the same.
function HonourCell({ label, to, name, stat, note, driverId, country, team, className = "", index = 0 }) {
  const flag = driverId ? countryFor(driverId, country) : null;
  const nameCls =
    "truncate font-display text-lg font-extrabold uppercase tracking-tight text-dark sm:text-xl lg:text-2xl";
  return (
    <div
      // Phones get one full-width cell per row, so the figure sits beside the
      // name. The 3-across sm: range is too narrow for that and stacks it
      // underneath instead; from lg: on the cells are wide enough again.
      className={`-ml-px -mt-px flex min-w-0 items-center justify-between gap-4 border-l border-t border-border bg-card p-5 sm:flex-col sm:items-start sm:gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4 ${className}`}
      style={{ "--i": index }}
    >
      <div className="min-w-0">
        <div className="font-mono text-[11px] font-bold uppercase tracking-widest text-light">{label}</div>
        <div className="mt-2 flex min-w-0 items-center gap-2.5">
          {!driverId && team && (
            <TeamLogo id={team.id} name={team.name} color={team.color} logoUrl={team.logoUrl} size={28} />
          )}
          {to ? (
            <Link to={to} className={`${nameCls} transition hover:text-brand`}>
              {name}
            </Link>
          ) : (
            <span className={nameCls}>{name}</span>
          )}
          {flag && <Flag code={flag} w={22} h={16} />}
        </div>
        {driverId && team && (
          <TeamLogo
            id={team.id}
            name={team.name}
            color={team.color}
            logoUrl={team.logoUrl}
            size={18}
            showName
            className="mt-2"
            nameClassName="truncate text-sm text-light"
          />
        )}
      </div>
      {stat && (
        <div className="shrink-0 text-right sm:text-left lg:text-right">
          <div className="font-display text-3xl font-black tabular-nums leading-none text-dark">
            {typeof stat === "number" ? <CountUp end={stat} /> : stat}
          </div>
          {note && (
            <div className="mt-1.5 max-w-[9rem] font-mono text-[10px] font-bold uppercase leading-relaxed tracking-wider text-light">
              {note}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// The season's car in the coming-soon hero: the showroom JPG at
// public/cars/s<n>.jpg (its black backdrop plus blend-mode "screen" acts as a
// free cutout on the dark panel). A season without one renders no panel at all.
// Drop-a-file, no admin.
function CarReveal({ season }) {
  const [ok, setOk] = useState(false);
  // null = probing whether the car image exists, true/false = probe verdict.
  const [hasImg, setHasImg] = useState(null);
  const src = carFor(season);

  // Probe the car shot first, so a season WITHOUT one renders no panel at all
  // instead of an empty placeholder box.
  useEffect(() => {
    let cancelled = false;
    setHasImg(null);
    setOk(false);
    if (!src) {
      setHasImg(false);
      return;
    }
    fetch(src, { method: "HEAD" })
      .then((res) => {
        // dev servers answer missing files with index.html, so check the type
        const type = res.headers.get("content-type") || "";
        if (!cancelled) setHasImg(res.ok && !type.includes("text/html"));
      })
      .catch(() => {
        if (!cancelled) setHasImg(false);
      });
    return () => {
      cancelled = true;
    };
  }, [src]);

  // Nothing to show (and nothing still probing): drop the panel entirely —
  // the announcement text simply fills the hero on its own.
  if (hasImg === false) return null;
  // Still probing: hold the space quietly (no placeholder copy) to avoid a
  // one-frame layout jump when the car pops in.
  const probing = hasImg === null;

  const showCar = ok;
  const alt = season?.name ? `The ${season.name} car` : "The season's car";
  return (
    <div
      /* once the car is up, the panel goes solid near-black so both the blend
         cutout and the 3D stage stay clean no matter the hero photo behind */
      className={`hero-car-slot hero-anim relative flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-2xl border border-black/10 dark:border-white/12 lg:w-[42%] ${
        showCar ? "bg-[#05070c]" : "bg-black/[0.04] dark:bg-white/[0.04]"
      }`}
      style={{ animationDelay: "0.24s" }}
    >
      {/* white hatch once the car's dark stage is up; theme-aware before */}
      <div className={`${showCar ? "speed-hatch" : "hero-hatch"} absolute inset-0 opacity-20`} />
      {/* no "coming soon" placeholder copy — while probing the panel just sits
          quietly with the hatch until the car (2D or 3D) is confirmed */}
      {probing && <span aria-hidden className="absolute inset-0" />}
      {hasImg === true && src && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onLoad={() => setOk(true)}
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
          className={`absolute inset-0 h-full w-full object-cover mix-blend-screen transition-opacity duration-slow ${ok ? "opacity-100" : "opacity-0"}`}
        />
      )}
      {showCar && (
        <div className="pointer-events-none absolute bottom-3 left-4 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
          The {season?.name} car{season?.game ? ` · ${seasonGameLabel(season)}` : ""}
        </div>
      )}
    </div>
  );
}

// How to name the day of the opener under the countdown. Weeks out, a date is
// the useful answer ("07 Aug"); inside the final week the weekday is what
// people actually plan around, and the last two days get named outright. Reads
// the kickoff time, not the raw date, so a date-only race says the same day the
// countdown counts to.
function openerDayLabel(date) {
  const target = raceKickoff(date);
  if (!target) return null;
  const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(target) - midnight(new Date())) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  // Only up to 6 days out: at exactly 7, "Friday" would name two possible days.
  // A kickoff already in the past (the season not activated the morning after
  // its opener) falls through to the date as well, rather than claiming "Today".
  if (days > 1 && days < 7) return fmtWeekday(target);
  return `${pad2(target.getDate())} ${MONTHS[target.getMonth()]}`;
}

// Dev-only preview helper: pretends the announced opener is `days` from now and
// optionally at another circuit, so the off-season hero can be checked at every
// stage of its countdown, and with any track's outline, without moving the real
// race in the admin. Keeps the league's usual evening start, so the day label
// and the countdown agree. Production builds never call this (see the `?opener=`
// read in Home, guarded by import.meta.env.DEV).
function previewOpener(teaser, spec, track) {
  if (!teaser?.firstRace) return teaser;
  if (track) {
    teaser = { ...teaser, firstRace: { ...teaser.firstRace, track } };
    if (spec == null) return teaser;
  }
  const s = String(spec).trim();
  const inHours = /h$/i.test(s);
  const n = Number(inHours ? s.slice(0, -1) : s);
  if (!Number.isFinite(n)) return teaser;
  const now = new Date();
  // A plain number counts whole days and keeps the league's evening start, so
  // the day label reads the way it will on the real date. "<n>h" counts hours
  // from right now instead, which is the only way to land inside the race
  // window and see the countdown flip to Lights Out.
  const at = inHours
    ? new Date(now.getTime() + n * 3600000)
    : new Date(now.getFullYear(), now.getMonth(), now.getDate() + Math.trunc(n), 19, 0, 0);
  return { ...teaser, firstRace: { ...teaser.firstRace, date: at.toISOString() } };
}

// Box for the circuit watermark on the next-season card, derived from the
// track's own proportions. The league's outlines run from a 2.1:1 sprawl (Miami)
// to a 1:3 sliver (Jeddah), and one fixed box would draw the wide ones large and
// the narrow ones tiny, since each outline is fitted inside whatever box it gets.
// Equal AREA instead, so every track carries about the same weight, then clamped
// so the mark stays in the card's free top-right corner and never reaches down
// into the countdown.
const MARK_AREA = 6700; // px², about 100x67 for a typical layout
// `area`, the clamps and `rotateBelow` are overridable because the next-race
// card gives the outline a band of its own rather than tucking it into a
// corner: it is wider, shorter, and lays every portrait track down.
function circuitMark(track, { area = MARK_AREA, maxW = 120, maxH = 100, rotateBelow = 0.5 } = {}) {
  const c = circuitFor(track);
  if (!c) return null;
  const [, , w, h] = String(c.box || "0 0 100 100").split(/\s+/).map(Number);
  let aspect = w > 0 && h > 0 ? w / h : 1;
  // A track taller than its slot is wide comes out as a thin scratch however
  // much area it is given, because the area has nowhere to go. Those lie down,
  // the same move the admin can make per track for the race pages. Where the
  // cutoff sits depends on the slot: a squarish corner only needs to turn the
  // extremes (Jeddah is 1:3, Montreal and Watkins Glen close behind), a wide
  // band turns everything portrait. CircuitMap grows its viewBox to the rotated
  // bounds, so nothing clips.
  const rotate = aspect < rotateBelow ? 90 : 0;
  if (rotate) aspect = 1 / aspect;
  const height = Math.sqrt(area / aspect);
  const width = aspect * height;
  const fit = Math.min(1, maxW / width, maxH / height);
  return { rotate, style: { width: Math.round(width * fit), height: Math.round(height * fit) } };
}

// The hero's off-season half: once the champion is crowned and the next season
// is announced, the celebration shares the hero with what comes next, instead
// of the only forward-looking thing on the page sitting far below the honours.
// Everything here comes from the teaser endpoint (name, game, opener track and
// date), so a season that is still private gives away nothing beyond what the
// admin chose to announce.
// `eyebrow`: the little label over the season name — "Next season" on the
// off-season hero, "New season" when the panel serves the season already
// running (same card, one word made honest).
function NextSeasonPanel({ teaser, discord, signupRace, eyebrow = "Next season" }) {
  // Same guard the "Coming up" strip uses: the car band stays hidden until the
  // file really loads, and a cached image can be complete before React attaches
  // its load listener, so the element is checked directly too.
  const [carOk, setCarOk] = useState(false);
  const carRef = useRef(null);
  const teasedNumber = teaser?.number;
  useEffect(() => {
    const el = carRef.current;
    if (el && el.complete && el.naturalWidth > 0) setCarOk(true);
  }, [teasedNumber]);

  if (!teaser) return null;
  const opener = teaser.firstRace;
  const carSrc = carFor(teaser);
  const openerFlag = opener?.track ? flagFor(opener.track) : null;
  const mark = opener?.track ? circuitMark(opener.track) : null;
  // Is the race the button leads to actually THIS season's opener? Matched on
  // the track, or on the same kickoff time for a season that runs the same
  // circuit twice.
  const sameTrack = (a, b) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
  const isOpenerSignup =
    !!signupRace &&
    (sameTrack(signupRace.track, opener?.track) ||
      (!!opener?.date && new Date(signupRace.date).getTime() === new Date(opener.date).getTime()));
  // "Season 8" reads fine; a season literally named "8" gets the prefix.
  const title = /^\d+$/.test(String(teaser.name).trim()) ? `Season ${teaser.name}` : teaser.name;

  return (
    <div className="flex shrink-0 flex-col justify-center lg:w-80">
      <div
        /* A touch more solid than the hero's other panels in light mode: the
           framed photo needs real white around it to read as a frame instead of
           the hero photo showing through the margin. */
        className="hero-anim overflow-hidden rounded-2xl border border-black/10 bg-white/85 shadow-xl shadow-ink/10 backdrop-blur-md dark:border-white/10 dark:bg-white/[0.08]"
        style={{ animationDelay: "0.3s" }}
      >
        {/* The new season's car. The Assetto Corsa showroom shots come on a
            black studio ground, and blend-screen only cuts that away over a
            dark surface, so the photo itself stays dark in both themes. Dark
            mode can therefore run it edge to edge like the "Coming up" strip
            does; light mode instead FRAMES it (white margin, hairline, caption),
            so it reads as a picture inside a white card rather than as a piece
            of the dark theme left in by accident.
            The shots put the car in the LOWER half of the frame, hence the low
            crop window. */}
        <div className={`px-3 pt-3 dark:px-0 dark:pt-0 ${carOk ? "" : "hidden"}`}>
          <div className="relative h-32 overflow-hidden rounded-xl bg-[#05070c] ring-1 ring-ink/10 sm:h-36 dark:rounded-none dark:ring-0">
            <div className="speed-hatch absolute inset-0 opacity-20" />
            {carSrc && (
              <img
                ref={carRef}
                src={carSrc}
                alt={`The ${title} car`}
                onLoad={() => setCarOk(true)}
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
                className="absolute inset-0 h-full w-full object-cover object-[center_82%] mix-blend-screen"
              />
            )}
          </div>
          {/* Caption only in light mode: in the dark card the band sits flush
              under the top edge and needs no label, the season name is right
              below it. */}
          <div className="pt-2 font-mono text-[10px] font-bold uppercase tracking-wider text-ink/45 dark:hidden">
            The {title} car
          </div>
        </div>

        <div className="p-5">
          {/* Season name and game, with the opener's circuit as a watermark
              beside them. The outline is centred on THIS block (not pinned to a
              corner of the card), so it reads as belonging to the name however
              tall the drawing turns out to be. */}
          <div className="relative">
            {/* The same outline the calendar and race pages use, drawing itself
                once (fx-lite and reduced motion stop that, see index.css).
                Faded with `opacity` rather than a translucent stroke colour,
                because the looping segment that follows the first lap carries
                its own colour and would otherwise be the loudest thing on the
                card. Sized per track by circuitMark, so a wide layout and a
                narrow one read as equally important. */}
            {mark && (
              <div
                className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-ink opacity-[0.12] dark:text-white dark:opacity-[0.16]"
                style={mark.style}
              >
                <CircuitMap
                  track={opener.track}
                  animate
                  rotate={mark.rotate}
                  className="h-full w-full"
                  stroke="currentColor"
                  strokeWidth={2}
                />
              </div>
            )}
            <div className="relative font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">
              {eyebrow}
            </div>
            <div className="relative mt-2.5 break-words font-display text-2xl font-black uppercase leading-none tracking-tight text-ink dark:text-white sm:text-3xl">
              {title}
            </div>
            {teaser.game && (
              <div className="relative mt-2 font-mono text-[10px] font-bold uppercase tracking-wider text-ink/55 dark:text-white/55">
                {seasonGameLabel(teaser)}
              </div>
            )}
          </div>

          <div>
            {opener?.track && (
              <div className="mt-3.5 flex items-center gap-2 border-t border-ink/10 pt-4 dark:border-white/10">
                {openerFlag && <Flag code={openerFlag.country} title={openerFlag.countryName} w={22} h={16} />}
                <span className="min-w-0 truncate font-mono text-[11px] font-bold uppercase tracking-wider text-ink/75 dark:text-white/75">
                  {opener.track}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-ink/40 dark:text-white/45">
                  Opener
                </span>
              </div>
            )}

            {opener?.date && (
              <>
                <RaceCountdown date={opener.date} className="mt-4" />
                <div className="mt-3 flex items-center justify-center gap-2 font-mono text-[11px] uppercase tracking-wider text-ink/65 dark:text-white/70">
                  <span className="font-bold text-ink/85 dark:text-white/85">{openerDayLabel(opener.date)}</span>
                  <span className="h-3 w-px bg-ink/20 dark:bg-white/25" />
                  <span>{fmtRaceTime(opener.date)}</span>
                </div>
              </>
            )}

            {/* Everyone who sees this card is signed in, and signed-in members
                are on the Discord already, so the button leads to the sign-up
                for the opener rather than to an invite. Discord stays as the
                fallback for as long as the race isn't in the events feed yet
                (a season still kept private), because then there is nothing to
                sign up for. */}
            {signupRace ? (
              <Link
                to={`/attendance?race=${signupRace.id}`}
                className="shine group mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-ink transition hover:brightness-105"
              >
                {/* The sign-up is for whatever race is actually next, which in
                    the off-season is this opener. A training race or a special
                    event slotted in before it would take that place, and then
                    calling it the opener would simply be wrong. */}
                {isOpenerSignup ? "Sign up for the opener" : "Sign up for the next race"}
                <span className="transition group-hover:translate-x-0.5">→</span>
              </Link>
            ) : discord ? (
              <a
                href={discord}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#5865F2] px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white shadow-lg shadow-[#5865F2]/30 transition hover:brightness-110"
              >
                Join for {title} <span aria-hidden="true">→</span>
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const { current: season, active, seasons, setSeason } = useSeason();
  const { user, isLoggedIn } = useAuth();
  const social = useSocial();
  const drivers = useApi(useCallback(() => api.driverStandings(), []));
  const t1 = useApi(useCallback(() => api.t1Standings(), []));
  const t2 = useApi(useCallback(() => api.t2Standings(), []));
  const races = useApi(useCallback(() => api.races(), []));
  const events = useApi(useCallback(() => api.events(), []));
  const [latest, setLatest] = useState(null);
  // Personal widgets: rank within the whole field vs. within the driver's tier.
  const [tierView, setTierView] = useState(false);

  // Hero motion: the photo drifts slowly on scroll; the primary CTA is magnetic.
  const heroImgRef = useParallax(0.08);
  const ctaRef = useMagnetic({ strength: 0.25 });

  // Championship rounds only (special events have no round number / aren't scored).
  const champRaces = (races.data || []).filter((r) => !r.isSpecialEvent && r.number != null);
  const completedRaces = champRaces.filter((r) => r.isCompleted);
  const lastRace = completedRaces[completedRaces.length - 1];
  const nextRace = champRaces.find((r) => !r.isCompleted);

  // Is the season being viewed an archived (past) one? Computed up here because
  // the hero needs it before the data-loading guard below.
  const isPast = !!season && !!active && season.number < active.number;
  // A live (not archived) season whose opener hasn't been run yet. Since
  // 2026-08-01 this state keeps the SAME pre-season page a future season shows
  // (coming-soon hero + the opener/rounds/grid tiles) instead of switching to
  // a champions-of-last-season hero the moment the season is activated — the
  // page only changes once the first result is actually in.
  const awaitingOpener = !isPast && !!races.data && completedRaces.length === 0;
  // A FUTURE season being viewed (higher number than the running one): it hasn't
  // started, so the hero shows a "Coming soon" card (with a reserved slot for a
  // future car reveal) instead of the previous champion.
  const isUpcomingSeason = !!season && !!active && season.number > active.number;
  // The LIVE season has run every round: the champion is crowned but the next
  // season isn't active yet (the off-season weeks). The hero switches to the
  // celebration + honours board, fed by /standings/honours.
  const seasonOver =
    !isPast && !isUpcomingSeason && champRaces.length > 0 && champRaces.every((r) => r.isCompleted);

  // The announced next season. Asked for right away, not once the season turns
  // out to be over: waiting made the hero paint its off-season layout twice,
  // first centred without the card and then shifted aside when the answer
  // arrived. One request either way, because the "Coming up" strip further down
  // is handed this same answer instead of fetching its own.
  const teaser = useApi(useCallback(() => api.seasonTeaser(), []));
  // Dev-only knobs for the off-season hero, same idea as ?demo=1 for the title
  // fight and just as absent from a build:
  //   ?opener=<days>       how the panel reads that many days out (6 = a
  //                        weekday, 1 = Tomorrow, 0 = Today, -1 = kickoff gone,
  //                        "<n>h" counts hours so -1h shows Lights Out)
  //   ?openerTrack=<name>  swaps the opener's circuit, to see the outline with a
  //                        wide, a tall or an odd-shaped track
  const devQuery = import.meta.env.DEV ? new URLSearchParams(window.location.search) : null;
  const openerShift = devQuery ? devQuery.get("opener") : null;
  const openerTrack = devQuery ? devQuery.get("openerTrack") : null;
  const teased =
    openerShift != null || openerTrack != null
      ? previewOpener(teaser.data, openerShift, openerTrack)
      : teaser.data;
  // The off-season weeks: champion crowned, next season announced but not yet
  // running. The hero then looks forward as well as back, and the "Coming up"
  // strip stands down so the countdown isn't on the page twice.
  const offSeason = seasonOver && !!teased;
  // The opener's own row in the events feed, so the card's button can lead
  // straight to its sign-up. Matched on the track name first, with the next
  // upcoming race as the fallback (which is what the opener is in the
  // off-season, and it keeps the button working under ?openerTrack=). Stays null
  // while the new season's races aren't in the feed yet, e.g. a season the admin
  // announced but is still keeping private: nothing to sign up for then.
  const upcomingEvents = events.data || [];
  const signupRace =
    upcomingEvents.find((e) => e.track === teased?.firstRace?.track) || upcomingEvents[0] || null;

  // Dev-only (?demo=1): preview the title-fight widget on a finished season.
  const demoFight = import.meta.env.DEV && new URLSearchParams(window.location.search).has("demo");

  // The three fetches below each carry an `alive` flag: switching season in the
  // picker restarts them, and without it a slow answer for the season the
  // visitor just left could land last and overwrite the newer one (podium and
  // honours from the wrong season), plus set state after unmount.
  useEffect(() => {
    let alive = true;
    if (lastRace?.id) api.raceResults(lastRace.id).then((d) => alive && setLatest(d)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [lastRace?.id]);

  // End-of-season honours — for the live finale AND archived seasons (the API
  // reads the selected season; awards without data simply stay away, so old
  // seasons show whatever can still be computed).
  const [honours, setHonours] = useState(null);
  useEffect(() => {
    let alive = true;
    if (seasonOver || isPast) {
      api
        .seasonHonours()
        .then((d) => alive && setHonours(d))
        .catch(() => alive && setHonours(null));
    } else {
      setHonours(null);
    }
    return () => {
      alive = false;
    };
  }, [seasonOver, isPast, season?.number]);

  // The announcement is part of this list ONLY while the season is over, which
  // is the one state where the hero's layout depends on it: with an announced
  // season the celebration shares the hero, without one it stands alone and
  // centred. Waiting the extra moment (the request runs in parallel with the
  // four above and is the smallest of them) means whichever of the two the
  // visitor gets is the one that paints, instead of one turning into the other
  // in front of them. A running season never waits for it, and an error is
  // treated as "nothing announced" rather than stalling the page.
  if (drivers.loading || t1.loading || t2.loading || races.loading || (seasonOver && teaser.loading))
    return (
      <div className="space-y-6 sm:space-y-12">
        <Skeleton className="h-[460px] w-full rounded-[1.75rem]" />
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
        <TableSkeleton rows={8} />
      </div>
    );

  // Without this the page rendered right through an API outage: every optional
  // chain resolved to nothing, so visitors got a hero with no names and empty
  // tables instead of being told something is wrong.
  //
  // Only the BACKBONE counts here (the driver table and the calendar). If just
  // one constructor table is unavailable the rest of the page is still worth
  // reading, and replacing all of it with an error box would be a step back
  // from what visitors saw before.
  const loadError = drivers.error || races.error;
  if (loadError)
    return (
      <div className="space-y-6">
        <ErrorBox message={loadError} />
      </div>
    );

  const leader = drivers.data?.standings?.[0];
  const podium = (latest?.results || [])
    .filter((r) => r.position != null)
    .sort((a, b) => a.position - b.position)
    .slice(0, 3);
  // What the round actually paid the top three, for the hero strip: the points
  // and the honours that go with them. Same rules the results table applies, so
  // the hero and the round page can never disagree — the admin-recorded fastest
  // lap wins over the one derived from the stored lap times, and a session that
  // scores nothing (training, special event) shows no points column at all.
  const latestRace = latest?.race || null;
  const latestScores = (latestRace?.type || "CHAMPIONSHIP") === "CHAMPIONSHIP";
  const latestLapRows = (latest?.results || []).filter((r) => isLapTime(r.bestLapMs));
  const latestFastestMs = latestLapRows.length
    ? Math.min(...latestLapRows.map((r) => r.bestLapMs))
    : null;
  const flDriverId =
    latestRace?.fastestLapDriverId ||
    (latestFastestMs != null
      ? latestLapRows.find((r) => r.bestLapMs === latestFastestMs)?.driverId
      : null) ||
    null;
  const dotdDriverId = latestRace?.driverOfTheDay?.driverId || null;
  // The round's honours, in the wording and colours the results table already
  // uses. Only these two: a third marker (pole) pushed the driver's name into
  // an ellipsis on a narrow phone, and these are the ones actually won in the
  // race.
  const podiumHonours = (p) =>
    [
      p.driverId === flDriverId && {
        key: "fl",
        label: "FL",
        title: "Fastest lap of the race",
        cls: "bg-fl/15 text-fl",
      },
      p.driverId === dotdDriverId && {
        key: "dotd",
        label: "DOTD",
        title: "Driver of the Day",
        cls: "bg-brand/20 text-brand",
      },
    ].filter(Boolean);
  const anyPodiumHonours = podium.some((p) => podiumHonours(p).length > 0);
  const nextDate = nextRace?.date ? new Date(nextRace.date) : null;
  const roundNo = lastRace?.number ?? completedRaces.length;
  const lastCircuit = flagFor(lastRace?.track, lastRace?.country);
  const nextCircuit = flagFor(nextRace?.track, nextRace?.country);
  // The next round's outline. Same drawing and sizing rule as the off-season
  // card's opener, but this card is narrower and its name fills the width, so
  // the outline gets a band of its own instead of lying behind the letters
  // (where it read as a scratch across the track name rather than a mark).
  // rotateBelow 1: every portrait circuit (Spa, Silverstone, Interlagos, Abu
  // Dhabi …) lies down for this band. It is wide and short, so upright they
  // came out as thin slivers next to a landscape track's full-width drawing —
  // turned, they all fill it about equally and the band keeps one height.
  const nextMark = nextRace?.track
    ? circuitMark(nextRace.track, { area: 14000, maxW: 236, maxH: 92, rotateBelow: 1 })
    : null;
  const completedNumbers = completedRaces.map((r) => r.number).sort((a, b) => a - b);
  // Championship rounds in this season (excludes non-scoring special events).
  const totalRounds = (races.data || []).filter((r) => !r.isSpecialEvent && r.number != null).length;

  // Season "by the numbers" band.
  const standings = drivers.data?.standings || [];
  const driverCount = standings.length;
  const constructorCount = (t1.data?.standings?.length || 0) + (t2.data?.standings?.length || 0);
  // Single-class seasons (archived S1–S5) have no Tier 2: collapse the split.
  const hasT2 = (t2.data?.standings?.length || 0) > 0;
  const runnerUp = standings[1];
  const titleGap = leader && runnerUp ? leader.total - runnerUp.total : 0;

  // Past (archive) seasons get a results-only Home: no personal tiles, no
  // "next race" / "coming up next season" widgets, and the hero celebrates the
  // champion instead of a (non-existent) upcoming race. The ACTIVE season keeps
  // the full live experience; a not-yet-active future season also stays "live"
  // (it just shows empty states until it starts).
  const champ = standings[0] || null; // season champion (archive + finale hero)
  const heroPodium =
    isPast || seasonOver
      ? standings.slice(0, 3).map((d, i) => ({ driverId: d.driverId, position: i + 1, name: d.name, country: d.country, team: d.team, total: d.total, photoUrl: d.photoUrl }))
      : podium;

  // The "Coming soon" hero (season name, countdown to the opener, Join Discord)
  // covers every season that hasn't run its opener yet: a future season being
  // previewed AND the active season before round one. The page a season was
  // announced with is the page it keeps until it produces its first result —
  // it used to jump to a champions-of-last-season hero on activation, which
  // read as if something had happened when nothing had.
  const showComingSoonHero = isUpcomingSeason || awaitingOpener;
  // The running season's own opener panel (right half of that hero): the same
  // card the off-season teaser uses, fed from the season itself — the teaser
  // endpoint only ever announces a season AHEAD of the active one, so it goes
  // silent the moment the admin flips the switch, which is exactly when this
  // takes over.
  const openerAwaited = awaitingOpener && !isUpcomingSeason;
  const openerPanel =
    openerAwaited && season
      ? {
          number: season.number,
          name: season.name,
          game: season.game,
          carImageUrl: season.carImageUrl,
          firstRace: nextRace ? { track: nextRace.track, date: nextRace.date } : null,
        }
      : null;
  const comingSoonCopy = isUpcomingSeason
    ? {
        eyebrow: "Coming soon",
        blurb:
          "The next NABS season is taking shape. Teams, cars and the calendar are being prepared right now. Jump into the Discord to be there from round one.",
      }
    : {
        eyebrow: "Season opener soon",
        blurb:
          "This season just got underway. Teams and drivers are locking in their seats, and the grid comes together on Discord. Jump in to be there from round one.",
      };

  // Personal "by the numbers" — shown to a logged-in driver who appears in the
  // SELECTED season: by their linked id in the active season, else by name /
  // discord in an archive season they raced in. If they didn't drive this season
  // (no match), the general season-wide tiles show instead. myDriverId then points
  // at THAT season's row id, so every link/stat below targets the right season.
  const norm = (v) => (v || "").trim().toLowerCase();
  const myRow = isLoggedIn
    ? standings.find(
        (s) =>
          (user?.driverId && s.driverId === user.driverId) ||
          (user?.driverName && norm(s.name) === norm(user.driverName)) ||
          (user?.discordName && norm(s.discordName) === norm(user.discordName))
      ) || null
    : null;
  const myDriverId = myRow?.driverId || (isLoggedIn ? user?.driverId : null);
  const myRounds = myRow ? Object.values(myRow.perRace || {}) : [];
  const myFinishes = myRounds.filter((r) => r.status === "FINISHED" && r.position != null);
  const myStarts = myRounds.filter((r) => r.status !== "DNS").length;
  const myWins = myFinishes.filter((r) => r.position === 1).length;
  const myPodiums = myFinishes.filter((r) => r.position <= 3).length;
  const myAvg = myFinishes.length
    ? Math.round((myFinishes.reduce((a, r) => a + r.position, 0) / myFinishes.length) * 10) / 10
    : null;
  // The driver's own constructor (Tier 1/2) standing — powers the Team tile.
  const myTeam = myRow
    ? [...(t1.data?.standings || []), ...(t2.data?.standings || [])].find((t) => t.teamId === myRow.team.id)
    : null;
  // Ranking within the driver's own tier (standings are already total-sorted),
  // so a Tier 2 driver can see where they sit among Tier 2 rather than overall.
  const myTier = myRow?.team?.tier ?? null;
  const tierRows = myTier ? standings.filter((s) => s.team.tier === myTier) : [];
  const myTierPos = myRow ? tierRows.findIndex((s) => s.driverId === myDriverId) + 1 : 0;
  // The Overall ⇄ Tier toggle only earns its place for Tier 2 drivers: their
  // tier rank differs meaningfully from their overall rank. A Tier 1 driver's
  // overall and Tier 1 positions are effectively the same view, so we hide it
  // and always show the championship (overall) numbers for them.
  const showTierToggle = !!myRow && myTier === 2 && tierRows.length > 1;
  const useTier = tierView && showTierToggle;

  // Tier-relative form: rank the driver among only their own tier's finishers in
  // each round, so a Tier 2 driver can see the wins / podiums / average finish
  // they'd have if the championship were scored within Tier 2 alone. (A "win"
  // here means being the best-placed Tier 2 car that round.)
  const tierRankInRound = (roundNum) => {
    const mine = myRow?.perRace?.[roundNum];
    if (!mine || mine.status !== "FINISHED" || mine.position == null) return null;
    let rank = 1;
    for (const row of tierRows) {
      if (row.driverId === myDriverId) continue;
      const r = row.perRace?.[roundNum];
      if (r && r.status === "FINISHED" && r.position != null && r.position < mine.position) rank++;
    }
    return rank;
  };
  const myTierRanks = myRow
    ? Object.keys(myRow.perRace || {}).map(tierRankInRound).filter((r) => r != null)
    : [];
  const myTierWins = myTierRanks.filter((r) => r === 1).length;
  const myTierPodiums = myTierRanks.filter((r) => r <= 3).length;
  const myTierAvg = myTierRanks.length
    ? Math.round((myTierRanks.reduce((a, r) => a + r, 0) / myTierRanks.length) * 10) / 10
    : null;

  const nextEv = events.data?.[0];
  const myStatus = nextEv
    ? ["ACCEPTED", "TENTATIVE", "DECLINED"].find((s) => nextEv.rsvps[s].some((r) => r.driverId === myDriverId))
    : null;
  const STATUS_WORD = { ACCEPTED: "Signed up", TENTATIVE: "Tentative", DECLINED: "Declined" };
  const nextStatusWord = events.loading ? "…" : myStatus ? STATUS_WORD[myStatus] : nextEv ? "Not responded" : NO_VALUE;

  // The logged-in driver's best finish of the season — takes the middle tile
  // once the season is over (there is no race left to sign up for).
  let myBestFinish = null;
  if (seasonOver && myRow) {
    for (const [num, v] of Object.entries(myRow.perRace || {})) {
      if (v.status === "FINISHED" && v.position != null && (!myBestFinish || v.position < myBestFinish.position)) {
        myBestFinish = { position: v.position, round: Number(num) };
      }
    }
    if (myBestFinish) {
      myBestFinish.track = champRaces.find((r) => r.number === myBestFinish.round)?.track || null;
    }
  }

  return (
    <div className="content-in space-y-10 sm:space-y-16">
      {/* ===================== SEASON TICKER ===================== */}
      <div className="-mt-2 space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[13px] font-semibold uppercase tracking-[0.2em] text-light">
          <SeasonPicker finished={seasonOver} />
          {season?.game && (
            <>
              <span className="hidden h-3 w-px bg-border sm:inline-block" />
              <span className="hidden sm:inline">{seasonGameLabel(season)}</span>
            </>
          )}
          <span className="hidden h-3 w-px bg-border sm:inline-block" />
          {isPast ? (
            <span className="text-medium">{totalRounds ? `${totalRounds} rounds` : "Final standings"}</span>
          ) : (
            <span className="text-medium">
              Round {pad2(roundNo)} <span className="text-faint">/ {totalRounds || NO_VALUE}</span>
            </span>
          )}
        </div>
      </div>

      {/* ===================== LEAD FEATURE ===================== */}
      {/* `reveal` (without an inline delay) makes the hero the first stop of the
          top-to-bottom page build; the hero-anim children then stagger inside. */}
      {/* The hero follows the site theme: dark mode keeps the classic dark
          card, light mode gets a proper WHITE version — white scrims over the
          photo and ink text (the inner elements carry light+dark variants). */}
      <section className="reveal relative overflow-hidden rounded-[1.75rem] bg-white shadow-xl shadow-ink/20 ring-1 ring-black/10 dark:bg-ink dark:ring-white/10">
        <img
          ref={heroImgRef}
          key={heroFor(season)}
          src={heroFor(season)}
          alt=""
          onError={heroOnError}
          // Same as the landing page's hero: exactly the size of the card, and
          // the scroll drift moves the crop rather than the picture. Nothing
          // hangs over the rounded corners, so nothing can be drawn past them.
          className="absolute inset-0 h-full w-full object-cover object-center"
        />
        {/* Backdrop scrim — white in light mode, dark in dark mode. The archive
            scrim reaches further across so the centred podium sits on solid
            ground. The light scrim runs slightly stronger: ink text needs more
            ground on a photo than white text does. */}
        <div
          className={`absolute inset-0 bg-gradient-to-tr ${
            isPast
              ? "from-white via-white/85 to-white/15 dark:from-ink dark:via-ink/80 dark:to-ink/10"
              : "from-white via-white/80 to-white/5 dark:from-ink dark:via-ink/75 dark:to-ink/0"
          }`}
        />
        <div
          className={`absolute inset-0 bg-gradient-to-t from-white/95 to-transparent dark:from-ink/95 ${
            isPast ? "via-white/25 dark:via-ink/20" : "via-transparent"
          }`}
        />
        <div
          className="hero-hatch absolute inset-y-0 right-0 w-[18%]"
          style={{
            WebkitMaskImage: "linear-gradient(to left, #000 35%, transparent 100%)",
            maskImage: "linear-gradient(to left, #000 35%, transparent 100%)",
          }}
        />

        <div className="relative flex min-h-[460px] flex-col gap-8 p-7 sm:p-12 lg:flex-row lg:gap-10">
          {seasonOver || isPast ? (
            /* SEASON COMPLETE — one hero for every finished season, live finale
               and archive alike: the "<season> complete" line over the final
               podium, with the honours band right below. The game name stays
               out of here on purpose; it already sits in the ticker line next
               to the season switcher. The live finale hands back to the normal
               hero when the next season starts.
               In the off-season it shares the hero with the next season's panel
               (see NextSeasonPanel); an archive season never does, there is
               nothing upcoming about a season from two years ago. */
            <>
            <div className="flex flex-1 flex-col justify-center gap-7">
              {/* Title card, matching the other hero variants exactly: the same
                  eyebrow row (mono, accent colour, hairlines) and the same big
                  display headline. Gold stays reserved for the champion. */}
              <div className="hero-anim text-center" style={{ animationDelay: "0.05s" }}>
                <div className="flex items-center justify-center gap-3 font-mono text-[13px] font-bold uppercase tracking-[0.2em] text-eyebrow">
                  <span className="h-px w-10 bg-accent/50" />
                  <span>Championship complete</span>
                  <span className="h-px w-10 bg-accent/50" />
                </div>
                <div className="mt-4 font-display text-5xl font-black uppercase leading-[0.92] tracking-tight text-ink dark:text-white sm:text-7xl">
                  {season?.name}
                </div>
              </div>
              {/* No hero-anim wrapper here: the podium columns stagger their
                  own entrances (P3 → P2 → champion, see .podium-col). */}
              <Podium entries={heroPodium} />
              <div className="hero-anim flex flex-wrap justify-center gap-3" style={{ animationDelay: "0.34s" }}>
                <Link
                  to="/drivers"
                  className="shine group inline-flex items-center gap-2 rounded-lg bg-brand px-6 py-3 text-sm font-bold uppercase tracking-wide text-ink shadow-lg shadow-brand/30 transition hover:brightness-105"
                >
                  Final Standings
                  <span className="transition group-hover:translate-x-0.5">→</span>
                </Link>
                <Link
                  to="/constructors"
                  className="inline-flex items-center rounded-lg border border-ink/15 bg-ink/[0.03] px-6 py-3 text-sm font-bold uppercase tracking-wide text-ink backdrop-blur-sm transition hover:bg-ink/[0.06] dark:border-white/20 dark:bg-white/5 dark:text-white dark:hover:bg-white/15"
                >
                  Constructors
                </Link>
              </div>
            </div>
            {/* Off-season with an announced season: the celebration shares the
                hero. Without one (nothing announced yet, or the announcement
                pulled again) this is simply absent and the hero is the plain
                champion layout it has always been, centred and full width. The
                page waits for the answer before painting, so neither state is
                ever built twice on screen. */}
            {offSeason && (
              <NextSeasonPanel teaser={teased} discord={social.data?.discord} signupRace={signupRace} />
            )}
            </>
          ) : showComingSoonHero ? (
            /* COMING SOON — a future season previewed before it has started, OR
               an already-active season waiting for its very first round with no
               previous season to fall back to (a brand-new series' opener). No
               champion/last-season content; a reserved slot holds the eventual
               3D car reveal (a real model mounts there later). */
            <div className="flex flex-1 flex-col justify-center gap-7 lg:flex-row lg:items-center lg:gap-10">
              <div className="flex flex-1 flex-col gap-5">
                <div className="hero-anim flex items-center gap-2.5 font-mono text-[13px] font-bold uppercase tracking-[0.2em] text-eyebrow" style={{ animationDelay: "0.05s" }}>
                  <span className="live-dot inline-block h-2 w-2 rounded-full bg-brand" />
                  {comingSoonCopy.eyebrow}
                </div>
                <h1 className="hero-anim font-display text-4xl font-black uppercase leading-[0.95] tracking-tight text-ink dark:text-white sm:text-6xl" style={{ animationDelay: "0.12s" }}>
                  {season?.name}
                </h1>
                {season?.game && (
                  <div className="hero-anim font-mono text-[13px] font-bold uppercase tracking-wider text-ink/60 dark:text-white/60" style={{ animationDelay: "0.16s" }}>
                    {seasonGameLabel(season)}
                  </div>
                )}
                <p className="hero-anim max-w-lg text-base leading-relaxed text-ink/75 dark:text-white/75" style={{ animationDelay: "0.2s" }}>
                  {comingSoonCopy.blurb}
                </p>
                {/* Big countdown to the opener — the same broadcast clock the
                    next-race panel uses, so race day reads the same site-wide.
                    Once the season is ACTIVE the opener panel on the right
                    carries this clock, so it stands down here rather than
                    ticking twice in one hero. */}
                {nextRace?.date && !openerAwaited && (
                  <div className="hero-anim max-w-md" style={{ animationDelay: "0.26s" }}>
                    <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink/55 dark:text-white/55">
                      Season opener · Round {nextRace.number}{nextRace.track ? ` · ${nextRace.track}` : ""}
                    </div>
                    <RaceCountdown date={nextRace.date} className="mt-3" />
                    <div className="mt-3 flex items-center justify-center gap-2 font-mono text-[11px] uppercase tracking-wider text-ink/60 dark:text-white/60">
                      <span className="font-bold text-ink/85 dark:text-white/85">
                        {fmtRaceDate(nextRace.date)}
                      </span>
                      <span className="h-3 w-px bg-ink/25 dark:bg-white/25" />
                      <span>{fmtRaceTime(nextRace.date)}</span>
                    </div>
                  </div>
                )}
                {social.data?.discord && (
                  <div className="hero-anim flex flex-wrap items-center gap-3" style={{ animationDelay: "0.3s" }}>
                    <a href={social.data.discord} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-2 rounded-xl bg-[#5865F2] px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white shadow-lg shadow-[#5865F2]/30 transition hover:brightness-110">
                      Join the Discord <span aria-hidden="true">→</span>
                    </a>
                  </div>
                )}
              </div>
              {/* Right half: previewing a FUTURE season shows the plain car
                  reveal, as before. The ACTIVE season awaiting its opener gets
                  the full opener card instead — the same one the off-season
                  teaser shows (car on top, opener + flag, countdown, sign-up) —
                  so activating the season keeps the page's promise until the
                  first result replaces it. */}
              {openerAwaited ? (
                <NextSeasonPanel
                  teaser={openerPanel}
                  discord={social.data?.discord}
                  signupRace={signupRace}
                  eyebrow="New season"
                />
              ) : (
                <CarReveal season={season} />
              )}
            </div>
          ) : (
          <>
          {/* LEFT — the latest race. Before the opener the hero is the
              coming-soon variant above, so this side always has a result. */}
          <div className="flex flex-1 flex-col justify-end">
            <div className="hero-anim flex items-center gap-3 font-mono text-[13px] font-bold uppercase tracking-[0.2em] text-eyebrow" style={{ animationDelay: "0.05s" }}>
              {lastCircuit && <Flag code={lastCircuit.country} title={lastCircuit.countryName} w={26} h={19} />}
              <span>Latest Race</span>
              <span className="h-px w-10 bg-accent/50" />
              <span className="text-ink/40 dark:text-white/50">Round {roundNo}</span>
            </div>

            {/* The size follows the width on phones instead of sitting at a
                fixed 48px. At 48px a ten-letter circuit needs 359px and the
                column is 324px wide on a 412px phone, so `break-words` did what
                it is there to do and split the word: HOCKENHEI / M. The longest
                single word in the calendar is "Silverstone"; 9.5vw keeps that
                whole down to a 360px screen, with room to spare, and the clamp
                stops it shrinking on a narrow one or growing past the old size
                on a wide one. break-words stays as the last resort for a name
                nobody has raced yet. */}
            <h1 className="hero-anim mt-4 max-w-3xl break-words font-display text-[clamp(1.75rem,9.5vw,3rem)] font-black uppercase leading-[0.92] tracking-tight text-ink dark:text-white sm:text-7xl" style={{ animationDelay: "0.12s" }}>
              {lastRace?.track || "Season opener"}
            </h1>
            <p className="hero-anim mt-3 font-mono text-[13px] uppercase tracking-wider text-ink/70 dark:text-white/65" style={{ animationDelay: "0.2s" }}>
              {`${lastCircuit && lastCircuit.circuit?.toLowerCase() !== lastRace?.track?.toLowerCase() ? `${lastCircuit.circuit} · ` : ""}${fmtFull(lastRace?.date)}`}
            </p>

            {/* podium strip — latest-race top 3 */}
            {heroPodium.length > 0 && (
              <div className="mt-8 grid max-w-2xl gap-2 sm:grid-cols-3">
                {heroPodium.map((p, i) => (
                  <Link
                    key={p.driverId}
                    to={`/drivers/${p.driverId}`}
                    // Each card rises on its own beat (P1 first), instead of the
                    // whole strip fading in as one block.
                    style={{ animationDelay: `${0.26 + i * 0.14}s` }}
                    className="hero-anim shine group relative flex items-center gap-3 overflow-hidden rounded-xl border border-black/10 bg-white/70 px-4 py-3 backdrop-blur-md transition hover:-translate-y-0.5 hover:border-brand/50 hover:bg-white/90 dark:border-white/10 dark:bg-white/[0.07] dark:hover:bg-white/[0.12]"
                  >
                    <span
                      className="absolute left-0 top-0 h-full w-1"
                      style={{ backgroundColor: MEDAL[i] }}
                    />
                    {/* faint medal tint bleeding in from the rank bar */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0"
                      style={{ background: `linear-gradient(90deg, ${MEDAL[i]}26, transparent 55%)` }}
                    />
                    <span
                      className="font-display text-2xl font-black tabular-nums"
                      style={{ color: MEDAL[i] }}
                    >
                      P{p.position}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-base font-bold leading-tight text-ink transition group-hover:text-brand dark:text-white">
                        <span className="truncate">{p.name}</span>
                        <Flag code={countryFor(p.driverId, p.country)} w={16} h={12} />
                      </span>
                      {p.isSub && p.subForTeam ? (
                        <TeamLogo
                          id={p.subForTeam.id}
                          name={`${p.subForTeam.name} (sub)`}
                          color={p.subForTeam.color}
                          logoUrl={p.subForTeam.logoUrl}
                          size={16}
                          showName
                          className="mt-0.5"
                          nameClassName="truncate text-[13px] leading-tight text-ink/55 dark:text-white/60"
                        />
                      ) : (
                        <TeamLogo
                          id={p.team.id}
                          name={p.team.name}
                          color={p.team.color}
                          logoUrl={p.team.logoUrl}
                          size={16}
                          showName
                          className="mt-0.5"
                          nameClassName="truncate text-[13px] leading-tight text-ink/55 dark:text-white/60"
                        />
                      )}
                    </span>
                    {/* What the round paid the driver: the points, with the
                        honours won that day above them. PHONES ONLY. There the
                        card runs the full width of the page and the right half
                        sits empty; from sm up the same three cards share one
                        row, which leaves each about 220px, and anything added
                        on the right cut the driver's name down to an ellipsis.
                        The round page carries all of it in full either way. */}
                    <span className="ml-auto flex shrink-0 flex-col items-end gap-1 pl-1 text-right sm:hidden">
                      {/* The row is reserved for all three as soon as ONE of
                          them earned something, so the cards keep a common
                          height and the points sit on one line down the strip
                          instead of stepping up and down. */}
                      {anyPodiumHonours && (
                        <span className="flex min-h-[1rem] items-center gap-1">
                          {podiumHonours(p).map((h) => (
                            <span
                              key={h.key}
                              title={h.title}
                              className={`rounded-full px-1 py-px font-mono text-[10px] font-bold uppercase leading-[1.4] ${h.cls}`}
                            >
                              {h.label}
                            </span>
                          ))}
                        </span>
                      )}
                      {latestScores && p.points != null && (
                        <span className="flex items-baseline gap-1">
                          <span className="font-display text-xl font-black tabular-nums text-ink dark:text-white">
                            {p.points}
                          </span>
                          <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-ink/45 dark:text-white/50">
                            pts
                          </span>
                        </span>
                      )}
                    </span>
                  </Link>
                ))}
              </div>
            )}

            <div className="hero-anim mt-9 flex flex-wrap gap-3" style={{ animationDelay: "0.36s" }}>
              <Link
                ref={ctaRef}
                to="/races"
                className="shine group inline-flex items-center gap-2 rounded-lg bg-brand px-6 py-3 text-sm font-bold uppercase tracking-wide text-ink shadow-lg shadow-brand/30 transition hover:brightness-105"
              >
                Full Results
                <span className="transition group-hover:translate-x-0.5">→</span>
              </Link>
              <Link
                to="/drivers"
                className="inline-flex items-center rounded-lg border border-ink/15 bg-ink/[0.03] px-6 py-3 text-sm font-bold uppercase tracking-wide text-ink backdrop-blur-sm transition hover:bg-ink/[0.06] dark:border-white/20 dark:bg-white/5 dark:text-white dark:hover:bg-white/15"
              >
                Standings
              </Link>
            </div>
          </div>

          {/* RIGHT — next race panel */}
          {nextRace && (
            <div className="flex shrink-0 flex-col justify-end lg:w-72">
              <div className="hero-anim rounded-2xl border border-black/10 bg-white/75 p-5 shadow-xl shadow-ink/10 backdrop-blur-md dark:border-white/10 dark:bg-white/[0.08]" style={{ animationDelay: "0.22s" }}>
                <div className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-sky-600 dark:text-sky-300">
                  {nextCircuit && <Flag code={nextCircuit.country} title={nextCircuit.countryName} w={22} h={16} />}
                  <span>Next Race</span>
                  <span className="ml-auto text-ink/40 dark:text-white/50">Round {nextRace.number}</span>
                </div>

                {/* The circuit gets a band of its own between the label and the
                    name: the card grows by exactly the drawing's height, and the
                    outline never has to share space with the letters. Centred
                    and near full width, because every other block in this card
                    (name, countdown, button) runs the full width too — pinned to
                    one side it left half the band empty. Same outline, colours
                    and draw-on the off-season card uses. */}
                {nextMark && (
                  <div className="mt-4 flex justify-center" aria-hidden="true">
                    <div
                      className="pointer-events-none text-ink opacity-[0.16] dark:text-white dark:opacity-[0.22]"
                      style={nextMark.style}
                    >
                      <CircuitMap
                        track={nextRace.track}
                        animate
                        rotate={nextMark.rotate}
                        className="h-full w-full"
                        stroke="currentColor"
                        strokeWidth={2}
                      />
                    </div>
                  </div>
                )}

                <div className="mt-4 break-words font-display text-2xl font-black uppercase leading-[1.05] tracking-tight text-ink dark:text-white sm:text-3xl">
                  {nextRace.track}
                </div>
                {/* skip the circuit line when it just repeats the race name
                    (e.g. race "Interlagos" at circuit "Interlagos") */}
                {nextCircuit && nextCircuit.circuit?.toLowerCase() !== nextRace.track?.toLowerCase() && (
                  <div className="mt-2 font-mono text-[11px] uppercase tracking-wider text-ink/60 dark:text-white/65">
                    {nextCircuit.circuit}
                  </div>
                )}

                <RaceCountdown date={nextRace.date} className="mt-5" />

                {nextDate && (
                  <div className="mt-3 flex items-center justify-center gap-2 font-mono text-[11px] uppercase tracking-wider text-ink/65 dark:text-white/70">
                    <span className="font-bold text-ink/80 dark:text-white/85">
                      {nextDate.getDate()} {MONTHS[nextDate.getMonth()]}
                    </span>
                    <span className="h-3 w-px bg-ink/20 dark:bg-white/25" />
                    <span>{fmtRaceTime(nextRace.date)}</span>
                  </div>
                )}

                <Link
                  to={`/attendance?race=${nextRace.id}`}
                  className="shine group mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-ink transition hover:brightness-105"
                >
                  Sign Up
                  <span className="transition group-hover:translate-x-0.5">→</span>
                </Link>
              </div>
            </div>
          )}
          </>
          )}
        </div>
      </section>

      {/* ===================== TITLE FIGHT (running seasons) ================= */}
      {/* Dev-only preview (?demo=1, like the live demo): shows the widget on a
          finished season by pretending the last two rounds are still to come. */}
      {(demoFight || (!isPast && !seasonOver && !showComingSoonHero)) && (
        <TitleFight
          standings={standings}
          raceNumbers={drivers.data?.raceNumbers || []}
          dropWorst={drivers.data?.dropWorst ?? 0}
          // P1's score from this season's points table (admin-editable); the
          // widget falls back to the best observed round when none is stored.
          tableMax={Array.isArray(season?.pointsTable) ? season.pointsTable[0] : 0}
          totalRounds={totalRounds}
          // Demo rewinds the last two rounds, so gaps/totals/aliveness are all
          // computed as of that earlier point in the season.
          completedNumbers={demoFight ? completedNumbers.slice(0, -2) : completedNumbers}
        />
      )}

      {/* ===================== SEASON HONOURS (finished seasons) ============= */}
      {/* The awards of a completed season — the live finale and every archived
          season alike — in the site's quiet hairline-grid language. Awards an
          old season has no data for simply don't get a cell. */}
      {(seasonOver || isPast) && honours && (() => {
        // Build the award cells first, so the grid can close its last row
        // cleanly no matter how many awards this season has (no half-framed
        // holes). Fastest lap is deliberately not an honour here.
        // Each award hands its headline figure to the cell as `stat` (big, on
        // the right) plus a small `note` explaining it — new awards just follow
        // the same two-field pattern and land in the layout automatically.
        const cells = [];
        // (No 2nd-place cell on purpose: the podium above already shows P2,
        // and without it the usual award set closes a clean 2×3 grid.)
        for (const t of honours.teamChampions || []) {
          cells.push({
            key: `team${t.tier}`,
            // Single-class seasons have exactly one champion team — a "Tier 1"
            // prefix would imply a Tier 2 that never existed.
            label: (honours.teamChampions?.length || 0) > 1 ? `Tier ${t.tier} team champions` : "Team champions",
            to: `/teams/${t.teamId}`,
            name: t.name,
            stat: t.points,
            note: "points",
            team: { id: t.teamId, name: t.name, color: t.color, logoUrl: t.logoUrl },
          });
        }
        if (honours.bestNewcomer) {
          cells.push({
            key: "newcomer",
            label: "Best newcomer",
            to: `/drivers/${honours.bestNewcomer.driverId}`,
            name: honours.bestNewcomer.name,
            stat: honours.bestNewcomer.position ? `P${honours.bestNewcomer.position}` : honours.bestNewcomer.points,
            note: honours.bestNewcomer.position ? "in their first season" : "points",
            driverId: honours.bestNewcomer.driverId,
            country: honours.bestNewcomer.country,
            team: honours.bestNewcomer.team,
          });
        }
        if (honours.mostOvertakes) {
          cells.push({
            key: "overtakes",
            label: "Most overtakes",
            to: `/drivers/${honours.mostOvertakes.driverId}`,
            name: honours.mostOvertakes.name,
            stat: honours.mostOvertakes.count,
            note: "on-track passes",
            driverId: honours.mostOvertakes.driverId,
            country: honours.mostOvertakes.country,
            team: honours.mostOvertakes.team,
          });
        }
        if (honours.mostLapsLed) {
          cells.push({
            key: "lapsLed",
            label: "Most laps led",
            to: `/drivers/${honours.mostLapsLed.driverId}`,
            name: honours.mostLapsLed.name,
            stat: honours.mostLapsLed.count,
            note: "laps out front",
            driverId: honours.mostLapsLed.driverId,
            country: honours.mostLapsLed.country,
            team: honours.mostLapsLed.team,
          });
        }
        if (honours.cleanest) {
          cells.push({
            key: "cleanest",
            label: "Cleanest driver",
            to: `/drivers/${honours.cleanest.driverId}`,
            name: honours.cleanest.name,
            stat: honours.cleanest.contacts,
            note: `contacts in ${honours.cleanest.starts} starts`,
            driverId: honours.cleanest.driverId,
            country: honours.cleanest.country,
            team: honours.cleanest.team,
          });
        }
        if (!cells.length) return null;
        // Phones run one cell per row (never a hole to close); from sm: on the
        // LAST cell stretches over whatever is left of its 3-wide row.
        const lastClass = { 0: "", 1: "sm:col-span-3", 2: "sm:col-span-2" }[cells.length % 3];
        return (
          <section className="reveal space-y-5">
            <h3 className="section-title">Season honours</h3>
            {/* cascade: the award cells deal in one after another on reveal */}
            <div className="cascade grid grid-cols-1 overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-3">
              {cells.map(({ key, ...c }, i) => (
                <HonourCell key={key} {...c} index={i} className={i === cells.length - 1 ? lastClass : ""} />
              ))}
            </div>
          </section>
        );
      })()}

      {/* ===================== BY THE NUMBERS (personal when linked) ========= */}
      {/* Archive seasons show only the general season stats — no personal band.
          A season that hasn't STARTED yet (not-yet-active future season, or an
          already-active one still waiting for round one with no previous
          season to fall back to) has no leader or title gap to show, so it
          gets its own pre-season band: the opener, the calendar and how the
          grid is filling up — same condition as the hero above. */}
      {showComingSoonHero ? (
        <section className="cascade grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <NumberTile
            index={0}
            compact
            to="/races"
            label="Season Opener"
            value={nextRace?.track || "TBA"}
            sub={
              nextRace?.date
                ? fmtRaceDate(nextRace.date)
                : "date TBA"
            }
            icon="calendar"
            accent="#0ea5e9"
            mark={
              nextRace && circuitFor(nextRace.track) ? (
                <CircuitMap track={nextRace.track} className="h-full w-full" align="xMaxYMax" stroke="currentColor" strokeWidth={2} />
              ) : undefined
            }
          />
          <NumberTile
            index={1}
            to="/races"
            label="Rounds Planned"
            value={totalRounds || NO_VALUE}
            sub="on the calendar"
            icon="flag"
            accent="#7c3aed"
          />
          <NumberTile index={2} to="/drivers" label="Drivers" value={driverCount} sub="on the entry list" icon="users" accent="#0d9488" />
          {/* same trick as the other bands: the last two tiles stretch so 5
              tiles close the 2- and 3-column rows without a hole */}
          <NumberTile
            index={3}
            to="/constructors"
            label="Constructors"
            value={constructorCount}
            sub="teams entered"
            icon="shield"
            accent="#d97706"
            className="sm:col-span-2 lg:col-span-1"
          />
          <NumberTile
            index={4}
            to="/attendance"
            label="Sign-Ups"
            value={nextEv ? nextEv.rsvps.ACCEPTED.length : NO_VALUE}
            sub="for the opener"
            icon="trend"
            accent="#e11d48"
            className="col-span-2 sm:col-span-1"
          />
        </section>
      ) : (
        <div className="space-y-8">
          {/* One numbers band, not two: a linked driver gets their PERSONAL
              band (the hero + Season Honours already tell the season's story),
              everyone else the season-wide numbers. Two near-identical 5-tile
              rows stacked on top of each other read as clutter. */}
          {!(!isPast && myRow) && (
          <div className="space-y-5">
            <section className="cascade grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <NumberTile
                index={0}
                to="/races"
                label="Rounds Done"
                value={completedRaces.length}
                sub={`of ${totalRounds || NO_VALUE}`}
                icon="calendar"
                accent="#0ea5e9"
              />
              <NumberTile index={1} to="/drivers" label="Drivers" value={driverCount} sub="on the grid" icon="users" accent="#7c3aed" />
              <NumberTile
                index={2}
                to="/constructors"
                label="Constructors"
                value={constructorCount}
                sub="teams scoring"
                icon="shield"
                accent="#0d9488"
              />
              {/* same trick as the personal band: the last two tiles stretch so 5
                  tiles close the 2- and 3-column rows without a hole */}
              <NumberTile
                index={3}
                to={leader ? `/drivers/${leader.driverId}` : undefined}
                label={isPast || seasonOver ? "Champion" : "Leader"}
                value={leader?.total ?? NO_VALUE}
                sub={leader?.name || "TBA"}
                icon="trophy"
                accent={leader?.team?.color || "#d97706"}
                className="sm:col-span-2 lg:col-span-1"
              />
              <NumberTile
                index={4}
                to="/drivers"
                label="Title Gap"
                value={titleGap > 0 ? titleGap : "Level"}
                prefix={titleGap > 0 ? "+" : ""}
                sub="P1 to P2"
                icon="trend"
                accent="#d97706"
                className="col-span-2 sm:col-span-1"
              />
            </section>
          </div>
          )}

          {!isPast && myRow && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="section-title">Personal Season</h3>
            {showTierToggle && (
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">Ranking</span>
                <SlidingTabs
                  wrapClassName="inline-flex rounded-lg border border-border bg-card p-0.5"
                  btnClassName="px-2.5 py-1 text-xs"
                  pillClassName="rounded-md bg-brand"
                  items={[
                    { key: "overall", label: "Overall" },
                    { key: "tier", label: `Tier ${myTier}` },
                  ]}
                  value={useTier ? "tier" : "overall"}
                  onChange={(k) => setTierView(k === "tier")}
                />
              </div>
            )}
          </div>
          <section className="cascade grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <NumberTile
              index={0}
              to={`/drivers/${myDriverId}`}
              label={useTier ? `Tier ${myTier}` : "Championship"}
              value={useTier ? (myTierPos ? `P${myTierPos}` : NO_VALUE) : myRow.position ? `P${myRow.position}` : NO_VALUE}
              sub={useTier ? `of ${tierRows.length} in tier` : `${myRow.total} pts`}
              icon="podium"
              accent={myRow.team.color}
            />
            <NumberTile
              index={1}
              to={`/teams/${myRow.team.id}`}
              label="Team"
              value={myTeam ? myTeam.total : NO_VALUE}
              sub={myTeam ? `${myRow.team.name} · P${myTeam.position}` : myRow.team.name}
              icon="shield"
              accent={myRow.team.color}
              mark={
                <TeamLogo id={myRow.team.id} name={myRow.team.name} color={myRow.team.color} logoUrl={myRow.team.logoUrl} size={76} />
              }
            />
            {seasonOver ? (
              /* the season is done, there is nothing to sign up for — show the
                 driver's best result of the year instead */
              <NumberTile
                index={2}
                compact
                to={`/drivers/${myDriverId}`}
                label="Best Finish"
                value={myBestFinish ? `P${myBestFinish.position}` : NO_VALUE}
                sub={myBestFinish?.track ? `at ${myBestFinish.track}` : "this season"}
                icon="flag"
                accent="#0ea5e9"
                mark={
                  myBestFinish?.track && circuitFor(myBestFinish.track) ? (
                    <CircuitMap track={myBestFinish.track} className="h-full w-full" align="xMaxYMax" stroke="currentColor" strokeWidth={2} />
                  ) : undefined
                }
              />
            ) : (
              <NumberTile
                index={2}
                compact
                to={nextEv ? `/races?race=${nextEv.id}` : "/races"}
                label="Next Race"
                value={nextEv ? nextEv.track : "TBA"}
                sub={nextStatusWord}
                icon="flag"
                accent="#0ea5e9"
                mark={
                  nextEv && circuitFor(nextEv.track) ? (
                    <CircuitMap track={nextEv.track} className="h-full w-full" align="xMaxYMax" stroke="currentColor" strokeWidth={2} />
                  ) : undefined
                }
              />
            )}
            {/* 5 tiles never fill a 2- or 3-column grid evenly, so the last two
                stretch to close the row instead of leaving a hole */}
            <NumberTile
              index={3}
              to={`/drivers/${myDriverId}`}
              label={useTier ? "Tier 2 Wins" : "Wins"}
              value={useTier ? myTierWins : myWins}
              sub={`${useTier ? myTierPodiums : myPodiums} podiums`}
              icon="trophy"
              accent="#d97706"
              className="sm:col-span-2 lg:col-span-1"
            />
            <NumberTile
              index={4}
              to={`/drivers/${myDriverId}`}
              label="Avg Finish"
              value={(useTier ? myTierAvg : myAvg) != null ? `P${useTier ? myTierAvg : myAvg}` : NO_VALUE}
              sub={useTier ? `${myStarts} starts · in tier` : `${myStarts} starts`}
              icon="trend"
              accent="#7c3aed"
              className="col-span-2 sm:col-span-1"
            />
          </section>
        </div>
          )}
        </div>
      )}

      {/* =============== NEXT SEASON (active season, transition only) ======== */}
      {/* Sits under the numbers band: the running season teases the next one while
          it's being set up. On an archive season this renders nothing, and in the
          off-season the hero already carries the announcement (with the same
          countdown), so the strip stays away rather than repeating it. */}
      {season?.isActive && !offSeason && <NextSeasonTeaser data={teaser.data} />}

      {/* ===================== SOCIAL WALL ===================== */}
      {/* What we posted lately, on YouTube, Instagram and TikTok. Kept off the
          archive seasons: "latest from our channels" under a two-year-old
          championship table would be this week's clip in a museum. */}
      {!isPast && <SocialFeed />}

      {/* ===================== DRIVERS' CHAMPIONSHIP ===================== */}
      <section className="reveal">
        <Heading index="01" eyebrow="Championship" title="Drivers' Standings" to="/drivers" />
        <DriversTable rows={(drivers.data?.standings || []).slice(0, 10)} leaderTotal={leader?.total ?? 0} decided={isPast || seasonOver} />
      </section>

      {/* ===================== CONSTRUCTORS ===================== */}
      {hasT2 ? (
        <section className="reveal grid gap-10 lg:grid-cols-2">
          <div>
            <Heading index="02" eyebrow="Constructors" title="Tier 1" to="/constructors" />
            <ConstructorTable rows={(t1.data?.standings || []).slice(0, 5)} decided={isPast || seasonOver} />
          </div>
          <div>
            <Heading index="03" eyebrow="Constructors" title="Tier 2" to="/constructors" />
            <ConstructorTable rows={(t2.data?.standings || []).slice(0, 5)} decided={isPast || seasonOver} />
          </div>
        </section>
      ) : (
        <section className="reveal">
          <Heading index="02" eyebrow="Championship" title="Constructors" to="/constructors" />
          <ConstructorTable rows={(t1.data?.standings || []).slice(0, 5)} decided={isPast || seasonOver} />
        </section>
      )}

      {/* ===================== POINTS PROGRESSION ===================== */}
      {/* Hidden on phones ON PURPOSE (the dense line charts don't read well
          there); shown from md up. This is a deliberate call, not an oversight —
          making the chart fit a narrow screen was tried and reverted, so please
          leave the breakpoint alone. Skipped entirely for archived seasons with
          no per-race data. */}
      {completedNumbers.length > 0 && (
        <>
          <section className="reveal hidden md:block">
            <Heading index="04" eyebrow="Points Progression" title={hasT2 ? "Tier 1" : "Constructors"} to="/constructors" />
            <PointsChart standings={t1.data?.standings || []} completed={completedNumbers} allRounds={t1.data?.raceNumbers || []} dropWorst={t1.data?.dropWorst} dropMode={t1.data?.dropMode} teamDropWorst={t1.data?.teamDropWorst} />
          </section>

          {hasT2 && (
            <section className="reveal hidden md:block">
              <Heading index="05" eyebrow="Points Progression" title="Tier 2" to="/constructors" />
              <PointsChart standings={t2.data?.standings || []} completed={completedNumbers} allRounds={t2.data?.raceNumbers || []} dropWorst={t2.data?.dropWorst} dropMode={t2.data?.dropMode} teamDropWorst={t2.data?.teamDropWorst} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */

function Heading({ index, eyebrow, title, to }) {
  return (
    // min-w-0 + a title that may wrap: without them the heading block could not
    // give way, and on a 375px phone "Drivers' Standings" next to the shrink-0
    // "Full table" link pushed the whole page 20px past the viewport.
    <div className="mb-6 flex items-end justify-between gap-3 border-b border-border pb-4 sm:gap-4">
      <div className="flex min-w-0 items-end gap-3 sm:gap-4">
        <span className="font-display text-3xl font-black leading-none text-faint">{index}</span>
        <div className="min-w-0">
          <div className="font-mono text-[13px] font-bold uppercase tracking-[0.2em] text-eyebrow">{eyebrow}</div>
          <h2 className="font-display text-2xl font-extrabold uppercase tracking-tight text-dark sm:text-3xl">
            {title}
          </h2>
        </div>
      </div>
      {to && (
        <Link
          to={to}
          className="group shrink-0 whitespace-nowrap font-mono text-[13px] font-bold uppercase tracking-wider text-light transition hover:text-dark"
        >
          {/* text-eyebrow, not text-brand: brand pink on the light page measures
              1.78:1, and this arrow is the only coloured thing in the row. */}
          Full table <span className="text-eyebrow transition group-hover:translate-x-0.5">→</span>
        </Link>
      )}
    </div>
  );
}

function NumberTile({ label, value, sub, to, index = 0, prefix = "", compact = false, icon, accent = "#64748b", mark, className = "" }) {
  const cls =
    "group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-card transition" +
    (to ? " hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-lg" : "") +
    (className ? ` ${className}` : "");
  const valueCls = compact
    ? "relative mt-3.5 truncate font-display text-2xl font-black uppercase leading-tight tracking-tight text-dark"
    : "relative mt-3.5 font-display text-4xl font-black leading-none tabular-nums text-dark";
  const iconPath = icon ? TILE_ICONS[icon] : null;
  const body = (
    <>
      {/* Bottom-right flourish — the single element that makes every tile read as
          one family. A caller graphic (team logo / circuit outline) when given,
          otherwise a faint oversized copy of the tile's own icon. Both sit in the
          same corner slot at low opacity. */}
      {mark ? (
        <div
          className="pointer-events-none absolute bottom-0 right-0 flex h-[5.5rem] w-3/5 items-end justify-end p-2 opacity-[0.14] transition-transform duration-base group-hover:scale-105"
          style={{ color: accent }}
          aria-hidden="true"
        >
          {mark}
        </div>
      ) : iconPath ? (
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-4 -right-4 h-24 w-24 opacity-[0.07] transition-transform duration-base group-hover:scale-110 dark:opacity-[0.06]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ color: accent }}
        >
          <path d={iconPath} />
        </svg>
      ) : null}
      <div className="relative flex items-center gap-2.5">
        {iconPath ? (
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${accent}1f`, color: accent }}
          >
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={iconPath} />
            </svg>
          </span>
        ) : null}
        <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-light">{label}</span>
        {to && (
          <span className="ml-auto text-light opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100">
            →
          </span>
        )}
      </div>
      <div className={valueCls}>
        {typeof value === "number" ? <CountUp end={value} prefix={prefix} /> : value}
      </div>
      {sub && (
        <div className="relative mt-1.5 truncate font-mono text-[11px] font-semibold uppercase tracking-wider text-light">
          {sub}
        </div>
      )}
    </>
  );
  return to ? (
    <Link to={to} className={cls} style={{ "--i": index }}>
      {body}
    </Link>
  ) : (
    <div className={cls} style={{ "--i": index }}>
      {body}
    </div>
  );
}

// `decided` — the title is settled: first place wears gold; while the season
// still runs the leader gets the pink wash instead.
function DriversTable({ rows, leaderTotal, decided = false }) {
  return (
    <div className="card overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border text-left font-mono text-[11px] font-bold uppercase tracking-widest text-light">
            <th className="w-14 py-3 pl-5 text-center">Pos</th>
            <th className="py-3 pl-2">Driver</th>
            <th className="hidden py-3 sm:table-cell">Team</th>
            <th className="py-3 pr-5 text-right">Pts</th>
            <th className="hidden py-3 pr-5 text-right md:table-cell">Gap</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const isLeader = d.position === 1;
            const pct = leaderTotal > 0 ? Math.max(6, (d.total / leaderTotal) * 100) : 0;
            return (
              <tr
                key={d.driverId}
                className={`group border-b border-border last:border-0 transition ${
                  isLeader && d.total > 0 ? (decided ? "row-gold" : "row-leader") : "hover:bg-surface2"
                }`}
              >
                <td className="py-4 pl-5 text-center">
                  <Rank position={d.position} />
                </td>
                <td className="py-4 pl-2">
                  <div className="flex items-center gap-3">
                    <span className="h-7 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: d.team.color }} />
                    <Link
                      to={`/drivers/${d.driverId}`}
                      className="font-display text-base font-bold uppercase tracking-tight text-dark transition hover:text-brand sm:text-lg"
                    >
                      {d.name}
                    </Link>
                    <Flag code={countryFor(d.driverId, d.country)} className="ml-0.5" />
                  </div>
                </td>
                <td className="hidden py-4 sm:table-cell">
                  <Link to={`/teams/${d.team.id}`} className="inline-flex transition hover:opacity-80">
                    <TeamLogo
                      id={d.team.id}
                      name={d.team.name}
                      color={d.team.color}
                      logoUrl={d.team.logoUrl}
                      size={20}
                      showName
                      nameClassName="truncate text-[15px] text-medium"
                    />
                  </Link>
                </td>
                <td className="py-4 pr-5 text-right">
                  <div className="flex flex-col items-end gap-1.5">
                    <span className="font-mono text-lg font-bold tabular-nums text-dark sm:text-xl">
                      <CountUp end={d.total} duration={900} />
                    </span>
                    <span className="hidden h-1 w-20 overflow-hidden rounded-full bg-border sm:block">
                      <span
                        className="bar-fill block h-full rounded-full"
                        style={{ "--w": `${pct}%`, backgroundColor: d.team.color }}
                      />
                    </span>
                  </div>
                </td>
                <td className="hidden py-4 pr-5 text-right font-mono text-[15px] tabular-nums text-light md:table-cell">
                  {isLeader ? NO_VALUE : `−${leaderTotal - d.total}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ConstructorTable({ rows, decided = false }) {
  const top = rows[0]?.total ?? 0;
  return (
    <div className="card overflow-hidden">
      <table className="w-full">
        <tbody>
          {rows.map((t) => {
            const pct = top > 0 ? Math.max(6, (t.total / top) * 100) : 0;
            return (
              <tr
                key={t.teamId}
                className={`group border-b border-border last:border-0 transition ${
                  t.position === 1 && t.total > 0 ? (decided ? "row-gold" : "row-leader") : "hover:bg-surface2"
                }`}
              >
                <td className="w-14 py-4 pl-5 text-center">
                  <Rank position={t.position} />
                </td>
                <td className="py-4 pl-1">
                  <Link to={`/teams/${t.teamId}`} className="flex items-center gap-3">
                    <TeamLogo id={t.teamId} name={t.name} color={t.color} logoUrl={t.logoUrl} size={32} />
                    <div className="min-w-0">
                      <span className="block truncate font-display text-base font-bold uppercase tracking-tight text-dark transition group-hover:text-brand sm:text-lg">
                        {t.name}
                      </span>
                      <span className="mt-1.5 block h-1 w-24 overflow-hidden rounded-full bg-border">
                        <span
                          className="bar-fill block h-full rounded-full"
                          style={{ "--w": `${pct}%`, backgroundColor: t.color }}
                        />
                      </span>
                    </div>
                  </Link>
                </td>
                <td className="py-4 pr-5 text-right">
                  <span className="font-mono text-lg font-bold tabular-nums text-dark sm:text-xl">
                    <CountUp end={t.total} duration={900} />
                  </span>
                  <span className="ml-1 text-xs font-semibold text-light">PTS</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
