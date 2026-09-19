import { useLayoutEffect, useRef, useState } from "react";
import Flag from "./Flag.jsx";
import { countryFor } from "../data/driverCountries.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { useSeries } from "../context/SeriesContext.jsx";
// The collector series (Concepts, Spectrum, Velocity, Signature): a catalogue of
// keys and the stylesheets that paint them. They hang off the same data-edition
// the earned editions use, plus data-series/data-material, so a bought design is
// just another edition as far as everything outside this file is concerned.
import { COLLECTIBLE_EDITIONS } from "./collectibleEditions.js";
import useCardFoil from "./useCardFoil.js";
import "./collectibleCards.css";
import "./collectibleFinishes.css";
import "./collectibleSpectrum.css";
import "./collectibleThemes.css";
import "./collectibleConcepts.css";
import "./cardPhotoEdges.css";
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
// note on purpose — the admins are still refining those two formulas. The
// values themselves are the card's own season snapshot (see cardRatingService):
// what "this season" means below is the season the card was earned in, not
// necessarily the one being raced.
export const RATING_INFO = {
  exp: {
    code: "EXP",
    label: "Experience",
    text:
      "Career experience over your last seven finished seasons: race starts (45%), championship results for you and your teams (45%), plus small bonuses for finishing nearly every race and for seasons raced. An absolute scale, not compared to the rest of the field.",
  },
  rac: {
    code: "RAC",
    label: "Racecraft",
    text:
      "How you race, measured over the season this card was earned in and ranked against that field: finishing positions (45%), places gained from your grid slot (20%), podiums (20%) and on-track overtakes (15%).",
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
      "Raw speed over the career window: your average grid slot, your gap to the best race laps, and how consistent your lap times are, all ranked against the season's regulars.",
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
  // A collector design, if this driver is wearing one. The safety car keeps its
  // own marshalling edition whatever else is set.
  const collectible = driver?.role !== "safety" ? COLLECTIBLE_EDITIONS[driver?.cardStyle] : null;
  // Two of the series put the name in a narrower box than the league cards do.
  const nameMaxSize = collectible?.series === "concepts" ? 34 : collectible?.series === "signature" ? 36 : 40;
  const { ref: nameRef, size: nameSize } = useFitName(driver?.name || "", nameMaxSize);
  // The foil answers to the pointer: the hook hands the card where your hand is
  // (--mx/--my plus a slight lean), which is what makes a holo sheen travel
  // instead of sitting still. It bows out by itself under reduced motion and in
  // performance-lite mode.
  //
  // Called HERE, with the other hooks and above the early return below: a hook
  // after that return is a hook that does not always run, and this one spent its
  // first evening never attaching at all because of it.
  const foilRef = useCardFoil(
    Boolean(collectible) && driver?.cardAnim !== "off" && anim !== "none"
  );
  const { current: season, seasons } = useSeason();
  const [info, setInfo] = useState(null); // "exp" | "rac" | "aha" | "pac" | null
  // A Discord avatar dies the moment the member changes their picture: the
  // stored URL 404s until they sign in again, and the card was left with an
  // empty hole where the photo should be. Falling back to no photo at all
  // gives the design's own surface back, which every edition is built to
  // stand on.
  const [photoBroken, setPhotoBroken] = useState(null);
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
  const wantedPhoto = driver.cardPhotoUrl || driver.photoUrl;
  const cardPhoto = wantedPhoto && wantedPhoto !== photoBroken ? wantedPhoto : null;
  // The chosen card edition. Safety-car drivers always keep their marshalling
  // amber edition; otherwise the driver's pick (null = classic). The design
  // lives in CSS keyed on data-edition — editions with a fixed palette define
  // --team/--team2 there. We only set those vars INLINE for the team-coloured
  // editions (classic + safety); an inline value would otherwise beat the CSS
  // palette (inline styles outrank any selector) and the edition wouldn't tint.
  const edition = isSafety ? "safety" : driver?.cardStyle || "classic";
  // "carbon" and "neon" (premium preview editions) are team-coloured too: the
  // weave and the lit tube are the material, the team colour stays the identity,
  // riding the same inline vars.
  const teamColored =
    edition === "classic" ||
    edition === "safety" ||
    edition === "carbon" ||
    edition === "neon" ||
    collectible?.material === "carbon";
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
      ref={foilRef}
      data-edition={edition}
      data-collectible={collectible ? "true" : undefined}
      data-series={collectible?.series}
      data-material={collectible?.material}
      data-photo={cardPhoto ? "true" : undefined}
      data-anim={animAttr}
      style={teamColored ? { "--team": color, "--team2": `color-mix(in srgb, ${color} 52%, #ffffff)` } : undefined}
    >
      <div className="rcard">
        {/* The Concepts series paints a full-bleed material behind everything
            (and Studio Blue prints the driver's number into it). The other
            series need no element of their own. */}
        {collectible?.series === "concepts" && (
          <div className="rcard-concept-art" aria-hidden="true">
            {edition === "concept-blue" && <span>{driver.number}</span>}
          </div>
        )}
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
                    onError={() => setPhotoBroken(cardPhoto)}
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
        {/* A collector card's two extras: the light that follows the pointer
            across the foil, and the corner that says which series it is from
            and which number in that series. Both are inert on every other
            edition, so nothing about the league's own cards changes. */}
        {collectible && (
          <>
            <div className="rcard-foil-light" aria-hidden="true" />
            <div className="rcard-collection">
              <img src="/logo-dark.png" alt="" draggable={false} />
              <b>{collectible.name}</b>
              <small>EDITION {collectible.serial}</small>
            </div>
          </>
        )}

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
            <p className="mt-1.5 text-[11px] font-semibold leading-relaxed text-warn">
              This formula is still being fine-tuned, so the exact maths may change.
            </p>
          )}
          {/* Where the number comes from: a card is locked for a whole season
              and shows the end of the season before it. */}
          {rating?.card?.locked && rating.card.fromSeasonNumber != null && (
            <p className="mt-1.5 text-[11px] font-semibold leading-relaxed text-light">
              Locked for this season · earned by the end of Season {rating.card.fromSeasonNumber}.
            </p>
          )}
          {rating?.card?.source === "live" && (
            <p className="mt-1.5 text-[11px] font-semibold leading-relaxed text-light">
              First season on a card · this one still moves with every round, then locks for next season.
            </p>
          )}
        </div>
      )}
    </div>
  );
}


