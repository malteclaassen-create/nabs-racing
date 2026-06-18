// NABS logo — a self-contained SVG recreation of the pink ((N)) mark so it
// works without any image file. Pass `size` (px) and optional `className`.
export default function Logo({ size = 40, className = "" }) {
  const ink = "#0F172A";
  const pink = "#F4AFC6";
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="NABS Racing"
    >
      {/* disc */}
      <circle cx="60" cy="60" r="58" fill={ink} />
      <circle cx="60" cy="60" r="53" fill={pink} />

      {/* sound-wave brackets */}
      <g fill="none" stroke={ink} strokeWidth="6" strokeLinecap="round">
        <path d="M86 38 A 30 30 0 0 1 86 82" />
        <path d="M96 28 A 44 44 0 0 1 96 92" />
        <path d="M34 38 A 30 30 0 0 0 34 82" />
        <path d="M24 28 A 44 44 0 0 0 24 92" />
      </g>

      {/* central N in a ring */}
      <circle cx="60" cy="60" r="20" fill="none" stroke={ink} strokeWidth="5" />
      <path
        d="M51 71 V49 L69 71 V49"
        fill="none"
        stroke={ink}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
