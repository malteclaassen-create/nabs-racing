import { useEffect, useRef, useState } from "react";
import { prefersLessMotion } from "./ui.jsx";
import { useSite } from "../site.jsx";

// Page changes as a downpour of the logo's streaks.
//
// Lanes of rounded streaks at 45 degrees, each in its own shade (of black,
// white and the league or series colour), rain in from the top right with a
// spray of small drops ahead, until they cover the screen; the new page is put
// in underneath; then they run on out at the bottom left and their tails
// uncover it. The page shown is held back (`display`)
// until the screen is covered, so the old page never flickers into the new
// one half way.
//
// The first visit opens with the logo in the middle of the streaks, which
// then part to show the page. Moves inside one page (the admin's tabs, a
// changed ?season=) swap at once, and so does everything for anyone who
// asked their system for less motion.

// The drops fall slower than the cover comes: they start nearly together
// (60 ms apart at most), so a calmer fall still covers the screen in about
// the same time.
const IN_MS = 560; // until the screen is covered
const OUT_MS = 660; // until the last drop has run off
const INTRO_HOLD = 650; // the opening: how long the logo shows before the rain clears
// How long after the page swap its own entrance animations wait, so they play
// as the streaks clear instead of under them.
const ENTER_AFTER_INTRO = "720ms";
const ENTER_AFTER_SWAP = "160ms";

// One "page" for the transition: the admin's tabs count as one.
const pageKey = (loc) => (loc.pathname.startsWith("/admin") ? "/admin" : loc.pathname);

export function useRainTransition(location) {
  const [display, setDisplay] = useState(location);
  const [phase, setPhase] = useState(() => (prefersLessMotion() ? "idle" : "intro"));
  const [enter, setEnter] = useState(() => (prefersLessMotion() ? "0ms" : ENTER_AFTER_INTRO));
  const timers = useRef([]);
  const frame = useRef(0);
  const enterTimer = useRef(null);
  // the entrance delay goes back to nothing once the page is in, so things
  // shown later (a table after its data arrives) do not wait for no reason
  const delayEnter = (value, forMs) => {
    clearTimeout(enterTimer.current);
    setEnter(value);
    enterTimer.current = setTimeout(() => setEnter("0ms"), forMs);
  };

  // the opening: streaks part around the logo once
  useEffect(() => {
    if (phase !== "intro") return undefined;
    // (unless a page change has taken over the overlay meanwhile)
    const t = setTimeout(() => setPhase((p) => (p === "intro" ? "idle" : p)), INTRO_HOLD + OUT_MS);
    delayEnter(ENTER_AFTER_INTRO, 2600);
    return () => clearTimeout(t);
  }, []); // the first render only

  useEffect(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    cancelAnimationFrame(frame.current);
    if (pageKey(location) === pageKey(display) || prefersLessMotion()) {
      setDisplay(location);
      if (pageKey(location) !== pageKey(display)) window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    setPhase("in");
    timers.current.push(
      setTimeout(() => {
        setDisplay(location);
        window.scrollTo({ top: 0, behavior: "instant" });
        delayEnter(ENTER_AFTER_SWAP, 2000);
        // the streaks clear once the new page is drawn underneath (two
        // frames: React's render, then the browser's paint), so building
        // the page does not stall the way out
        frame.current = requestAnimationFrame(() => {
          frame.current = requestAnimationFrame(() => {
            setPhase("out");
            timers.current.push(setTimeout(() => setPhase("idle"), OUT_MS));
          });
        });
      }, IN_MS + 40),
    );
  }, [location]); // when the address changes; `display` is read, not watched

  // While the streaks come in, the header's blur is not worked out again for
  // every frame. The page's own background rain keeps falling throughout.
  useEffect(() => {
    document.documentElement.classList.toggle("wiping", phase === "in");
  }, [phase]);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      clearTimeout(enterTimer.current);
      cancelAnimationFrame(frame.current);
    },
    [],
  );

  return { display, phase, enter, displayKey: pageKey(display) };
}

// The rain is drawn on one canvas: hundreds of drops as a few filled paths a
// frame (one per shade), where as many elements would each be a layer for
// the phone to move.

const rnd = (a, b) => a + Math.random() * (b - a);

