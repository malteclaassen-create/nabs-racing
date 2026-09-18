// The coin mark of the league's server tokens: the NABS mark as a coin. The
// ring is the logo's circle and the coin's rim in one, and the N sits inside it
// where a currency symbol would.
//
// The logo's two outer arcs are deliberately NOT here. This is drawn at 14px in
// the nav bar, and at that size the arcs sit a pixel from the ring and smear
// into it, taking the N with them. The ring and the N are the part that still
// reads, so they get the whole 24 units to themselves.
//
// The N is a filled letterform rather than a stroked path for the same reason:
// a hairline N inside a hairline circle is a smudge at coin size, and the real
// mark's N is solid anyway.
//
// Drawn rather than the logo PNG on purpose: a scaled-down bitmap turns to mush
// at this size, and this has to take the colour of whatever it sits in
// (currentColor), which an image cannot.
//
// Its own file rather than an export of the Tokens page: the nav bar draws it on
// every page, and importing it from there would drag the whole personal area
// into the bundle that a visitor downloads to look at the standings.
export default function TokenIcon({ className = "h-4 w-4" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      {/* the coin's rim, and the ring of the mark */}
      <circle cx="12" cy="12" r="8.4" stroke="currentColor" strokeWidth="2.1" />
      {/* the N */}
      <path
        d="M8.7 15.9V8.1h2.1l2.5 3.9V8.1h2.1v7.8h-2.1l-2.5-3.9v3.9z"
        fill="currentColor"
      />
    </svg>
  );
}
