// ---------------------------------------------------------------------------
// The site's overlay layer: one dismissal contract, one focus contract, one
// scroll lock, one stacking tier.
//
// Before this, seven overlays each implemented their own half of the job. Every
// one of them handled Escape and most handled a click outside; NONE of them
// trapped focus, and none gave focus back to whatever opened them — so a
// keyboard user tabbing inside the settings drawer walked straight out the back
// of it into the page underneath, and landed nowhere in particular on close.
// Only two of the seven locked body scroll, so the rest let the page scroll
// away behind the panel.
//
// Three pieces, smallest first:
//   useDismiss  — Escape + outside click. Shared with the dropdown menus, which
//                 want dismissal WITHOUT focus trapping (moving focus into a
//                 menu that opened on hover is hostile).
//   <Modal>     — the full contract: trap, lock, restore, aria, animation.
//   <Confirm>   — the "are you sure" dialog, plus the imperative `ask()` that
//                 lets a call site keep reading like the window.confirm it
//                 replaces, including the dozen that pass a server error
//                 message from inside a catch block.
// ---------------------------------------------------------------------------
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Elements that can hold focus, in DOM order. Used by the trap.
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// How many overlays currently hold the body scroll lock. Nested overlays are
// real (a confirm opened from inside the settings drawer), and the first one to
// close must not hand scrolling back while the second is still up.
let lockCount = 0;
let lockedOverflow = "";

// The scroll lock as a hook, for an overlay that keeps its own markup (the
// feedback sheet, whose panel is anchored to its floating button rather than
// centred, so the Modal shells do not fit it).
export function useScrollLock(active) {
  useEffect(() => (active ? lockScroll() : undefined), [active]);
}

function lockScroll() {
  if (lockCount === 0) {
    lockedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  lockCount += 1;
  return () => {
    lockCount -= 1;
    if (lockCount === 0) document.body.style.overflow = lockedOverflow;
  };
}

// Escape and click-outside, the two dismissals every floating thing shares.
// `ref` is the panel; a click inside it is not "outside". Pass an `anchorRef`
// as well when the trigger sits outside the panel, so clicking the trigger
// again closes rather than closing-then-reopening.
export function useDismiss(open, onDismiss, { ref, anchorRef, escape = true, outside = true } = {}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation(); // innermost overlay wins, not every one at once
        onDismiss();
      }
    };
    const onDown = (e) => {
      if (ref?.current?.contains(e.target)) return;
      if (anchorRef?.current?.contains(e.target)) return;
      onDismiss();
    };
    if (escape) document.addEventListener("keydown", onKey);
    if (outside) {
      document.addEventListener("mousedown", onDown);
      // Phones fire touchstart well before the synthesised mousedown; without
      // this a tap outside left the panel up until the tap finished.
      document.addEventListener("touchstart", onDown);
    }
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open, onDismiss, ref, anchorRef, escape, outside]);
}

// Keep Tab inside `ref` while `active`, and hand focus back to whatever had it
// when the overlay opened. The restore is the half everyone forgets and the
// half a keyboard user notices most: without it, closing a dialog drops you at
// the top of the document and you tab through the whole page to get back.
export function useFocusTrap(active, ref, { initialFocus } = {}) {
  useEffect(() => {
    if (!active) return;
    const returnTo = document.activeElement;
    const panel = ref.current;
    // Move in. Prefer what the caller asked for, else the first focusable
    // thing, else the panel itself (which carries tabIndex={-1} for exactly
    // this case, so a dialog with no controls still takes the screen reader).
    const first = initialFocus?.current || panel?.querySelector(FOCUSABLE) || panel;
    // A beat after mount, so focus lands on an element that has finished
    // arriving rather than one still animating in from scale(0.97).
    //
    // A timeout, NOT requestAnimationFrame: rAF is tied to compositing, and an
    // occluded or embedded window stops compositing entirely — the callback
    // then never runs and the dialog opens with focus left on the page behind
    // it, which is the whole bug this trap exists to prevent. The settings
    // drawer had learned this the hard way for its open animation; the same
    // trap applies here.
    const t = setTimeout(() => first?.focus?.({ preventScroll: true }), 20);
    const onKey = (e) => {
      if (e.key !== "Tab" || !panel) return;
      const items = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === panel);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      // Focus outside the panel entirely (it escaped, or started outside):
      // pull it back to the right end rather than letting Tab continue.
      if (!panel.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? lastEl : firstEl).focus();
        return;
      }
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      // Take focus back, but only if it is still ours to give: nobody home
      // (body, or nothing), or focus is on something inside the overlay that is
      // about to disappear with it. If some OTHER part of the page has claimed
      // focus in the meantime — a toast, a redirect, a field the close handler
      // itself focused — leave it where it is.
      //
      // Checking only for "nobody home" was not enough: depending on when React
      // tears the subtree down, the element that had focus inside the panel can
      // still be the active one at this moment, and the overlay then closed
      // leaving focus on a node that no longer exists.
      const active = document.activeElement;
      const focusIsOurs = !active || active === document.body || !active.isConnected || panel?.contains(active);
      if (returnTo?.isConnected && focusIsOurs) returnTo.focus?.({ preventScroll: true });
    };
  }, [active, ref, initialFocus]);
}

