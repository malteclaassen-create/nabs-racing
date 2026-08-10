import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { searchAdmin } from "../data/adminIndex.js";

// A way into the admin that isn't "read all twenty-two tab names and guess".
//
// It searches what each tab lets you DO, not what it is called (see
// data/adminIndex.js), so "ban", "backup", "who is coming" and "rickroll" all
// land somewhere sensible. A hit switches to its tab, and to the right view
// inside that tab where the tab has several.
//
// Deliberately not a modal: a search box you can see is a search box people
// discover. It stays out of the way at one line high and opens a results panel
// only while something is typed.
export default function AdminSearch({ onGo }) {
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const [open, setOpen] = useState(false);
  // Where the input is on screen. The panel is rendered into <body> (see the
  // portal below), so it has to be told; re-measured on scroll and resize
  // because a fixed panel does not follow the page on its own.
  const [anchor, setAnchor] = useState(null);
  const boxRef = useRef(null);
  const panelRef = useRef(null);
  const inputRef = useRef(null);

  const hits = useMemo(() => searchAdmin(q), [q]);
  // The highlight belongs to the current result list, not to the last one.
  useEffect(() => setCursor(0), [q]);

  const showPanel = open && q.trim().length >= 2;

  useEffect(() => {
    if (!showPanel) return;
    const measure = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (!r) return;
      // How tall the panel may be, worked out here rather than as a CSS
      // `calc(100dvh - …)`: the viewport unit and the rectangle above are two
      // different measurements, and where they disagree — an embedded browser,
      // a phone mid-address-bar-slide — the panel comes out short for no
      // visible reason. One source, re-measured on scroll and resize.
      const room = Math.max(180, Math.round(window.innerHeight - r.bottom - 22));
      setAnchor({ left: r.left, top: r.bottom, width: r.width, maxHeight: room });
    };
    measure();
    // Capture phase: the page may scroll inside a container rather than the
    // window, and a scroll event on that container never reaches the window.
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [showPanel]);

  // Clicking anywhere else puts the panel away. Focus alone can't do this, and
  // the panel counts as "inside" even though it lives in <body>: without that
  // check, mousedown would close it and the click on the result would land on
  // nothing.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (boxRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function go(hit) {
    if (!hit) return;
    setQ("");
    setOpen(false);
    inputRef.current?.blur();
    onGo(hit);
  }

  function onKeyDown(e) {
    if (e.key === "Escape") {
      setQ("");
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!hits.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (c + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (c - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(hits[cursor]);
    }
  }

  // The results are a card on a page made of cards, in a theme where a card and
  // the page behind it are nearly the same colour — a border and a shadow were
  // not enough to say where the list stopped and the admin started. So the rest
  // of the page steps back: dimmed and slightly blurred, the same treatment the
  // nav menu and the confirm dialogs use.
  //
  // Both parts go through a portal into <body>. The admin page sits inside a
  // wrapper that carries a transform (the page entrance), and a transform makes
  // its element the containing block for anything `fixed` inside it — the scrim
  // came out the width of the content column instead of the width of the
  // window, leaving the page visibly undimmed down both edges.
  //
  // The dimming starts at the BOTTOM of the input, like the nav's own scrim
  // starts below the bar: the box you are typing in has to stay bright and
  // clickable, and everything the results overlap is below it anyway.
  const overlay =
    showPanel && anchor
      ? createPortal(
          <>
            <div
              aria-hidden
              className="fixed inset-x-0 bottom-0 z-scrim bg-ink/50 backdrop-blur-sm"
              style={{ top: anchor.top }}
              onMouseDown={() => setOpen(false)}
            />
            <div
              ref={panelRef}
              id="admin-search-results"
              role="listbox"
              className="fixed z-overlay flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
              style={{
                left: anchor.left,
                top: anchor.top + 6,
                width: anchor.width,
                maxHeight: anchor.maxHeight,
              }}
            >
              {hits.length === 0 ? (
                <p className="px-4 py-3 text-sm text-light">
                  Nothing matches &ldquo;{q.trim()}&rdquo;. Try a plainer word for it, like{" "}
                  <span className="font-semibold text-medium">points</span>,{" "}
                  <span className="font-semibold text-medium">reminder</span> or{" "}
                  <span className="font-semibold text-medium">photos</span>.
                </p>
              ) : (
                <>
                  <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
                    {hits.map((h, i) => (
                      <li key={`${h.tab}:${h.view || ""}:${h.title}`}>
                        <button
                          type="button"
                          role="option"
                          id={`admin-search-hit-${i}`}
                          aria-selected={i === cursor}
                          onMouseEnter={() => setCursor(i)}
                          onClick={() => go(h)}
                          className={`flex w-full flex-col gap-0.5 px-4 py-2.5 text-left transition ${
                            i === cursor ? "bg-surface2" : ""
                          }`}
                        >
                          <span className="flex flex-wrap items-baseline gap-x-2">
                            <span className="font-semibold text-dark">{h.title}</span>
                            {/* Where it lives, so the next time they go straight
                                there instead of searching again. */}
                            <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
                              {h.groupLabel} › {h.tabLabel}
                              {h.viewLabel ? ` › ${h.viewLabel}` : ""}
                            </span>
                          </span>
                          <span className="text-xs leading-relaxed text-light">{h.hint}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {/* A definite bottom edge. A scrolling list that simply stops
                      mid-row leaves you unsure whether the panel ended or the
                      page did, and this is also the only place the keys are
                      written down. */}
                  <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-surface2/60 px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-light">
                    <span>
                      {hits.length} {hits.length === 1 ? "result" : "results"}
                    </span>
                    <span className="hidden sm:inline">↑ ↓ to move · Enter to open · Esc to close</span>
                  </div>
                </>
              )}
            </div>
          </>,
          document.body
        )
      : null;

  return (
    <div ref={boxRef} className="relative mb-4">
      <div className="relative">
        <svg
          viewBox="0 0 24 24"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-light"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          className="input pl-9"
          placeholder="Search the admin: what do you want to change? (hotlap, ban, backup, points…)"
          aria-label="Search admin settings"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="admin-search-results"
          aria-autocomplete="list"
          // Which result the arrow keys are on, for a screen reader — the
          // highlight below is otherwise only a colour.
          aria-activedescendant={showPanel && hits.length ? `admin-search-hit-${cursor}` : undefined}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
      </div>
      {overlay}
    </div>
  );
}
