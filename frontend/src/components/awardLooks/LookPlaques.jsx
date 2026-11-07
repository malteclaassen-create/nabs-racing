// ---------------------------------------------------------------------------
// Season awards look "plaques" (Hall of Fame preview, ?look=plaques). Every
// award is the engraved nameplate off a trophy base: a plate of brushed metal
// with a bevelled edge and a brass screw in each corner, the award and the
// winner cut into it, and the winner set into a round, brass-rimmed medallion
// at its left (portrait or initials, team logo, the circuit, or a laurel for a
// typed name). The plates hang two across, one on a phone, an odd last one
// centred under the rest the way you would hang them on a wall. Gunmetal on the
// dark theme, brushed steel on the light one; the metal is in lookPlaques.css.
// ---------------------------------------------------------------------------
import { useState } from "react";
import { Link } from "react-router-dom";
import { Flag as FlagIcon } from "lucide-react";
import { readableInkOn, sizedAvatarUrl } from "../ui.jsx";
import TeamLogo from "../TeamLogo.jsx";
import Flag from "../Flag.jsx";
import CircuitMap from "../CircuitMap.jsx";
import SlidingTabs from "../SlidingTabs.jsx";
import { hasOutline, useTrackOutlines } from "../../data/trackOutlines.js";
import { useSwapClass } from "../../hooks/motion.js";
import { winnerOf } from "./shared.js";
import "./lookPlaques.css";

// Four screws never line up on a real plate, so each corner gets its own turn.
const SCREWS = [
  ["tl", -32],
  ["tr", 58],
  ["bl", 14],
  ["br", -71],
];

// winnerOf hands a driver's flag over as a code but a race's as the whole
// flagFor() record ({ country, countryName, ... }); both become a code here.
const flagCode = (flag) => (typeof flag === "string" ? flag : flag?.country) || null;

const initialsOf = (name) =>
  (name || "?")
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

// The mark for a typed winner (a pair of drivers, a whole grid): a laurel, two
// branches curving up from the bottom and open at the top. Worked out once, in
// a 40 x 40 box, as one path for the leaves and one for the stems.
const LAUREL = (() => {
  const cx = 20;
  const cy = 21;
  const R = 12;
  const r2 = (n) => Math.round(n * 100) / 100;
  const rad = (deg) => (deg * Math.PI) / 180;
  const at = (dir, theta) => [cx + dir * R * Math.sin(rad(theta)), cy + R * Math.cos(rad(theta))];
  const leaves = [];
  const leaf = ([x, y], deg, len, wide) => {
    const c = Math.cos(rad(deg));
    const s = Math.sin(rad(deg));
    const tip = [x + c * len, y + s * len];
    const mid = [x + c * len * 0.5, y + s * len * 0.5];
    const a = [mid[0] - s * wide, mid[1] + c * wide];
    const b = [mid[0] + s * wide, mid[1] - c * wide];
    leaves.push(
      `M${r2(x)} ${r2(y)}Q${r2(a[0])} ${r2(a[1])} ${r2(tip[0])} ${r2(tip[1])}Q${r2(b[0])} ${r2(b[1])} ${r2(x)} ${r2(y)}Z`
    );
  };
  const stems = [];
  for (const dir of [-1, 1]) {
    // theta: degrees up the circle from its bottom point.
    for (let i = 0; i < 6; i++) {
      const theta = 30 + i * 22;
      const k = 1 - i * 0.06;
      const p = at(dir, theta);
      // The direction the branch grows in at this point (up and round).
      const grow = (Math.atan2(-Math.sin(rad(theta)), dir * Math.cos(rad(theta))) * 180) / Math.PI;
      leaf(p, grow + dir * 42, 6 * k, 1.9 * k);
      leaf(p, grow - dir * 40, 4.6 * k, 1.5 * k);
    }
    const top = at(dir, 150);
    leaf(top, (Math.atan2(-Math.sin(rad(150)), dir * Math.cos(rad(150))) * 180) / Math.PI, 5, 1.6);
    const [x0, y0] = at(dir, 20);
    stems.push(`M${r2(x0)} ${r2(y0)}A${R} ${R} 0 0 ${dir === 1 ? 0 : 1} ${r2(top[0])} ${r2(top[1])}`);
  }
  return { leaves: leaves.join(""), stems: stems.join("") };
})();

function Laurel() {
  return (
    <svg viewBox="0 0 40 40" className="aw-plaques-mark" aria-hidden="true">
      <path d={LAUREL.stems} fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <path d={LAUREL.leaves} fill="currentColor" />
    </svg>
  );
}

// Photo or initials on the team colour (a driver's, or a team's that has no
// logo). Not DriverAvatar: that one is drawn at a fixed pixel size, and the
// medallion changes size with the screen. A photo that fails to load (a
// Discord avatar is gone once its owner changes it) falls back to the initials
// rather than leaving an empty disc.
function Portrait({ name, photoUrl, color }) {
  const [dead, setDead] = useState(null);
  const bg = color || "#64748b";
  if (photoUrl && dead !== photoUrl)
    return (
      <img
        src={sizedAvatarUrl(photoUrl, 64)}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setDead(photoUrl)}
        className="aw-plaques-photo"
        style={{ backgroundColor: bg }}
      />
    );
  return (
    <span className="aw-plaques-initials" style={{ backgroundColor: bg, color: readableInkOn(bg) }}>
      {initialsOf(name)}
    </span>
  );
}

