import { useEffect, useRef } from "react";
import SlidingTabs from "./SlidingTabs.jsx";

// ---------------------------------------------------------------------------
// The telemetry page's own small kit: one panel, one segmented switch, one
// icon button, one menu. Every block of the comparison is built from these,
// so the page reads as one instrument rather than eight widgets that each
// picked their own border, heading and button.
// ---------------------------------------------------------------------------

// A titled block. The header carries the title, an optional quiet note and
// the block's own controls on the right; `flush` drops the body padding for
// content that draws to the edge (the map).
export function Panel({ title, icon: Icon, note, actions, children, footer, flush = false, className = "", bodyClassName = "", ...rest }) {
  return (
    <section className={`min-w-0 overflow-hidden rounded-xl border border-border bg-card ${className}`} aria-label={typeof title === "string" ? title : undefined} {...rest}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-3 py-2.5 sm:px-4">
          <div className="flex min-w-0 items-baseline gap-2">
            {Icon && <Icon className="h-4 w-4 shrink-0 self-center text-light" aria-hidden="true" />}
            <h3 className="shrink-0 text-sm font-semibold text-dark">{title}</h3>
            {note && <span className="min-w-0 truncate text-xs text-light">{note}</span>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={flush ? bodyClassName : `p-3 sm:p-4 ${bodyClassName}`}>{children}</div>
      {footer}
    </section>
  );
}

// The site's sliding segmented control, in the compact size a panel header
// has room for.
export function Segmented({ items, value, onChange, label }) {
  return (
    <div role="group" aria-label={label}>
      <SlidingTabs
        items={items}
        value={value}
        onChange={onChange}
        wrapClassName="inline-flex rounded-lg border border-border bg-surface2 p-0.5"
        btnClassName="px-2.5 py-1 text-[11px]"
        pillClassName="rounded-md bg-card shadow-sm"
        activeClassName="text-dark"
        idleClassName="text-light hover:text-dark"
      />
    </div>
  );
}

// A toolbar button: an icon, and its word beside it from `sm` up. The word is
// always the accessible name, so a phone's icon-only button still says what
// it does.
export function ToolButton({ icon: Icon, label, showLabel = true, className = "", children, ...props }) {
  return (
    <button type="button" aria-label={label} title={props.title || label}
      className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-2 text-xs font-semibold text-medium transition hover:bg-surface2 hover:text-dark disabled:pointer-events-none disabled:opacity-40 ${className}`} {...props}>
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      {children ?? (showLabel && <span className="hidden sm:inline">{label}</span>)}
    </button>
  );
}

// A small drop-down built on <details>: no state to keep, keyboard and screen
// reader behaviour for free. Closes itself on a pick, on a click elsewhere
// and on Escape, which a bare <details> does not.
// `upOnPhone`: opens above its button on a phone, for a menu that lives on
// the bottom edge of the screen there.
export function Menu({ icon: Icon, label, summary, align = "right", width = "w-52", upOnPhone = false, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => {
      const el = ref.current;
      if (!el?.open) return;
      if (e.type === "keydown" ? e.key === "Escape" : !el.contains(e.target)) el.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  return (
    <details ref={ref} className="relative" onClick={(e) => { if (e.target.closest?.("[data-menu-item]") && ref.current) ref.current.open = false; }}>
      <summary aria-label={label} title={label}
        className="inline-flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-lg border border-border bg-card px-2 text-xs font-semibold text-medium transition hover:bg-surface2 hover:text-dark [&::-webkit-details-marker]:hidden">
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        {summary ?? <span className="hidden sm:inline">{label}</span>}
      </summary>
      <div className={`absolute ${align === "right" ? "right-0" : "left-0"} z-30 ${upOnPhone ? "bottom-full mb-1 sm:bottom-auto sm:top-full sm:mb-0 sm:mt-1" : "mt-1"} ${width} rounded-lg border border-border bg-card p-1 font-sans text-xs font-normal shadow-lift`}>{children}</div>
    </details>
  );
}

export function MenuItem({ icon: Icon, children, ...props }) {
  return (
    <button type="button" data-menu-item className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-dark transition hover:bg-surface2" {...props}>
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-light" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Kbd({ children }) {
  return <kbd className="inline-flex min-w-[1.5rem] items-center justify-center rounded border border-border bg-surface2 px-1 font-mono text-[10px] font-semibold text-dark">{children}</kbd>;
}

// A toggle that reads as a chip: for switching optional things on and off.
export function Chip({ on, onClick, children, color }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition max-sm:min-h-[32px] ${on ? "border-transparent bg-dark text-card" : "border-border bg-card text-light hover:text-dark"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${on ? "" : "opacity-50"}`} style={{ background: color || "currentColor" }} aria-hidden="true" />
      {children}
    </button>
  );
}
