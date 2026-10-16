// The motion engine of the "Smooth premium" package: a damped spring that
// keeps its velocity when its target moves (so a row that is still gliding to
// lap 12's slot carries straight on to lap 13's), one shared frame clock
// capped at 60 fps that stops itself when nothing is moving, the decelerating
// curves the numbers count along, and the same springs sampled into CSS
// `linear()` easings so the stylesheet's entrances settle exactly like the
// scripted ones.
import { useLayoutEffect, useRef, useEffect } from "react";
import { motionOff } from "../../hooks/motion.js";

// --- curves --------------------------------------------------------------------

// Long, graceful deceleration: most of the distance early, then a slow settle.
export const easeOutExpo = (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * Math.max(0, p)));
// A gentler sibling, for numbers: a quintic that keeps easing to the very end.
export const easeOutQuint = (p) => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 5);
// What a count should feel like: an expo that is exactly 1 at the end.
export const countEase = (p) => {
  const c = Math.min(1, Math.max(0, p));
  return c >= 1 ? 1 : (1 - Math.pow(2, -10 * c)) / (1 - Math.pow(2, -10));
};
// The draw curtains run on an ease-in-out sine, whose inverse is exact: the
// moment the curtain uncovers a given fraction of the chart.
export const sineInOut = (p) => 0.5 - Math.cos(Math.PI * p) / 2;
export const sineInOutInverse = (f) => Math.acos(1 - 2 * Math.min(1, Math.max(0, f))) / Math.PI;

// Step response of a damped spring (zero start velocity), x from 0 to 1.
function response(t, omega, zeta) {
  if (zeta >= 1) return 1 - (1 + omega * t) * Math.exp(-omega * t);
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
}

// The spring's response squeezed into t = 0..1: omega is chosen so the motion
// has settled (within 0.2%) by the end of the animation's duration.
function normalisedSpring(zeta) {
  let omega = 4;
  for (; omega < 40; omega += 0.1) {
    let ok = true;
    for (let t = 0.9; t <= 1.0001; t += 0.01) if (Math.abs(response(t, omega, zeta) - 1) > 0.002) ok = false;
    if (ok) break;
  }
  return (t) => (t >= 1 ? 1 : response(t, omega, zeta));
}

function toLinear(fn, n = 56) {
  const pts = [];
  for (let i = 0; i <= n; i += 1) pts.push(+fn(i / n).toFixed(4));
  pts[pts.length - 1] = 1;
  return `linear(${pts.join(", ")})`;
}

// Installs the spring easings as custom properties on the root, once, where
// the browser understands `linear()`. Where it does not, the stylesheet's
// var() fallbacks (long expo curves) take over.
let installed = false;
export function installSpringEasings() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  try {
    if (!window.CSS?.supports?.("animation-timing-function", "linear(0, 0.5, 1)")) return;
    const root = document.documentElement.style;
    root.setProperty("--sp-soft", toLinear(normalisedSpring(0.78))); // a whisper of overshoot, then still
    root.setProperty("--sp-calm", toLinear(normalisedSpring(1))); // critically damped: arrives, never passes
  } catch {
    /* fallbacks in the stylesheet */
  }
}

// --- the spring ------------------------------------------------------------------

export class Spring {
  constructor(value = 0, { omega = 14, zeta = 0.85, eps = 0.02 } = {}) {
    this.x = value;
    this.v = 0;
    this.target = value;
    this.omega = omega;
    this.zeta = zeta;
    this.eps = eps;
  }
  snap(value = this.target) {
    this.x = value;
    this.target = value;
    this.v = 0;
  }
  // Semi-implicit Euler in small fixed steps: stable at any frame rate.
  step(dt) {
    const h = 1 / 240;
    let left = dt;
    const { omega, zeta } = this;
    while (left > 1e-6) {
      const s = Math.min(h, left);
      const a = -2 * zeta * omega * this.v - omega * omega * (this.x - this.target);
      this.v += a * s;
      this.x += this.v * s;
      left -= s;
    }
    return this.settled;
  }
  get settled() {
    if (Math.abs(this.x - this.target) < this.eps && Math.abs(this.v) < this.eps * 4) {
      this.x = this.target;
      this.v = 0;
      return true;
    }
    return false;
  }
}

// --- the clock -------------------------------------------------------------------

// One requestAnimationFrame loop for every spring on the page. Subscribers get
// dt in seconds and return false when they are done; the loop stops when the
// last one is. Frames closer than 15 ms are skipped, so a 120 Hz screen still
// runs it at 60.
const subs = new Set();
let raf = 0;
let last = 0;
function loop() {
  const now = performance.now();
  raf = 0;
  if (now - last < 15) {
    raf = requestAnimationFrame(loop);
    return;
  }
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  for (const fn of [...subs]) {
    if (fn(dt) === false) subs.delete(fn);
  }
  if (subs.size) raf = requestAnimationFrame(loop);
}
export function onFrame(fn) {
  subs.add(fn);
  if (!raf) {
    last = performance.now() - 16;
    raf = requestAnimationFrame(loop);
  }
  return () => subs.delete(fn);
}

// --- springs on a list ------------------------------------------------------------

// Rows that ride to a new slot on springs. `targets` is [[id, y], …]; give
// each row `ref={node(id)}` and no transform of its own. A row seen for the
// first time is put straight in place; after that every change of target is
// followed by its spring, velocity kept, so a reshuffle that lands in the
// middle of the last one flows on instead of restarting.
export function useSpringRows(targets, opts) {
  const nodes = useRef(new Map());
  const refs = useRef(new Map());
  const springs = useRef(new Map());
  const stop = useRef(null);
  const write = (id, y) => {
    const el = nodes.current.get(id);
    if (el) el.style.transform = `translate3d(0,${y.toFixed(2)}px,0)`;
  };
  const node = (id) => {
    if (!refs.current.has(id)) {
      refs.current.set(id, (el) => {
        if (el) {
          nodes.current.set(id, el);
          const s = springs.current.get(id);
          if (s) el.style.transform = `translate3d(0,${s.x.toFixed(2)}px,0)`;
        } else nodes.current.delete(id);
      });
    }
    return refs.current.get(id);
  };
  useLayoutEffect(() => {
    const off = motionOff();
    let moving = false;
    for (const [id, y] of targets) {
      let s = springs.current.get(id);
      if (!s) {
        s = new Spring(y, { eps: 0.05, ...opts });
        springs.current.set(id, s);
        write(id, y);
        continue;
      }
      if (s.target === y && s.settled) continue;
      s.target = y;
      if (off) {
        s.snap(y);
        write(id, y);
      } else moving = true;
    }
    if (moving && !stop.current) {
      stop.current = onFrame((dt) => {
        let busy = false;
        for (const [id, s] of springs.current) {
          if (!s.step(dt)) busy = true;
          write(id, s.x);
        }
        if (!busy) {
          stop.current = null;
          return false;
        }
        return true;
      });
    }
  });
  useEffect(
    () => () => {
      if (stop.current) stop.current();
      stop.current = null;
    },
    []
  );
  return node;
}
