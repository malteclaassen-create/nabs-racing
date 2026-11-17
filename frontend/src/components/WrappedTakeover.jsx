// ---------------------------------------------------------------------------
// The way into a member's season Wrapped from the Home page.
//
// Once a season is over, a member who raced in it finds the Home main card
// taken over by their Wrapped: the season in big type in their team colour,
// in the story's own look (pages/review/story.css), and one button to watch
// it. Closing it (the cross, or watching it) is remembered per season in this
// browser, and the normal champion card comes back, which then keeps a
// smaller "Your Wrapped" button next to the standings.
//
// Whether there is a Wrapped at all is the server's call
// (GET /api/me/season-wrapped): signed in, switched on for them, raced in the
// season, the season complete.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motionOff } from "../hooks/motion.js";
import { Play, X } from "lucide-react";
import { api } from "../api/client.js";
import { readableInkOn } from "./ui.jsx";
import TeamLogo from "./TeamLogo.jsx";
import { slideColours } from "../pages/review/wrapPalette.js";
import "../pages/review/story.css";

const SEEN_KEY = (seasonId) => `nabs_wrapped_seen_${seasonId}`;
const LEAGUE = "#F4AFC6";

export const wrappedPath = (w) => `${w.seriesSlug ? `/s/${w.seriesSlug}` : ""}/drivers/${encodeURIComponent(w.driverId)}/review`;
const teamColourOf = (w) => (w?.team && w.team.tier !== 0 && /^#[0-9a-f]{6}$/i.test(w.team.color || "") ? w.team.color : LEAGUE);

function readSeen(seasonId) {
  try {
    return localStorage.getItem(SEEN_KEY(seasonId)) === "1";
  } catch {
    return false;
  }
}
function writeSeen(seasonId) {
  try {
    localStorage.setItem(SEEN_KEY(seasonId), "1");
  } catch {
    /* private window: it simply shows again next time */
  }
}

// { wrapped, showTakeover, dismiss } for the season on the Home page.
export function useSeasonWrapped(season, isLoggedIn, finished) {
  const [wrapped, setWrapped] = useState(null);
  const [seen, setSeen] = useState(() => (season?.id ? readSeen(season.id) : false));
  useEffect(() => {
    setWrapped(null);
    setSeen(season?.id ? readSeen(season.id) : false);
    if (!isLoggedIn || !finished || !season?.id) return undefined;
    let gone = false;
    api
      .mySeasonWrapped(season.id)
      .then((w) => !gone && setWrapped(w?.available ? w : null))
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [season?.id, isLoggedIn, finished]);
  const dismiss = () => {
    if (season?.id) writeSeen(season.id);
    setSeen(true);
  };
  return { wrapped, showTakeover: !!wrapped && !seen, dismiss };
}

// The takeover: covers the whole main card.
// The card (or the small button) grows into the story: a sheet in its
// colour covers the window but is clipped to exactly where the card sits,
// and the clip opens out to the whole window, the corners rounding off on the
// way; then the story opens underneath and the sheet fades. The curve starts
// slow, runs fast through the middle and settles slowly, the way system
// animations on a phone move. The sheet lives on <body>, so it survives the
// change of page.
const GROW_MS = 760;
const GROW_EASE = "cubic-bezier(0.65, 0, 0.35, 1)";
export function growInto(el, colour, go) {
  const box = el?.getBoundingClientRect();
  if (!box || motionOff() || typeof el.animate !== "function") {
    go();
    return;
  }
  const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || parseFloat(getComputedStyle(el.parentElement || el).borderTopLeftRadius) || 16;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const sheet = document.createElement("div");
  Object.assign(sheet.style, { position: "fixed", inset: "0", background: colour, zIndex: "2147483000", pointerEvents: "none" });
  document.body.appendChild(sheet);
  const from = `inset(${box.top}px ${vw - box.right}px ${vh - box.bottom}px ${box.left}px round ${radius}px)`;
  const grow = sheet.animate([{ clipPath: from }, { clipPath: "inset(0px 0px 0px 0px round 0px)" }], { duration: GROW_MS, easing: GROW_EASE, fill: "forwards" });
  grow.onfinish = () => {
    go();
    // Give the story a moment to paint, then let the sheet go, slowly.
    setTimeout(() => {
      const fade = sheet.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 360, easing: "cubic-bezier(0.33, 0, 0.2, 1)", fill: "forwards" });
      fade.onfinish = () => sheet.remove();
    }, 160);
  };
}

