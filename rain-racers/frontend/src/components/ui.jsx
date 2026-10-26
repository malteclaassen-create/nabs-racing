import { Link } from "react-router-dom";
import { useSite } from "../site.jsx";
import { flag } from "../format.js";

export function Logo({ size = 36 }) {
  const { settings } = useSite();
  if (settings?.logoUrl) {
    return <img src={settings.logoUrl} alt="" style={{ height: size, width: "auto" }} className="block" />;
  }
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" className="block shrink-0">
      <rect width="64" height="64" rx="14" className="fill-card" stroke="rgb(var(--line))" strokeWidth="2" />
      <path d="M32 10C32 10 16 30 16 40a16 16 0 0 0 32 0C48 30 32 10 32 10z" className="fill-accent" />
      <path d="M24 41a8 8 0 0 0 8 8" stroke="rgb(var(--card))" strokeWidth="4" strokeLinecap="round" fill="none" />
    </svg>
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
    <Link to={`/drivers/${driver.id}`} className="hover:text-accent">
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
