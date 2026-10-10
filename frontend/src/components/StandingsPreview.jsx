import { Link } from "react-router-dom";
import { ArrowRight, Repeat } from "lucide-react";
import { DriverAvatar, MEDAL, MEDAL_TEXT, Skeleton } from "./ui.jsx";
import TeamLogo from "./TeamLogo.jsx";
import { standingCaption } from "./DriverStandingsRow.jsx";
import { seasonLabelOf } from "../utils/pageTitle.js";
import { kindLabel } from "../utils/transferRows.js";

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

function LoadingRows() {
  return (
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
}

function SmallLogo({ team }) {
  if (!team) return <span className="h-5 w-5 shrink-0 rounded bg-border" aria-hidden="true" />;
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center" title={team.name}>
      <TeamLogo id={team.id} name={team.name} color={team.color} logoUrl={team.logoUrl} size={18} />
    </span>
  );
}

// Transfers: the latest moves, newest first, as the page lists them.
function TransfersBody({ page }) {
  const { data, loading, error } = page;
  if (loading) return <LoadingRows />;
  if (error) return <Note>The moves didn&apos;t load just now. The page on the left still has them.</Note>;
  if (!data.total) return <Note>Nobody has changed team this season yet.</Note>;
  return (
    <div key="transfers" className="content-in">
      <div className="mt-2 space-y-1">
        {data.latest.map((r) => (
          <Link
            key={r.key}
            to={`/drivers/${r.driverId}`}
            className="-mx-1.5 flex items-center gap-2.5 rounded-lg px-1.5 py-1 transition hover:bg-card"
          >
            <DriverAvatar name={r.driver?.name} photoUrl={r.driver?.photoUrl} color={r.to?.color} size={24} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-bold text-dark">{r.driver?.name || r.driverId}</span>
              <span className={`block truncate text-[11px] ${r.pending ? "text-brand" : "text-light"}`}>
                {kindLabel(r)} · R{r.round}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1 text-light">
              <SmallLogo team={r.from} />
              {r.kind === "sub" ? <Repeat className="h-3 w-3" aria-hidden="true" /> : <ArrowRight className="h-3 w-3" aria-hidden="true" />}
              <SmallLogo team={r.to} />
            </span>
          </Link>
        ))}
      </div>
      {data.total > data.latest.length && (
        <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-light">
          {data.total} moves this season
        </p>
      )}
    </div>
  );
}

// Hall of Fame: the reigning champion, then the all-time wins.
function RecordsBody({ page }) {
  const { data, loading, error } = page;
  if (loading) return <LoadingRows />;
  if (error) return <Note>The records didn&apos;t load just now. The page on the left still has them.</Note>;
  const champ = data.champion;
  if (!champ && !data.wins.length) return <Note>No season has been decided yet. The first champion goes up here.</Note>;
  return (
    <div key="records" className="content-in">
      {champ && (
        <Link
          to={`/drivers/${champ.driver.driverId}?season=${champ.seasonNumber}`}
          className="mt-2 flex items-center gap-2.5 rounded-xl bg-card p-2.5 shadow-card transition hover:shadow-lift"
        >
          <DriverAvatar
            name={champ.driver.name}
            photoUrl={champ.driver.photoUrl}
            color={champ.driver.team?.color || MEDAL[0]}
            size={34}
            className="ring-2 ring-[color:var(--medal-1)]"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-mono text-[10px] font-bold uppercase tracking-wider" style={{ color: MEDAL_TEXT[0] }}>
              Champion · {champ.seasonName || `Season ${champ.seasonNumber}`}
            </span>
            <span className="block truncate text-[13px] font-bold text-dark">{champ.driver.name}</span>
          </span>
          <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-dark">{champ.points} pts</span>
        </Link>
      )}
      {data.wins.length > 0 && (
        <>
          <div className="mt-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-light">Most wins, all time</div>
          <div className="mt-1.5 space-y-1">
            {data.wins.map((w, i) => (
              <Link
                key={w.driverId}
                to={`/drivers/${w.driverId}${w.seasonNumber != null ? `?season=${w.seasonNumber}` : ""}`}
                className="-mx-1.5 flex items-center gap-2.5 rounded-lg px-1.5 py-1 transition hover:bg-card"
              >
                <MiniRank position={i + 1} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-dark">{w.name}</span>
                <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-dark">{w.value}</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Desktop: the panel beside the menu rows. `view` follows the row under the
// pointer or the keyboard focus: "drivers" and "constructors" show the table
// (`preview`), "transfers" and "records" their own page (`page`).
export function StandingsPreviewPanel({ preview, view, page }) {
  const { data, loading, error, decided } = preview;
  const teamsView = view === "constructors";
  const ownPage = view === "transfers" || view === "records";
  const heading =
    view === "transfers" ? "Latest moves" : view === "records" ? "Hall of Fame" : teamsView ? (data?.multiTier ? "Tier 1 constructors" : "Constructors") : "Drivers";

  let body;
  if (view === "transfers") {
    body = <TransfersBody page={page} />;
  } else if (view === "records") {
    body = <RecordsBody page={page} />;
  } else if (loading) {
    body = <LoadingRows />;
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
      <div className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-light">
        {view === "records" ? (page?.data?.seasons ? `${page.data.seasons} seasons` : "All time") : ownPage ? seasonLabelOf(preview.season) || "This season" : caption(preview)}
      </div>
      <div className="mt-1 font-display text-sm font-extrabold uppercase tracking-tight text-dark">{heading}</div>
      {body}
    </div>
  );
}