// The round medallion set into the plate: a recess, a brass rim, and what sits
// under the glass. The flag rides on the rim as a small pin.
function Medallion({ w }) {
  // Uploaded circuit outlines arrive after the first render; this re-renders
  // the race medallion when they do.
  useTrackOutlines();
  const code = flagCode(w.flag);
  let face;
  let pin = code;
  if (w.kind === "driver") {
    face = <Portrait name={w.name} photoUrl={w.driver.photoUrl} color={w.color} />;
  } else if (w.kind === "team" && w.team.logoUrl) {
    face = (
      <span className="aw-plaques-logo">
        <TeamLogo id={w.team.id} name={w.team.name} color={w.team.color} logoUrl={w.team.logoUrl} size={48} />
      </span>
    );
  } else if (w.kind === "team") {
    // No logo uploaded: the team's initials on its colour, like a driver's.
    // TeamLogo's own fallback writes white letters, lost on a white team.
    face = <Portrait name={w.team.name} color={w.team.color} />;
  } else if (w.kind === "race" && hasOutline(w.race.track)) {
    face = <CircuitMap track={w.race.track} className="aw-plaques-circuit" strokeWidth={1.6} />;
  } else if (w.kind === "race" && code) {
    // No outline of this circuit: its flag fills the medallion instead.
    face = <Flag code={code} w={80} h={48} className="aw-plaques-flagfill" />;
    pin = null;
  } else if (w.kind === "race") {
    face = <FlagIcon className="aw-plaques-mark aw-plaques-mark-icon" strokeWidth={1.75} aria-hidden="true" />;
  } else {
    face = <Laurel />;
  }
  return (
    <span className="aw-plaques-medal" aria-hidden="true">
      <span className="aw-plaques-bezel">
        <span className="aw-plaques-disc">{face}</span>
      </span>
      {pin && (
        <span className="aw-plaques-pin">
          <Flag code={pin} w={40} h={24} />
        </span>
      )}
    </span>
  );
}

// A long single word ("Schwarzenberg") does not fit the narrow column on a
// phone at full size and would break with a letter or two on a line of its
// own. The name steps down in size for its longest word instead (the CSS only
// applies it where the column is narrow); hyphens count as a place to break.
const nameFit = (name) => {
  const longest = Math.max(1, ...String(name || "").split(/[\s-]+/).map((p) => p.length));
  return Math.min(1, Math.max(0.72, 11 / longest));
};

function Plaque({ award, seasonNumber }) {
  const w = winnerOf(award, seasonNumber);
  const inner = (
    <>
      {SCREWS.map(([corner, turn]) => (
        <span
          key={corner}
          aria-hidden="true"
          className={`aw-plaques-screw aw-plaques-screw-${corner}`}
          style={{ "--aw-plaques-turn": `${turn}deg` }}
        />
      ))}
      <div className="aw-plaques-face">
        <span className="aw-plaques-frame" aria-hidden="true" />
        <div className="aw-plaques-head">
          <Medallion w={w} />
          <div className="aw-plaques-who">
            {/* The inner spans carry the engraved fill, one shading per line. */}
            <h3 className="aw-plaques-title">
              <span>{award.title}</span>
            </h3>
            <div className="aw-plaques-name" style={{ "--aw-plaques-fit": nameFit(w.name) }}>
              <span>{w.name}</span>
            </div>
            {w.sub && (
              <div className="aw-plaques-sub">
                {/* The team's name follows in words; its logo is only the mark. */}
                {w.kind === "driver" && w.team && (
                  <span className="aw-plaques-sublogo" aria-hidden="true">
                    <TeamLogo id={w.team.id} name={w.team.name} color={w.team.color} logoUrl={w.team.logoUrl} size={14} />
                  </span>
                )}
                <span className="min-w-0">{w.sub}</span>
              </div>
            )}
          </div>
        </div>
        {award.note && <p className="aw-plaques-note">{award.note}</p>}
      </div>
    </>
  );
  return w.to ? (
    <Link to={w.to} className="aw-plaques-plate aw-plaques-plate-link">
      {inner}
    </Link>
  ) : (
    <div className="aw-plaques-plate">{inner}</div>
  );
}

export default function LookPlaques({ seasons }) {
  const [picked, setPicked] = useState(seasons[0]?.seasonNumber);
  const season = seasons.find((s) => s.seasonNumber === picked) || seasons[0];
  // After the first pick the wall fades over as a whole instead of dealing
  // its plates in again (see .swap-in in index.css).
  const swap = useSwapClass(season?.seasonNumber);
  if (!season) return null;
  const name = season.seasonName || `Season ${season.seasonNumber}`;
  return (
    <section data-awards-look="plaques" className="aw-plaques reveal">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-eyebrow sm:text-[11px] sm:tracking-[0.2em]">
            {name}
          </div>
          <h2 className="mt-1 font-display text-2xl font-extrabold uppercase tracking-tight text-dark sm:text-3xl">
            Season awards
          </h2>
        </div>
        {seasons.length > 1 && (
          <SlidingTabs
            items={seasons.map((s) => ({
              key: s.seasonNumber,
              label: <span data-awards-season={s.seasonNumber}>S{s.seasonNumber}</span>,
              title: s.seasonName || `Season ${s.seasonNumber}`,
            }))}
            value={season.seasonNumber}
            onChange={setPicked}
          />
        )}
      </div>
      <div key={season.seasonNumber} className={swap}>
        <ul className="aw-plaques-wall cascade" aria-label={`Awards, ${name}`}>
          {season.awards.map((a, i) => (
            <li key={a.id} className="aw-plaques-slot" style={{ "--i": Math.min(i, 12) }}>
              <Plaque award={a} seasonNumber={season.seasonNumber} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
