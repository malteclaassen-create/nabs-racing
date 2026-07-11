import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useSocial } from "./SocialLinks.jsx";
import { carFor } from "../utils/heroImage.js";
import RaceCountdown from "./RaceCountdown.jsx";

// Announcement strip for the NEXT season, fed by /api/seasons/teaser: the
// admin flips "Announce on Home" (Seasons tab) and the strip appears on Home
// and the newcomer page — even while the season itself is still PRIVATE and
// unreachable through the season switcher. The endpoint hands out only the
// teaser facts (name, game, opener), so nothing else leaks early. The strip
// disappears by itself once the season is activated. If the season has a car
// showroom shot (public/cars/s<n>.jpg), it rides along on a dark panel.
export default function NextSeasonTeaser() {
  const social = useSocial();
  const teaser = useApi(useCallback(() => api.seasonTeaser(), []));
  // The car picture is optional per season: the panel stays hidden until the
  // image actually loads, so a season without a shot loses nothing. Besides
  // onLoad, an effect checks the element directly — a cached image can be
  // complete before React's load listener is even attached, and the event
  // would then never come.
  const [carOk, setCarOk] = useState(false);
  const carRef = useRef(null);
  const teasedNumber = teaser.data?.number;
  useEffect(() => {
    const el = carRef.current;
    if (el && el.complete && el.naturalWidth > 0) setCarOk(true);
  }, [teasedNumber]);

  const next = teaser.data;
  if (!next) return null;

  const firstRace = next.firstRace;
  const carSrc = carFor(next);

  // "Season 8" reads fine; a season that is literally named "8" gets a prefix.
  const title = /^\d+$/.test(String(next.name).trim()) ? `Season ${next.name}` : next.name;

  return (
    <section className="reveal relative overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-lg shadow-ink/5 dark:border-transparent dark:bg-ink dark:shadow-ink/20 sm:p-8">
      <div
        className="absolute inset-0 opacity-80 dark:opacity-70"
        style={{ background: "radial-gradient(130% 140% at 85% 0%, rgba(244,175,198,0.28), transparent 55%)" }}
      />
      <div className="speed-hatch absolute inset-y-0 right-0 w-[30%] opacity-[0.12] dark:opacity-25"
        style={{ WebkitMaskImage: "linear-gradient(to left,#000 30%,transparent)", maskImage: "linear-gradient(to left,#000 30%,transparent)" }} />
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-eyebrow">
            <span className="live-dot inline-block h-2 w-2 rounded-full bg-brand" />
            Coming up
          </div>
          <h2 className="mt-1.5 font-display text-2xl font-black uppercase tracking-tight text-dark dark:text-white sm:text-3xl">
            {title}
            {next.game && <span className="ml-3 align-middle font-mono text-xs font-bold uppercase tracking-wider text-light dark:text-white/50">{next.game}</span>}
          </h2>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-medium dark:text-white/70">
            {firstRace
              ? <>The new season kicks off at <span className="font-semibold text-dark dark:text-white">{firstRace.track}</span>. Grids are forming now, so jump into the Discord to claim a seat.</>
              : <>The next season is taking shape: teams, cars and calendar are being prepared. Jump into the Discord to be there from round one.</>}
          </p>
        </div>

        {/* the season's car — a showroom shot on black, so the dark panel plus
            blend-screen act as a free cutout (same trick as the hero's slot) */}
        <div
          className={`relative h-32 w-full shrink-0 overflow-hidden rounded-xl bg-[#05070c] ring-1 ring-black/20 dark:ring-white/10 sm:h-36 lg:h-28 lg:w-56 xl:h-32 xl:w-72 ${
            carOk ? "" : "hidden"
          }`}
        >
          <div className="speed-hatch absolute inset-0 opacity-20" />
          {/* NOT lazy on purpose: the panel is display:none until the image
              loads, and a lazy image inside a hidden box never loads — the
              two would deadlock and the car would never appear. */}
          {carSrc && (
            <img
              ref={carRef}
              src={carSrc}
              alt={`The ${title} car`}
              onLoad={() => setCarOk(true)}
              onError={(e) => { e.currentTarget.style.display = "none"; }}
              className="absolute inset-0 h-full w-full object-cover mix-blend-screen"
            />
          )}
        </div>

        <div className="flex shrink-0 flex-col items-start gap-3 lg:items-end">
          {/* live countdown to the opener — the same broadcast clock as the
              hero's next-race panel, instead of a static date pill */}
          {firstRace?.date && <RaceCountdown date={firstRace.date} className="w-full min-w-[15rem] max-w-[17rem]" />}
          <a
            href={social.data?.discord || undefined}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-2 rounded-xl bg-[#5865F2] px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white shadow-lg shadow-[#5865F2]/30 transition hover:brightness-110"
          >
            Join for {title} <span aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </section>
  );
}