// The page's colours as they are now (the accent follows the series), and the
// shades the drops get: mostly near-black like the page, then the accent and
// white, each in a few strengths, with how often each comes up.
function readPalette() {
  const style = getComputedStyle(document.documentElement);
  const rgb = (name, fallback) => (style.getPropertyValue(name).trim() || fallback).split(/[\s,]+/).map(Number);
  const bg = rgb("--bg", "0 0 0");
  const ink = rgb("--ink", "255 255 255");
  const accent = rgb("--accent", "255 255 255");
  const mix = (to, t) => `rgb(${bg.map((v, i) => Math.round(v + (to[i] - v) * t)).join(",")})`;
  return {
    bg: mix(ink, 0),
    shades: [
      [mix(ink, 0.08), 3],
      [mix(ink, 0.13), 3],
      [mix(ink, 0.19), 2],
      [mix(ink, 0.27), 1],
      [mix(accent, 1), 2],
      [mix(accent, 0.72), 2],
      [mix(accent, 0.48), 2],
      [mix(ink, 0.92), 1],
      [mix(ink, 0.6), 1],
    ],
    spray: [mix(accent, 1), mix(ink, 1)],
  };
}

function pickShade(shades) {
  let n = Math.random() * shades.reduce((sum, [, w]) => sum + w, 0);
  for (let i = 0; i < shades.length; i++) {
    n -= shades[i][1];
    if (n < 0) return i;
  }
  return 0;
}

// How long a drop takes to cross the screen. Every drop falls at this one
// speed from the moment it comes in until it has run off: no slowing down
// while the screen is covered, no start from standing on the way out.
const CROSS_MS = 460;

// Where every drop goes, for a screen of W x H. Drawn in a frame turned 45
// degrees around the middle, where "down" runs to the bottom left; `h` is
// half the side of that frame's square that covers the whole screen.
function makeScene(W, H) {
  const palette = readPalette();
  // with room to spare: on a phone the browser's bars come and go while the
  // drops are out (the page scrolls to the top under them), and the way out
  // runs the same drops on the taller or shorter screen
  const h = ((W + H * 1.3) * Math.SQRT1_2) / 2 + 4;
  // the streaks' size follows the screen's (about 25 to 60 pixels wide on a phone)
  const unit = Math.max(W, H) / 40;
  // Lanes side by side, each an endless train of drops of their own length
  // and shade (one stretch, repeated), on a black base so no page shows
  // between them. The lanes start a little apart, so the front is ragged;
  // on the way out each train is cut behind the drops already in, a little
  // apart too, and runs off.
  const lanes = [];
  for (let x = -h; x < h; ) {
    const w = rnd(1.2, 2.8) * unit;
    const drops = [];
    let y = 0;
    while (y < 2 * h) {
      const len = Math.min(rnd(4, 12) * w, h / 2);
      drops.push({ y, len, shade: pickShade(palette.shades) });
      y += len + rnd(5, 11);
    }
    lanes.push({ x, w: w + 1, drops, period: y, inD: rnd(0, 60), outD: rnd(0, 60) });
    x += w;
  }
  // the spray: small drops falling fast, ahead on the way in, behind on the way out
  const spray = Array.from({ length: Math.min(70, Math.round((h * h) / 6000)) }, () => ({
    x: rnd(-h, h),
    len: rnd(24, 80),
    w: rnd(3, 6),
    tone: Math.random() < 0.5 ? 0 : 1,
    faint: Math.random() < 0.5,
    inD: rnd(0, 320),
    inT: rnd(180, 340),
    outD: rnd(0, 320),
    outT: rnd(180, 260),
  }));
  return { W, H, h, v: (2 * h) / CROSS_MS, lanes, spray, palette };
}

// A streak round at both ends, its front at `front`, `len` long.
function drop(path, x, w, front, len) {
  const r = w / 2;
  path.moveTo(x + w, front - r);
  path.arc(x + r, front - r, r, 0, Math.PI);
  path.arc(x + r, front - len + r, r, Math.PI, 2 * Math.PI);
  path.closePath();
}

