import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import { DriverAvatar } from "./ui.jsx";
import Flag from "./Flag.jsx";
import { flagFor } from "../data/circuits.js";

// The left-hand icon/mark for a result: a driver's avatar, a team logo/colour,
// a race's circuit flag, or a small type glyph for seasons/series.
function ResultMark({ item }) {
  if (item.type === "driver") {
    return <DriverAvatar name={item.label} photoUrl={item.photoUrl} color="#4251a8" size={26} />;
  }
  if (item.type === "team") {
    return item.logoUrl ? (
      <img src={item.logoUrl} alt="" className="h-6 w-6 object-contain" />
    ) : (
      <span className="h-5 w-5 rounded-md ring-1 ring-black/10" style={{ background: item.color || "#888" }} />
    );
  }
  if (item.type === "race") {
    const country = item.country || flagFor(item.label)?.country;
    if (country) return <Flag code={country} w={24} h={17} />;
  }
  const p = { viewBox: "0 0 24 24", className: "h-4 w-4 text-medium", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
  switch (item.type) {
    case "race":
      return <svg {...p}><path d="M5 21V4" /><path d="M5 4c3-1.5 6 1.5 9 0s5-1 5 0v8c-3 1.5-6-1.5-9 0s-5 1-5 0" /></svg>;
    case "season":
      return <svg {...p}><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M4 9h16M8 3v4M16 3v4" /></svg>;
    case "series":
      return <svg {...p}><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></svg>;
    default:
      return <svg {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>;
  }
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" />
    </svg>
  );
}

// Global search box: finds drivers, constructors, races, seasons and series
// across every series/season (not scoped to the page you're on). Debounced,
// with a grouped results dropdown and full keyboard navigation.
export default function GlobalSearch({ mobile = false, className = "", alignLeftRef = null }) {
  const [q, setQ] = useState("");
  const [data, setData] = useState(null);
  const [searchError, setSearchError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1); // highlighted flat index
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const navigate = useNavigate();
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  // On roomy desktops the collapsed field is wide enough to spell out "Search"
  // next to the icon; on tighter ones it stays an icon-only pill so the packed
  // nav row (down to the lg breakpoint) never overflows. 1200px is the cutoff
  // where the bar has comfortably more room than the word needs.
  const [wide, setWide] = useState(
    () => !mobile && typeof window !== "undefined" && window.matchMedia("(min-width: 1200px)").matches
  );
  useEffect(() => {
    if (mobile) return;
    const mq = window.matchMedia("(min-width: 1200px)");
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [mobile]);

  // Desktop: the field is a compact pill that widens on hover/focus (or while
  // it holds a query). Mobile is always full width.
  const expanded = mobile || hovered || focused || q.trim().length > 0;
  // Reserved collapsed footprint: enough for "Search" when there's room (see
  // `wide`), otherwise just the icon. Expanded is the full field either way.
  const collapsedW = wide ? "6.5rem" : "3.25rem";

  // The expanded field (and the results panel below it) reach LEFT exactly to
  // the left edge of the "Live" nav item — NavBar hands us its ref. We measure
  // the gap from the field's pinned right edge back to that element and use it
  // as the open width, so both the field and the dropdown span the same run and
  // the run re-fits itself on resize / when the collapsed pill changes size.
  const [expandedW, setExpandedW] = useState(null);
  useEffect(() => {
    if (mobile) return;
    const measure = () => {
      const target = alignLeftRef?.current;
      const wrap = wrapRef.current;
      if (!target || !wrap) return;
      const w = Math.round(wrap.getBoundingClientRect().right - target.getBoundingClientRect().left);
      if (w > 40) setExpandedW(w);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // Re-measured on `expanded` too: the "Live" item's left edge only settles
    // after fonts/layout do, so measuring again the moment we open pins the left
    // edge exactly rather than to a slightly stale mount-time value.
  }, [mobile, alignLeftRef, wide, expanded]);

  // Debounced query. An empty box clears everything.
  useEffect(() => {
    const term = q.trim();
    if (!term) { setData(null); setLoading(false); return; }
    setLoading(true);
    let alive = true;
    const t = setTimeout(() => {
      api
        .search(term)
        .then((d) => { if (alive) { setData(d); setActive(-1); setSearchError(null); } })
        // A failed search is not an empty one. Swallowing the error left the
        // dropdown claiming "No matches for <term>", which tells the visitor
        // their driver is not on the site when in fact nothing was searched.
        .catch((e) => { if (alive) { setData(null); setSearchError(e.message); } })
        .finally(() => alive && setLoading(false));
    }, 180);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  // Flat list of items across all groups, for arrow-key navigation.
  const flat = useMemo(() => (data?.groups || []).flatMap((g) => g.items), [data]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  function go(item) {
    if (!item) return;
    setOpen(false);
    setQ("");
    setData(null);
    inputRef.current?.blur();
    navigate(item.link);
  }

  function onKeyDown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      // From "nothing selected" (-1), Math.max(0, -2) used to land on the FIRST
      // result — so the very first Up press selected something and a following
      // Enter navigated somewhere the user never picked. Step back to
      // "nothing selected" instead.
      setActive((i) => (i <= 0 ? -1 : i - 1));
    } else if (e.key === "Enter") {
      // Enter used to require arrowing down first: type a driver's name, press
      // Enter, and nothing at all happened, which reads as a broken search box.
      // With nothing highlighted it now takes the top result — the one the
      // results are already sorted to put first, and the one the typist means.
      const pick = active >= 0 ? flat[active] : flat[0];
      if (pick) { e.preventDefault(); go(pick); }
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  const showPanel = open && q.trim().length > 0;
  // Assign each item its flat index as we render, to match `active`.
  let idx = -1;

  return (
    <div
      ref={wrapRef}
      // The newcomer tour spotlights this. On the marker itself rather than a
      // wrapper: the field is positioned (the dropdown hangs off it) and sized
      // by inline styles, so anything wrapped around it would either take the
      // box away or take the positioning.
      data-tour={mobile ? undefined : "nav-search"}
      className={`relative ${mobile ? "w-full" : "shrink-0"} ${className}`}
      style={mobile ? undefined : { width: collapsedW, height: "2.25rem" }}
      onMouseEnter={() => !mobile && setHovered(true)}
      onMouseLeave={() => !mobile && setHovered(false)}
    >
      {/* Desktop: a compact pill that widens on hover/focus. It sits ABSOLUTE
          (out of the nav's flex flow, which would otherwise clamp its width) and
          grows leftward, anchored to right:0, so the profile chip on its right
          never shifts. The collapsed width reserves an intrinsic minimum on
          purpose: a search input can't render narrower than its own left icon
          padding + border (~50px), so a tighter slot let the input spill its
          right edge over the "Log in" button. `collapsedW` reserves exactly the
          collapsed width, so the field's right edge stays pinned in both states
          — no overlap, no jump. Mobile: a plain in-flow full-width field.
          Positioning is all inline to dodge flex-shrink and utility-class
          ordering surprises. */}
      <div
        className="relative"
        style={mobile ? undefined : { position: "absolute", top: 0, right: 0, height: "2.25rem", width: expanded ? (expandedW ? `${expandedW}px` : "15rem") : collapsedW, transition: "width var(--t-base) var(--e-out)" }}
      >
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-light">
          <SearchIcon />
        </span>
        {/* Arrow keys and Enter already worked, but nothing told a screen reader
            that a list of suggestions had appeared, or which entry was
            highlighted. The combobox attributes below are what carry that. */}
        <input
          ref={inputRef}
          type="search"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => { setOpen(true); setFocused(true); }}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          placeholder={expanded ? "Search drivers, teams, races…" : wide ? "Search" : ""}
          aria-label="Search"
          autoComplete="off"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="global-search-results"
          aria-autocomplete="list"
          aria-activedescendant={showPanel && active >= 0 ? `global-search-option-${active}` : undefined}
          className="h-9 w-full min-w-0 rounded-lg border border-border bg-surface2 py-2 pl-9 pr-3 text-sm text-dark placeholder:text-light focus:border-primary focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>

      {showPanel && (
        <div
          className={`search-pop absolute top-full z-dropdown mt-2 overflow-hidden rounded-xl border border-border bg-card shadow-2xl shadow-ink/20 ${
            mobile ? "inset-x-0" : "right-0"
          }`}
          style={mobile ? undefined : { width: expandedW ? `${expandedW}px` : "15rem", maxWidth: "calc(100vw - 1.5rem)" }}
        >
          <div id="global-search-results" role="listbox" aria-label="Search results" className="max-h-[min(28rem,70vh)] overflow-y-auto py-1">
            {loading && !data ? (
              <p className="px-4 py-6 text-center text-sm text-light">Searching…</p>
            ) : searchError ? (
              <p role="alert" className="px-4 py-6 text-center text-sm font-medium text-bad">
                Search is not answering right now. Try again in a moment.
              </p>
            ) : !data || data.groups.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-light">
                No matches for “{q.trim()}”.
              </p>
            ) : (
              data.groups.map((g) => (
                <div key={g.type} role="group" aria-label={g.label} className="py-1">
                  <div aria-hidden className="px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-light">{g.label}</div>
                  {g.items.map((item) => {
                    idx += 1;
                    const i = idx;
                    return (
                      <button
                        key={`${item.type}-${item.id}`}
                        type="button"
                        id={`global-search-option-${i}`}
                        role="option"
                        aria-selected={active === i}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => go(item)}
                        className={`flex w-full items-center gap-3 px-3 py-2 text-left transition ${
                          active === i ? "bg-surface2" : "hover:bg-surface2"
                        }`}
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface2">
                          <ResultMark item={item} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-dark">{item.label}</span>
                          {item.sublabel && <span className="block truncate text-xs text-light">{item.sublabel}</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
