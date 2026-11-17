// The Wrapped opening and closing like one piece of paper: a sheet in the
// button's colour grows out of the button to fill the screen, and shrinks
// back into it when the story is closed.
//
// Two things make it feel like one object rather than a box being cut:
// the corners stay visibly round the whole way (rounder while the sheet is
// big, exactly the button's rounding when it lands), and closing aims at the
// button where it is in every frame, not where it was when the page started
// loading: the page under the sheet still settles while it shrinks.
import { motionOff } from "../hooks/motion.js";

const MS = 760;

// The curve of cubic-bezier(0.65, 0, 0.35, 1): slow to start, quick in the
// middle, gentle at the end.
function bezier(x1, y1, x2, y2) {
  const at = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return (x) => {
    let lo = 0;
    let hi = 1;
    let t = x;
    for (let i = 0; i < 24; i += 1) {
      if (at(x1, x2, t) < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return at(y1, y2, t);
  };
}
const ease = bezier(0.65, 0, 0.35, 1);

// Where the last opening came from, so closing can go back to it.
let origin = null;

const radiusOf = (el) => parseFloat(getComputedStyle(el).borderTopLeftRadius) || parseFloat(getComputedStyle(el.parentElement || el).borderTopLeftRadius) || 16;
const screen = () => ({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight });
const mix = (a, b, e) => ({ left: a.left + (b.left - a.left) * e, top: a.top + (b.top - a.top) * e, width: a.width + (b.width - a.width) * e, height: a.height + (b.height - a.height) * e });
// Big sheets get rounder corners so the rounding still reads; small ones end
// on the button's own.
const roundness = (box, r) => Math.max(r, Math.min(24, Math.min(box.width, box.height) * 0.08));

function place(sheet, box, radius) {
  const s = sheet.style;
  s.left = `${box.left}px`;
  s.top = `${box.top}px`;
  s.width = `${box.width}px`;
  s.height = `${box.height}px`;
  s.borderRadius = `${radius}px`;
}

function makeSheet(colour, box, radius) {
  const sheet = document.createElement("div");
  Object.assign(sheet.style, { position: "fixed", background: colour, zIndex: "2147483000", pointerEvents: "none", willChange: "left, top, width, height" });
  place(sheet, box, radius);
  document.body.appendChild(sheet);
  return sheet;
}

// Runs `step(p)` every frame for MS, p from 0 to 1, then `done`.
function run(step, done) {
  const t0 = performance.now();
  const frame = (now) => {
    const p = Math.min(1, (now - t0) / MS);
    step(p);
    if (p < 1) requestAnimationFrame(frame);
    else done();
  };
  requestAnimationFrame(frame);
}

function fadeAway(sheet, delay = 0, ms = 360) {
  setTimeout(() => {
    const fade = sheet.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: "cubic-bezier(0.33, 0, 0.2, 1)", fill: "forwards" });
    fade.onfinish = () => sheet.remove();
  }, delay);
}

const canMove = () => !motionOff() && typeof document.body.animate === "function";

// The button (or card) `el` grows to fill the screen, then `go` opens the story.
export function growInto(el, colour, go) {
  const from = el?.getBoundingClientRect();
  if (!from || !canMove()) {
    go();
    return;
  }
  const r = radiusOf(el);
  origin = { colour };
  const sheet = makeSheet(colour, from, r);
  run(
    (p) => {
      const box = mix(from, screen(), ease(p));
      // Round all the way; square off only in the last moment, as the
      // sheet meets the edge of the screen.
      const k = p < 0.88 ? 1 : (1 - p) / 0.12;
      place(sheet, box, roundness(box, r) * k);
    },
    () => {
      go();
      // Give the story a moment to paint, then let the sheet go, slowly.
      fadeAway(sheet, 160);
    },
  );
}

// The story closes: the screen becomes the sheet again (in the colour of the
// slide it was on), `go` goes back, and the sheet shrinks into the Wrapped
// button on the page it lands on. Opened from anywhere else (a shared link),
// or with the button gone, it just goes back.
export function shrinkBack(go, fromColour) {
  const from = origin;
  if (!from || !canMove()) {
    go();
    return;
  }
  origin = null;
  const start = fromColour || from.colour;
  const sheet = makeSheet(start, screen(), 0);
  go();
  const t0 = performance.now();
  const land = () => {
    const target = document.querySelector("[data-wrapped-origin]");
    if (!target) {
      // The page is still loading; give it a little while, then just fade.
      if (performance.now() - t0 < 1500) requestAnimationFrame(land);
      else fadeAway(sheet);
      return;
    }
    const first = target.getBoundingClientRect();
    if (first.bottom < 0 || first.top > window.innerHeight) target.scrollIntoView({ block: "center" });
    const r = radiusOf(target);
    run(
      (p) => {
        // Measured every frame: the page may still shift under the sheet.
        const box = mix(screen(), target.getBoundingClientRect(), ease(p));
        // Rounded from the first moment it leaves the screen edge.
        const k = p < 0.1 ? p / 0.1 : 1;
        place(sheet, box, roundness(box, r) * k);
        const c = Math.round(Math.min(1, p / 0.55) * 100);
        sheet.style.background = `color-mix(in srgb, ${from.colour} ${c}%, ${start})`;
      },
      () => {
        // Stay on the button while fading, should it still move a pixel.
        const stay = () => {
          if (!sheet.isConnected) return;
          place(sheet, target.getBoundingClientRect(), r);
          requestAnimationFrame(stay);
        };
        requestAnimationFrame(stay);
        fadeAway(sheet, 0, 220);
      },
    );
  };
  requestAnimationFrame(land);
}
