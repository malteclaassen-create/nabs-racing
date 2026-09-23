// ---------------------------------------------------------------------------
// Unsaved changes, across the admin area.
//
// Every admin form keeps its edits in component state, and every way out of a
// form throws that state away without a word: another tab, a search hit, a
// different round in the picker, a reload. Somebody who had typed a round's
// classification by hand from a Discord message and clicked "Import" to check
// something lost the lot.
//
// So a form that has something unsaved says so here (registerDirty, or the
// useUnsavedGuard hook), and whatever is about to take the form off the screen
// asks first (confirmLeave). One registry rather than a prop threaded through
// every panel: the tab switch lives in Admin() and the forms live three
// components down, and neither should have to know the other exists.
//
// No React in here on purpose, so the rules can be tested with node alone.
// ---------------------------------------------------------------------------

// id -> () => label | null. The label says WHAT is unsaved ("Race Info"), for
// the question; null or "" means clean.
const checks = new Map();
let nextId = 1;

// The labels of everything unsaved right now, in registration order.
export function dirtyLabels() {
  const out = [];
  for (const check of checks.values()) {
    let label = null;
    try {
      label = check();
    } catch {
      label = null;
    }
    if (label) out.push(String(label));
  }
  return out;
}

export function anyDirty() {
  return dirtyLabels().length > 0;
}

// Register a dirty check. Returns the function that removes it again, which a
// form calls when it unmounts: a form that is gone has nothing left to lose.
export function registerDirty(check) {
  const id = nextId++;
  checks.set(id, check);
  syncBeforeUnload();
  return () => {
    checks.delete(id);
    syncBeforeUnload();
  };
}

// The question itself, worded from the labels.
export function leaveQuestion(labels) {
  const what = labels.length ? labels.join(", ") : "this form";
  return {
    title: "Leave without saving?",
    body: `Unsaved changes in ${what} will be lost.`,
    danger: true,
    confirmLabel: "Leave anyway",
  };
}

// Ask before leaving when anything is unsaved. `ask` is the app's own dialog
// (useAsk from overlay.jsx), which takes the same {title, body} object and
// resolves to true or false; without one the browser's confirm does the job.
// Resolves true when it is fine to go (nothing unsaved, or the admin said so).
export async function confirmLeave(ask) {
  const labels = dirtyLabels();
  if (!labels.length) return true;
  const q = leaveQuestion(labels);
  if (typeof ask === "function") return !!(await ask(q));
  if (typeof window === "undefined" || typeof window.confirm !== "function") return true;
  return window.confirm(`${q.title}\n\n${q.body}`);
}

// A reload or a closed tab can't be asked in our own words: the browser shows
// its generic "leave site?" prompt, and only when the page asks for it. The
// listener is only attached while at least one form is registered, so the rest
// of the site never carries it.
function onBeforeUnload(e) {
  if (!anyDirty()) return;
  e.preventDefault();
  // Older browsers still want a returnValue before they show the prompt.
  e.returnValue = "";
}

let listening = false;
function syncBeforeUnload() {
  if (typeof window === "undefined") return;
  const want = checks.size > 0;
  if (want && !listening) window.addEventListener("beforeunload", onBeforeUnload);
  if (!want && listening) window.removeEventListener("beforeunload", onBeforeUnload);
  listening = want;
}
