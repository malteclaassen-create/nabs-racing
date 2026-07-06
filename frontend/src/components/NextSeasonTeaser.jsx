import { useCallback } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { useSocial } from "./SocialLinks.jsx";
import { fmtRaceTime } from "../utils/raceTime.js";

// Announcement strip for the NEXT season. Appears automatically as soon as a
// season with a higher number than the one being viewed exists in the DB
// (i.e. during the transition weeks while the new season is being set up),
// and disappears by itself once that season is activated. If the new season
// already has a dated first round, it counts down to it.
export default function NextSeasonTeaser() {
  const { seasons, current } = useSeason();
  const social = useSocial();

  const next = (seasons || [])
    .filter((s) => current && !s.isActive && s.number > current.number)
    .sort((a, b) => a.number - b.number)[0];

  const races = useApi(
    useCallback(() => (next ? api.racesFor(next.number) : Promise.resolve([])), [next?.number])
  );

  if (!next) return null;

  const firstRace = (races.data || [])
    .filter((r) => !r.isSpecialEvent && r.number != null && !r.isCompleted && r.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date))[0];

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
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
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
        <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
          {firstRace && (
            <span className="rounded-lg border border-border bg-surface2 px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-medium dark:border-white/15 dark:bg-white/10 dark:text-white/85">
              Round 1 ·{" "}
              {new Date(firstRace.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}{" "}
              · {fmtRaceTime(firstRace.date)}
            </span>
          )}
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
