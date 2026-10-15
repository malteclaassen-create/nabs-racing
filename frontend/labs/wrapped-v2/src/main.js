// Season Wrapped v2: the story. A start screen loads everything (films,
// fonts, the car) and waits for a tap on Play, which also lets the phone
// play the films. Then slide after slide: a 3D scene to play with on the
// canvas, the words over it, and the real car's film under it on three of
// them. Tap right / left to move, hold to pause, drag to play with the 3D.
import "./style.css";
import { createStage } from "./stage.js";
import { DATA, FILM } from "./data.js";
import { SLIDES } from "./slides.js";
import { loadCar } from "./scenes/kit.js";
import { shareCard } from "./share.js";

const $ = (s) => document.querySelector(s);
const app = $("#app");
const film = $("#film");
const ui = $("#ui");
const wipe = $("#wipe");
const chrome = $("#chrome");
const start = $("#start");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

const slides = SLIDES.filter((s) => !s.when || s.when(DATA));
const blobs = {}; // film key -> object URL
let stage = null;
let index = -1;
let elapsed = 0; // seconds into the current slide
let current = null; // { slide, sceneDef, ui }
let busy = false; // a transition is running
let userPaused = false;
let holding = false;
let dragging = false;
let hidden = document.hidden;
let started = false;
const built = new Map(); // slide index -> Promise<sceneDef>

// --- the top: progress bars, logo, pause, close ---------------------------
chrome.innerHTML = `
  <div class="bars">${slides.map(() => "<i></i>").join("")}</div>
  <div class="top">
    <img src="logo.png" alt="">
    <span class="dev">DEV</span>
    <span class="label">${DATA.season.label} Wrapped</span>
    <span class="sp"></span>
    <button type="button" data-act="pause" aria-label="Pause"><svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg></button>
    <button type="button" data-act="close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
  </div>`;
chrome.style.display = "none";
const bars = [...chrome.querySelectorAll(".bars i")];
const pauseBtn = chrome.querySelector('[data-act="pause"]');
const PAUSE_ICON = pauseBtn.innerHTML;
const PLAY_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l12-7z"/></svg>';
chrome.addEventListener("pointerdown", (e) => e.stopPropagation());
chrome.addEventListener("click", (e) => {
  const act = e.target.closest("button")?.dataset.act;
  if (act === "pause") setUserPaused(!userPaused);
  if (act === "close") close();
});

function setUserPaused(on) {
  userPaused = on;
  pauseBtn.innerHTML = on ? PLAY_ICON : PAUSE_ICON;
  pauseBtn.setAttribute("aria-label", on ? "Play" : "Pause");
  syncPlay();
}
const running = () => started && !busy && !userPaused && !holding && !dragging && !hidden;
function syncPlay() {
  const run = running();
  ui.classList.toggle("paused", !run);
  if (current?.slide.film) {
    if (run) film.play().catch(() => {});
    else film.pause();
  }
}

// --- the start screen ---------------------------------------------------------
function showStart(again = false) {
  start.innerHTML = `
    <div class="startscreen">
      <img class="logo" src="logo.png" alt="">
      <h1>Your ${DATA.season.label},<br><em>wrapped.</em></h1>
      <p>NABS Racing · F1 Friday</p>
      <div class="loadbar"${again ? ' style="display:none"' : ""}><i></i></div>
      <button class="play" type="button"${again ? "" : " disabled"}>${again ? "Play again" : "Loading"}</button>
    </div>`;
  start.querySelector(".play").addEventListener("click", play, { once: true });
}

async function preload() {
  const bar = () => start.querySelector(".loadbar i");
  const keys = [...new Set(slides.map((s) => s.film).filter(Boolean))];
  const total = {};
  const got = {};
  const progress = () => {
    const t = Object.values(total).reduce((a, b) => a + b, 0) || 1;
    const g = Object.values(got).reduce((a, b) => a + b, 0);
    bar()?.style.setProperty("--p", `${Math.round(Math.min(0.98, g / t) * 100)}%`);
  };
  await Promise.all([
    ...keys.map(async (k) => {
      total[k] = 1;
      got[k] = 0;
      try {
        const res = await fetch(FILM[k].src);
        total[k] = Number(res.headers.get("content-length")) || 4e6;
        const reader = res.body.getReader();
        const parts = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value);
          got[k] += value.length;
          progress();
        }
        blobs[k] = URL.createObjectURL(new Blob(parts, { type: "video/mp4" }));
      } catch {
        blobs[k] = null;
      }
      await new Promise((r) => {
        const i = new Image();
        i.onload = i.onerror = r;
        i.src = FILM[k].poster;
      });
    }),
    loadCar(),
    document.fonts?.load?.("900 40px Archivo"),
    document.fonts?.load?.("700 16px 'JetBrains Mono'"),
    document.fonts?.load?.("700 16px Inter"),
  ]);
  bar()?.style.setProperty("--p", "100%");
  // The first slide's 3D, ready before Play.
  build(0);
  await built.get(0);
  const btn = start.querySelector(".play");
  btn.disabled = false;
  btn.textContent = "Play";
}

