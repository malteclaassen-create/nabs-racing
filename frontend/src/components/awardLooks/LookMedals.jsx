// ---------------------------------------------------------------------------
// Season awards look "medals" (Hall of Fame preview, ?look=medals). Every award
// is a gold medal hanging from a short ribbon in the winner's team colour,
// framed by a laurel wreath, with the winner set into its centre: portrait or
// initials, team logo, the track's flag, or a star for a typed name. One season
// at a time, newest first. The metal is CSS gradients and inline SVG, see
// lookMedals.css.
// ---------------------------------------------------------------------------
import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { DriverAvatar, MEDAL, MEDAL_TEXT } from "../ui.jsx";
import TeamLogo from "../TeamLogo.jsx";
import Flag from "../Flag.jsx";
import SlidingTabs from "../SlidingTabs.jsx";
import { useSwapClass } from "../../hooks/motion.js";
import { winnerOf } from "./shared.js";
import "./lookMedals.css";

const rad = (deg) => (deg * Math.PI) / 180;
const r2 = (n) => Math.round(n * 100) / 100;

// Light falls from the top left. Of each two-tone shape below, the half that
// faces it is drawn bright and the other dark, which is what makes flat SVG
// read as struck metal.
const LIGHT = [-0.6, -0.8];
const facing = (nx, ny) => nx * LIGHT[0] + ny * LIGHT[1];

// The laurel: two branches up the sides of a 100 x 100 box with the medal
// (radius ~35.7) in the middle, open at the top where the ribbon hangs and
// crossing at the bottom. Every medal wears the same one, so it is worked out
// once, as three paths, instead of per award.
const LAUREL = (() => {
  const R = 41;
  const hi = [];
  const lo = [];
  const leaf = (x, y, deg, len, w) => {
    const c = Math.cos(rad(deg));
    const s = Math.sin(rad(deg));
    const p = (lx, ly) => `${r2(x + lx * c - ly * s)} ${r2(y + lx * s + ly * c)}`;
    for (const side of [-1, 1]) {
      const d = `M${p(0, 0)}C${p(side * w, -0.32 * len)} ${p(side * w * 0.72, -0.8 * len)} ${p(0, -len)}Z`;
      (facing(side * c, side * s) > 0 ? hi : lo).push(d);
    }
  };
  // theta: degrees from the bottom of the circle, up one side.
  const at = (dir, theta) => [50 + dir * R * Math.sin(rad(theta)), 50 + R * Math.cos(rad(theta))];
  const stems = [];
  for (const dir of [1, -1]) {
    const nodes = 8;
    for (let i = 0; i < nodes; i++) {
      const t = i / (nodes - 1);
      const theta = 14 + t * 116;
      const [x, y] = at(dir, theta);
      const along = dir * (90 - theta);
      const k = 1 - 0.4 * t;
      leaf(x, y, along + dir * 46, 11.5 * k, 4 * k);
      leaf(x, y, along - dir * 28, 8 * k, 3 * k);
    }
    const [tx, ty] = at(dir, 136);
    leaf(tx, ty, dir * (90 - 136), 8, 2.8);
    const [sx, sy] = at(dir, -9);
    stems.push(`M${r2(sx)} ${r2(sy)}A${R} ${R} 0 0 ${dir === 1 ? 0 : 1} ${r2(tx)} ${r2(ty)}`);
  }
  return { hi: hi.join(""), lo: lo.join(""), stems: stems.join("") };
})();

// A five-point star cut into ten facets, for an award that went to a typed
// name (no driver, team or race to show).
const STAR = (() => {
  const tones = { hi: [], mid: [], lo: [] };
  const pt = (r, deg) => `${r2(50 + r * Math.cos(rad(deg)))} ${r2(50 + r * Math.sin(rad(deg)))}`;
  const outline = [];
  for (let k = 0; k < 5; k++) {
    const a = -90 + k * 72;
    outline.push(pt(46, a), pt(19, a + 36));
    for (const side of [-1, 1]) {
      const b = facing(-side * Math.sin(rad(a)), side * Math.cos(rad(a)));
      tones[b > 0.35 ? "hi" : b < -0.35 ? "lo" : "mid"].push(`M50 50L${pt(46, a)}L${pt(19, a + side * 36)}Z`);
    }
  }
  return {
    hi: tones.hi.join(""),
    mid: tones.mid.join(""),
    lo: tones.lo.join(""),
    outline: `M${outline.join("L")}Z`,
  };
})();

