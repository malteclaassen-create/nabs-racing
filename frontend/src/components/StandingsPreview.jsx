import { Link } from "react-router-dom";
import { DriverAvatar, MEDAL, Skeleton } from "./ui.jsx";
import TeamLogo from "./TeamLogo.jsx";
import { standingCaption } from "./DriverStandingsRow.jsx";
import { seasonLabelOf } from "../utils/pageTitle.js";

// The right-hand half of the Standings menu, and the strip at the top of the
// phone menu: the top of the table as it stands, with the gaps, so you can see
// who is how far ahead before you have even opened the page. The numbers come
// from hooks/useStandingsPreview.js, which explains where they come from and
// why the order is the page's own.

// A small medal square, the size the menu rows have room for. The table's Rank
// is twice this and fixes its own size, so it cannot simply be shrunk.
function MiniRank({ position }) {
  const medal = position >= 1 && position <= 3 ? MEDAL[position - 1] : null;
  return (
    <span
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded font-display text-[10px] font-black tabular-nums ${
        medal ? "text-ink" : "text-medium"
      }`}
      style={medal ? { backgroundColor: medal } : undefined}
    >
      {position}
    </span>
  );
}

// "Season 7 · after R10", or "· final" once the title is settled.
function caption(preview) {
  const label = seasonLabelOf(preview.season) || "This season";
  if (preview.decided) return `${label} · final`;
  const last = preview.data?.lastRound;
  return last != null ? `${label} · after R${last}` : label;
}

function Points({ total, gapText }) {
  return (
    <span className="shrink-0 text-right">
      <span className="block font-mono text-xs font-bold tabular-nums text-dark">{total}</span>
      <span className="block font-mono text-[10px] tabular-nums text-light">{gapText}</span>
    </span>
  );
}

function DriverLine({ d, leaderTotal, decided }) {
  return (
    <Link
      to={`/drivers/${d.driverId}`}
      className="-mx-1.5 flex items-center gap-2.5 rounded-lg px-1.5 py-1 transition hover:bg-card"
    >
      <MiniRank position={d.position} />
      <DriverAvatar name={d.name} photoUrl={d.photoUrl} fallbacks={d.photoFallbacks} color={d.team?.color} size={24} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-bold text-dark">{d.name}</span>
        <span className="block truncate text-[11px] text-light">{d.team?.name}</span>
      </span>
      <Points total={d.total} gapText={standingCaption(d.position, leaderTotal - d.total, { decided, unit: " pts" })} />
    </Link>
  );
}

function TeamLine({ t, leaderTotal, decided }) {
  return (
    <Link
      to={`/teams/${t.teamId}`}
      className="-mx-1.5 flex items-center gap-2.5 rounded-lg px-1.5 py-1 transition hover:bg-card"
    >
      <MiniRank position={t.position} />
      <span className="flex h-6 w-6 shrink-0 items-center justify-center">
        <TeamLogo id={t.teamId} name={t.name} color={t.color} logoUrl={t.logoUrl} size={22} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-dark">{t.name}</span>
      <Points total={t.total} gapText={standingCaption(t.position, leaderTotal - t.total, { decided, unit: " pts" })} />
    </Link>
  );
}

// The card under the rows: one team and what it leads.
function TeamCard({ t, label }) {
  return (
    <Link
      to={`/teams/${t.teamId}`}
      className="mt-3 flex items-center gap-2.5 rounded-xl bg-card p-2.5 shadow-card transition hover:shadow-lift"
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: `color-mix(in srgb, ${t.color || "#888"} 12%, transparent)` }}
      >
        <TeamLogo id={t.teamId} name={t.name} color={t.color} logoUrl={t.logoUrl} size={24} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-bold text-dark">{t.name}</span>
        <span className="block truncate font-mono text-[10px] text-light">
          {label} · {t.total} pts
        </span>
      </span>
    </Link>
  );
}

function Note({ children }) {
  return <p className="mt-3 text-[13px] leading-snug text-light">{children}</p>;
}

// Desktop: the panel beside the menu rows. `view` is "drivers" or
// "constructors", following the row under the pointer or the keyboard focus.
export function StandingsPreviewPanel({ preview, view }) {
  const { data, loading, error, decided } = preview;
  const teamsView = view === "constructors";
  const heading = teamsView ? (data?.multiTier ? "Tier 1 constructors" : "Constructors") : "Drivers";

  let body;
  if (loading) {
    body = (
      <div className="mt-3 space-y-3" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-2.5">
            <Skeleton className="h-5 w-5" />
            <Skeleton className="h-6 w-6 rounded-full" />
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-3 w-8" />
          </div>
        ))}
        <Skeleton className="h-14 w-full rounded-xl" />
      </div>
    );
  } else if (error) {
    body = <Note>The table didn&apos;t load just now. The pages on the left still have it.</Note>;
  } else if (data.empty) {
    body = <Note>No results yet this season. The table fills in after the first round.</Note>;
  } else if (teamsView) {
    const t1Leader = data.t1[0];
    body = (
      // Keyed on the view, so switching rows fades the new list in.
      <div key="constructors" className="content-in">
        <div className="mt-2 space-y-1">
          {data.t1.map((t) => (
            <TeamLine key={t.teamId} t={t} leaderTotal={t1Leader?.total ?? 0} decided={decided} />
          ))}
        </div>
        {data.multiTier && data.t2Leader && data.t2Leader.total > 0 && (
          <TeamCard t={data.t2Leader} label={decided ? "Tier 2 champions" : "Tier 2 leaders"} />
        )}
      </div>
    );
  } else {
    const team = data.t1[0];
    body = (
      <div key="drivers" className="content-in">
        <div className="mt-2 space-y-1">
          {data.drivers.map((d) => (
            <DriverLine key={d.driverId} d={d} leaderTotal={data.driverLeaderTotal} decided={decided} />
          ))}
        </div>
        {team && team.total > 0 && (
          <TeamCard
            t={team}
            label={data.multiTier ? (decided ? "Tier 1 champions" : "Tier 1 leaders") : decided ? "Champions" : "Leading team"}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col rounded-[18px] bg-surface2 p-4">
      <div className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-light">{caption(preview)}</div>
      <div className="mt-1 font-display text-sm font-extrabold uppercase tracking-tight text-dark">{heading}</div>
      {body}
    </div>
  );
}

// Phone: the top three side by side, at the head of the menu sheet. Says
// nothing at all when there is nothing to say (no results yet, or the read
// failed): the rows below are what the menu is for.
export function StandingsLeaderStrip({ preview, to }) {
  const { data, loading, decided } = preview;
  if (!loading && (!data || data.empty || data.drivers.length === 0)) return null;
  return (
    <Link to={to} className="block rounded-2xl bg-surface2 p-3">
      <span className="block px-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-light">{caption(preview)}</span>
      <span className="mt-2 flex gap-2">
        {loading
          ? [0, 1, 2].map((i) => (
              <span key={i} className="flex flex-1 flex-col items-center gap-1.5" aria-hidden="true">
                <Skeleton className="h-[30px] w-[30px] rounded-full" />
                <Skeleton className="h-2.5 w-14" />
                <Skeleton className="h-2 w-10" />
              </span>
            ))
          : data.drivers.map((d) => (
              <span key={d.driverId} className="flex min-w-0 flex-1 flex-col items-center text-center">
                <DriverAvatar name={d.name} photoUrl={d.photoUrl} fallbacks={d.photoFallbacks} color={d.team?.color} size={30} />
                <span className="mt-1 block w-full truncate text-[11px] font-bold uppercase text-dark">{d.name}</span>
                <span className="block font-mono text-[10px] tabular-nums text-light">
                  P{d.position} · {d.total}
                </span>
                <span className="block font-mono text-[10px] tabular-nums text-faint">
                  {standingCaption(d.position, data.driverLeaderTotal - d.total, { decided, unit: " pts" })}
                </span>
              </span>
            ))}
      </span>
    </Link>
  );
}
