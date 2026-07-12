import { useLayoutEffect, useRef, useState } from "react";
import Flag from "./Flag.jsx";
import { countryFor } from "../data/driverCountries.js";
import { useSeason } from "../context/SeasonContext.jsx";

const TIER = { 1: "Tier 1", 2: "Tier 2", 0: "Reserve" };

// Auto-fit the name to the card: shrink the font-size until the longest word
// fits the available width, so long single-word names (e.g. "JadenDMotorports")
// no longer overflow and clip at the card edge. Multi-word names that already
// fit keep the full size and simply wrap across lines, as before. Runs in a
// layout effect so the adjustment happens before paint (no visible flash).
function useFitName(name, max = 40, min = 15) {
  const ref = useRef(null);
  const [size, setSize] = useState(max);
  useLayoutEffect(() => {
    if (!ref.current) return;
    let cancelled = false;
    const fit = () => {
      const el = ref.current;
      if (cancelled || !el) return;
      let s = max;
      el.style.fontSize = `${s}px`;
      // scrollWidth > clientWidth means a word is wider than the box (a single
      // long word can't wrap) — step the size down until it fits, or we hit min.
      while (s > min && el.scrollWidth > el.clientWidth) {
        s -= 1;
        el.style.fontSize = `${s}px`;
      }
      setSize(s);
    };
    fit();
    // Re-fit once webfonts finish loading — the display font's metrics differ
    // from the fallback, so a name measured against the fallback could still
    // overflow (or shrink too far) until the real font is in.
    document.fonts?.ready.then(fit);
    return () => { cancelled = true; };
  }, [name, max, min]);
  return { ref, size };
}

// The driver-adjustable photo framing (Driver.cardPhotoPos, self-service on
// /profile): focal point in % + zoom, clamped so bad data can't push the
// picture off the card. null/absent = the classic default framing.
const clampN = (v, lo, hi, dflt) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);
export function cardPhotoFraming(pos) {
  return {
    x: clampN(Number(pos?.x), 0, 100, 50),
    y: clampN(Number(pos?.y), 0, 100, 22),
    z: clampN(Number(pos?.z), 1, 3, 1),
  };
}

// FIFA-/EA-style driver rating card. `driver` supplies identity (name, number,
// country, photo + framing, team + team logo); `rating` supplies the numbers.
// The team colour drives the whole card via the --team / --team2 custom
// properties; all the visual layering lives in index.css (.rcard-*).
export default function RatingCard({ driver, rating }) {
  // Hooks run unconditionally (rules of hooks); harmless when we render null.
  const { ref: nameRef, size: nameSize } = useFitName(driver?.name || "");
  const { current: season, seasons } = useSeason();
  // Card footer brand line, e.g. "NABS RACING · SEASON 4" — the DRIVER's own
  // season when known (the ratings are per-season, so an archive driver's card
  // must not claim the season currently being viewed), else the viewed one.
  const ownSeason =
    driver?.seasonNumber != null ? (seasons || []).find((s) => s.number === driver.seasonNumber) : null;
  const seasonLabel =
    (ownSeason?.name || (driver?.seasonNumber != null ? `Season ${driver.seasonNumber}` : season?.name) || "")
      .toUpperCase() || "LEAGUE";
  // Safety car drivers get their own card edition: the classic marshalling
  // amber replaces the team colour, the tier plate reads SAFETY CAR, and the
  // card renders even WITHOUT ratings (no races -> no rating payload): the
  // RTG box then says SC and the stat boxes show dashes. If they do race,
  // their real numbers appear on the same card.
  const isSafety = driver?.role === "safety";
  if (!rating?.ratings && !isSafety) return null;
  const g = rating?.ratings || null;
  const color = isSafety ? "#f59e0b" : driver.team?.color || "#3b4254";
  const initial = (driver.name || "?").trim().charAt(0).toUpperCase();
  const logo = driver.team?.logoUrl;

  return (
    <div
      className="rcard-frame"
      style={{ "--team": color, "--team2": `color-mix(in srgb, ${color} 52%, #ffffff)` }}
    >
      <div className="rcard">
        {driver.photoUrl ? (
          (() => {
            const { x, y, z } = cardPhotoFraming(driver.photoPos);
            return (
              <>
                {/* blurred full-card continuation, so the photo has no hard bottom edge */}
                <div className="rcard-photo-blur" style={{ backgroundImage: `url('${driver.photoUrl}')` }} />
                <div className="rcard-photo">
                  <img
                    src={driver.photoUrl}
                    alt=""
                    draggable={false}
                    style={{
                      objectPosition: `${x}% ${y}%`,
                      // zoom around the chosen focal point, so zooming keeps it in view
                      transform: z !== 1 ? `scale(${z})` : undefined,
                      transformOrigin: `${x}% ${y}%`,
                    }}
                  />
                </div>
              </>
            );
          })()
        ) : (
          <div className="rcard-mono">{initial}</div>
        )}
        <div className="rcard-duotone" />
        <div className="rcard-streaks" />
        <div className="rcard-ray" />
        <div className="rcard-grade" />
        {logo && <div className="rcard-wm"><img src={logo} alt="" /></div>}
        <div className="rcard-sheen" />
        <div className="rcard-innerline" />

        <div className="rcard-rtg">
          <span className="rcard-rtg-l">RTG</span>
          <span className="rcard-rtg-n">{g ? g.overall : "SC"}</span>
        </div>
        {isSafety ? (
          <div className="rcard-tier">SAFETY CAR</div>
        ) : (
          TIER[driver.tier] && <div className="rcard-tier">{TIER[driver.tier].toUpperCase()}</div>
        )}

        <div className="rcard-id">
          <div className="rcard-meta">
            <Flag code={countryFor(driver.id, driver.country)} w={22} h={16} />
            {driver.number != null && <span className="rcard-num">#{driver.number}</span>}
          </div>
          <div className="rcard-name" ref={nameRef} style={{ fontSize: `${nameSize}px` }}>{driver.name}</div>
          <div className="rcard-team">
            {logo ? <img className="rcard-teamlogo" src={logo} alt="" /> : <span className="rcard-dot" />}
            {driver.team?.name}
          </div>
        </div>

        <div className="rcard-stats">
          <div className="rcard-stat"><span>EXP</span><b>{g ? g.exp : "–"}</b></div>
          <div className="rcard-stat"><span>RAC</span><b>{g ? g.rac : "–"}</b></div>
          {/* internal key stays `aha`; the league's display code is AWA */}
          <div className="rcard-stat"><span>AWA</span><b>{g ? g.aha : "–"}</b></div>
          <div className="rcard-stat"><span>PAC</span><b>{g ? g.pac : "–"}</b></div>
        </div>

        <div className="rcard-brand"><span>NABS</span> RACING<i />{seasonLabel}</div>
      </div>
    </div>
  );
}
