import { createElement, useEffect, useRef } from "react";
import { registerDirty } from "../utils/unsavedGuard.js";

// A form's side of utils/unsavedGuard.js: while the component is mounted, the
// registry can ask it whether it holds unsaved changes. `dirty` is read through
// a ref, so the check always answers with the latest render's value without
// registering again on every keystroke.
export function useUnsavedGuard(dirty, label) {
  const state = useRef({ dirty, label });
  state.current = { dirty, label };
  useEffect(() => registerDirty(() => (state.current.dirty ? state.current.label || "this form" : null)), []);
}

// The words beside a save button while something is unsaved. (createElement
// rather than JSX: this is a .js file, like the other hooks.)
export function UnsavedHint({ dirty, className = "" }) {
  if (!dirty) return null;
  return createElement("span", { className: `text-xs font-semibold text-warn ${className}`, role: "status" }, "Unsaved changes");
}
