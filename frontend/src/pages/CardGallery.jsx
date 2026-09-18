import { useEffect, useRef, useState } from "react";
import { PageHeader } from "../components/ui.jsx";
import RatingCard, { CardBack } from "../components/RatingCard.jsx";
import SlidingTabs from "../components/SlidingTabs.jsx";

// A no-login preview of every rating-card edition — a design reference so the
// look of each unlockable card can be checked without earning it or signing in.
// Not linked in the nav; reach it at /cards. The catalogue mirrors the backend
// lib/cardEditions.js (kept in sync by hand; this page is preview-only).
const GROUPS = [
  {
    title: "Free",
    note: "Always selectable.",
    editions: [
      { key: "classic", name: "Classic", tagline: "Team colour" },
      { key: "nabs", name: "NABS", tagline: "League edition" },
      { key: "mono", name: "Mono", tagline: "Purist black & white" },
    ],
  },
  {
    title: "Milestones",
    note: "Earned from career starts, wins, podiums and poles, kept forever.",
    editions: [
      { key: "rookie", name: "Rookie", tagline: "10 starts" },
      { key: "veteran", name: "Veteran", tagline: "20 starts" },
      { key: "legend", name: "Legend", tagline: "50 starts" },
      { key: "winner", name: "Winner", tagline: "First win" },
      { key: "dominator", name: "Dominator", tagline: "10 wins" },
      { key: "podium", name: "Podium", tagline: "10 podiums" },
      { key: "poleman", name: "Poleman", tagline: "First pole" },
      { key: "qualiking", name: "Quali King", tagline: "5 poles" },
    ],
  },
  {
    title: "Titles",
    note: "Key off a season's podium seal, for that season's card only.",
    editions: [
      { key: "champion", name: "Champion", tagline: "Title this season" },
      { key: "vice", name: "Vice", tagline: "P2 this season" },
      { key: "bronze", name: "Bronze", tagline: "P3 this season" },
      { key: "teamchamp", name: "Team Champion", tagline: "Team title this season" },
    ],
  },
  {
    title: "Special",
    note: "Fixed role, not chosen.",
    editions: [{ key: "safety", name: "Safety Car", tagline: "Safety car driver", role: "safety" }],
  },
];

// A believable sample so the numbers, flag, team logo and stat bar all show;
// no photo on purpose, so the palette tint reads through the initial fallback.
const SAMPLE_DRIVER = {
  id: "sample",
  name: "Sample Driver",
  number: 1,
  country: "de",
  tier: 1,
  photoUrl: null,
  seasonNumber: 7,
  team: { id: "mclaren", name: "McLaren", color: "#ff8000", logoUrl: "/teams/mclaren.png" },
};
const SAMPLE_RATING = { ratings: { overall: 91, exp: 88, rac: 90, aha: 86, pac: 93 } };

// --- Premium candidates (PREVIEW) -------------------------------------------
// Designs for the cards the points system would SELL rather than award. They
// are deliberately not in the backend catalogue, so nothing can select one yet;
// this page hands the key straight to the card. Hidden behind ?premium=1 so the
// group can't be stumbled on from the public look-book while it's being judged.
const PREMIUM = {
  title: "Premium (preview)",
  note: "Candidates for cards bought with points. Not selectable anywhere — design study only. Move the pointer over one, click it to turn it over.",
  editions: [
    { key: "holo", name: "Holo", tagline: "Foil that moves with your hand" },
    { key: "carbon", name: "Carbon", tagline: "Real woven surface, matt, no shine" },
    { key: "prisma", name: "Prisma", tagline: "Spectrum drifting around and through it" },
    { key: "gold", name: "Gold", tagline: "Gold leaf on black, follows your hand" },
    { key: "titanium", name: "Titanium", tagline: "Brushed metal with a drifting heat tint" },
    { key: "obsidian", name: "Obsidian", tagline: "Black glass, one reflection that slides" },
    { key: "neon", name: "Neon", tagline: "A lit tube in the team colour" },
    { key: "blueprint", name: "Blueprint", tagline: "Technical drawing, dead still" },
  ],
};
const showPremium = () => {
  try {
    return new URLSearchParams(window.location.search).get("premium") === "1";
  } catch {
    return false;
  }
};

