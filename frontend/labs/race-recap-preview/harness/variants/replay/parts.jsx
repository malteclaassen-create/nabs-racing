// The small pieces every card of the replay recap shares: the reveal wait,
// numbers that count and settle, values that rise out of a mask, bars that
// draw with a soft head, the card, the label, the chapter header.
import { useEffect, useRef, useState } from "react";
import { motionOff } from "@site/hooks/motion.js";
import { countEase, installSpringEasings } from "./spring.js";

installSpringEasings();

// Whether the card this element sits in has been let in yet. Numbers wait
// for that rather than for being on screen, or they would count up behind
// a card that is still invisible.
export function useRevealed() {
  const ref = useRef(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const host = ref.current?.closest(".recap-reveal");
    if (!host || host.classList.contains("is-visible")) {
      setOn(true);
      return undefined;
    }
    const mo = new MutationObserver(() => {
      if (host.classList.contains("is-visible")) {
        setOn(true);
        mo.disconnect();
      }
    });
    mo.observe(host, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return [ref, on];
}

// A number that counts from what it was to what it is once its card is in,
// along a curve that does most of the distance early and then decelerates
// for a long, quiet settle. No pop at the end: it simply comes to rest.
export function Tween({ from = 0, to, decimals = 0, duration = 1600, delay = 420, prefix = "", suffix = "", className = "", lock = true }) {
  const [ref, on] = useRevealed();
  const start = from == null || !Number.isFinite(from) ? to : from;
  const [n, setN] = useState(start);
  useEffect(() => {
    if (!on || !Number.isFinite(to)) return undefined;
    if (motionOff() || start === to) {
      setN(to);
      return undefined;
    }
    let raf = 0;
    let last = 0;
    const t0 = performance.now() + delay;
    const tick = () => {
      const t = performance.now();
      if (t - last < 15) {
        raf = requestAnimationFrame(tick);
        return;
      }
      last = t;
      const p = Math.min(1, Math.max(0, (t - t0) / duration));
      setN(start + (to - start) * countEase(p));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on, start, to, duration, delay]);
  const shown = decimals ? n.toFixed(decimals) : Math.round(n).toLocaleString("en-US");
  return (
    <span ref={ref} className={`tabular-nums ${lock ? "inline-block" : ""} ${className}`}>
      {prefix}
      {shown}
      {suffix}
    </span>
  );
}

// A value that rises into place character by character from behind a mask,
// each a breath after the one before it. The wrapper is a block with its
// overflow hidden; only the characters' transforms move.
export function Ticker({ value, delay = 300, className = "" }) {
  const text = value == null ? "" : String(value);
  return (
    <span className={`rr-chars tabular-nums ${className}`}>
      <span className="sr-only">{text}</span>
      {[...text].map((c, i) => (
        <span key={i} className="rr-char" aria-hidden="true" style={{ "--cd": `${delay + i * 34}ms` }}>
          {c === " " ? "\u00a0" : c}
        </span>
      ))}
    </span>
  );
}

// A bar that grows by scale on a long decelerating curve, a soft head riding
// its tip and fading as it settles. `pct` is 0–100.
// `delay` in ms after the card is in. `children` are drawn over the track
// (markers that should not move).
export function Bar({ pct, h = "h-1.5", fill = "bg-light", fillStyle, delay = 0, track = "bg-surface2", cursor = true, rounded = "rounded-full", children, className = "" }) {
  const w = `${Math.max(0, Math.min(100, pct))}%`;
  return (
    <div className={`relative w-full ${h} ${rounded} ${track} ${className}`}>
      <div className={`bar-fill absolute left-0 top-0 h-full ${rounded} ${fill}`} style={{ "--w": w, "--bar-delay": `${delay}ms`, ...fillStyle }} />
      {children}
      {cursor && (
        <div className="rr-cursor pointer-events-none absolute inset-0" style={{ "--w": w, "--bar-delay": `${delay}ms` }} aria-hidden="true">
          <span className="rr-head absolute left-0 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-dark ring-2 ring-card" />
        </div>
      )}
    </div>
  );
}

// A card rises out of depth (a touch smaller, a little lower) and settles on
// a spring; its content follows a beat behind, a second layer of the same
// glide.
export function Card({ children, className = "", bodyClassName = "", as: Tag = "div" }) {
  return (
    <Tag className={`recap-reveal card p-4 sm:p-6 ${className}`}>
      <div className={`rr-body ${bodyClassName}`}>{children}</div>
    </Tag>
  );
}

// The eyebrow of a card carries a small team-colour tab, a broadcast tag.
export function Label({ children, className = "", tone = "text-eyebrow" }) {
  return (
    <div className={`font-mono text-[10px] font-bold uppercase tracking-[0.2em] ${tone} ${className}`}>
      {tone === "text-eyebrow" && <span className="rr-tab" aria-hidden="true" />}
      {children}
    </div>
  );
}

// "+3" in green, "−1" in red. `goodWhen` says which way is the good one.
export function Delta({ value, decimals = 0, suffix = "", className = "", arrow = false, goodWhen = "up" }) {
  if (value == null || !Number.isFinite(value)) return null;
  const zero = Math.abs(value) < (decimals ? 0.005 : 0.5);
  const up = value > 0;
  const good = goodWhen === "up" ? up : !up;
  const text = zero ? `±0${suffix}` : `${up ? "+" : "−"}${Math.abs(value).toFixed(decimals)}${suffix}`;
  return (
    <span className={`font-mono font-bold tabular-nums ${zero ? "text-light" : good ? "text-ok" : "text-bad"} ${className}`}>
      {arrow && !zero && (up ? "▲ " : "▼ ")}
      {text}
    </span>
  );
}

// A label on the left, a mono value on the right.
export function Row({ label, value, tone = "text-dark" }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <Label tone="text-light">{label}</Label>
      <span className={`font-mono text-sm font-bold tabular-nums ${tone}`}>{value}</span>
    </div>
  );
}

// A chapter of the recap, headed the way the site heads its pages: the faint
// index numeral, the brand eyebrow, the display-font title, a hairline rule
// under it (ui.jsx PageHeader). Each piece slides up out of its own mask (an
// overflow-hidden wrapper; only transforms move), one after another, and the
// rule draws out along a long ease.
export function Chapter({ n, title, sub, id }) {
  return (
    <header id={id} className="recap-reveal rr-chapter relative pb-3 pt-6 sm:pb-4 sm:pt-10">
      <div className="flex min-w-0 items-end gap-4">
        <span className="rr-mask shrink-0" aria-hidden="true">
          <span className="rr-ch-num block font-display text-4xl font-black leading-none tabular-nums text-faint">{n}</span>
        </span>
        <div className="min-w-0">
          {sub && (
            <div className="rr-mask rr-ch-sub font-mono text-[11px] font-bold uppercase tracking-widest text-eyebrow sm:text-[13px] sm:tracking-[0.2em]">
              <span className="rr-mask-in block truncate">{sub}</span>
            </div>
          )}
          <h2 className="rr-mask rr-ch-title font-display text-2xl font-extrabold uppercase tracking-tight text-dark sm:text-3xl">
            <span className="rr-mask-in block">{title}</span>
          </h2>
        </div>
      </div>
      <div className="rr-ch-rule absolute inset-x-0 bottom-0 h-px origin-left bg-border" aria-hidden="true" />
    </header>
  );
}
