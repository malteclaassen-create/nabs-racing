// Small shared presentational helpers — the site-wide design kit.

import { useEffect, useState } from "react";
import { useInView } from "../hooks/motion.js";

export const MEDAL = ["#EAB308", "#94A3B8", "#C2410C"]; // gold / silver / bronze (filled chips)
// Medal tones for text/borders on the card background — theme-aware (deeper in
// light mode so gold/silver stay readable on white; see --medal-* in index.css).
export const MEDAL_TEXT = ["var(--medal-1)", "var(--medal-2)", "var(--medal-3)"];

// Number that counts up from 0 to `end` the first time it scrolls into view.
// Falls straight to the final value when motion is reduced. `prefix`/`suffix`
// wrap the number (e.g. "+", "pts"); non-numeric stats should just render plain.
export function CountUp({ end, prefix = "", suffix = "", duration = 1200, decimals = 0, className = "" }) {
  // Pre-trigger a little below the viewport so the count-up is already running
  // when the number scrolls in — a standing "0" at the bottom edge looks broken.
  const [ref, inView] = useInView({ rootMargin: "0px 0px 20% 0px" });
  const target = Number(end);
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!inView || !isFinite(target)) return;
    // Straight to the final value under reduced motion and in lite graphics
    // mode (both themes animate; Performance → Lite is the single off-switch).
    const html = document.documentElement.classList;
    const reduce =
      (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) ||
      html.contains("fx-lite");
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

// Odometer number: each digit slides to its value so counters roll instead of
// hard-swapping (used by the race countdown). `value` is a number; `digits`
// pads to a minimum width (2 for a clock field). Styling (size/colour/font)
// comes from the parent — 1em drives the digit height, so it just works.
function RollDigit({ digit }) {
  return (
    <span className="roll-digit">
      <span className="roll-col" style={{ transform: `translateY(${digit * -10}%)` }}>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <span key={n} className="roll-cell">{n}</span>
        ))}
      </span>
    </span>
  );
}

export function RollingNumber({ value, digits = 2, className = "" }) {
  const str = String(Math.max(0, Math.floor(Number(value) || 0))).padStart(digits, "0");
  return (
    <span className={`inline-flex tabular-nums ${className}`} aria-label={str} role="text">
      {str.split("").map((d, i) => (
        <RollDigit key={i} digit={Number(d)} />
      ))}
    </span>
  );
}

// Which constructor table a car scores in. The race preview used to carry its
// own near-identical copy of this in sky/violet, so the same badge looked
// different before and after a result was saved; the explanatory titles came
// from that copy and are kept here.
export function TierBadge({ tier }) {
  if (tier === 1)
    return <span className="pill bg-brand/20 text-dark" title="Scores in the Tier 1 constructors' table">T1</span>;
  if (tier === 2)
    return <span className="pill bg-link/10 text-link" title="Scores in the Tier 2 table (re-ranked among Tier-2 cars)">T2</span>;
  return <span className="pill bg-surface2 text-light" title="Reserve: scores only for the team it subs for">RES</span>;
}

// --- colour helpers --------------------------------------------------------
function parseHex(hex) {
  let c = String(hex || "").replace("#", "").trim();
  if (c.length === 3) c = c.split("").map((x) => x + x).join("");
  if (!/^[0-9a-f]{6}$/i.test(c)) return null;
  return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16));
}
const toHex = (rgb) => "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
function relLuminance([r, g, b]) {
  const ch = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}