export function WrappedTakeover({ wrapped, onClose }) {
  const cardRef = useRef(null);
  const navigate = useNavigate();
  const colours = slideColours("intro", teamColourOf(wrapped));
  const label = wrapped.season?.label || "Season";
  const num = /\d+$/.exec(label)?.[0] || "";
  const head = num ? label.slice(0, -num.length).trim() : label;
  const team = wrapped.team && wrapped.team.tier !== 0 ? wrapped.team : null;
  return (
    <div ref={cardRef} className="wt-card absolute inset-0 z-20 overflow-hidden" style={{ ...colours, background: "var(--g-bg)", color: "var(--g-fg)" }} role="dialog" aria-label={`Your ${label} Wrapped`}>
      {/* A band of the slide's second colour sweeps across once, the way the
          story's slides hand over to each other. */}
      <div className="wt-sweep absolute inset-0" aria-hidden="true" />
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full transition hover:opacity-100"
        style={{ background: "color-mix(in srgb, var(--g-fg) 12%, transparent)", opacity: 0.85 }}
        aria-label="Close and show the championship card"
      >
        <X size={20} strokeWidth={2.25} />
      </button>
      <div className="relative flex h-full flex-col justify-center gap-6 px-7 py-10 sm:px-12 lg:flex-row lg:items-center lg:justify-between lg:gap-10">
        <div className="min-w-0">
          <div className="st-in text-[13px] font-bold uppercase tracking-[0.14em]" style={{ "--d": "150ms", fontFamily: "Inter, sans-serif" }}>
            The season's done. Here's how yours went.
          </div>
          <div className="mt-3 flex items-end gap-4">
            <div className="st-in wr-big uppercase" style={{ "--d": "300ms", fontSize: "clamp(3rem, 9vw, 7.5rem)", lineHeight: 0.85 }}>
              {head}
            </div>
            {num && (
              <div className="wr-echo wr-big wr-num st-land" style={{ "--d": "520ms", fontSize: "clamp(5rem, 15vw, 12rem)", lineHeight: 0.8 }}>
                <span className="wr-ghost" style={{ "--sx": "0.09em", "--sy": "0.07em", "--d": "870ms" }} aria-hidden="true">
                  {num}
                </span>
                <span className="wr-ghost" style={{ "--sx": "0.045em", "--sy": "0.035em", "--d": "770ms" }} aria-hidden="true">
                  {num}
                </span>
                <span className="relative">{num}</span>
              </div>
            )}
          </div>
          <div className="st-in wr-big mt-2 uppercase" style={{ "--d": "700ms", fontSize: "clamp(2.2rem, 6vw, 5rem)", lineHeight: 0.9, color: "var(--g-pop)" }}>
            Wrapped
          </div>
          {wrapped.championship?.position ? (
            <div className="st-in mt-4 text-[15px] font-extrabold" style={{ "--d": "850ms", fontFamily: "Montserrat, sans-serif" }}>
              <span className="wr-mark">P{wrapped.championship.position}</span> in the championship, {wrapped.championship.points} points.
            </div>
          ) : null}
        </div>
        <div className="st-in flex flex-col items-start gap-4 lg:items-end" style={{ "--d": "950ms" }}>
          {team && (
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center justify-center rounded-xl p-2" style={{ background: "#f6f5f1" }}>
                <TeamLogo id={team.id} name={team.name} color={team.color} logoUrl={team.logoUrl} size={36} />
              </span>
              <span className="text-[14px] font-bold" style={{ fontFamily: "Inter, sans-serif", opacity: 0.85 }}>
                Your year at {team.name}, in a few slides.
              </span>
            </div>
          )}
          <Link
            to={wrappedPath(wrapped)}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              const colour = getComputedStyle(cardRef.current).backgroundColor;
              growInto(cardRef.current, colour, () => {
                onClose();
                navigate(wrappedPath(wrapped));
              });
            }}
            className="wt-go inline-flex h-14 items-center gap-2.5 whitespace-nowrap rounded-full px-6 text-[15px] font-extrabold uppercase tracking-wide sm:px-7 sm:text-[16px]"
            style={{ background: "var(--g-fg)", color: "var(--g-bg)", fontFamily: "Montserrat, sans-serif" }}
          >
            <Play size={18} strokeWidth={2.5} fill="currentColor" />
            Watch your Wrapped
          </Link>
        </div>
      </div>
    </div>
  );
}

// The smaller button that stays on the champion card once the takeover is
// closed.
export function WrappedButton({ wrapped }) {
  const colour = teamColourOf(wrapped);
  const navigate = useNavigate();
  return (
    <Link
      to={wrappedPath(wrapped)}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        growInto(e.currentTarget, colour, () => navigate(wrappedPath(wrapped)));
      }}
      className="inline-flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-bold uppercase tracking-wide shadow-lg transition hover:brightness-105"
      style={{ background: colour, color: readableInkOn(colour) }}
    >
      <Play size={15} strokeWidth={2.5} fill="currentColor" />
      Your Wrapped
    </Link>
  );
}