// The BACK of a rating card (the flip's other side): the same chamfered frame in
// the same MATERIAL as the front — the edition's layers are the card's own, so a
// carbon card is carbon on both sides and a holo one keeps its foil — with the
// league mark front and centre and the driver's name plus season as a quiet
// signature line. The dark logo variant always applies (the card face is dark in
// both themes) and a series' own uploaded mark is honoured like everywhere else.
export function CardBack({ driver, seasonLabel = "", edition = "classic", onClick }) {
  const { current: series } = useSeries();
  const color = driver?.team?.color || "#3b4254";
  // A collector design is a MATERIAL, and a material does not stop at the edge
  // of the front: the back carries the same series and finish, so turning a
  // chrome card over shows chrome rather than a plain black panel.
  const collectible = COLLECTIBLE_EDITIONS[edition] || null;
  const teamColored =
    edition === "classic" ||
    edition === "safety" ||
    edition === "carbon" ||
    edition === "neon" ||
    collectible?.material === "carbon";
  const logo = series?.logoDarkUrl || "/logo-dark.png";

  // A COLLECTOR card's back is designed, not improvised: each series paints its
  // own reverse (the printed pattern, where the mark sits, the rule under the
  // top edge) in components/collectible*.css, keyed on these class names. The
  // league's own editions keep the hand-built back below, which is the one they
  // were drawn for.
  if (collectible) {
    return (
      <div
        // h-full: the front of a card gets its height from its contents, but a
        // collector back is a painted panel with nothing in it that has a height
        // of its own. Without this it collapsed to a six pixel sliver, which is
        // exactly what it looked like.
        className="rcard-frame h-full"
        data-edition={edition}
        data-collectible="true"
        data-series={collectible.series}
        data-material={collectible.material}
        style={teamColored ? { "--team": color, "--team2": `color-mix(in srgb, ${color} 52%, #ffffff)` } : undefined}
      >
        <div
          className="rcard-back"
          onClick={onClick}
          style={onClick ? { cursor: "pointer" } : undefined}
          title={onClick ? "Flip the card back over" : undefined}
        >
          <div className="rcard-back-pattern" aria-hidden="true" />
          <div className="rcard-foil-light" aria-hidden="true" />
          <img className="rcard-back-logo" src={logo} alt="" draggable={false} />
          <div className="rcard-back-title">
            <strong>NABS RACING</strong>
            <small>OFFICIAL DRIVER CARD</small>
          </div>
          <div className="rcard-back-bottom">
            <span>{driver?.name}</span>
            {seasonLabel && (
              <>
                <i aria-hidden="true" />
                <span>{seasonLabel}</span>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="rcard-frame"
      data-edition={edition}
      style={teamColored ? { "--team": color, "--team2": `color-mix(in srgb, ${color} 52%, #ffffff)` } : undefined}
    >
      <div
        className="rcard flex flex-col items-center justify-center"
        onClick={onClick}
        style={onClick ? { cursor: "pointer" } : undefined}
        title={onClick ? "Flip the card back over" : undefined}
      >
        {/* quiet glow in the card's own colour, then the front's own dressing */}
        <div
          className="absolute inset-0"
          style={{ background: "radial-gradient(85% 60% at 50% 40%, color-mix(in srgb, var(--team) 26%, transparent), transparent 72%)" }}
        />
        <div className="rcard-streaks" />
        <div className="rcard-grade" />
        <div className="rcard-innerline" />
        {/* The material's own layers sit above the card's middle (the foil and
            the spectrum are the whole point), so the mark needs its own pool of
            dark to stay legible, and it sits above them. */}
        <div
          className="absolute inset-0 z-[4]"
          style={{ background: "radial-gradient(68% 48% at 50% 42%, rgba(4, 6, 10, 0.78), rgba(4, 6, 10, 0.18) 72%)" }}
        />

        <img src={logo} alt="" width={116} height={116} className="relative z-10" draggable={false} />
        <div className="relative z-10 mt-4 text-center">
          <div className="font-display text-2xl font-black uppercase tracking-tight text-white">
            NABS <span style={{ color: "color-mix(in srgb, var(--team2) 70%, #fff)" }}>Racing</span>
          </div>
          <div className="mt-1 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-white/45">
            Official driver card
          </div>
        </div>
        <div className="rcard-brand">
          <span>{driver?.name}</span>
          {seasonLabel && (
            <>
              <i />
              {seasonLabel}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
