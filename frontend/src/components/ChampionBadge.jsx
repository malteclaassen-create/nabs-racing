// Podium seal — the site's "Discord role" for a top-three championship finish.
// Earned, never assigned: the backend derives one per concluded season
// (driverProfileService `badges`): gold laurel for the champion, silver for
// second place, bronze for third. Design (settled with the league after a
// few rounds): a classic laurel wreath — open at the top, closing at the
// bottom, leaves tapering upward — with the season tag ("S6") inside, no
// filled disc. Hovering opens a small popover with the full story
// ("Season 6 Champion · F1 2013 · 265 pts"); deliberately NO hover glint.

import { useId } from "react";
import TeamLogo from "./TeamLogo.jsx";

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
const TITLE_BY_TYPE = { champion: "Champion", vice: "2nd Place", third: "3rd Place" };

// The wreath, generated: two mirrored branches of tapered leaf ellipses along
// a circle — open at the top (±34°), meeting at the bottom (±168°), each leaf
// tilted 112° off its radius so it lies along the branch, leaning outward.
export function wreathLeaves() {
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

// Popover placement: centred under the seal by default; "right" pins it to the
// seal's right edge so a seal at the card's right border never gets clipped by
// the card's overflow-hidden.
const POP_POS = {
  center: "left-1/2 -translate-x-1/2",
  right: "right-0",
};

export default function ChampionBadge({ type = "champion", seasonNumber, seasonName, game, points, size = 32, align = "center" }) {
  const m = METALS[METAL_BY_TYPE[type]] || METALS.gold;
  // Unique per component INSTANCE, not just per (type, season): the trophy
  // shelf renders twice (a display:none desktop column + the mobile block), so
  // a deterministic id would collide and `fill="url(#…)"` would resolve to the
  // hidden copy's gradient — painting nothing on the visible one (the phone
  // seals looked blank). useId() gives each render its own gradient id.
  const gid = `seal${useId()}`;
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
        className={`pointer-events-none invisible absolute top-full z-30 mt-2 translate-y-1 whitespace-nowrap rounded-lg border border-border bg-card px-3 py-2 text-left opacity-0 shadow-xl shadow-ink/20 transition duration-150 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 ${POP_POS[align] || POP_POS.center}`}
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

// Team seal — the constructor twin of the podium seal: the same laurel wreath
// in the metal of the TEAM's final championship position, with the team logo
// inside instead of the season tag. The popover tells the story ("Season 7
// Teams 3rd Place · Williams · 312 pts").
const TEAM_TITLE_BY_POS = { 1: "Team Champions", 2: "Teams 2nd Place", 3: "Teams 3rd Place" };
const METAL_BY_POS = { 1: "gold", 2: "silver", 3: "bronze" };

export function TeamPodiumBadge({ position = 1, seasonNumber, seasonName, game, points, team, size = 32, align = "center" }) {
  const m = METALS[METAL_BY_POS[position]] || METALS.gold;
  // Unique per instance (see ChampionBadge): the shelf renders on both the
  // desktop and mobile layouts, so a deterministic id would collide across the
  // two copies and the gradient would paint the wrong (hidden) one.
  const gid = `teamseal${useId()}`;
  const label = `${seasonName || `Season ${seasonNumber}`} ${TEAM_TITLE_BY_POS[position] || "Team Champions"}`;
  const detail = [team?.name, game, points != null ? `${points} pts` : null].filter(Boolean).join(" · ");
  return (
    <span
      className={`group relative inline-flex shrink-0 ${m.text}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label} · ${team?.name || ""}`}
    >
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <defs>
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
      </svg>
      {/* the team logo fills the wreath's open centre */}
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <TeamLogo id={team?.id} name={team?.name} color={team?.color} logoUrl={team?.logoUrl} size={Math.round(size * 0.48)} />
      </span>
      {/* season ribbon over the wreath's closing leaves — the driver seal
          carries its season INSIDE the wreath, the team seal carries the logo
          there, so the season tag moves onto a little banner at the bottom */}
      <span className="pointer-events-none absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-[3px] bg-card px-[3px] py-px font-mono text-[7px] font-black leading-none tracking-tight">
        S{seasonNumber}
      </span>

      <span
        role="tooltip"
        className={`pointer-events-none invisible absolute top-full z-30 mt-2 translate-y-1 whitespace-nowrap rounded-lg border border-border bg-card px-3 py-2 text-left opacity-0 shadow-xl shadow-ink/20 transition duration-150 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 ${POP_POS[align] || POP_POS.center}`}
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