// Mount/unmount with an animation on both ends. `open` is the caller's intent;
// `render` is whether anything is in the DOM; `show` drives the in/out classes.
// The pattern is lifted from the settings drawer, which had the only correct
// version of it, and given the nav drawer's belt-and-braces unmount: whichever
// of transitionend or the timeout arrives first wins, because a transition that
// never runs (reduced motion, a hidden tab) must not strand the overlay.
function useMountAnimation(open, duration = 220) {
  const [render, setRender] = useState(open);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (open) {
      setRender(true);
      const t = setTimeout(() => setShow(true), 15);
      return () => clearTimeout(t);
    }
    setShow(false);
    const t = setTimeout(() => setRender(false), duration);
    return () => clearTimeout(t);
  }, [open, duration]);
  return { render, show };
}

// ---------------------------------------------------------------------------
// <Modal>
//
// variant:
//   center — a dialog box in the middle. The default.
//   sheet  — full width along the bottom on phones, a card bottom-right on
//            desktop. What the feedback panel is.
//   drawer — a full-height panel down one side. What settings is.
//   bare   — no chrome at all: the caller fills the whole scrim. What the
//            photo lightbox is.
// ---------------------------------------------------------------------------
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  variant = "center",
  size = "md",
  initialFocus,
  // Some overlays must NOT close on a click outside: a confirm that guards a
  // deletion should take a deliberate answer, not a stray click on the scrim.
  dismissOnOutsideClick = true,
  closeLabel = "Close",
  // The header's × is right for a panel you browse (settings, a photo viewer)
  // and wrong for a question: a confirm already carries a Cancel button, and
  // two controls with the same accessible name in one small dialog is a
  // screen-reader riddle, not a courtesy.
  showClose = true,
  // Escape hatch for the lightbox, which paints its own full-bleed surface.
  className = "",
  panelClassName = "",
}) {
  const panelRef = useRef(null);
  const titleId = useId();
  const descId = useId();
  const { render, show } = useMountAnimation(open);

  useFocusTrap(render, panelRef, { initialFocus });
  useDismiss(render, onClose, { ref: panelRef, outside: false }); // Escape only
  useEffect(() => (render ? lockScroll() : undefined), [render]);

  if (!render) return null;

  const sizes = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };
  const shells = {
    center: `relative m-auto w-full ${sizes[size] || sizes.md} rounded-2xl border border-border bg-card shadow-2xl shadow-ink/30 transition duration-base ${
      show ? "translate-y-0 scale-100 opacity-100" : "translate-y-2 scale-[0.98] opacity-0"
    }`,
    sheet: `relative mt-auto w-full rounded-t-2xl border border-border bg-card shadow-2xl shadow-ink/30 transition duration-base sm:m-auto sm:max-w-md sm:rounded-2xl ${
      show ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
    }`,
    drawer: `relative ml-auto flex h-full w-80 max-w-[85vw] flex-col border-l border-border bg-card shadow-2xl transition-transform duration-base ${
      show ? "translate-x-0" : "translate-x-full"
    }`,
    bare: `relative flex h-full w-full min-h-0 flex-col transition duration-base ${show ? "opacity-100" : "opacity-0"}`,
  };
  const pad = variant === "bare" ? "" : "p-4 sm:p-6";

  return createPortal(
    // Portalled to <body> deliberately: `position: fixed` is measured against
    // the nearest TRANSFORMED ancestor, not the viewport, and this site has
    // plenty of those (every animating card). An overlay rendered in place
    // inside one of them lands in the wrong spot and clips.
    <div className={`fixed inset-0 z-overlay flex ${pad} ${className}`} role="presentation">
      <div
        className={`absolute inset-0 z-scrim bg-ink/50 backdrop-blur-sm transition-opacity duration-base ${
          show ? "opacity-100" : "opacity-0"
        }`}
        onClick={dismissOnOutsideClick ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : closeLabel}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`z-overlay outline-none ${shells[variant] || shells.center} ${panelClassName}`}
      >
        {title && (
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="font-display text-lg font-extrabold uppercase tracking-tight text-dark">
                {title}
              </h2>
              {description && (
                <p id={descId} className="mt-1 whitespace-pre-line text-sm leading-relaxed text-medium">
                  {description}
                </p>
              )}
            </div>
            {showClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              className="transition -mr-1 -mt-1 shrink-0 rounded-lg p-1.5 text-light hover:bg-surface2 hover:text-dark focus:outline-none focus:ring-2 focus:ring-accent/50"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
            )}
          </div>
        )}
        {children != null && (
          <div
            className={
              variant === "drawer"
                ? "min-h-0 flex-1 overflow-y-auto"
                : variant === "bare"
                  // min-h-0 matters: without it this flex child takes its
                  // CONTENT height and a tall photo pushes itself off the
                  // bottom of the screen instead of scaling down into what is
                  // left over.
                  ? "flex min-h-0 flex-1 flex-col"
                  : "px-5 py-4"
            }
          >
            {children}
          </div>
        )}
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-4">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// Confirmations.
//
// Thirty-four native window.confirm calls sat behind the admin's destructive
// actions. A browser confirm is the single loudest "this is not a finished
// product" signal a site can emit: unstyled, unbranded, differently placed in
// every browser, and on some phones it names the localhost origin above the
// question. It also cannot do what several of these call sites actually need —
// a third choice, or a typed confirmation.
//
// The replacement keeps the CALL SITE shape, because that is what makes 34
// migrations tractable and safe:
//
//   if (!(await ask({ title: "Delete the round?", body, danger: true }))) return;
//
// `ask` resolves false on cancel, true on confirm, and for the type-to-confirm
// variant it resolves only when the typed text matches.
// ---------------------------------------------------------------------------
const AskContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [req, setReq] = useState(null);
  const [typed, setTyped] = useState("");
  const resolver = useRef(null);
  const inputRef = useRef(null);
  const cancelRef = useRef(null);

  const ask = useCallback((opts) => {
    // A string argument is the window.confirm shape; keep it working.
    const o = typeof opts === "string" ? { body: opts } : opts || {};
    setTyped("");
    setReq(o);
    return new Promise((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((value) => {
    setReq(null);
    const r = resolver.current;
    resolver.current = null;
    r?.(value);
  }, []);

  const confirmText = req?.confirmWith;
  const matched = !confirmText || typed.trim() === String(confirmText).trim();

  return (
    <AskContext.Provider value={ask}>
      {children}
      <Modal
        open={!!req}
        onClose={() => settle(false)}
        title={req?.title || "Are you sure?"}
        variant="center"
        size="sm"
        // A deletion deserves a deliberate answer; a stray click on the dark
        // area must not count as one either way.
        dismissOnOutsideClick={false}
        showClose={false}
        // Focus lands on Cancel, not on the destructive button: a dialog that
        // opens with "Delete" under the return key is a trap, and Escape and
        // Cancel should be the two easiest things to reach. The type-to-confirm
        // variant is the exception, where the input is the whole point.
        initialFocus={confirmText ? inputRef : cancelRef}
        closeLabel="Cancel"
        footer={
          <>
            <button ref={cancelRef} type="button" className="btn-secondary" onClick={() => settle(false)}>
              {req?.cancelLabel || "Cancel"}
            </button>
            {req?.thirdLabel && (
              <button type="button" className="btn-secondary" onClick={() => settle("third")}>
                {req.thirdLabel}
              </button>
            )}
            <button
              type="button"
              disabled={!matched}
              onClick={() => settle(true)}
              className={
                req?.danger
                  ? "transition inline-flex items-center justify-center rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500/40 disabled:opacity-40"
                  : "btn-primary disabled:opacity-40"
              }
            >
              {req?.confirmLabel || (req?.danger ? "Delete" : "Confirm")}
            </button>
          </>
        }
      >
        {req?.body && <p className="whitespace-pre-line text-sm leading-relaxed text-medium">{req.body}</p>}
        {confirmText && (
          <label className="mt-4 block">
            <span className="mb-1.5 block font-mono text-[11px] font-bold uppercase tracking-wider text-medium">
              Type {confirmText} to confirm
            </span>
            <input
              ref={inputRef}
              className="input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && matched) settle(true);
              }}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        )}
      </Modal>
    </AskContext.Provider>
  );
}

// The hook every call site uses. Falls back to the native dialog if a tree
// somehow renders outside the provider — a missing provider must not silently
// turn a guarded deletion into an unguarded one.
export function useAsk() {
  const ask = useContext(AskContext);
  return (
    ask ||
    ((opts) => {
      const o = typeof opts === "string" ? { body: opts } : opts || {};
      return Promise.resolve(window.confirm([o.title, o.body].filter(Boolean).join("\n\n")));
    })
  );
}
