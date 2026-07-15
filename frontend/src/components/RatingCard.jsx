import { useLayoutEffect, useRef, useState } from "react";
import Flag from "./Flag.jsx";
import { countryFor } from "../data/driverCountries.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { wreathLeaves } from "./ChampionBadge.jsx";

const TIER = { 1: "Tier 1", 2: "Tier 2", 0: "Reserve" };

// The metal editions (title cards) carry a faint laurel in the top-right
// corner, so the card speaks the same language as the podium seal. Reuse the
// seal's wreath geometry rather than drawing a second one.
const WREATH_EDITIONS = new Set(["champion", "vice", "bronze"]);
const WREATH = wreathLeaves();

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
    // Saturation of the card photo (1 = full colour). Toning it down keeps a
    // very colourful picture from drowning out the card edition.
    s: clampN(Number(pos?.s), 0, 1, 1),
    // Tint: how strongly the photo takes on the card edition's own colour
    // (0 = untinted, 1 = a full duotone in the card colour).
    t: clampN(Number(pos?.t), 0, 1, 0),
  };
}

// FIFA-/EA-style driver rating card. `driver` supplies identity (name, number,
// country, photo + framing, team + team logo); `rating` supplies the numbers.
// The team colour drives the whole card via the --team / --team2 custom
// properties; all the visual layering lives in index.css (.rcard-*).
// `anim` (preview only, from the /cards look-book) forces ONE animation type
// onto the card via data-anim, so the different motions can be compared side by
// side. Omitted / "baseline" = each edition keeps its own designed motion.
export default function RatingCard({ driver, rating, anim }) {
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
  // The card can carry its OWN picture, separate from the profile avatar; it
  // falls back to the profile photo when none is set.
  const cardPhoto = driver.cardPhotoUrl || driver.photoUrl;
  // The chosen card edition. Safety-car drivers always keep their marshalling
  // amber edition; otherwise the driver's pick (null = classic). The design
  // lives in CSS keyed on data-edition — editions with a fixed palette define
  // --team/--team2 there. We only set those vars INLINE for the team-coloured
  // editions (classic + safety); an inline value would otherwise beat the CSS
  // palette (inline styles outrank any selector) and the edition wouldn't tint.
  const edition = isSafety ? "safety" : driver?.cardStyle || "classic";
  const teamColored = edition === "classic" || edition === "safety";
  // The tier badge now lives in the footer signature line (see .rcard-brand),
  // not a top-right plate — the top-right corner is the wreath's home now.
  const tierLabel = isSafety ? "SAFETY CAR" : TIER[driver.tier] ? TIER[driver.tier].toUpperCase() : null;
  // Motion: the /cards look-book forces one type via `anim` ("baseline" = the
  // edition's own designed motion). Real cards have no `anim`; there the driver's
  // own on/off switch applies — cardAnim "off" reuses the look-book's fully-still
  // "none" state (stills sheen, glow band, sparkle and wreath twinkle), while the
  // baseline design (colours, wreath, layout) stays exactly as-is.
  const animAttr = anim
    ? anim !== "baseline" ? anim : undefined
    : driver?.cardAnim === "off" ? "none" : undefined;

  return (
    <div
      className="rcard-frame"
      data-edition={edition}
      data-anim={animAttr}
      style={teamColored ? { "--team": color, "--team2": `color-mix(in srgb, ${color} 52%, #ffffff)` } : undefined}
    >
      <div className="rcard">
        {cardPhoto ? (
          (() => {
            const { x, y, z, s, t } = cardPhotoFraming(driver.photoPos);
            const sat = s !== 1 ? `saturate(${s})` : undefined;
            return (
              <>
                {/* blurred full-card continuation, so the photo has no hard bottom edge */}
                <div
                  className="rcard-photo-blur"
                  style={{ backgroundImage: `url('${cardPhoto}')`, filter: s !== 1 ? `blur(26px) saturate(${1.3 * s}) brightness(0.72)` : undefined }}
                />
                <div className="rcard-photo">
                  <img
                    src={cardPhoto}
                    alt=""
                    draggable={false}
                    style={{
                      objectPosition: `${x}% ${y}%`,
                      // zoom around the chosen focal point, so zooming keeps it in view
                      transform: z !== 1 ? `scale(${z})` : undefined,
                      transformOrigin: `${x}% ${y}%`,
                      filter: sat,
                    }}
                  />
                  {/* Tint the photo toward the card's own colour (mix-blend
                      "color" keeps the photo's shading but takes the card hue),
                      so a loud picture harmonises with the edition. */}
                  {t > 0 && <div className="rcard-tint" style={{ opacity: t }} />}
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
        {WREATH_EDITIONS.has(edition) && (
          <svg className="rcard-wreath" viewBox="0 0 24 24" aria-hidden="true">
            <g fill="currentColor">
              {WREATH.map((l) => (
                <ellipse key={l.key} cx={l.x} cy={l.y} rx={l.rx} ry={l.ry} transform={`rotate(${l.rot} ${l.x} ${l.y})`} />
              ))}
            </g>
          </svg>
        )}
        <div className="rcard-sheen" />
        {/* Generic effect layer — inert unless data-anim forces a motion type
            (preview look-book). Real cards never set it. */}
        <div className="rcard-fx" />
        <div className="rcard-innerline" />

        <div className="rcard-rtg">
          <span className="rcard-rtg-l">RTG</span>
          <span className="rcard-rtg-n">{g ? g.overall : "SC"}</span>
        </div>
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

        <div className="rcard-brand"><span>NABS</span> RACING<i />{seasonLabel}{tierLabel && <><i />{tierLabel}</>}</div>
      </div>
    </div>
  );
}
