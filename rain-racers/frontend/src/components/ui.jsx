import { Link } from "react-router-dom";
import { useSite } from "../site.jsx";
import { flag } from "../format.js";

// The league's logo: an uploaded one from the admin, else the Rain Racers
// mark (black disc, white streaks and car) shipped in public/brand/.
export function Logo({ size = 36 }) {
  const { settings } = useSite();
  return (
    <img
      src={settings?.logoUrl || "/brand/logo-256.png"}
      alt=""
      style={{ height: size, width: settings?.logoUrl ? "auto" : size }}
      className="block shrink-0 rounded-full ring-1 ring-white/25"
    />
  );
}

// The logo's rounded rain streaks at 45 degrees as a drifting background.
//
// One square tile, drawn so that it repeats without a seam: every streak runs
// along a 45-degree line through the tile, and each one is drawn nine times
// (shifted by a tile in every direction) so the parts that leave one edge come
// back in at the opposite one. Two layers of it, a near one and a smaller,
// fainter, faster far one, slide down along the streaks by exactly one tile,
// so the loop never jumps.
const TILE = 160;
const PILLS = [
  [40, 40, 90],
  [120, 120, 60],
  [80, 80, 120],
  [0, 0, 40],
];
function streakTile(color) {
  const shapes = [];
  for (const [cx, cy, len] of PILLS) {
    for (const dx of [-TILE, 0, TILE]) {
      for (const dy of [-TILE, 0, TILE]) {
        const x = cx + dx;
        const y = cy + dy;
        shapes.push(`<rect x="${x - len / 2}" y="${y - 11}" width="${len}" height="22" rx="11" transform="rotate(-45 ${x} ${y})"/>`);
      }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}" viewBox="0 0 ${TILE} ${TILE}"><g fill="${color}">${shapes.join("")}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
const TILES = { white: streakTile("#ffffff"), black: streakTile("#000000") };

export function Streaks({ opacity = 0.07, tone = "white", className = "" }) {
  const image = TILES[tone] || TILES.white;
  return (
    <div className={`streaks ${className}`} aria-hidden="true">
      <div className="streaks-far" style={{ backgroundImage: image, opacity: opacity * 0.55 }} />
      <div className="streaks-near" style={{ backgroundImage: image, opacity }} />
    </div>
  );
}

// Whether the visitor asked their system for less motion.
export function prefersLessMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// Staggered entrance: the n-th item rises in a little after the one before.
export const rise = (i = 0, step = 60) => ({ className: "rise", style: { "--d": `${Math.min(i, 14) * step}ms` } });

// A big headline in leaning capitals, one word per line, each sliding
// up out of its own mask.
export function HeroTitle({ text, className = "text-6xl sm:text-8xl" }) {
  return (
    <h1 className={`display max-w-[10ch] ${className}`} aria-label={text}>
      {String(text || "")
        .split(/\s+/)
        .map((word, i) => (
          <span key={i} className="title-line" aria-hidden="true">
            <span style={{ "--d": `${120 + i * 110}ms` }}>{word}</span>
          </span>
        ))}
    </h1>
  );
}

export function TeamDot({ team, className = "" }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${className}`}
      style={{ background: team?.color || "rgb(var(--muted) / 0.5)" }}
      aria-hidden="true"
    />
  );
}

export function DriverName({ driver, link = true }) {
  const body = (
    <span className="inline-flex items-center gap-2">
      {driver.number != null && <span className="w-7 text-right font-mono text-xs text-muted">#{driver.number}</span>}
      <span className="font-semibold">{driver.name}</span>
      {driver.country && <span title={driver.country}>{flag(driver.country)}</span>}
    </span>
  );
  return link ? (
    <Link to={`/drivers/${driver.id}`} className="hover:opacity-70">
      {body}
    </Link>
  ) : (
    body
  );
}

export function TeamName({ team }) {
  if (!team) return <span className="text-muted">—</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <TeamDot team={team} />
      <span>{team.name}</span>
    </span>
  );
}

export function Position({ value, status }) {
  if (status && status !== "FIN") return <span className="font-mono text-xs font-bold text-muted">{status}</span>;
  const tone = value === 1 ? "bg-amber-400 text-bg" : value === 2 ? "bg-slate-300 text-bg" : value === 3 ? "bg-orange-400 text-bg" : "text-ink";
  return <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1 text-xs font-black tabular ${tone}`}>{value}</span>;
}

export function PageHeader({ eyebrow, title, children }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <div className="eyebrow rise mb-1">{eyebrow}</div>}
        <h1 className="h1">
          <span className="title-line">
            <span style={{ "--d": "60ms" }}>{title}</span>
          </span>
        </h1>
      </div>
      {children}
    </div>
  );
}

// The seasons of the series being looked at, when it has more than one.
export function SeasonPicker() {
  const { series, seasonId, setSeasonId } = useSite();
  const seasons = series?.seasons || [];
  if (seasons.length < 2) return null;
  return (
    <select className="input w-auto" value={seasonId ?? ""} onChange={(e) => setSeasonId(Number(e.target.value))} aria-label="Season">
      {seasons.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

// A series' name with its colour, as a small pill.
export function SeriesBadge({ series, className = "" }) {
  if (!series) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[11px] font-black uppercase italic ${className}`}>
      <span className="h-2 w-2 rounded-full" style={{ background: series.color || "rgb(var(--ink))" }} />
      {series.name}
    </span>
  );
}

export function Loading() {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="shimmer h-8 w-48 rounded-lg" />
      <div className="shimmer h-64 rounded-2xl" />
    </div>
  );
}

export function Empty({ children }) {
  return <div className="card px-6 py-10 text-center text-sm text-muted">{children}</div>;
}

export function ErrorBox({ error }) {
  return <div className="card border-red-500/40 px-6 py-6 text-sm text-red-300">{error?.message || String(error)}</div>;
}

const ICONS = {
  discord:
    "M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.3 18.3 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5C.6 9.2-.3 13.8.1 18.3a19.9 19.9 0 0 0 6 3l1.3-2a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2a19.8 19.8 0 0 0 6-3c.5-5.2-.8-9.7-3.6-13.9ZM8 15.6c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.8 8 10.8s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z",
  youtube:
    "M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8ZM9.6 15.6V8.4l6.3 3.6-6.3 3.6Z",
};

export function SocialIcon({ name, className = "h-4 w-4" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

// "Join the Discord" and "YouTube" as buttons, for whichever links are set.
export function SocialButtons() {
  const { settings } = useSite();
  return (
    <>
      {settings?.discordInvite && (
        <a href={settings.discordInvite} target="_blank" rel="noopener noreferrer" className="btn-ghost">
          <SocialIcon name="discord" />
          Join the Discord
        </a>
      )}
      {settings?.youtubeUrl && (
        <a href={settings.youtubeUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost">
          <SocialIcon name="youtube" />
          YouTube
        </a>
      )}
    </>
  );
}
