// Podium seal — the site's "Discord role" for a top-three championship finish.
// Earned, never assigned: the backend derives one per concluded season
// (driverProfileService `badges`): gold laurel for the champion, silver for
// the vice-champion, bronze for third. Design (settled with the league after a
// few rounds): a classic laurel wreath — open at the top, closing at the
// bottom, leaves tapering upward — with the season tag ("S6") inside, no
// filled disc. Hovering opens a small popover with the full story
// ("Season 6 Champion · F1 2013 · 265 pts"); deliberately NO hover glint.

// Metal palettes, one per podium step. `text` classes are static literals on
// purpose (Tailwind needs to see them) — darker metal on the light theme,
// bright on dark.
const METALS = {
  gold: {
    stops: ["#f8e08e", "#e9bc42", "#a8770e"],
    text: "text-[#8a6410] dark:text-[#e9bc42]",
  },
  silver: {
    stops: ["#eef2f7", "#b9c2cf", "#7e8a9a"],
    text: "text-[#5c6878] dark:text-[#c5cedb]",
  },
  bronze: {
    stops: ["#e8c49a", "#c08a4e", "#7e5426"],
    text: "text-[#7e5426] dark:text-[#d9a86b]",
  },
};
const METAL_BY_TYPE = { champion: "gold", vice: "silver", third: "bronze" };
const TITLE_BY_TYPE = { champion: "Champion", vice: "Vice-Champion", third: "Third Place" };

// The wreath, generated: two mirrored branches of tapered leaf ellipses along
// a circle — open at the top (±34°), meeting at the bottom (±168°), each leaf
// tilted 112° off its radius so it lies along the branch, leaning outward.
function wreathLeaves() {
  const leaves = [];
  const N = 7;
  for (const side of [1, -1]) {
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const deg = side * (34 + t * (168 - 34));
      const x = 12 + 8.2 * Math.sin((deg * Math.PI) / 180);
      const y = 12 - 8.2 * Math.cos((deg * Math.PI) / 180);
      const scale = 0.55 + 0.45 * t; // small at the top, full at the bottom
      leaves.push({
        key: `${side}-${i}`,
        x,
        y,
        rx: 1.35 * scale,
        ry: 3.0 * scale,
        rot: side * (Math.abs(deg) + 112),
      });
    }
  }
  return leaves;
}
const LEAVES = wreathLeaves();

export default function ChampionBadge({ type = "champion", seasonNumber, seasonName, game, points, size = 32 }) {
  const m = METALS[METAL_BY_TYPE[type]] || METALS.gold;
  const gid = `seal-${type}-${seasonNumber}`;
  const label = `${seasonName || `Season ${seasonNumber}`} ${TITLE_BY_TYPE[type] || "Champion"}`;
  const detail = [game, points != null ? `${points} pts` : null].filter(Boolean).join(" · ");
  return (
    <span
      className={`group relative inline-flex shrink-0 ${m.text}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label}
    >
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <defs>
          {/* unique id per seal — several can share one page */}
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={m.stops[0]} />
            <stop offset="55%" stopColor={m.stops[1]} />
            <stop offset="100%" stopColor={m.stops[2]} />
          </linearGradient>
        </defs>
        <g fill={`url(#${gid})`}>
          {LEAVES.map((l) => (
            <ellipse key={l.key} cx={l.x} cy={l.y} rx={l.rx} ry={l.ry} transform={`rotate(${l.rot} ${l.x} ${l.y})`} />
          ))}
        </g>
        {/* season tag straight inside the wreath — theme-aware via currentColor */}
        <text
          x="12"
          y="12.3"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={seasonNumber >= 10 ? 5.6 : 6.4}
          fontWeight="900"
          fontFamily="inherit"
          fill="currentColor"
        >
          S{seasonNumber}
        </text>
      </svg>

      {/* popover — pure CSS show-on-hover; sits below the seal so the card's
          rounded overflow never clips it */}
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute left-1/2 top-full z-30 mt-2 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-lg border border-border bg-card px-3 py-2 text-left opacity-0 shadow-xl shadow-ink/20 transition duration-150 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100"
      >
        <span className="block font-display text-xs font-extrabold uppercase tracking-tight text-dark">{label}</span>
        {detail && (
          <span className="mt-0.5 block font-mono text-[10px] font-semibold uppercase tracking-wider text-light">
            {detail}
          </span>
        )}
      </span>
    </span>
  );
}
