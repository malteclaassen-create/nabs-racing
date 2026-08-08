import { useCallback, useEffect, useRef, useState } from "react";
import { useDismiss } from "./overlay.jsx";

// ---------------------------------------------------------------------------
// The two small buttons above the Session Best Times board: **Sort** and
// **Columns**. Two separate menus on purpose — they answer different questions
// ("in what order?" and "which numbers?"), and one panel holding both meant
// scrolling past a dozen sort options to reach a checkbox.
//
// Sorting: the board ranks by best lap, but the interesting question is often
// another one (fastest ideal lap, quickest down the straight, who has done the
// laps). Clicking a column heading does the same thing, one tap closer.
//
// Columns start in AUTOMATIC mode: the table shows as much as the screen can
// hold, which is why a phone gets four columns and a wide monitor thirteen. The
// moment someone ticks their own set, that set is what shows at every width and
// the table scrolls sideways if it has to. "Back to automatic" undoes it.
// ---------------------------------------------------------------------------

function SortIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h9M4 12h6M4 17h3" />
      <path d="M17 7v10M14 14l3 3 3-3" />
    </svg>
  );
}

function ColumnsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M9.5 4.5v15M15 4.5v15" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

// Hovering to open is a pointer idea. On a touch screen a tap fires the
// simulated mouseenter AND the click, which would open the menu and shut it
// again in the same tap — so the hover handlers only exist where hovering does.
function useCanHover() {
  const [can, setCan] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.("(hover: hover)").matches
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(hover: hover)");
    const on = () => setCan(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return can;
}

// The shell both menus share: the button and the panel under it. Opens on hover
// and closes when the pointer leaves, exactly like the Standings flyout in the
// nav bar — same short close delay, same transparent bridge across the gap so
// moving down into the panel doesn't count as leaving, and the same click/Escape
// handling for touch and keyboard.
function Menu({ icon, label, hint, highlight, title, children, footer }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const closeTimer = useRef(null);
  const canHover = useCanHover();

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const openNow = () => {
    cancelClose();
    setOpen(true);
  };
  const closeSoon = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 140);
  };

  useEffect(() => () => cancelClose(), []);
  // Escape and click-outside now come from the shared overlay layer; the hover
  // open/close timing above is this menu's own and stays.
  useDismiss(open, useCallback(() => setOpen(false), []), { ref });

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={canHover ? openNow : undefined}
      onMouseLeave={canHover ? closeSoon : undefined}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider transition ${
          open || highlight ? "border-brand/50 bg-card text-dark" : "border-border bg-card text-light hover:text-dark"
        }`}
      >
        {icon}
        {label}
        {hint && <span className="hidden text-eyebrow sm:inline">· {hint}</span>}
        <svg
          viewBox="0 0 24 24"
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* Stays mounted and fades/scales in and out, like the nav flyout and the
          series/season switchers. Closed it is `invisible` + `pointer-events-none`,
          so it catches nothing and leaves no phantom hover zone under the button.
          The wrapper starts flush with the button and carries the visual gap as
          TRANSPARENT padding — that is the bridge the pointer crosses. */}
      <div className={`absolute right-0 top-full z-40 pt-2 ${open ? "" : "pointer-events-none"}`}>
        <div
          role="menu"
          className={`w-64 max-w-[calc(100vw-2rem)] origin-top-right overflow-hidden rounded-xl border border-border bg-card shadow-xl shadow-ink/10 transition-[opacity,transform,visibility] duration-quick ${
            open ? "visible scale-100 opacity-100" : "invisible scale-[0.97] opacity-0"
          }`}
        >
          <div className="max-h-[min(26rem,65vh)] overflow-y-auto py-1">{children}</div>
          {footer && <div className="space-y-2 border-t border-border px-4 py-3">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

// One sort choice. The label on the right says which way round it currently is;
// picking the one already active flips it.
function SortRow({ label, active, dir, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition hover:bg-surface2"
    >
      <span className={`min-w-0 flex-1 truncate ${active ? "font-semibold text-dark" : "text-medium"}`}>
        {label}
      </span>
      {active && (
        <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-eyebrow">
          {dir === "desc" ? "high to low" : "low to high"}
        </span>
      )}
    </button>
  );
}

// A row that is either on or off. Deliberately a button with its own tick box
// rather than a real checkbox: the whole row is the target (a thumb on a phone),
// and the box picks up the brand colour when it is on.
function ToggleRow({ label, hint, on, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm transition hover:bg-surface2"
    >
      <span
        aria-hidden
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
          on ? "border-brand bg-brand text-ink" : "border-border text-transparent"
        }`}
      >
        <CheckIcon />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${on ? "font-semibold text-dark" : "text-medium"}`}>{label}</span>
        {hint && <span className="block truncate text-xs text-light">{hint}</span>}
      </span>
    </button>
  );
}

export function LiveSortMenu({ columns, prefs }) {
  const sortable = columns.filter((c) => c.sortValue);
  const active = sortable.find((c) => c.key === prefs.sort.key);
  return (
    <Menu
      icon={<SortIcon />}
      label="Sort"
      hint={active ? active.sortLabel || active.label : null}
      highlight={!!active}
      title="What the board is sorted by"
      footer={
        active ? (
          <button
            type="button"
            onClick={() => prefs.setSort(null)}
            className="transition font-mono text-[11px] font-bold uppercase tracking-wider text-link hover:underline"
          >
            Back to session order
          </button>
        ) : (
          <p className="text-xs leading-relaxed text-light">
            Session order is how the server ranks the field: running order in a race, fastest lap otherwise.
          </p>
        )
      }
    >
      <SortRow label="Session order" active={!prefs.sort.key} dir="asc" onClick={() => prefs.setSort(null)} />
      {sortable.map((c) => (
        <SortRow
          key={c.key}
          label={c.sortLabel || c.label}
          active={prefs.sort.key === c.key}
          dir={prefs.sort.dir}
          onClick={() => prefs.setSort(c.key)}
        />
      ))}
    </Menu>
  );
}

export function LiveColumnsMenu({ columns, prefs }) {
  const optional = columns.filter((c) => !c.locked);
  return (
    <Menu
      icon={<ColumnsIcon />}
      label="Columns"
      hint={prefs.custom ? "yours" : null}
      highlight={prefs.custom}
      title="Which columns the table shows"
      footer={
        <>
          <p className="text-xs leading-relaxed text-light">
            {prefs.custom
              ? "Your columns show on every screen size, so the table may scroll sideways on a phone."
              : "Automatic: the table shows as much as your screen fits. Tick your own set to decide yourself."}
          </p>
          {prefs.custom && (
            <button
              type="button"
              onClick={prefs.resetColumns}
              className="transition font-mono text-[11px] font-bold uppercase tracking-wider text-link hover:underline"
            >
              Back to automatic
            </button>
          )}
        </>
      }
    >
      {optional.map((c) => (
        <ToggleRow
          key={c.key}
          label={c.sortLabel || c.label}
          hint={c.hint}
          on={prefs.enabled.has(c.key)}
          onClick={() => prefs.toggle(c.key)}
        />
      ))}
    </Menu>
  );
}
