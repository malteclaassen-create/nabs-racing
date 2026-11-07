// ---------------------------------------------------------------------------
// Season awards look "medals" (Hall of Fame preview, ?look=medals). Every award
// is a gold medal hanging from a short ribbon in the winner's team colour,
// framed by a laurel wreath, with the winner set into its centre: a photo or
// initials struck into the gold, the team logo on enamel, the track's flag as
// a plaque, or a mark for a typed name. One season at a time, newest first.
// The metal is CSS gradients and inline SVG, see lookMedals.css.
// ---------------------------------------------------------------------------
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MEDAL, MEDAL_TEXT, sizedAvatarUrl } from "../ui.jsx";
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

// A chequered flag on a pole, for a race whose track has no flag to show. It
// has to differ from the star, or "Race of the Season" and a typed-name award
// look like the same medal. The cloth waves a little, so its squares are cut
// along the wave rather than drawn as a straight grid.
const CHEQUER = (() => {
  const cols = 6;
  const rows = 4;
  const [x0, x1, y0, h] = [26, 82, 19, 38];
  const wave = (x) => 3 * Math.sin(((x - x0) / (x1 - x0)) * Math.PI * 1.6);
  const pt = (c, r) => {
    const x = x0 + (c / cols) * (x1 - x0);
    return `${r2(x)} ${r2(y0 + (r / rows) * h + wave(x))}`;
  };
  const dark = [];
  const light = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ((r + c) % 2 ? light : dark).push(`M${pt(c, r)}L${pt(c + 1, r)}L${pt(c + 1, r + 1)}L${pt(c, r + 1)}Z`);
    }
  }
  const top = Array.from({ length: cols + 1 }, (_, c) => pt(c, 0));
  const bottom = Array.from({ length: cols + 1 }, (_, c) => pt(cols - c, rows));
  return { dark: dark.join(""), light: light.join(""), outline: `M${[...top, ...bottom].join("L")}Z` };
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

// Polished gold, lit from above: the pin bar, the clip and the ring share it.
function GoldGradient({ id }) {
  return (
    <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stopColor="#fff4c2" />
      <stop offset="0.5" stopColor="#eab308" />
      <stop offset="1" stopColor="#8a5a0b" />
    </linearGradient>
  );
}

// The ribbon: a strip in the team colour, gathered into a clip, and the ring
// through the medal's eye. It swings with the medal; the bar it hangs from is
// drawn on its own (PinBar) and stays put.
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
        <GoldGradient id={`${id}g`} />
      </defs>
      {/* hangs straight from the bar, then gathers into the clip */}
      <path d="M6 2H34V21L28.5 36H11.5L6 21Z" fill={color} />
      <path d="M17.6 2H22.4V21L21.46 36H18.54L17.6 21Z" fill="#fff" fillOpacity="0.55" />
      <path d="M9 2H10.8V21L14.4 36H13.3L9 21ZM29.2 2H31V21L26.7 36H25.6L29.2 21Z" fill="#fde68a" fillOpacity="0.9" />
      <path d="M6 2H34V21L28.5 36H11.5L6 21Z" fill={`url(#${id}s)`} />
      <rect x="11" y="34" width="18" height="6" rx="1.5" fill={`url(#${id}g)`} stroke="#6b4508" strokeWidth="0.6" />
      <circle cx="20" cy="45" r="4.3" fill="none" stroke={`url(#${id}g)`} strokeWidth="2.2" />
    </svg>
  );
}

// The gold bar at the top of the ribbon. Same box as the ribbon, so the two
// line up, but outside the part that swings: a bar fixed to the wall does not
// tilt when the medal sways below it.
function PinBar() {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <svg className="aw-medals-ribbon aw-medals-bar" viewBox="0 0 40 52" aria-hidden="true" focusable="false">
      <defs>
        <GoldGradient id={`${id}g`} />
      </defs>
      <rect x="1.5" y="0" width="37" height="5" rx="2.5" fill={`url(#${id}g)`} stroke="#6b4508" strokeWidth="0.6" />
    </svg>
  );
}