function play() {
  // This tap is what lets the phone play the films (Low Power Mode and
  // friends refuse until the page is touched): start the first one inside it.
  const first = slides[0].film;
  if (first && blobs[first]) {
    film.src = blobs[first];
    film.poster = FILM[first].poster;
    film.play().catch(() => {});
  }
  // Tilt for the scenes that follow the phone (iOS asks once, in a tap).
  try {
    const D = window.DeviceOrientationEvent;
    if (D && typeof D.requestPermission === "function") D.requestPermission().catch(() => {});
  } catch {
    /* no tilt, then */
  }
  start.innerHTML = "";
  chrome.style.display = "";
  started = true;
  index = -1;
  setUserPaused(false);
  go(0, null, true);
}

function close() {
  started = false;
  film.pause();
  film.classList.remove("on");
  chrome.style.display = "none";
  ui.innerHTML = "";
  stage?.set(null);
  current = null;
  for (const [i, p] of built) {
    p.then((s) => s?.dispose?.());
    built.delete(i);
  }
  app.style.setProperty("--bg", "#050507");
  showStart(true);
  build(0);
}

// --- slides ---------------------------------------------------------------------
function build(i) {
  if (i < 0 || i >= slides.length || !stage) return null;
  if (!built.has(i)) {
    const p = Promise.resolve()
      .then(() => slides[i].scene?.(stage, DATA, { reduced, slide: slides[i] }) ?? null)
      .then((s) => {
        if (s) stage.warm(s);
        return s;
      })
      .catch((err) => {
        console.warn("scene failed", slides[i].id, err);
        return null;
      });
    built.set(i, p);
  }
  return built.get(i);
}

async function go(i, from, instant = false) {
  if (busy || i < 0 || i >= slides.length || i === index) return;
  busy = true;
  syncPlay();
  const slide = slides[i];
  const nextScene = build(i);
  if (!instant && !reduced) {
    wipe.classList.remove("out");
    wipe.style.setProperty("--wbg", slide.bg);
    wipe.style.setProperty("--x", from ? `${from.x}px` : i > index ? "100%" : "0%");
    wipe.style.setProperty("--y", from ? `${from.y}px` : "50%");
    void wipe.offsetWidth;
    wipe.classList.add("go");
    await Promise.all([new Promise((r) => setTimeout(r, 500)), nextScene]);
  } else {
    await nextScene;
  }
  const sceneDef = await nextScene;
  built.delete(i);
  // Swap everything while the circle covers the frame.
  const prev = index;
  index = i;
  elapsed = 0;
  app.style.setProperty("--bg", slide.bg);
  app.style.setProperty("--ink", slide.ink);
  app.style.setProperty("--accent", slide.accent || "#39ff14");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", slide.bg);
  if (slide.film && blobs[slide.film]) {
    if (film.dataset.key !== slide.film) {
      film.dataset.key = slide.film;
      film.poster = FILM[slide.film].poster;
      film.src = blobs[slide.film];
    }
    film.currentTime = 0;
    film.classList.add("on");
  } else {
    film.classList.remove("on");
    film.pause();
  }
  const view = slide.ui(DATA, { reduced });
  ui.innerHTML = "";
  ui.append(view.el);
  current = { slide, sceneDef, view };
  stage.set(sceneDef);
  if (sceneDef) sceneDef.clock = 0;
  bars.forEach((b, k) => b.style.setProperty("--p", k < i ? 1 : 0));
  announce(slide, prev);
  // Let the circle go.
  wipe.classList.remove("go");
  wipe.classList.add("out");
  busy = false;
  syncPlay();
  // The next slide's 3D, built while this one plays.
  setTimeout(() => started && index === i && build(i + 1), 700);
  // Anything built for a slide we jumped past.
  for (const [k, p] of built) {
    if (k !== i + 1) {
      p.then((s) => s?.dispose?.());
      built.delete(k);
    }
  }
}