const contrast = (a, b) => {
  const [x, y] = [relLuminance(a), relLuminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

// A team colour used as TEXT, nudged until it is actually readable on the
// current theme. Every one of the league's 18 team colours failed the 4.5:1
// bar on at least one of the two themes when used raw: McLaren's orange sits
// at 2.6 on white, Toro Rosso's navy near 1.2 on the dark card.
//
// It blends toward the theme's own text colour only as far as each colour
// needs, rather than a fixed mix: Ferrari red barely moves, a pale orange moves
// a lot, and the team stays recognisable in a way a flat 50% mix would not.
// Returns the colour unchanged when it already carries.
export function readableAccent(hex, { dark = false, target = 4.5 } = {}) {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  // The theme's own --c-card / --c-text from index.css. Kept in step with them:
  // guessing the dark card a few points too dark left Ferrari at 4.38 instead
  // of clearing the bar.
  const ground = dark ? [19, 28, 46] : [255, 255, 255]; // --c-card
  const ink = dark ? [232, 238, 247] : [15, 23, 42]; // --c-text
  if (contrast(rgb, ground) >= target) return hex;
  for (let step = 1; step <= 20; step++) {
    const p = 1 - step / 20;
    const mixed = rgb.map((v, i) => v * p + ink[i] * (1 - p));
    if (contrast(mixed, ground) >= target) return toHex(mixed);
  }
  return toHex(ink);
}

// Ink colour that stays readable on an arbitrary team colour. Some teams race
// in white, pale yellow or the brand pink, and always-white initials vanished
// on those (white on white at worst). Relative luminance per WCAG; the 0.179
// cut-off is where black overtakes white on contrast.
export function readableInkOn(bgHex) {
  let c = String(bgHex || "").replace("#", "").trim();
  if (c.length === 3) c = c.split("").map((x) => x + x).join("");
  if (!/^[0-9a-f]{6}$/i.test(c)) return "#fff"; // unparseable -> previous behaviour
  const channel = (v) => {
    const s = parseInt(v, 16) / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const luminance =
    0.2126 * channel(c.slice(0, 2)) + 0.7152 * channel(c.slice(2, 4)) + 0.0722 * channel(c.slice(4, 6));
  return luminance > 0.179 ? "#0F172A" : "#fff";
}

// Driver avatar: shows the photo if present, else the initials on the team
// colour. `size` is the pixel diameter.
export function DriverAvatar({ name, photoUrl, color = "#888", size = 44, className = "" }) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const initials = (name || "?")
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const showPhoto = photoUrl && !photoFailed;
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-display font-black ring-2 ring-black/5 ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        fontSize: size * 0.38,
        color: readableInkOn(color),
      }}
    >
      {showPhoto ? (
        <img
          src={photoUrl}
          alt={name}
          className="h-full w-full object-cover"
          loading="lazy"
          // A dead picture link falls back to the initials instead of leaving an
          // empty coloured disc (hiding the <img> used to show nothing at all).
          onError={() => setPhotoFailed(true)}
        />
      ) : (
        initials
      )}
    </span>
  );
}