function FacetStar() {
  return (
    <svg className="aw-medals-mark" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <path d={STAR.mid} fill="#e2ad1f" />
      <path d={STAR.hi} fill="#fff1bd" />
      <path d={STAR.lo} fill="#a87708" />
      <path d={STAR.outline} fill="none" stroke="#6b4508" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function ChequerFlag() {
  return (
    <svg className="aw-medals-mark" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      {/* the pole: lit half and shaded half, with a knob on top */}
      <path d="M21 17H23.5V88H21Z" fill="#fff1bd" />
      <path d="M23.5 17H26V88H23.5Z" fill="#a87708" />
      <path d="M21 17H26V88H21Z" fill="none" stroke="#6b4508" strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx="23.5" cy="14" r="4.4" fill="#e2ad1f" stroke="#6b4508" strokeWidth="1.4" />
      <path d={CHEQUER.light} fill="#fff1bd" />
      <path d={CHEQUER.dark} fill="#8a5a0b" />
      <path d={CHEQUER.outline} fill="none" stroke="#6b4508" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

// Letters only, so "13bot" is struck as B and not as a 1: alone in the middle
// of a gold medal, a 1 reads as first place.
function initialsOf(name, max = 2) {
  const text = String(name || "").trim();
  const letters = text
    .split(/\s+/)
    .map((word) => word.match(/\p{L}/u)?.[0])
    .filter(Boolean)
    .slice(0, max)
    .join("");
  return (letters || text.charAt(0) || "?").toUpperCase();
}

// A driver: the photo when there is one; otherwise the initials struck into
// the gold. A coloured disc with letters on it looked like a poker chip inside
// the medal, so the team colour moves to a thin enamel ring round the centre
// (and the ribbon).
function Portrait({ w }) {
  const [broken, setBroken] = useState(false);
  const photo = w.driver?.photoUrl;
  const ring = w.color ? { "--aw-medals-ring": w.color } : undefined;
  if (photo && !broken) {
    return (
      <span className="aw-medals-inlay aw-medals-ringed" style={{ ...ring, backgroundColor: w.color || "#64748b" }}>
        <img
          src={sizedAvatarUrl(photo, 72)}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
        />
      </span>
    );
  }
  return (
    <span className="aw-medals-inlay aw-medals-matte aw-medals-ringed" style={ring}>
      <span className="aw-medals-initials font-display font-black">{initialsOf(w.name)}</span>
    </span>
  );
}

// Where a logo's ink sits in its file, as fractions of the image. The files
// are padded every which way (NCB Mugen's wordmark sits in the middle of a
// square, Toro Rosso's fills a thin strip), so the file's own shape says
// little about how big the mark can be drawn. Same file, same answer: kept.
const inkCache = new Map();
function inkOf(img) {
  const src = img.currentSrc || img.src;
  if (inkCache.has(src)) return inkCache.get(src);
  let ink = null;
  try {
    const N = 48;
    const canvas = document.createElement("canvas");
    canvas.width = N;
    canvas.height = N;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, N, N);
    const { data } = ctx.getImageData(0, 0, N, N);
    let [x0, y0, x1, y1] = [N, N, -1, -1];
    for (let i = 0; i < N * N; i++) {
      if (data[i * 4 + 3] < 32) continue;
      const x = i % N;
      const y = Math.floor(i / N);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    if (x1 >= 0) ink = { x: x0 / N, y: y0 / N, w: (x1 + 1 - x0) / N, h: (y1 + 1 - y0) / N };
  } catch {
    // A file from another site that does not allow reading it back: it keeps
    // the plain box.
  }
  inkCache.set(src, ink);
  return ink;
}

// The biggest box of the ink's shape that the round inlay holds is the one
// whose corners touch the circle; INK_K keeps it clear of the rim's shadow. A
// wide wordmark then gets most of the width across the middle, a crest most of
// the height. Returned as the custom properties lookMedals.css places it by.
const INK_K = 0.88;
function logoFit(img) {
  const ink = inkOf(img);
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (!ink || !nw || !nh) return null;
  const aspect = (ink.w * nw) / (ink.h * nh);
  const diag = Math.hypot(aspect, 1);
  const iw = (INK_K * aspect) / diag / ink.w; // the whole file at that scale
  const ih = INK_K / diag / ink.h;
  const pct = (n) => `${(n * 100).toFixed(2)}%`;
  return {
    "--aw-medals-lw": pct(iw),
    "--aw-medals-lh": pct(ih),
    "--aw-medals-lx": pct(0.5 - (ink.x + ink.w / 2) * iw),
    "--aw-medals-ly": pct(0.5 - (ink.y + ink.h / 2) * ih),
  };
}

// A team: its logo on pale enamel. TeamLogo still picks the file; this only
// measures the picture once it is in and sizes it to the circle. A team with
// no logo file (or a dead one) gets the initials of its words struck into the
// enamel instead of TeamLogo's monogram, which is the first three letters of
// the name: big in the middle of a medal, "Apex Grand Prix" read as APE.
function TeamInlay({ w }) {
  const ref = useRef(null);
  const [fit, setFit] = useState(null);
  const [plain, setPlain] = useState(false);
  // Before paint, so a team without a logo never shows TeamLogo's tile first.
  useLayoutEffect(() => {
    const img = ref.current?.querySelector("img");
    if (!img) {
      setPlain(true);
      return undefined;
    }
    const measure = () => {
      if (img.naturalWidth) setFit(logoFit(img));
    };
    const fail = () => setPlain(true);
    if (img.complete) measure();
    img.addEventListener("load", measure);
    img.addEventListener("error", fail);
    return () => {
      img.removeEventListener("load", measure);
      img.removeEventListener("error", fail);
    };
  }, []);
  const tint = { "--aw-medals-tint": w.color || "#334155" };
  if (plain) {
    const mark = initialsOf(w.team.name, 3);
    return (
      <span className="aw-medals-inlay aw-medals-enamel" style={tint}>
        <span className={`aw-medals-initials font-display font-black${mark.length > 2 ? " aw-medals-initials-3" : ""}`}>
          {mark}
        </span>
      </span>
    );
  }
  return (
    <span className="aw-medals-inlay aw-medals-enamel" style={tint}>
      <span ref={ref} className={`aw-medals-logo${fit ? " aw-medals-fit" : ""}`} style={fit || undefined}>
        <TeamLogo id={w.team.id} name={w.team.name} color={w.team.color} logoUrl={w.team.logoUrl} size={64} />
      </span>
    </span>
  );
}

// A race: the track's flag as an enamelled plaque on the gold, at the flag's
// own shape. Filled into the round inlay the 80px file was blown up two to
// four times on a sharp screen and lost most of itself to the crop. The plaque
// is at most 40px wide, so the 40px file is drawn at its own size on an
// ordinary screen and the 80px one on a sharp screen. Without a flag (or its
// file), the chequered flag.
function RaceInlay({ code }) {
  const [broken, setBroken] = useState(false);
  const c = String(code || "").toLowerCase();
  return (
    <span className="aw-medals-inlay aw-medals-matte">
      {code && !broken ? (
        <img
          src={`/flags/w40/${c}.png`}
          srcSet={`/flags/w80/${c}.png 2x`}
          alt=""
          className="aw-medals-plaque"
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
        />
      ) : (
        <ChequerFlag />
      )}
    </span>
  );
}

// What sits in the middle of the medal for each kind of winner.
function Inlay({ w }) {
  if (w.kind === "driver") return <Portrait w={w} />;
  if (w.kind === "team") return <TeamInlay w={w} />;
  if (w.kind === "race") return <RaceInlay code={w.flag} />;
  return (
    <span className="aw-medals-inlay aw-medals-matte">
      <FacetStar />
    </span>
  );
}

function Medallion({ w }) {
  return (
    <div className="aw-medals-art" aria-hidden="true">
      <Laurel />
      {/* the part that hangs from the bar, so it can sway as one */}
      <div className="aw-medals-hang">
        <div className="aw-medals-medal">
          <span className="aw-medals-face" />
          <Inlay w={w} />
          <span className="aw-medals-shine" />
        </div>
        <Ribbon color={w.color || MEDAL[0]} />
      </div>
      <PinBar />
    </div>
  );
}

// winnerOf hands a driver's flag over as a code but a race's as the whole
// flagFor() record ({ country, ... }); both become a plain code here.
const flagCode = (flag) => (typeof flag === "string" ? flag : flag?.country) || null;

// An initial ("J. Yamanaka", "Q. Li") is held to the word after it with a
// no-break space, so a narrow column never leaves it alone on a line. Only a
// capital with a full stop counts: the "e" of "Enzo e Dino Ferrari" is a word.
const holdInitials = (name) => String(name || "").replace(/(?<=^|\s)(\p{Lu}\.) +/gu, "$1\u00a0");

// How wide Archivo Black capitals are at the name's tracking, in em (measured
// in the browser), roughly by letter shape.
function glyphEm(ch) {
  const c = ch.normalize("NFD").charAt(0).toUpperCase();
  if ("MW".includes(c)) return 0.97;
  if ("GHKNOQU&@".includes(c)) return 0.82;
  if ("ABCDRVXY".includes(c)) return 0.76;
  if ("EPSTZ".includes(c)) return 0.71;
  if ("I.,:;'!|".includes(c)) return 0.34;
  if (c === "\u00a0") return 0.25;
  return 0.66;
}

// The name may only break at a space or after a hyphen, so its longest run
// between those decides how big it can be: lookMedals.css sizes it so that run
// fills at most 90% of its column (in container units), up to the usual size.
// A long handle like JadenDMotorports then steps down to fit its column
// instead of being cut mid-word, and a short one keeps the full size. Not more
// than 90%: two long names side by side need a clear gap between them, or the
// row reads as one line.
function nameFit(name) {
  const runs = name.split(/[ \t\n]+/).flatMap((word) => word.split(/(?<=-)/));
  const em = Math.max(1, ...runs.map((run) => [...run].reduce((sum, ch) => sum + glyphEm(ch), 0)));
  return 90 / em;
}

// Names side by side share one size, the one the tightest of them needs: a
// short name at full size next to a long one stepped down looked like a
// mistake. Which names share a row depends on how many columns there are,
// which lookMedals.css picks by width, so the shared size is worked out for
// one, two and three across, and the stylesheet uses the one that applies.
function rowFits(fits) {
  const across = (cols) =>
    fits.map((_, i) => {
      const start = i - (i % cols);
      return Math.min(...fits.slice(start, start + cols));
    });
  const two = across(2);
  const three = across(3);
  return fits.map((own, i) => ({
    "--aw-medals-fit-1": own.toFixed(2),
    "--aw-medals-fit-2": two[i].toFixed(2),
    "--aw-medals-fit-3": three[i].toFixed(2),
  }));
}

function MedalItem({ award, w, name, fit, index }) {
  // The driver's flag sits with the team on the line under the name, not
  // after the name: glued to the last word it pushed long handles out of
  // their column on a phone.
  const flag = w.kind === "driver" ? w.flag : null;
  const logo = w.kind === "driver" ? w.team : null;
  const body = (
    <>
      <Medallion w={w} />
      <div className="aw-medals-text">
        <h3
          className="aw-medals-title flex flex-col justify-end font-mono text-[11px] font-bold uppercase leading-[1.35] tracking-[0.1em] [text-wrap:balance] sm:tracking-[0.2em]"
          style={{ color: MEDAL_TEXT[0] }}
        >
          {award.title}
        </h3>
        {/* The name and the line under it as one block, so the notes along a
            row start level whichever names wrap or have no line under them. */}
        <div className="aw-medals-head">
          <div
            className="aw-medals-name mt-1.5 font-display font-black uppercase leading-[1.08] tracking-tight text-dark [text-wrap:balance]"
            style={fit}
          >
            {name}
          </div>
          {(w.sub || flag) && (
            <div className="aw-medals-sub mt-2 font-mono text-[11px] font-bold uppercase tracking-wider text-light">
              {flag && <Flag code={flag} w={16} h={11} className="shrink-0" />}
              {logo && (
                <span aria-hidden="true" className="aw-medals-sublogo">
                  <TeamLogo id={logo.id} name={logo.name} color={logo.color} logoUrl={logo.logoUrl} size={14} />
                </span>
              )}
              {w.sub && <span className="min-w-0 [overflow-wrap:anywhere] [text-wrap:balance]">{w.sub}</span>}
            </div>
          )}
        </div>
        {award.note && (
          <>
            <span className="aw-medals-rule" aria-hidden="true" />
            <p className="aw-medals-note text-[13px] leading-relaxed text-light [text-wrap:pretty] sm:text-sm">
              {award.note}
            </p>
          </>
        )}
      </div>
    </>
  );
  return (
    <li className="aw-medals-item" style={{ "--i": Math.min(index, 16) }}>
      {/* Its padding (lookMedals.css) keeps the focus ring off the ribbon and
          the last line. */}
      {w.to ? (
        <Link
          to={w.to}
          className="aw-medals-body aw-medals-link rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {body}
        </Link>
      ) : (
        <div className="aw-medals-body">{body}</div>
      )}
    </li>
  );
}

// Each medal sways and catches the light once, as it comes on screen, so rows
// further down do it when they are reached and not while out of sight. Its own
// observer rather than the site's reveal-chart hook: a later change to how
// charts come in must not reach the medals. Medals that arrive together go
// one after another, along the row and then down.
function useMedalsInView(ref, key) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    const arts = [...root.querySelectorAll(".aw-medals-art:not(.aw-medals-seen)")];
    if (typeof IntersectionObserver === "undefined") {
      arts.forEach((el) => el.classList.add("aw-medals-seen"));
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        const due = entries
          .filter((e) => e.isIntersecting)
          .map((e) => ({ el: e.target, top: Math.round(e.boundingClientRect.top), left: e.boundingClientRect.left }))
          .sort((a, b) => a.top - b.top || a.left - b.left);
        due.forEach(({ el }, i) => {
          el.style.setProperty("--aw-medals-delay", `${Math.min(i, 8) * 90}ms`);
          el.classList.add("aw-medals-seen");
          io.unobserve(el);
        });
      },
      { rootMargin: "0px 0px -10% 0px" }
    );
    arts.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [ref, key]);
}

// Two across, an award title that runs to two lines ("Overtake of the Season")
// pushed its winner's name below the one beside it, and a name that wraps (or
// a winner with no line under the name) did the same to the notes. So each
// title, and each name with its line, takes the height of the tallest in its
// row (a title keeps its text at the bottom): the names in a row start level,
// and so do the notes. Measured, because only the browser knows what wraps at
// this width: again when the list is resized, and when a web font lands, which
// re-wraps text without resizing anything.
const ROW_ALIGNED = [".aw-medals-title", ".aw-medals-head"];
function useRowAligned(ref, key) {
  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return undefined;
    let frame = 0;
    let live = true;
    const align = () => {
      frame = 0;
      const items = [...list.children];
      const parts = items.map((li) => ROW_ALIGNED.map((sel) => li.querySelector(sel)));
      parts.flat().forEach((el) => el && (el.style.minHeight = ""));
      // Every read before any write: a row made taller moves the rows below
      // it, and they would no longer be found by where they were. Layout
      // heights to the fraction of a pixel (offsetHeight rounds, and left the
      // notes in a row a pixel apart), not drawn ones, so the cascade's
      // spring-in cannot skew them.
      const rows = items.map((li) => li.offsetTop);
      const heights = parts.map((els) => els.map((el) => (el ? parseFloat(getComputedStyle(el).height) || 0 : 0)));
      const tallest = new Map();
      rows.forEach((row, i) => {
        const was = tallest.get(row) || heights[i];
        tallest.set(row, was.map((h, k) => Math.max(h, heights[i][k])));
      });
      parts.forEach((els, i) =>
        els.forEach((el, k) => {
          const h = tallest.get(rows[i])[k];
          if (el && heights[i][k] < h) el.style.minHeight = `${h}px`;
        })
      );
    };
    // On the next frame: changing heights inside the observer's own callback
    // would make it report a loop.
    const later = () => {
      if (live && !frame) frame = requestAnimationFrame(align);
    };
    align();
    const fonts = typeof document !== "undefined" ? document.fonts : null;
    fonts?.ready?.then(later);
    fonts?.addEventListener?.("loadingdone", later);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(later) : null;
    ro?.observe(list);
    return () => {
      live = false;
      ro?.disconnect();
      fonts?.removeEventListener?.("loadingdone", later);
      cancelAnimationFrame(frame);
    };
  }, [ref, key]);
}