function Laurel() {
  return (
    <svg className="aw-medals-laurel" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <path className="aw-medals-stem" d={LAUREL.stems} />
      <path className="aw-medals-leaf-lo" d={LAUREL.lo} />
      <path className="aw-medals-leaf-hi" d={LAUREL.hi} />
    </svg>
  );
}

// The ribbon the medal hangs from: a strip in the team colour on a gold pin
// bar, gathered into a clip, and the ring through the medal's eye.
function Ribbon({ color }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <svg className="aw-medals-ribbon" viewBox="0 0 40 52" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}s`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.4" />
          <stop offset="0.26" stopColor="#000" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.2" />
          <stop offset="0.74" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.4" />
        </linearGradient>
        <linearGradient id={`${id}g`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#fff4c2" />
          <stop offset="0.5" stopColor="#eab308" />
          <stop offset="1" stopColor="#8a5a0b" />
        </linearGradient>
      </defs>
      {/* hangs straight from the bar, then gathers into the clip */}
      <path d="M6 2H34V21L28.5 36H11.5L6 21Z" fill={color} />
      <path d="M17.6 2H22.4V21L21.46 36H18.54L17.6 21Z" fill="#fff" fillOpacity="0.55" />
      <path d="M9 2H10.8V21L14.4 36H13.3L9 21ZM29.2 2H31V21L26.7 36H25.6L29.2 21Z" fill="#fde68a" fillOpacity="0.9" />
      <path d="M6 2H34V21L28.5 36H11.5L6 21Z" fill={`url(#${id}s)`} />
      <rect x="1.5" y="0" width="37" height="5" rx="2.5" fill={`url(#${id}g)`} stroke="#6b4508" strokeWidth="0.6" />
      <rect x="11" y="34" width="18" height="6" rx="1.5" fill={`url(#${id}g)`} stroke="#6b4508" strokeWidth="0.6" />
      <circle cx="20" cy="45" r="4.3" fill="none" stroke={`url(#${id}g)`} strokeWidth="2.2" />
    </svg>
  );
}

