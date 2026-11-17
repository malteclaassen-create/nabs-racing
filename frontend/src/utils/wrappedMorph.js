// The Wrapped opening and closing like one piece of paper: a sheet in the
// button's colour grows out of the button to fill the screen, and shrinks
// back into it when the story is closed. The corners keep the button's
// rounding the whole way and only square off as the sheet meets the screen
// edge, so it reads as the button getting bigger, not a box being cut open.
import { motionOff } from "../hooks/motion.js";

const MS = 760;
// Slow to start, quick in the middle, gentle at the end.
const EASE = "cubic-bezier(0.65, 0, 0.35, 1)";

// Where the last opening came from, so closing can go back to it.
let origin = null;

const radiusOf = (el) => parseFloat(getComputedStyle(el).borderTopLeftRadius) || parseFloat(getComputedStyle(el.parentElement || el).borderTopLeftRadius) || 16;

const boxOf = (r) => ({ left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
const fullBox = () => ({ left: "0px", top: "0px", width: `${window.innerWidth}px`, height: `${window.innerHeight}px` });

function makeSheet(colour, box, radius) {
  const sheet = document.createElement("div");
  Object.assign(sheet.style, { position: "fixed", background: colour, borderRadius: `${radius}px`, zIndex: "2147483000", pointerEvents: "none", ...box });
  document.body.appendChild(sheet);
  return sheet;
}

function fadeAway(sheet, delay = 0, ms = 360) {
  setTimeout(() => {
    const fade = sheet.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: "cubic-bezier(0.33, 0, 0.2, 1)", fill: "forwards" });
    fade.onfinish = () => sheet.remove();
  }, delay);
}

// The button (or card) `el` grows to fill the screen, then `go` opens the story.
export function growInto(el, colour, go) {
  const rect = el?.getBoundingClientRect();
  if (!rect || motionOff() || typeof document.body.animate !== "function") {
    go();
    return;
  }
  const radius = radiusOf(el);
  origin = { colour, radius };
  const sheet = makeSheet(colour, boxOf(rect), radius);
  sheet.animate([boxOf(rect), fullBox()], { duration: MS, easing: EASE, fill: "forwards" });
  // Round until the sheet is all but full size, square only as it lands.
  const corners = sheet.animate([{ borderRadius: `${radius}px` }, { borderRadius: `${radius}px`, offset: 0.86 }, { borderRadius: "0px" }], { duration: MS, easing: "linear", fill: "forwards" });
  corners.onfinish = () => {
    go();
    // Give the story a moment to paint, then let the sheet go, slowly.
    fadeAway(sheet, 160);
  };
}

// The story closes: the screen becomes the sheet again (in the colour of the
// slide it was on), `go` goes back, and the sheet shrinks into the Wrapped
// button on the page it lands on. Opened from anywhere else (a shared link),
// or with the button gone, it just goes back.
export function shrinkBack(go, fromColour) {
  const from = origin;
  if (!from || motionOff() || typeof document.body.animate !== "function") {
    go();
    return;
  }
  origin = null;
  const sheet = makeSheet(fromColour || from.colour, fullBox(), 0);
  go();
  const started = performance.now();
  const land = () => {
    const target = document.querySelector("[data-wrapped-origin]");
    if (!target) {
      // The page is still loading; give it a little while, then just fade.
      if (performance.now() - started < 1500) requestAnimationFrame(land);
      else fadeAway(sheet);
      return;
    }
    let rect = target.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      target.scrollIntoView({ block: "center" });
      rect = target.getBoundingClientRect();
    }
    const radius = radiusOf(target);
    sheet.animate([fullBox(), boxOf(rect)], { duration: MS, easing: EASE, fill: "forwards" });
    sheet.animate([{ background: fromColour || from.colour }, { background: from.colour, offset: 0.55 }, { background: from.colour }], { duration: MS, easing: "linear", fill: "forwards" });
    // Rounded from the first moment it leaves the screen edge.
    const corners = sheet.animate([{ borderRadius: "0px" }, { borderRadius: `${radius}px`, offset: 0.14 }, { borderRadius: `${radius}px` }], { duration: MS, easing: "linear", fill: "forwards" });
    corners.onfinish = () => fadeAway(sheet, 0, 220);
  };
  requestAnimationFrame(land);
}
