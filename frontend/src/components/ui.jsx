// Small shared presentational helpers — the site-wide design kit.

import { useEffect, useState } from "react";
import { useInView } from "../hooks/motion.js";

export const MEDAL = ["#EAB308", "#94A3B8", "#C2410C"]; // gold / silver / bronze

// Number that counts up from 0 to `end` the first time it scrolls into view.
// Falls straight to the final value when motion is reduced. `prefix`/`suffix`
// wrap the number (e.g. "+", "pts"); non-numeric stats should just render plain.
export function CountUp({ end, prefix = "", suffix = "", duration = 1200, decimals = 0, className = "" }) {
  const [ref, inView] = useInView();
  const target = Number(end);
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!inView || !isFinite(target)) return;
    const reduce =
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setN(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic — fast then settles
      setN(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, target, duration]);

  if (!isFinite(target)) {
    return <span className={className}>{end}</span>;
  }
  const shown = decimals > 0 ? n.toFixed(decimals) : Math.round(n).toLocaleString("en-US");
  return (
    <span ref={ref} className={`tabular-nums ${className}`}>
      {prefix}
      {shown}
      {suffix}
    </span>
  );
}

export function TierBadge({ tier }) {
  if (tier === 1)
    return <span className="pill bg-brand/20 text-dark">T1</span>;
  if (tier === 2)
    return <span className="pill bg-primary/10 text-primary">T2</span>;
  return <span className="pill bg-surface2 text-light">RES</span>;
}

// Driver avatar: shows the photo if present, else the initials on the team
// colour. `size` is the pixel diameter.
export function DriverAvatar({ name, photoUrl, color = "#888", size = 44, className = "" }) {
  const initials = (name || "?")
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-display font-black text-white ring-2 ring-black/5 ${className}`}
      style={{ width: size, height: size, backgroundColor: color, fontSize: size * 0.38 }}
    >
      {photoUrl ? (
        <img
          src={photoUrl}
          alt={name}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={(e) => (e.currentTarget.style.display = "none")}
        />
      ) : (
        initials
      )}
    </span>
  );
}

export function StatusPill({ status }) {
  if (!status || status === "FINISHED") return null;
  const map = {
    DNS: "bg-border text-medium",
    DNF: "bg-amber-100 text-amber-700",
    DSQ: "bg-red-100 text-primary",
  };
  return <span className={`pill ${map[status] || "bg-surface2"}`}>{status}</span>;
}

export function TeamDot({ color }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-black/10"
      style={{ backgroundColor: color }}
    />
  );
}

// Filled medallion rank chip (gold/silver/bronze for the podium) — the single
// rank treatment used across every standings/results table.
export function Rank({ position, className = "" }) {
  const medal = position >= 1 && position <= 3 ? MEDAL[position - 1] : null;
  return (
    <span
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md font-display text-sm font-black tabular-nums ${
        medal ? "text-ink" : "text-medium"
      } ${className}`}
      style={medal ? { backgroundColor: medal } : undefined}
    >
      {position}
    </span>
  );
}

export function Spinner({ label = "Loading…" }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-light">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-brand" />
      <span className="font-mono text-sm uppercase tracking-wider">{label}</span>
    </div>
  );
}

// --- Skeleton loaders -------------------------------------------------
// Shown while data fetches, in place of the spinner, so navigation doesn't
// flash an empty centered page (and the footer stays put). Each skeleton
// mirrors the real layout it stands in for, so there's no shift on load.

export function Skeleton({ className = "" }) {
  return <div className={`animate-pulse rounded bg-border/70 ${className}`} aria-hidden="true" />;
}

// Placeholder for the PageHeader (eyebrow + title + subtitle + hairline).
export function PageHeaderSkeleton() {
  return (
    <div className="mb-8 border-b border-border pb-5">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-9 w-72 max-w-[70%]" />
      <Skeleton className="mt-4 h-4 w-96 max-w-full" />
    </div>
  );
}

// A standings/list card with `rows` placeholder rows.
export function TableSkeleton({ rows = 8 }) {
  return (
    <div className="card divide-y divide-border overflow-hidden">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <Skeleton className="h-8 w-8 shrink-0 rounded-md" />
          <Skeleton className="h-9 w-1.5 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40 max-w-[55%]" />
            <Skeleton className="h-3 w-28 max-w-[35%]" />
          </div>
          <Skeleton className="hidden h-1.5 w-40 md:block" />
          <Skeleton className="h-6 w-12 shrink-0" />
        </div>
      ))}
    </div>
  );
}

// A responsive grid of card placeholders (Teams etc.).
export function CardsSkeleton({ count = 8, cols = "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" }) {
  return (
    <div className={`grid gap-4 ${cols}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card overflow-hidden">
          <Skeleton className="h-1.5 w-full rounded-none" />
          <div className="space-y-3 p-5">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ErrorBox({ message }) {
  return (
    <div className="card border-red-500/30 bg-red-500/10 p-4 text-sm font-medium text-red-600">
      {message || "Something went wrong."}
    </div>
  );
}

// Themed inline notice — consistent success/info/error feedback across the
// admin area (replaces ad-hoc green/red boxes; works in light & dark mode).
export function Notice({ kind = "success", children }) {
  const styles = {
    success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
    info: "border-sky-500/30 bg-sky-500/10 text-sky-600",
    error: "border-red-500/30 bg-red-500/10 text-red-600",
  };
  if (!children) return null;
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm font-medium ${styles[kind] || styles.success}`}>
      {children}
    </div>
  );
}

// Consistent card section header: brand-pink mono eyebrow + display title.
export function CardHead({ eyebrow, title, children }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        {eyebrow && (
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-brand">{eyebrow}</div>
        )}
        <h3 className="font-display text-lg font-extrabold uppercase tracking-tight text-dark">{title}</h3>
      </div>
      {children}
    </div>
  );
}

// Page header matching the home-page section style: faint index numeral,
// brand-pink mono eyebrow, display-font uppercase title, hairline rule.
export function PageHeader({ index, eyebrow, title, subtitle, right }) {
  return (
    <div className="mb-8 border-b border-border pb-5">
      <div className="flex items-end justify-between gap-4">
        <div className="flex items-end gap-4">
          {index && (
            <span className="font-display text-4xl font-black leading-none text-faint">{index}</span>
          )}
          <div>
            {eyebrow && (
              <div className="font-mono text-[13px] font-bold uppercase tracking-[0.2em] text-brand">
                {eyebrow}
              </div>
            )}
            <h1 className="font-display text-3xl font-extrabold uppercase tracking-tight text-dark sm:text-4xl">
              {title}
            </h1>
          </div>
        </div>
        {right}
      </div>
      {subtitle && <p className="mt-3 max-w-3xl text-[15px] text-light">{subtitle}</p>}
    </div>
  );
}

// Smaller section heading (display font + brand eyebrow), for sub-sections.
export function SectionHeading({ eyebrow, title, right }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <div className="font-mono text-[12px] font-bold uppercase tracking-[0.2em] text-brand">
            {eyebrow}
          </div>
        )}
        <h2 className="font-display text-xl font-extrabold uppercase tracking-tight text-dark sm:text-2xl">
          {title}
        </h2>
      </div>
      {right}
    </div>
  );
}
