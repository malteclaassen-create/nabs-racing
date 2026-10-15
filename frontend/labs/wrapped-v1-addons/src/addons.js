// What the first test page (test/wrapped) takes over from Season Wrapped v2,
// on four of its slides, without touching its own bundle beyond loading this:
//
//   intro    v2's ribbons, running behind the car (the film's black keyed out)
//   numbers  v2's wall of race blocks and its words, in place of the slide
//   climb    v2's words and the position plates flying up, over the film
//   summary  v2's ribbons behind the card
//
// It follows the story by its spoken line ("Slide 2 of 11. You started ...")
// and mounts its own layer into the story's frame for the slide on show.
import css from "./addons.css?inline";
import { createStage } from "../../wrapped-v2/src/stage.js";
import { setBand } from "../../wrapped-v2/src/scenes/kit.js";
import { DATA } from "../../wrapped-v2/src/data.js";
import { view, words, count, fade, slam, marquee, hint } from "../../wrapped-v2/src/ui.js";
import numbers from "../../wrapped-v2/src/scenes/numbers.js";
import climb from "../../wrapped-v2/src/scenes/climb.js";
import summary from "../../wrapped-v2/src/scenes/summary.js";
import keyedFilm from "./keyedFilm.js";

const style = document.createElement("style");
style.textContent = css;
document.head.append(style);

const KINDS = [
  { kind: "intro", test: /^Slide 1 of \d+\./ },
  { kind: "numbers", test: /You started/ },
  { kind: "climb", test: /Biggest climb/ },
  { kind: "summary", test: /\bSummary\b/ },
];

const numbersUi = (d) =>
  view(`
    ${marquee("The season in numbers", "38%")}
    <div class="eyebrow fade">The season in numbers</div>
    <div class="grow"></div>
    <h2 class="h2">${words("You started", 0.2)}</h2>
    ${slam(`<div class="big">${count(d.stats.starts, { at: 0.4, dur: 1 })}</div>`, 0.35)}
    <div class="unit">${words("races.", 0.9)}</div>
    ${fade(`<p class="sub">And finished ${d.stats.finishes} of them.</p>`, 1.6)}
    ${fade(
      `<div class="chips"><span class="chip">${count(d.stats.overtakes, { at: 2, dur: 1.4 })} overtakes</span><span class="chip">${count(d.stats.lapsLed, { at: 2.2, dur: 1.2 })} laps led</span></div>`,
      1.9
    )}
    ${hint("Tap a block", 2.6)}`);

const climbUi = (d) =>
  view(`
    <div class="eyebrow fade">Biggest climb</div>
    <h1 class="h1">${words("Through the field.", 0.2)}</h1>
    <div class="grow"></div>
    ${slam(`<div class="big" style="color:#39ff14">${count(d.climb.gained, { at: 1, dur: 1.6, prefix: "+" })}</div>`, 0.8)}
    <div class="unit">${words("places", 1.3)}</div>
    ${fade(`<div class="mono" style="margin-top:12px">P${d.climb.grid} → P${d.climb.position} · ${d.climb.track} · Round ${d.climb.round}</div>`, 1.8)}`);

let layer = null; // { kind, el, stage, restore() }

// The 3D keeps to the room the layer's words leave (their spacer).
setBand(() => {
  const g = layer?.el.querySelector(".grow");
  if (!g) return null;
  const r = g.getBoundingClientRect();
  const c = layer.el.getBoundingClientRect();
  return { top: (r.top - c.top) / c.height, bottom: (r.bottom - c.top) / c.height };
});

function frameEl() {
  return document.querySelector(".story-canvas")?.parentElement || null;
}

function unmount() {
  if (!layer) return;
  layer.stage?.destroy();
  layer.restore?.();
  layer.el.remove();
  layer = null;
}

