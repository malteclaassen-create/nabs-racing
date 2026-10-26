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
export function Streaks({ opacity = 0.07 }) {
  return (
    <div className="streaks" aria-hidden="true">
      <svg>
        <defs>
          <pattern id="rr-streaks" width="220" height="88" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
            <rect x="0" y="6" width="128" height="30" rx="15" fill="white" />
            <rect x="148" y="6" width="58" height="30" rx="15" fill="white" />
            <rect x="78" y="50" width="56" height="30" rx="15" fill="white" />
            {/* one streak across the tile's edge: drawn on both sides so it joins up */}
            <rect x="152" y="50" width="126" height="30" rx="15" fill="white" />
            <rect x="-68" y="50" width="126" height="30" rx="15" fill="white" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#rr-streaks)" opacity={opacity} />
      </svg>
    </div>
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
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h1 className="h1">{title}</h1>
      </div>
      {children}
    </div>
  );
}

export function SeasonPicker() {
  const { seasons, seasonId, setSeasonId } = useSite();
  if (seasons.length < 2) return null;
  const current = seasons.find((s) => s.isCurrent)?.id ?? seasons[0]?.id;
  return (
    <select className="input w-auto" value={seasonId ?? current} onChange={(e) => setSeasonId(Number(e.target.value))} aria-label="Season">
      {seasons.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

export function Loading() {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="h-8 w-48 animate-pulse rounded-lg bg-card" />
      <div className="h-64 animate-pulse rounded-2xl bg-card" />
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
