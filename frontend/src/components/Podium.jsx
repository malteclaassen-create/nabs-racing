import { Link } from "react-router-dom";
import { MEDAL, MEDAL_TEXT, DriverAvatar } from "./ui.jsx";
import Flag from "./Flag.jsx";
import TeamLogo from "./TeamLogo.jsx";
import { countryFor } from "../data/driverCountries.js";

// Clean stepped 1-2-3 podium for a championship's top three. `entries` is the
// top-3 standings rows in finishing order (driverId, name, country, team, total).
// Theme-aware (the archive hero is a light card in light mode, dark in dark mode).
// Columns read P2 | P1 | P3; pedestals are a faint base with a medal-coloured top
// cap + number (flat — no gradients/blur/glow).
const COLUMN_ORDER = [1, 0, 2]; // entry index for each visual column
const CFG = {
  0: { h: "h-24 sm:h-32", avatar: 82, name: "text-lg sm:text-2xl" },
  1: { h: "h-16 sm:h-24", avatar: 60, name: "text-sm sm:text-lg" },
  2: { h: "h-12 sm:h-20", avatar: 56, name: "text-sm sm:text-lg" },
};

export default function Podium({ entries = [] }) {
  const columns = COLUMN_ORDER.map((i) => ({ e: entries[i], rank: i })).filter((c) => c.e);
  if (columns.length === 0) return null;

  return (
    <div className="relative flex items-end justify-center gap-2.5 pb-px sm:gap-4">
      {/* the floor the pedestals stand on */}
      <div className="pointer-events-none absolute inset-x-2 bottom-0 h-px bg-gradient-to-r from-transparent via-ink/30 to-transparent dark:via-white/25" />
      {columns.map(({ e, rank }) => {
        const color = MEDAL[rank]; // bright fill (chip, avatar ring)
        const tone = MEDAL_TEXT[rank]; // theme-aware text/border tone
        const cfg = CFG[rank];
        const champ = rank === 0;
        return (
          <div key={e.driverId} className="flex w-1/3 max-w-[13.5rem] flex-col items-center">
            {champ && (
              <span
                className="mb-2.5 rounded-full px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-ink"
                style={{ backgroundColor: color }}
              >
                Champion
              </span>
            )}

            <Link to={`/drivers/${e.driverId}`} className="group flex w-full flex-col items-center text-center">
              {/* plain avatar — the medal colour lives in the pedestal and the
                  points, a coloured ring around the photo was one accent too many */}
              <DriverAvatar name={e.name} photoUrl={e.photoUrl} color="#232833" size={cfg.avatar} />

              <span className={`mt-3 flex max-w-full items-center justify-center gap-1.5 font-display font-black uppercase leading-none tracking-tight text-ink transition group-hover:text-brand dark:text-white ${cfg.name}`}>
                <span className="truncate">{e.name}</span>
                <Flag code={countryFor(e.driverId, e.country)} w={champ ? 18 : 15} h={champ ? 13 : 11} />
              </span>

              {e.team && (
                <TeamLogo
                  id={e.team.id}
                  name={e.team.name}
                  color={e.team.color}
                  logoUrl={e.team.logoUrl}
                  size={16}
                  showName
                  className="mt-2"
                  nameClassName="truncate text-xs font-semibold text-ink/70 dark:text-white/55"
                />
              )}

              <span className="mt-2 font-display text-xl font-black leading-none tabular-nums sm:text-2xl" style={{ color: tone }}>
                {e.total}
                <span className="ml-1 align-middle text-[10px] font-bold text-ink/45 dark:text-white/45">PTS</span>
              </span>
            </Link>

            {/* pedestal: medal top cap over a medal-tinted base (color-mix keeps the
                tint correct on both themes), with a FILLED rank medallion — same
                treatment as the Rank chips in every table, so it reads on white. */}
            <div
              className={`mt-3 flex w-full items-center justify-center rounded-t-lg border-t-[3px] ring-1 ring-ink/10 dark:ring-white/10 ${cfg.h}`}
              style={{
                borderColor: tone,
                background: `linear-gradient(180deg, color-mix(in srgb, ${tone} 18%, var(--c-card)), color-mix(in srgb, ${tone} 4%, var(--c-card)))`,
              }}
            >
              <span
                className={`flex items-center justify-center rounded-full font-display font-black tabular-nums text-ink shadow-md ring-2 ring-card dark:ring-ink/40 ${
                  champ ? "h-12 w-12 text-2xl sm:h-14 sm:w-14 sm:text-3xl" : "h-10 w-10 text-xl sm:h-11 sm:w-11 sm:text-2xl"
                }`}
                style={{ backgroundColor: color }}
              >
                {rank + 1}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