function stageIn(el, makeScene) {
  const canvas = document.createElement("canvas");
  canvas.className = "nx-canvas";
  el.append(canvas);
  let ui = null;
  let t = 0;
  const stage = createStage(canvas, {
    onFrame(dt) {
      t += dt;
      ui?.update(t);
    },
  });
  if (!stage) return { stage: null, setUi: () => {} };
  Promise.resolve(makeScene(stage)).then((s) => s && stage.set(s));
  return { stage, setUi: (v) => (ui = v) };
}

function mount(kind) {
  const frame = frameEl();
  if (!frame) return false;
  const slideEl = frame.querySelector(".story-slide-in");
  const el = document.createElement("div");
  el.className = `nx nx-${kind}`;
  const restore = [];
  const hide = (node) => {
    if (!node) return;
    const prev = node.style.visibility;
    node.style.visibility = "hidden";
    restore.push(() => (node.style.visibility = prev));
  };

  if (kind === "intro") {
    const video = frame.querySelector(".story-film video");
    if (!video) return false;
    // In the film's own box, over the film, which then only feeds the key.
    const box = video.parentElement;
    box.append(el);
    const { stage } = stageIn(el, (s) => keyedFilm(s, video));
    const prev = video.style.opacity;
    video.style.opacity = "0";
    restore.push(() => (video.style.opacity = prev));
    layer = { kind, el, stage, restore: () => restore.forEach((f) => f()) };
    return true;
  }
  if (kind === "summary") {
    // Behind the slide's words and card.
    frame.insertBefore(el, frame.querySelector(".story-canvas").nextSibling);
    const { stage } = stageIn(el, (s) => summary(s, DATA, { slide: { bg: "#000000" } }));
    // The ribbons scene paints its own background: let the slide's show.
    if (stage) {
      const set = stage.set.bind(stage);
      stage.set = (def) => {
        if (def) {
          def.scene.background = null;
          def.transparent = true;
        }
        set(def);
      };
    }
    layer = { kind, el, stage, restore: () => restore.forEach((f) => f()) };
    return true;
  }
  if (kind === "numbers" || kind === "climb") {
    frame.append(el);
    hide(slideEl);
    const { stage, setUi } = stageIn(el, (s) =>
      kind === "numbers" ? numbers(s, DATA, { slide: { bg: "#0038ff" } }) : climb(s, DATA, { chevrons: false })
    );
    const v = kind === "numbers" ? numbersUi(DATA) : climbUi(DATA);
    el.append(v.el);
    setUi(v);
    if (kind === "numbers") {
      // A tap on a block flips it (and stays here); any other tap goes on
      // to the story as before.
      el.addEventListener(
        "pointerdown",
        (e) => {
          const def = stage?.scene;
          if (!def?.tap) return;
          const r = el.getBoundingClientRect();
          const ndc = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
          if (def.tap(ndc)) {
            e.stopPropagation();
            const stop = (ev) => ev.stopPropagation();
            el.addEventListener("pointerup", stop, { once: true, capture: true });
          }
        },
        true
      );
    }
    layer = { kind, el, stage, restore: () => restore.forEach((f) => f()) };
    return true;
  }
  return false;
}

// Follow the story.
let lastLine = "";
let wanted = null;
setInterval(() => {
  const live = document.querySelector('p[aria-live="polite"]');
  const line = live?.textContent || "";
  // The story replaced the slide under the layer (watch again, a re-render).
  if (layer && !layer.el.isConnected) {
    const kind = layer.kind;
    unmount();
    wanted = kind;
  }
  if (line === lastLine && (layer || !wanted)) return;
  if (line !== lastLine) {
    lastLine = line;
    unmount();
    wanted = KINDS.find((k) => k.test.test(line))?.kind || null;
  }
  // The slide's elements can arrive a moment after its line: try until then.
  if (wanted && !layer && mount(wanted)) wanted = layer ? null : wanted;
}, 120);
document.addEventListener("visibilitychange", () => layer?.stage?.pause(document.hidden));