export function StatusPill({ status }) {
  if (!status || status === "FINISHED") return null;
  // Tinted with the site's usual <colour>-500/15 wash rather than the solid
  // -100 shades: those were the only near-white chips in the app and glared out
  // of a dark card. DSQ also used to be styled `text-link`, i.e. the blue
  // accent on a red chip, which read as a mistake next to amber-on-amber DNF.
  const map = {
    DNS: "bg-border text-medium",
    DNF: "bg-amber-500/15 text-warn",
    DSQ: "bg-red-500/15 text-bad",
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

// Movement since the previous round, championship-table style: ▲n climbed,
// ▼n fell, a quiet dash for held station. null = no history to compare
// against (season opener, or the season is decided and the table should sit
// still).
//
// Shown on phones too. This was once switched off below sm, which meant the
// single most interesting thing about a standings table the morning after a
// race — who moved, and by how much — was missing on the device most people
// read it on. It costs a narrow column: on phones the arrow carries a compact
// digit, and the "no change" dash sits out entirely rather than spending
// width on nothing.
export function PosDelta({ delta }) {
  if (delta == null) return null;
  if (delta === 0)
    return <span className="hidden w-7 shrink-0 text-center font-mono text-[11px] font-bold text-light/60 sm:block">–</span>;
  const up = delta > 0;
  return (
    <span
      className={`flex w-5 shrink-0 items-center justify-center gap-0.5 font-mono text-[10px] font-bold tabular-nums sm:w-7 sm:text-[11px] ${
        up ? "text-ok" : "text-bad"
      }`}
      title={`${up ? "Up" : "Down"} ${Math.abs(delta)} since the last round`}
    >
      <svg viewBox="0 0 10 10" className="h-2 w-2" fill="currentColor" aria-hidden="true">
        {up ? <path d="M5 1l4 7H1z" /> : <path d="M5 9L1 2h8z" />}
      </svg>
      {Math.abs(delta)}
    </span>
  );
}

export function Spinner({ label = "Loading…" }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-light">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-brand" />
      <span className="font-mono text-[13px] uppercase tracking-wider">{label}</span>
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

// Friendly empty state: a clear title + hint (plus optional extra content),
// instead of a bare grey sentence. Used wherever a page or filter comes up
// with nothing.
export function EmptyState({ title, hint, children, className = "" }) {
  return (
    <div className={`card flex flex-col items-center px-6 py-12 text-center ${className}`}>
      <div className="font-display text-lg font-extrabold uppercase tracking-tight text-dark">{title}</div>
      {hint && <p className="mt-1.5 max-w-md text-sm leading-relaxed text-medium">{hint}</p>}
      {children}
    </div>
  );
}

// The site's shared "this didn't load" state.
//
// Most pages hand their whole body to this on a failed read (`if (error) return
// <ErrorBox …/>`), so what it renders IS the page in that moment. It used to be
// a bare red strip carrying whatever string came back, which left a visitor on
// an otherwise empty screen with one technical line and no way forward. It now
// carries a heading, the message, and — when the caller passes `onRetry` — a
// button, because a failed read is usually a blip and asking again fixes it.
// useApi already returns `reload`, so wiring it up at a call site is one prop.
//
// role="alert" so a screen reader hears it: this appears after an action, and
// the reader is not looking at the part of the page that changed.
//
// — the 600 shade sits under 4.5:1 on a dark card, and this
// is shared feedback, so every page that shows an error inherited that.
export function ErrorBox({ message, onRetry, title = "That didn't load" }) {
  return (
    <div
      role="alert"
      className="card border-red-500/30 bg-red-500/10 p-5 text-bad"
    >
      <div className="font-display text-base font-extrabold uppercase tracking-tight">{title}</div>
      <p className="mt-1 text-sm font-medium">{message || "Something went wrong."}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 px-3 py-1.5 text-sm font-semibold transition hover:bg-red-500/10"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 11a8 8 0 1 0-2.3 5.7" />
            <path d="M20 5v6h-6" />
          </svg>
          Try again
        </button>
      )}
    </div>
  );
}

// Themed inline notice — consistent success/info/error feedback across the
// admin area (replaces ad-hoc green/red boxes; works in light & dark mode).
export function Notice({ kind = "success", children }) {
  const styles = {
    success: "border-emerald-500/30 bg-emerald-500/10 text-ok",
    info: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300",
    error: "border-red-500/30 bg-red-500/10 text-bad",
  };
  if (!children) return null;
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm font-medium ${styles[kind] || styles.success}`}>
      {children}
    </div>
  );
}

// Consistent card section header: brand-pink mono eyebrow + display title.
// The strip across the top of a card: a hairline underneath, and the same
// horizontal padding as the card body so the two line up.
//
// This existed as hand-written classes in more than twenty places and had
// drifted apart. On the driver profile alone, three of the four bars carried
// `sm:px-6` and the fourth did not, so the same card sat inset differently on
// desktop depending which section you looked at; title sizes ranged from
// text-base to text-xl for the same job.
//
//   <CardBar title="Team" />                        title only
//   <CardBar title="Season form" right={<Menu />} /> title left, controls right
//   <CardBar>{anything}</CardBar>                    just the bar's geometry
//
// Note this is NOT CardHead below, which is the margin-based heading used
// INSIDE an already-padded admin card. Different job, deliberately separate.
export function CardBar({ title, right, as: Tag = "h2", className = "", children }) {
  const bar = `border-b border-border px-5 py-4 sm:px-6 ${className}`;
  const heading = "font-display text-lg font-extrabold uppercase tracking-tight text-dark sm:text-xl";
  if (children) return <div className={bar}>{children}</div>;
  if (!right) return <Tag className={`${bar} ${heading}`}>{title}</Tag>;
  return (
    <div className={`flex items-center justify-between gap-3 ${bar}`}>
      <Tag className={heading}>{title}</Tag>
      {right}
    </div>
  );
}

export function CardHead({ eyebrow, title, children }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        {eyebrow && (
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">{eyebrow}</div>
        )}
        <h3 className="font-display text-lg font-extrabold uppercase tracking-tight text-dark">{title}</h3>
      </div>
      {children}
    </div>
  );
}

// Page header matching the home-page section style: faint index numeral,
// brand-pink mono eyebrow, display-font uppercase title, hairline rule.
// `rightInline`: keeps `right` beside the title on phones too — only for
// controls small enough to share the line (e.g. the two tier pills on
// Constructors); wide filter bars keep the default stacked row.
export function PageHeader({ index, eyebrow, title, subtitle, right, rightInline = false }) {
  return (
    <div className="mb-4 border-b border-border pb-4 sm:mb-8 sm:pb-5">
      {/* On phones `right` (filters, pills) gets its own row under the title —
          side by side it collided with the title on narrow screens. */}
      <div
        className={
          rightInline
            ? "flex flex-row items-end justify-between gap-3 sm:gap-4"
            : "flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4"
        }
      >
        <div className="flex min-w-0 items-end gap-4">
          {index && (
            <span className="font-display text-4xl font-black leading-none text-faint">{index}</span>
          )}
          <div className="min-w-0">
            {eyebrow && (
              <div className="font-mono text-[11px] font-bold uppercase tracking-widest text-eyebrow sm:text-[13px] sm:tracking-[0.2em]">
                {eyebrow}
              </div>
            )}
            {/* rightInline shares the phone row with controls, so the title
                steps down a notch there to leave them room. */}
            {/* break-words because a title can be someone's own display name
                (the welcome screen greets a new member by theirs), and a long
                one without spaces would otherwise push the row sideways. */}
            <h1 className={`break-words font-display font-extrabold uppercase tracking-tight text-dark sm:text-4xl ${rightInline ? "text-2xl" : "text-3xl"}`}>
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
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">
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