function FacetStar() {
  return (
    <svg className="aw-medals-star" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <path d={STAR.mid} fill="#e2ad1f" />
      <path d={STAR.hi} fill="#fff1bd" />
      <path d={STAR.lo} fill="#a87708" />
      <path d={STAR.outline} fill="none" stroke="#6b4508" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

// The track's flag as a round enamel inlay, or the star when there is no flag
// (or its file is missing). Its own <img> rather than <Flag>: <Flag> serves the
// 40px file at 1x, which smears when blown up to fill the inlay; the 80px one
// holds up.
function RaceInlay({ code }) {
  const [broken, setBroken] = useState(false);
  if (!code || broken) {
    return (
      <span className="aw-medals-inlay aw-medals-matte">
        <FacetStar />
      </span>
    );
  }
  return (
    <span className="aw-medals-inlay">
      <img
        src={`/flags/w80/${String(code).toLowerCase()}.png`}
        alt=""
        className="h-full w-full object-cover"
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
      />
    </span>
  );
}

// What sits in the middle of the medal for each kind of winner.
function Inlay({ w }) {
  if (w.kind === "driver") {
    return (
      <span className="aw-medals-inlay">
        <DriverAvatar
          name={w.driver.name}
          photoUrl={w.driver.photoUrl}
          color={w.color || "#64748b"}
          size={96}
          className="aw-medals-avatar"
        />
      </span>
    );
  }
  if (w.kind === "team") {
    return (
      <span className="aw-medals-inlay aw-medals-enamel" style={{ "--aw-medals-tint": w.color || "#334155" }}>
        <span className="aw-medals-logo">
          <TeamLogo id={w.team.id} name={w.team.name} color={w.team.color} logoUrl={w.team.logoUrl} size={64} />
        </span>
      </span>
    );
  }
  if (w.kind === "race") return <RaceInlay code={w.flag} />;
  return (
    <span className="aw-medals-inlay aw-medals-matte">
      <FacetStar />
    </span>
  );
}

// reveal-chart: the site's scroll observer (useScrollReveal) marks it
// is-visible once it scrolls into view, and the class carries no style of its
// own. So each medal settles and catches the light as it comes on screen,
// rows further down included, not all at once while they are still out of
// sight.
function Medallion({ w }) {
  return (
    <div className="aw-medals-art reveal-chart" aria-hidden="true">
      {/* everything that hangs from the pin, so it can swing as one */}
      <div className="aw-medals-hang">
        <Laurel />
        <div className="aw-medals-medal">
          <span className="aw-medals-face" />
          <Inlay w={w} />
          <span className="aw-medals-shine" />
        </div>
        <Ribbon color={w.color || MEDAL[0]} />
      </div>
    </div>
  );
}

// winnerOf hands a driver's flag over as a code but a race's as the whole
// flagFor() record ({ country, ... }); both become a plain code here.
const flagCode = (flag) => (typeof flag === "string" ? flag : flag?.country) || null;

// A long single word (a track like "Internazionale", a run-together handle)
// does not fit a phone's half-width column at the usual size and would be cut
// mid-word, so a name with one steps down a size there.
const longestWord = (name) => Math.max(0, ...String(name || "").split(/\s+/).map((p) => p.length));

// The driver's flag rides on the last word of the name, so a name that wraps
// in a narrow column never leaves the flag alone on a line of its own. Not for
// a word too long to fit anyway: that one has to be free to break.
function NameWithFlag({ name, code }) {
  const flag = <Flag code={code} w={18} h={13} className="relative -top-[0.12em] ml-1.5 align-middle" />;
  const cut = name.lastIndexOf(" ");
  const last = name.slice(cut + 1);
  if (last.length > 12) {
    return (
      <>
        {name}
        {flag}
      </>
    );
  }
  return (
    <>
      {name.slice(0, cut + 1)}
      <span className="whitespace-nowrap">
        {last}
        {flag}
      </span>
    </>
  );
}

function MedalItem({ award, seasonNumber, index }) {
  const won = winnerOf(award, seasonNumber);
  const w = { ...won, flag: flagCode(won.flag) };
  const body = (
    <>
      <Medallion w={w} />
      <div className="mt-3 text-center">
        <h3
          className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] sm:text-[11px] sm:tracking-[0.2em]"
          style={{ color: MEDAL_TEXT[0] }}
        >
          {award.title}
        </h3>
        <div
          className={`mt-1.5 font-display font-black uppercase leading-[1.08] tracking-tight text-dark [overflow-wrap:anywhere] sm:text-xl lg:text-2xl ${
            longestWord(w.name) > 12 ? "text-base" : "text-lg"
          }`}
        >
          {w.kind === "driver" && w.flag ? <NameWithFlag name={w.name} code={w.flag} /> : w.name}
        </div>
        {w.sub && (
          <div className="mt-1.5 flex items-center justify-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-light">
            {w.kind === "driver" && w.team && (
              <span aria-hidden="true" className="flex">
                <TeamLogo id={w.team.id} name={w.team.name} color={w.team.color} logoUrl={w.team.logoUrl} size={14} />
              </span>
            )}
            <span className="min-w-0 [overflow-wrap:anywhere]">{w.sub}</span>
          </div>
        )}
        {award.note && (
          <>
            <span className="aw-medals-rule" aria-hidden="true" />
            <p className="mx-auto max-w-[34ch] text-xs leading-relaxed text-light sm:text-[13px]">{award.note}</p>
          </>
        )}
      </div>
    </>
  );
  return (
    <li className="aw-medals-item" style={{ "--i": Math.min(index, 16) }}>
      {/* The padding keeps the focus ring off the ribbon and the last line. */}
      {w.to ? (
        <Link
          to={w.to}
          className="aw-medals-link block h-full rounded-xl pb-3 pt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {body}
        </Link>
      ) : (
        <div className="h-full pb-3 pt-2">{body}</div>
      )}
    </li>
  );
}

export default function LookMedals({ seasons }) {
  const [picked, setPicked] = useState(seasons[0]?.seasonNumber);
  const season = seasons.find((s) => s.seasonNumber === picked) || seasons[0];
  const swap = useSwapClass(season?.seasonNumber);
  if (!season) return null;
  const count = season.awards.length;
  return (
    <section data-awards-look="medals" className="aw-medals-root reveal">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-eyebrow sm:text-[11px] sm:tracking-[0.2em]">
            {season.seasonName || `Season ${season.seasonNumber}`} · {count === 1 ? "1 award" : `${count} awards`}
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

      <div className="aw-medals-wall relative overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        <div key={season.seasonNumber} className={swap}>
          <ul role="list" className="aw-medals-list cascade relative flex flex-wrap justify-center gap-y-7 px-3 py-7 sm:gap-y-9 sm:px-8 sm:py-10">
            {season.awards.map((a, i) => (
              <MedalItem key={a.id} award={a} seasonNumber={season.seasonNumber} index={i} />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