const next = (from) => (index < slides.length - 1 ? go(index + 1, from) : null);
const back = (from) => (index > 0 ? go(index - 1, from) : (elapsed = 0));

const live = document.createElement("p");
live.setAttribute("aria-live", "polite");
live.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)";
app.append(live);
function announce(slide) {
  live.textContent = `Slide ${index + 1} of ${slides.length}. ${slide.say?.(DATA) ?? ""}`;
}

// --- every frame -----------------------------------------------------------------
function onFrame(dt) {
  if (!started || !current) return;
  if (running()) {
    elapsed += dt;
    const dur = current.slide.dur;
    if (dur && elapsed >= dur) {
      if (index < slides.length - 1) next(null);
      else elapsed = dur;
    }
  }
  const dur = current.slide.dur;
  bars[index]?.style.setProperty("--p", dur ? Math.min(1, elapsed / dur) : 1);
  if (current.sceneDef) current.sceneDef.clock = elapsed;
  current.view.update?.(elapsed);
  // Keep a film with the story's clock, without seeking it all the time.
  if (current.slide.film && film.duration && running() && Math.abs(film.currentTime - Math.min(elapsed, film.duration - 0.05)) > 1.2 && !film.seeking) {
    film.currentTime = Math.min(elapsed, film.duration - 0.05);
  }
}

// --- touch: tap to move, hold to pause, drag to play with the 3D -------------
let down = null;
let holdTimer = 0;
app.addEventListener("pointerdown", (e) => {
  if (!started || e.target.closest("button, a")) return;
  down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t: performance.now() };
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => {
    if (down && !dragging) {
      holding = true;
      syncPlay();
    }
  }, 230);
});
app.addEventListener("pointermove", (e) => {
  if (!down) return;
  const dx = e.clientX - down.lx;
  const dy = e.clientY - down.ly;
  if (!dragging && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) {
    dragging = true;
    holding = false;
    syncPlay();
  }
  if (dragging) current?.sceneDef?.drag?.(dx, dy, e);
  down.lx = e.clientX;
  down.ly = e.clientY;
});
function up(e) {
  if (!down) return;
  clearTimeout(holdTimer);
  const quick = performance.now() - down.t < 230;
  const wasDrag = dragging;
  const wasHold = holding;
  const at = { x: down.x, y: down.y };
  down = null;
  if (wasDrag) {
    // A swipe down closes; a sideways swipe moves on or back (when the
    // slide's 3D doesn't take sideways drags itself).
    current?.sceneDef?.release?.();
    dragging = false;
  }
  holding = false;
  syncPlay();
  if (wasDrag || wasHold || !quick || e.type === "pointercancel") return;
  const ndc = { x: (at.x / innerWidth) * 2 - 1, y: -(at.y / innerHeight) * 2 + 1 };
  if (current?.sceneDef?.tap?.(ndc, at)) return;
  if (at.x < innerWidth * 0.3) back(at);
  else next(at);
}
app.addEventListener("pointerup", up);
app.addEventListener("pointercancel", up);
app.addEventListener("contextmenu", (e) => e.preventDefault());

document.addEventListener("keydown", (e) => {
  if (!started) return;
  if (e.key === "ArrowRight") next(null);
  else if (e.key === "ArrowLeft") back(null);
  else if (e.key === " ") {
    e.preventDefault();
    setUserPaused(!userPaused);
  } else if (e.key === "Escape") close();
});
document.addEventListener("visibilitychange", () => {
  hidden = document.hidden;
  stage?.pause(hidden);
  syncPlay();
});

// The summary's buttons.
ui.addEventListener("click", (e) => {
  const act = e.target.closest("button")?.dataset.act;
  if (act === "again") {
    index = -1;
    go(0, null, true);
  }
  if (act === "share") shareCard(DATA).catch(() => {});
});
ui.addEventListener("pointerdown", (e) => {
  if (e.target.closest("button")) e.stopPropagation();
});

// --- go -----------------------------------------------------------------------
stage = createStage($("#stage"), { onFrame });
showStart(false);
preload();

// ?debug: a handle for tests.
if (new URLSearchParams(location.search).has("debug")) {
  window.__story = { get current() { return current; }, get elapsed() { return elapsed; }, stage };
}