// The premium cards answer to the pointer: the wrapper leans the card and hands
// the foil layers where your hand is (--mx/--my, 0..1), which is what makes the
// holo sheen travel instead of sitting still. Same two switches as every other
// motion on the site: off under reduced-motion and in performance-lite mode.
function useFoil({ max = 7 } = {}) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const onMove = (e) => {
      if (document.documentElement.classList.contains("fx-lite")) return;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.setProperty("--mx", px.toFixed(3));
        el.style.setProperty("--my", py.toFixed(3));
        el.style.setProperty("--hover", "1");
        el.style.setProperty(
          "transform",
          `perspective(900px) rotateX(${-(py - 0.5) * max}deg) rotateY(${(px - 0.5) * max}deg)`
        );
      });
    };
    const reset = () => {
      if (raf) cancelAnimationFrame(raf);
      el.style.removeProperty("transform");
      el.style.removeProperty("--mx");
      el.style.removeProperty("--my");
      el.style.setProperty("--hover", "0");
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", reset);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", reset);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [max]);
  return ref;
}

// One preview cell. Premium cards get the pointer wrapper and can be turned
// over (click the card); everything else renders exactly as before.
function GalleryCard({ edition, index, foil, driver, rating, anim }) {
  const foilRef = useFoil();
  const [flipped, setFlipped] = useState(false);
  const card = <RatingCard driver={driver} rating={rating} anim={anim} />;
  return (
    <div style={{ "--i": index }} className="w-full max-w-[332px] space-y-2.5">
      <div
        ref={foil ? foilRef : undefined}
        style={foil ? { transition: "transform 0.25s ease", willChange: "transform" } : undefined}
      >
        {foil ? (
          <div className={`cardflip ${flipped ? "is-flipped" : ""}`}>
            <div className="cardflip-inner">
              <div
                className="cardflip-front"
                onClick={() => setFlipped(true)}
                style={{ cursor: "pointer" }}
                title="Turn the card over"
              >
                {card}
              </div>
              <div className="cardflip-back">
                <CardBack
                  driver={driver}
                  seasonLabel={`SEASON ${driver.seasonNumber}`}
                  edition={edition.key}
                  onClick={() => setFlipped(false)}
                />
              </div>
            </div>
          </div>
        ) : (
          card
        )}
      </div>
      <div className="px-1 text-center">
        <div className="font-display text-sm font-bold uppercase tracking-tight text-dark">{edition.name}</div>
        <div className="text-xs text-light">{edition.tagline}</div>
      </div>
    </div>
  );
}

// Animation types to preview. "Baseline" keeps each edition's own designed
// motion; the rest force one motion onto every card for comparison.
const ANIMS = [
  { key: "baseline", label: "Baseline" },
  { key: "sweep", label: "Sweep" },
  { key: "flash", label: "Flash" },
  { key: "glow", label: "Glow" },
  { key: "pulse", label: "Pulse" },
  { key: "twinkle", label: "Twinkle" },
  { key: "none", label: "None" },
];

