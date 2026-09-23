// The two pieces every long admin list narrows itself with: a search box and a
// row of filter chips. The Drivers roster, the login accounts and the feedback
// inbox each grew past the point where scrolling was a way to find somebody,
// and three hand-made copies of the same box would have drifted apart the way
// the card headers once did.

// A search field with the magnifier inside it and a clear button once
// something is typed. `label` doubles as the placeholder unless one is given.
export function SearchField({ value, onChange, label, placeholder, className = "" }) {
  return (
    <div className={`relative ${className}`}>
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-light" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
      </svg>
      <input
        aria-label={label}
        className="input pl-9 pr-8"
        placeholder={placeholder || label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // Escape empties the box, the way the admin search above the tabs does.
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault();
            onChange("");
          }
        }}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-light transition hover:text-dark"
          onClick={() => onChange("")}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      )}
    </div>
  );
}

// One filter chip: a toggle with how many rows it would leave. A chip that
// would leave none is still shown, greyed, so the row of chips does not change
// shape as the data does; it stays pressable, because "nobody is missing a
// Steam id" is an answer worth being able to ask for.
export function FilterChip({ on, onClick, count, title, children }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
        on
          ? "border-brand/60 bg-brand/15 text-dark"
          : count === 0
            ? "border-border text-faint hover:text-light"
            : "border-border text-light hover:border-brand/40 hover:text-dark"
      }`}
    >
      {children}
      {count != null && <span className="font-mono text-[11px] tabular-nums opacity-70">{count}</span>}
    </button>
  );
}
