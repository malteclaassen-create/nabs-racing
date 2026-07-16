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

// Plain-words explanation of each sub-rating, shown on the public profile when
// `explain` is on (hover/tap a value). RAC and AWA carry a "still being tuned"
// note on purpose — the admins are still refining those two formulas.
const RATING_INFO = {
  exp: {
    code: "EXP",
    label: "Experience",
    text:
      "Career experience over your last seven finished seasons: race starts (45%), championship results for you and your teams (45%), plus small bonuses for finishing nearly every race and for seasons raced. An absolute scale — not compared to the rest of the field.",
  },
  rac: {
    code: "RAC",
    label: "Racecraft",
    text:
      "How you race, measured on this season and ranked against the field: finishing positions (45%), places gained from your grid slot (20%), podiums (20%) and on-track overtakes (15%).",
    tuning: true,
  },
  aha: {
    code: "AWA",
    label: "Awareness",
    text:
      "Staying out of trouble, ranked against the field: finish rate, few DNFs, consistent lap times, and how rarely you collect car contacts, off-tracks and penalties.",
    tuning: true,
  },
  pac: {
    code: "PAC",
    label: "Pace",
    text:
      "Raw speed over the career window: your average grid slot, your gap to the best race laps, and how consistent your lap times are — ranked against the season's regulars.",
  },
};

// FIFA-/EA-style driver rating card. `driver` supplies identity (name, number,
// country, photo + framing, team + team logo); `rating` supplies the numbers.
// The team colour drives the whole card via the --team / --team2 custom
// properties; all the visual layering lives in index.css (.rcard-*).
// `anim` (preview only, from the /cards look-book) forces ONE animation type
// onto the card via data-anim, so the different motions can be compared side by
// side. Omitted / "baseline" = each edition keeps its own designed motion.
// `explain` (the public profile) makes the four sub-values interactive: hover
// or tap one and a small panel pops open UNDER the card explaining how that
// value is computed (the card clips its own overflow, so it can't pop inside).
export default function RatingCard({ driver, rating, anim, explain = false }) {
  // Hooks run unconditionally (rules of hooks); harmless when we render null.
  const { ref: nameRef, size: nameSize } = useFitName(driver?.name || "");
  const { current: season, seasons } = useSeason();
  const [info, setInfo] = useState(null); // "exp" | "rac" | "aha" | "pac" | null
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

  const card = (
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
          {/* internal key stays `aha`; the league's display code is AWA */}
          {["exp", "rac", "aha", "pac"].map((k) => (
            <div
              key={k}
              className="rcard-stat"
              style={explain ? { cursor: "help" } : undefined}
              onMouseEnter={explain ? () => setInfo(k) : undefined}
              onMouseLeave={explain ? () => setInfo(null) : undefined}
              onClick={explain ? () => setInfo((cur) => (cur === k ? null : k)) : undefined}
            >
              <span>{RATING_INFO[k].code}</span>
              <b>{g ? g[k] : "–"}</b>
            </div>
          ))}
        </div>

        <div className="rcard-brand"><span>NABS</span> RACING<i />{seasonLabel}{tierLabel && <><i />{tierLabel}</>}</div>
      </div>
    </div>
  );

  if (!explain) return card;
  // Explain mode: a relative wrapper hosts the pop-open panel. It overlays the
  // LOWER PART OF THE CARD itself (not below it) — profile layouts clip
  // overflow around the card, so anything floating outside its footprint
  // would be cut off or land behind the next section.
  return (
    <div className="relative">
      {card}
      {info && RATING_INFO[info] && (
        <div className="pop-in pointer-events-none absolute inset-x-2 bottom-[4.5rem] z-30 rounded-xl border border-border bg-card p-4 text-left shadow-2xl shadow-ink/40">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-sm font-black uppercase tracking-tight text-dark">
              {RATING_INFO[info].label}
            </span>
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">
              {RATING_INFO[info].code}
            </span>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-medium">{RATING_INFO[info].text}</p>
          {RATING_INFO[info].tuning && (
            <p className="mt-1.5 text-[11px] font-semibold leading-relaxed text-amber-600 dark:text-amber-400">
              This formula is still being fine-tuned — the exact maths may change.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
