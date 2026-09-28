import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// The site's "design": which set of neutral colours the pages are drawn in —
// the page behind everything, the cards on it, the inset surfaces and the hair
// lines between them. Light and dark are still their own switch (useTheme);
// a design is the look WITHIN either of them, so every design has both a light
// and a dark version and the theme toggle keeps working the same way.
//
// Only the neutrals move. The series accent, the status colours and the text
// tones stay where index.css puts them, because those are measured against the
// card for contrast and a design that made "+10" or a red DNF unreadable would
// be a broken one, not a different one. The palettes themselves live in
// index.css under html[data-design="…"]; this hook only sets the attribute.
//
// Kept in this browser like the theme and the Lite mode, and applied before
// the first paint by the little script in index.html, so a reload does not
// flash the classic colours first.
// ---------------------------------------------------------------------------

const KEY = "nabs_design";

// The swatches are what the picker draws: [page, card, inset] for each theme.
// They are copies of the values in index.css, for the preview only.
export const DESIGNS = [
  {
    value: "classic",
    label: "Classic",
    hint: "The NABS look: cool blue-grey.",
    light: ["#e7ecf3", "#ffffff", "#f1f5f9"],
    dark: ["#080d18", "#131c2e", "#0d1626"],
  },
  {
    value: "carbon",
    label: "Carbon",
    hint: "Neutral greys, no tint at all.",
    light: ["#e9e9eb", "#ffffff", "#f3f3f4"],
    dark: ["#0b0b0c", "#18181b", "#111113"],
  },
  {
    value: "midnight",
    label: "Midnight",
    hint: "True black behind the cards. Easy on OLED screens at night.",
    light: ["#dfe5ef", "#ffffff", "#eef2f8"],
    dark: ["#000000", "#0e1320", "#05080f"],
  },
  {
    value: "ocean",
    label: "Ocean",
    hint: "A deeper blue, like the pit wall screens.",
    light: ["#dde8f3", "#ffffff", "#ecf3fa"],
    dark: ["#061426", "#0e2138", "#09192d"],
  },
  {
    value: "paddock",
    label: "Paddock",
    hint: "Warm, paper-like tones.",
    light: ["#ece6dc", "#fffdf9", "#f6f1e9"],
    dark: ["#12100d", "#201c17", "#181511"],
  },
];

const VALUES = new Set(DESIGNS.map((d) => d.value));

function initial() {
  try {
    const saved = localStorage.getItem(KEY);
    return VALUES.has(saved) ? saved : "classic";
  } catch {
    return "classic";
  }
}

// Shared module-level state so every useDesign() consumer stays in sync.
let current = initial();
const listeners = new Set();

function apply(design) {
  // Classic is the index.css default, so it needs no attribute at all.
  if (design === "classic") document.documentElement.removeAttribute("data-design");
  else document.documentElement.setAttribute("data-design", design);
  try {
    localStorage.setItem(KEY, design);
  } catch {
    // Private mode and friends: the choice just lasts until the tab closes.
  }
}
apply(current);

function setDesign(design) {
  current = VALUES.has(design) ? design : "classic";
  apply(current);
  listeners.forEach((notify) => notify(current));
}

export function useDesign() {
  const [design, setLocal] = useState(current);

  useEffect(() => {
    setLocal(current);
    listeners.add(setLocal);
    return () => listeners.delete(setLocal);
  }, []);

  return { design, setDesign };
}