export default function CardGallery() {
  // A colour picker so the team-coloured editions (classic) and the tinting can
  // be sanity-checked against different team colours.
  const [teamColor, setTeamColor] = useState("#ff8000");
  // Which animation type to force onto every card (baseline = each its own).
  const [anim, setAnim] = useState("baseline");
  // A local preview photo (object URL, never uploaded) so photo-dependent
  // editions (mono, the framing) can be judged with a real face.
  const [photoUrl, setPhotoUrl] = useState(null);
  const [photoSat, setPhotoSat] = useState(1); // card-photo saturation (1 = full)
  const [photoTint, setPhotoTint] = useState(0); // how much the photo takes the card colour
  const fileRef = useRef(null);

  function onPickPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(URL.createObjectURL(file));
  }
  function clearPhoto() {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(null);
  }

  return (
    <div className="content-in space-y-8">
      <PageHeader
        eyebrow="Design preview"
        title="Card Editions"
        subtitle="Every unlockable rating-card design. Drivers pick theirs on their profile; most are earned through starts, wins, poles and titles. This page is a look-book, no login needed."
        right={
          <div className="flex flex-wrap items-center gap-3">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onPickPhoto} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-medium transition hover:bg-surface2"
              title="Shown on every preview card. Stays on your device. Nothing is uploaded."
            >
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 8h3l2-3h6l2 3h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" />
                <circle cx="12" cy="13.5" r="3.5" />
              </svg>
              {photoUrl ? "Change photo" : "Add photo"}
            </button>
            {photoUrl && (
              <button type="button" onClick={clearPhoto} className="text-sm font-semibold text-light transition hover:text-dark">
                Remove
              </button>
            )}
            <label
              className={`flex items-center gap-2 text-sm text-medium ${photoUrl ? "" : "opacity-50"}`}
              title={photoUrl ? "Colour the photo takes on from the card edition (0 = untouched, 100% = full duotone in the card colour)" : "Add a photo to see the effect"}
            >
              Photo takes card colour
              <input
                type="range" min="0" max="1" step="0.05" value={photoTint}
                onChange={(e) => setPhotoTint(Number(e.target.value))}
                className="w-28" aria-label="Photo takes card colour"
              />
              <span className="w-9 text-right font-mono text-xs tabular-nums text-light">{Math.round(photoTint * 100)}%</span>
            </label>
            <label
              className={`flex items-center gap-2 text-sm text-medium ${photoUrl ? "" : "opacity-50"}`}
              title={photoUrl ? "Tone the photo’s own colour down toward grey" : "Add a photo to see the effect"}
            >
              Photo colour
              <input
                type="range" min="0" max="1" step="0.05" value={photoSat}
                onChange={(e) => setPhotoSat(Number(e.target.value))}
                className="w-28" aria-label="Photo colour"
              />
              <span className="w-9 text-right font-mono text-xs tabular-nums text-light">{Math.round(photoSat * 100)}%</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-medium">
              Team colour
              <input
                type="color"
                value={teamColor}
                onChange={(e) => setTeamColor(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded-lg border border-border bg-card p-0.5"
                title="Affects the team-coloured editions (Classic)"
              />
            </label>
          </div>
        }
      />

      {/* Animation-type switcher — try each motion across the whole grid. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-medium">Animation</span>
        <SlidingTabs
          wrapClassName="inline-flex flex-wrap rounded-lg border border-border bg-card p-1"
          btnClassName="px-3 py-1.5 text-xs uppercase tracking-wide"
          pillClassName="rounded-md bg-brand"
          items={ANIMS.map((a) => ({ key: a.key, label: a.label }))}
          value={anim}
          onChange={setAnim}
        />
        <span className="text-xs text-light">
          {anim === "baseline" ? "Each edition’s own motion." : "Forced on every card, for comparison."}
        </span>
      </div>

      {(showPremium() ? [...GROUPS, PREMIUM] : GROUPS).map((group) => (
        <section key={group.title} className="space-y-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border pb-3">
            <h2 className="font-display text-xl font-extrabold uppercase tracking-tight text-dark">{group.title}</h2>
            <span className="text-sm text-light">{group.note}</span>
          </div>
          {/* Sixteen cards used to land at once. Dealt out instead, in the same
              45ms rhythm the standings cards use. */}
          <div className="cascade grid grid-cols-1 justify-items-center gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {group.editions.map((e, i) => (
              <GalleryCard
                key={e.key}
                edition={e}
                index={i}
                foil={group === PREMIUM}
                driver={{
                  ...SAMPLE_DRIVER,
                  role: e.role ?? null,
                  cardStyle: e.role ? null : e.key,
                  photoUrl: photoUrl || null,
                  photoPos: { x: 50, y: 22, z: 1, s: photoSat, t: photoTint },
                  team: { ...SAMPLE_DRIVER.team, color: teamColor },
                }}
                rating={SAMPLE_RATING}
                anim={anim}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