export default function LookMedals({ seasons }) {
  const [picked, setPicked] = useState(seasons[0]?.seasonNumber);
  const season = seasons.find((s) => s.seasonNumber === picked) || seasons[0];
  const swap = useSwapClass(season?.seasonNumber);
  const listRef = useRef(null);
  useMedalsInView(listRef, season?.seasonNumber);
  useRowAligned(listRef, season?.seasonNumber);
  if (!season) return null;
  const items = season.awards.map((award) => {
    const won = winnerOf(award, season.seasonNumber);
    const w = { ...won, flag: flagCode(won.flag) };
    const name = holdInitials(w.name);
    return { award, w, name, fit: nameFit(name) };
  });
  const fits = rowFits(items.map((it) => it.fit));
  const count = items.length;
  // Four awards stand two and two rather than three and one on its own. Over
  // six, the medals come down a size: a long wall of them should not shout
  // over the champions above it.
  const shape = `${count === 4 ? "aw-medals-pairs" : "aw-medals-trio"}${count > 6 ? " aw-medals-many" : ""}`;
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
        <div key={season.seasonNumber} className={`aw-medals-frame ${swap}`}>
          <ul
            ref={listRef}
            role="list"
            className={`aw-medals-list ${shape} cascade relative flex flex-wrap justify-center px-3 py-7 sm:px-8 sm:py-8`}
          >
            {items.map((it, i) => (
              <MedalItem key={it.award.id} award={it.award} w={it.w} name={it.name} fit={fits[i]} index={i} />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
