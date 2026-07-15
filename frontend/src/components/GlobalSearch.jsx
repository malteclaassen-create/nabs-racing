import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import { DriverAvatar } from "./ui.jsx";
import Flag from "./Flag.jsx";
import { circuitFor } from "../data/circuits.js";

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
    const country = circuitFor(item.label)?.country;
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
        .then((d) => { if (alive) { setData(d); setActive(-1); } })
        .catch(() => alive && setData(null))
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
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      if (active >= 0 && flat[active]) { e.preventDefault(); go(flat[active]); }
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
        style={mobile ? undefined : { position: "absolute", top: 0, right: 0, height: "2.25rem", width: expanded ? (expandedW ? `${expandedW}px` : "15rem") : collapsedW, transition: "width 0.2s ease-out" }}
      >
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-light">
          <SearchIcon />
        </span>
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
          className="h-9 w-full min-w-0 rounded-lg border border-border bg-surface2 py-2 pl-9 pr-3 text-sm text-dark placeholder:text-light focus:border-primary focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>

      {showPanel && (
        <div
          className={`search-pop absolute top-full z-40 mt-2 overflow-hidden rounded-xl border border-border bg-card shadow-2xl shadow-ink/20 ${
            mobile ? "inset-x-0" : "right-0"
          }`}
          style={mobile ? undefined : { width: expandedW ? `${expandedW}px` : "15rem", maxWidth: "calc(100vw - 1.5rem)" }}
        >
          <div className="max-h-[min(28rem,70vh)] overflow-y-auto py-1">
            {loading && !data ? (
              <p className="px-4 py-6 text-center text-sm text-light">Searching…</p>
            ) : !data || data.groups.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-light">
                No matches for “{q.trim()}”.
              </p>
            ) : (
              data.groups.map((g) => (
                <div key={g.type} className="py-1">
                  <div className="px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-light">{g.label}</div>
                  {g.items.map((item) => {
                    idx += 1;
                    const i = idx;
                    return (
                      <button
                        key={`${item.type}-${item.id}`}
                        type="button"
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