// One frame, `t` milliseconds after the drops started coming in; `outAt`
// the moment they started running off (null while the screen stays
// covered). Returns whether anything is still moving.
function paint(ctx, scene, size, t, outAt) {
  const { h, v, palette } = scene;
  const { W, H, dpr } = size;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(W / 2, H / 2);
  ctx.rotate(Math.PI / 4);

  let moving = outAt == null;
  const base = new Path2D();
  const shades = palette.shades.map(() => new Path2D());
  for (const lane of scene.lanes) {
    const { x, w, drops, period } = lane;
    // the front of the lane's train, and on the way out the line it is cut
    // at: drops still behind it never come in
    const head = -h + v * (t - lane.inD);
    const cut = outAt == null ? null : -h + v * (t - outAt - lane.outD);
    if (head < -h - w) {
      moving = true;
      continue;
    }
    let top = cut == null ? -h - w - 10 : null; // where the black base begins
    // the repeats of the lane's stretch that reach the screen, nearest the front first
    for (let k = Math.max(0, Math.floor((head - h - 2) / period)); ; k++) {
      const start = head - k * period;
      if (start < -h - 2 || (cut != null && start < cut)) break;
      for (const d of drops) {
        const front = start - d.y;
        if (cut != null && front < cut) break;
        if (cut != null) top = top == null ? front - d.len : Math.min(top, front - d.len);
        if (front < -h - 2 || front - d.len > h + 2) continue;
        // a sliver inside the lane, so lanes next to each other stay apart
        drop(shades[d.shade], x + 2, w - 4, front, d.len);
      }
    }
    if (top == null || top > h) continue; // run off
    moving = true;
    const end = Math.min(head, h + w + 10);
    if (end > top) drop(base, x, w, end, end - top + 4);
  }
  ctx.fillStyle = palette.bg;
  ctx.fill(base);
  shades.forEach((path, i) => {
    ctx.fillStyle = palette.shades[i][0];
    ctx.fill(path);
  });

  const spray = [
    [new Path2D(), new Path2D()],
    [new Path2D(), new Path2D()],
  ];
  for (const s of scene.spray) {
    const way = outAt != null && t >= outAt;
    const p = way ? (t - outAt - s.outD) / s.outT : (t - s.inD) / s.inT;
    if (p > 0 && p < 1) {
      moving = true;
      drop(spray[s.tone][s.faint ? 1 : 0], s.x, s.w, -h + (2 * h + s.len) * p, s.len);
    }
  }
  spray.forEach(([strong, faint], tone) => {
    ctx.fillStyle = palette.spray[tone];
    ctx.globalAlpha = 0.85;
    ctx.fill(strong);
    ctx.globalAlpha = 0.4;
    ctx.fill(faint);
  });
  ctx.globalAlpha = 1;
  return moving;
}

export function RainOverlay({ phase }) {
  const { settings } = useSite();
  const canvas = useRef(null);
  const scene = useRef(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!ctx) return undefined;
    if (phase === "idle") {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, el.width, el.height);
      scene.current = null;
      return undefined;
    }
    const W = window.innerWidth;
    const H = window.innerHeight;
    // sharp on phones, but not more pixels than a big screen can redraw
    const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(4e6 / (W * H)));
    if (el.width !== Math.round(W * dpr) || el.height !== Math.round(H * dpr)) {
      el.width = Math.round(W * dpr);
      el.height = Math.round(H * dpr);
    }
    const now = performance.now();
    // The way out runs off the same drops, in the same shades, that came in
    // (also when the screen has changed size meanwhile: new drops would bring
    // the colours of the page underneath, which is already the next one),
    // carrying on where they are. The opening starts covered (as if the
    // drops had come in already) and runs off after the logo.
    if (phase === "in") scene.current = { ...makeScene(W, H), inStart: now, outAt: null };
    else if (phase === "out") {
      if (!scene.current) scene.current = { ...makeScene(W, H), inStart: now - IN_MS };
      scene.current.outAt = now - scene.current.inStart;
    } else {
      scene.current = { ...makeScene(W, H), inStart: now - IN_MS };
      scene.current.outAt = IN_MS + INTRO_HOLD;
    }
    const sc = scene.current;
    const size = { W, H, dpr };
    let raf = 0;
    const frame = (time) => {
      if (paint(ctx, sc, size, time - sc.inStart, sc.outAt)) raf = requestAnimationFrame(frame);
    };
    frame(now);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  return (
    <div className="wipe" data-phase={phase} aria-hidden="true">
      <canvas ref={canvas} className="wipe-canvas" />
      {phase === "intro" && <img src={settings?.logoUrl || "/brand/logo.png"} alt="" className="wipe-logo" />}
    </div>
  );
}
