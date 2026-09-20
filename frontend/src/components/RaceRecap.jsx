// ---------------------------------------------------------------------------
// The race recap: the round told from your seat, a few pages long, shown once
// the first time you open the site after the league office saved a result.
//
// Three parts. RaceRecapHost sits at the root of the app and asks the server
// once per page load whether a recap is waiting; when one is, it opens the
// dialog after the page has settled. RaceRecapDialog is the pages themselves,
// built only from what the server sent (backend lib/raceRecap.js). Anyone
// else can open the same dialog through openRaceRecap: the admin preview does,
// and so does the Recap button on a race page.
//
// Closing it tells the server it has been seen, so it is not offered again;
// a preview never does.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api/client.js";
import { useAuth } from "../hooks/useAuth.js";
import { Modal } from "./overlay.jsx";
import { CountUp, DriverAvatar, MEDAL, MEDAL_TEXT } from "./ui.jsx";
import Flag from "./Flag.jsx";
import TeamLogo from "./TeamLogo.jsx";
import TokenIcon from "./TokenIcon.jsx";
import { buildRaceFacts, FactRow } from "./RaceFacts.jsx";
import { countryFor } from "../data/driverCountries.js";
import { flagFor } from "../data/circuits.js";
import { fmtLap, fmtLapDelta, fmtRaceDateFull, NO_VALUE } from "../utils/format.js";
import { fmtGap } from "../utils/raceDuration.js";

export const RACE_RECAP_OPEN_EVENT = "nabs-race-recap-open";
const STATE_EVENT = "nabs-race-recap-state";

export function openRaceRecap(recap, { preview = false } = {}) {
  window.dispatchEvent(new CustomEvent(RACE_RECAP_OPEN_EVENT, { detail: { recap, preview } }));
}

// Whether the feature is on for this member, as the host's one request found
// out. Shared so the Recap button on a race page does not have to ask again.
let enabledState = null; // null = not asked yet
function setEnabled(v) {
  enabledState = v;
  window.dispatchEvent(new Event(STATE_EVENT));
}
export function useRaceRecapEnabled() {
  const [on, setOn] = useState(enabledState === true);
  useEffect(() => {
    const sync = () => setOn(enabledState === true);
    window.addEventListener(STATE_EVENT, sync);
    return () => window.removeEventListener(STATE_EVENT, sync);
  }, []);
  return on;
}

// --- the host ---------------------------------------------------------------

let asked = false; // once per page load, whichever page it was

export default function RaceRecapHost() {
  const { isLoggedIn } = useAuth();
  const location = useLocation();
  const [state, setState] = useState(null); // { recap, preview } while open

  useEffect(() => {
    const onOpen = (e) => setState(e.detail);
    window.addEventListener(RACE_RECAP_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(RACE_RECAP_OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!isLoggedIn) {
      asked = false; // the next login on this tab asks afresh
      return;
    }
    if (asked) return;
    // Not on race night: the live page is left up for hours, and a recap of
    // last week's round landing on top of this week's timing would be noise.
    // Nor over the admin, where the office is busy saving the very result.
    const p = location.pathname;
    if (p.startsWith("/admin") || p.startsWith("/auth") || /\/live(\/|$)/.test(p)) return;
    let gone = false;
    // A beat after the page, so the recap arrives over a settled page rather
    // than fighting the page's own entrance.
    const t = setTimeout(() => {
      asked = true;
      api
        .myRaceRecap()
        .then((r) => {
          setEnabled(!!r?.enabled);
          if (!gone && r?.recap) setState({ recap: r.recap, preview: false });
        })
        .catch(() => {});
    }, 900);
    return () => {
      gone = true;
      clearTimeout(t);
    };
  }, [isLoggedIn, location.pathname]);

  const close = useCallback(() => {
    setState((s) => {
      if (s && !s.preview) api.markRaceRecapSeen(s.recap.race.id).catch(() => {});
      return null;
    });
  }, []);

  if (!state) return null;
  return <RaceRecapDialog recap={state.recap} preview={state.preview} onClose={close} />;
}

// The Recap button on a race page: reads the same recap again. Only for a
// member with a seat, only when the feature is on for them, only once the
// round has a result.
export function RaceRecapButton({ raceId, ready }) {
  const { user } = useAuth();
  const enabled = useRaceRecapEnabled();
  const [busy, setBusy] = useState(false);
  if (!enabled || !user?.driverId || !ready || !raceId) return null;
  const open = async () => {
    setBusy(true);
    try {
      const r = await api.myRaceRecapFor(raceId);
      if (r?.recap) openRaceRecap(r.recap, { preview: true });
    } catch {
      /* not this member's season, or the round has no result: no recap */
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      title="Your recap of this round"
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-wider text-medium transition hover:border-brand/60 hover:text-dark disabled:opacity-60"
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 15l3-4 3 3 4-6" />
      </svg>
      {busy ? "Opening…" : "Recap"}
    </button>
  );
}

// --- the dialog -------------------------------------------------------------

function pagesFor(recap) {
  const pages = [{ key: "cover" }];
  if (recap.you) pages.push({ key: "you" });
  if (recap.standings) pages.push({ key: "standings" });
  if (recap.rating?.after) pages.push({ key: "rating" });
  if (recap.points && (recap.points.entries.length || recap.points.pending)) pages.push({ key: "points" });
  pages.push({ key: "facts" });
  return pages;
}

const PAGE_TITLE = {
  cover: "Race recap",
  you: "Your race",
  standings: "Championship",
  rating: "Live rating",
  points: "NABS Points",
  facts: "Race facts",
};

export function RaceRecapDialog({ recap, preview = false, onClose }) {
  const pages = useMemo(() => pagesFor(recap), [recap]);
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1); // which way the next page slides in
  const page = pages[Math.min(i, pages.length - 1)];
  const last = i >= pages.length - 1;

  const go = useCallback(
    (to) => {
      const n = Math.max(0, Math.min(pages.length - 1, to));
      setDir(n >= i ? 1 : -1);
      setI(n);
    },
    [i, pages.length]
  );

  // Arrow keys page through; Escape is the modal's own.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowRight") go(i + 1);
      else if (e.key === "ArrowLeft") go(i - 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [go, i]);

  // A sideways swipe on a phone turns the page too.
  const touch = useRef(null);
  const onTouchStart = (e) => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e) => {
    const t = touch.current;
    touch.current = null;
    if (!t) return;
    const dx = e.changedTouches[0].clientX - t.x;
    const dy = e.changedTouches[0].clientY - t.y;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? i + 1 : i - 1);
  };

  const race = recap.race;
  const link = `${race.seriesSlug ? `/s/${race.seriesSlug}` : ""}/races?race=${race.id}`;

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      closeLabel="Close the race recap"
      panelClassName="overflow-hidden"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => go(i - 1)}
            disabled={i === 0}
            className="text-sm font-semibold text-light transition hover:text-dark disabled:invisible"
          >
            Back
          </button>
          <div className="flex items-center gap-2">
            {last && (
              <Link to={link} onClick={onClose} className="btn-secondary py-1.5 text-sm">
                Full results
              </Link>
            )}
            <button type="button" onClick={() => (last ? onClose() : go(i + 1))} className="btn-primary py-1.5 text-sm">
              {last ? "Done" : "Next"}
            </button>
          </div>
        </div>
      }
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-eyebrow">{PAGE_TITLE[page.key]}</span>
            {preview && (
              <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-light">
                preview
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the race recap"
          className="-mr-1.5 shrink-0 rounded-lg p-1.5 text-light transition hover:bg-surface2 hover:text-dark focus:outline-none focus:ring-2 focus:ring-accent/50"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {/* The page marks: one segment per page, filled up to where you are. */}
      <div className="mt-3 flex gap-1" role="tablist" aria-label="Recap pages">
        {pages.map((p, n) => (
          <button
            key={p.key}
            type="button"
            role="tab"
            aria-selected={n === i}
            aria-label={PAGE_TITLE[p.key]}
            onClick={() => go(n)}
            className="group h-3 flex-1 py-1"
          >
            <span className={`block h-1 w-full rounded-full transition ${n <= i ? "bg-brand" : "bg-border group-hover:bg-light/50"}`} />
          </button>
        ))}
      </div>

      {/* The pages share one height so the dialog does not jump between them,
          and scroll inside it on a short screen rather than off the bottom. */}
      <div
        className="scrollbar-slim -mx-1 min-h-[min(24rem,calc(100dvh-13rem))] max-h-[calc(100dvh-13rem)] overflow-y-auto px-1 pt-4 sm:min-h-[min(26rem,calc(100dvh-13rem))]"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div key={page.key} className="recap-page" style={{ "--recap-dx": `${dir * 18}px` }}>
          {page.key === "cover" && <CoverPage recap={recap} />}
          {page.key === "you" && <YourRacePage recap={recap} />}
          {page.key === "standings" && <StandingsPage recap={recap} />}
          {page.key === "rating" && <RatingPage recap={recap} />}
          {page.key === "points" && <PointsPage recap={recap} />}
          {page.key === "facts" && <FactsPage recap={recap} onClose={onClose} />}
        </div>
      </div>
    </Modal>
  );
}

// --- the pages --------------------------------------------------------------

const teamOf = (row) => row?.effectiveTeam || row?.team || null;

function Eyebrow({ children }) {
  return <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-light">{children}</div>;
}

// A quiet rule-lined list: label left, value right, exactly the shape of the
// track-record list on the race page.
function Rows({ rows }) {
  const shown = rows.filter((r) => r && r.value != null && r.value !== "");
  if (!shown.length) return null;
  return (
    <div className="divide-y divide-border border-t border-border">
      {shown.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between gap-4 py-2.5">
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">{r.label}</span>
          <span className={`text-right font-mono text-sm font-bold tabular-nums ${r.tone || "text-dark"}`}>
            {r.value}
            {r.note && <span className="ml-1.5 text-[11px] font-semibold text-light">{r.note}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

// "+2" in green, "−1" in red, "±0" quiet. `unit` for "places" and the like.
function Delta({ value, decimals = 0, suffix = "" }) {
  if (value == null || !Number.isFinite(value)) return null;
  const zero = Math.abs(value) < (decimals ? 0.05 : 0.5);
  const up = value > 0;
  const text = zero ? `±0${suffix}` : `${up ? "+" : "−"}${Math.abs(value).toFixed(decimals)}${suffix}`;
  return (
    <span className={`font-mono text-xs font-bold tabular-nums ${zero ? "text-light" : up ? "text-ok" : "text-bad"}`}>{text}</span>
  );
}

function BigNumber({ children, className = "" }) {
  return <div className={`recap-pop font-display text-6xl font-black leading-none tabular-nums text-dark ${className}`}>{children}</div>;
}

function CoverPage({ recap }) {
  const { race, results, you } = recap;
  const finished = results.filter((r) => r.status === "FINISHED" && r.position != null).sort((a, b) => a.position - b.position);
  const podium = finished.slice(0, 3);
  const adj = (r) => (r.totalTimeMs > 0 ? r.totalTimeMs + (r.penaltySeconds || 0) * 1000 : null);
  const winnerMs = podium[0] ? adj(podium[0]) : null;
  const gapOf = (r, idx) => {
    if (idx === 0) return "Winner";
    const t = adj(r);
    if (!t || !winnerMs) return null;
    if (podium[0].laps != null && r.laps != null && r.laps < podium[0].laps) {
      const down = podium[0].laps - r.laps;
      return `+${down} lap${down > 1 ? "s" : ""}`;
    }
    return fmtGap(t - winnerMs) || null;
  };
  return (
    <div>
      <Eyebrow>
        {[race.seriesName, race.seasonNumber != null ? `Season ${race.seasonNumber}` : null, race.number != null ? `Round ${race.number}` : null]
          .filter(Boolean)
          .join(" · ")}
      </Eyebrow>
      <div className="mt-1.5 flex items-center gap-2.5">
        <h2 className="recap-pop font-display text-3xl font-black uppercase leading-none tracking-tight text-dark sm:text-4xl">{race.track}</h2>
        <Flag code={flagFor(race.track, race.country)?.country} w={26} h={19} />
      </div>
      <div className="mt-2 text-sm text-medium">
        {[race.date ? fmtRaceDateFull(race.date) : null, `${race.finishers} of ${race.fieldSize} classified`].filter(Boolean).join(" · ")}
      </div>

      {podium.length > 0 && (
        <div className="mt-6 divide-y divide-border border-t border-border">
          {podium.map((r, idx) => {
            const team = teamOf(r);
            return (
              <div key={r.driverId} className="recap-row flex items-center gap-3 py-3" style={{ "--i": idx }}>
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-sm font-black text-ink shadow-sm"
                  style={{ backgroundColor: MEDAL[idx] }}
                >
                  {idx + 1}
                </span>
                <DriverAvatar name={r.name} photoUrl={r.photoUrl} color={team?.color || "#232833"} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-display text-base font-extrabold uppercase tracking-tight text-dark">{r.name}</span>
                    <Flag code={countryFor(r.driverId, r.country)} w={16} h={12} />
                  </div>
                  {team && (
                    <TeamLogo id={team.id} name={team.name} color={team.color} logoUrl={team.logoUrl} size={14} showName nameClassName="truncate text-xs text-light" />
                  )}
                </div>
                <span className="shrink-0 font-mono text-xs font-bold tabular-nums" style={{ color: MEDAL_TEXT[idx] }}>
                  {gapOf(r, idx) || NO_VALUE}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {you && (
        <p className="mt-5 text-sm text-medium">
          {you.finished
            ? `You finished P${you.position}. Next page: your race in numbers.`
            : you.raced
              ? `Not the night you wanted: ${you.status}. Next page: what the round did to your season.`
              : "You sat this one out. Next page: what the round did to your season."}
        </p>
      )}
    </div>
  );
}

function YourRacePage({ recap }) {
  const y = recap.you;
  if (!y) return null;
  const { race } = recap;
  const movedFrom =
    y.finished && y.grid != null
      ? y.gained > 0
        ? `Up ${y.gained} place${y.gained > 1 ? "s" : ""} from P${y.grid} on the grid`
        : y.gained < 0
          ? `Down ${-y.gained} place${y.gained < -1 ? "s" : ""} from P${y.grid} on the grid`
          : `Held P${y.grid} from lights to flag`
      : y.finished
        ? null
        : y.raced
          ? y.grid != null
            ? `Started P${y.grid}`
            : null
          : "Did not start";
  const fastest = y.finished && y.bestLapMs != null && y.lapGapMs === 0;
  const pts = y.points || 0;
  const rows = [
    {
      label: "Points",
      value: pts > 0 ? `+${pts}` : "0",
      tone: pts > 0 ? "text-dark" : "text-light",
      note:
        [y.fastestLapBonus > 0 ? `incl. +${y.fastestLapBonus} fastest lap` : null, recap.standings?.roundDropped ? "dropped round" : null]
          .filter(Boolean)
          .join(" · ") || null,
    },
    y.sprint
      ? {
          label: "Sprint",
          value: y.sprint.position != null ? `P${y.sprint.position}` : y.sprint.status || NO_VALUE,
          note: y.sprint.points > 0 ? `+${y.sprint.points} pts` : null,
        }
      : null,
    y.bestLapMs != null && fmtLap(y.bestLapMs)
      ? {
          label: "Best lap",
          value: fmtLap(y.bestLapMs),
          tone: fastest ? "text-fl" : "text-dark",
          note: fastest ? "fastest of the race" : y.lapGapMs != null ? `${fmtLapDelta(y.lapGapMs)} to the fastest` : null,
        }
      : null,
    y.laps != null ? { label: "Laps", value: String(y.laps) } : null,
    y.overtakes != null ? { label: "Overtakes", value: String(y.overtakes), note: "estimated" } : null,
    y.lapsLed > 0 ? { label: "Laps led", value: String(y.lapsLed) } : null,
    y.contacts != null ? { label: "Car contacts", value: String(y.contacts), tone: y.contacts === 0 ? "text-ok" : "text-dark" } : null,
    y.consistencyPct != null && y.consistencyPct > 0 ? { label: "Consistency", value: `${y.consistencyPct.toFixed(2)}%` } : null,
    y.raced
      ? y.penaltySeconds > 0
        ? { label: "Penalties", value: `+${y.penaltySeconds}s`, tone: "text-bad", note: "stewards" }
        : y.cleanRace
          ? { label: "Penalties", value: "None", tone: "text-ok", note: "clean race" }
          : y.gamePenalties > 0
            ? { label: "Penalties", value: `${y.gamePenalties} in-game`, tone: "text-warn" }
            : null
      : null,
  ];
  return (
    <div>
      <Eyebrow>{race.track}</Eyebrow>
      <div className="mt-2 flex items-end gap-3">
        <BigNumber>{y.finished ? `P${y.position}` : y.raced ? y.status : "DNS"}</BigNumber>
        {y.finished && y.rawPosition != null && y.rawPosition !== y.position && (
          <span className="mb-1 font-mono text-xs font-bold text-light">crossed the line P{y.rawPosition}</span>
        )}
      </div>
      {movedFrom && <div className="mt-2 text-sm text-medium">{movedFrom}</div>}
      {y.finished && y.position <= 3 && (
        <div className="mt-1 font-mono text-[11px] font-bold uppercase tracking-wider" style={{ color: MEDAL_TEXT[y.position - 1] }}>
          {y.position === 1 ? "Race winner" : "On the podium"}
        </div>
      )}
      <div className="mt-5">
        <Rows rows={rows} />
      </div>
    </div>
  );
}

function StandingsPage({ recap }) {
  const s = recap.standings;
  const { you, team } = recap;
  if (!s?.after) return null;
  const moved = s.before ? s.before.position - s.after.position : null;
  const rows = [
    s.isLeader
      ? { label: "Lead", value: s.behind ? `${s.behind.gap} pts` : NO_VALUE, note: s.behind ? `over ${s.behind.name}` : null }
      : s.leader
        ? { label: "To the leader", value: `−${s.leader.total - s.after.total} pts`, note: s.leader.name }
        : null,
    !s.isLeader && s.ahead ? { label: "To the car ahead", value: `−${s.ahead.gap} pts`, note: s.ahead.name } : null,
    !s.isLeader && s.behind ? { label: "Over the car behind", value: `+${s.behind.gap} pts`, note: s.behind.name } : null,
  ];
  return (
    <div>
      <Eyebrow>
        {s.before ? "Championship, after this round" : "Championship, after the season opener"} · {s.fieldSize} drivers
      </Eyebrow>
      <div className="mt-2 flex items-end gap-4">
        {s.before && s.before.position !== s.after.position && (
          <span className="mb-1 font-display text-3xl font-black leading-none tabular-nums text-light line-through decoration-2">P{s.before.position}</span>
        )}
        <BigNumber>P{s.after.position}</BigNumber>
        {moved != null && (
          <span className="mb-1">
            <Delta value={moved} suffix={` place${Math.abs(moved) === 1 ? "" : "s"}`} />
          </span>
        )}
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="font-display text-2xl font-black tabular-nums text-dark">
          <CountUp end={s.after.total} />
        </span>
        <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">points</span>
        {you && you.points > 0 && !s.roundDropped && <Delta value={you.points} />}
      </div>
      <div className="mt-4">
        <Rows rows={rows} />
      </div>
      {team?.after && (
        <div className="mt-5 flex items-center gap-3 rounded-xl border border-border bg-surface2/50 px-4 py-3">
          <TeamLogo id={team.id} name={team.name} color={team.color} logoUrl={team.logoUrl} size={28} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-sm font-extrabold uppercase tracking-tight text-dark">{team.name}</div>
            <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">
              Tier {team.tier} constructors · {team.after.total} pts
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-display text-xl font-black tabular-nums text-dark">P{team.after.position}</span>
            {team.before && <Delta value={team.before.position - team.after.position} />}
          </div>
        </div>
      )}
    </div>
  );
}

const RATING_PARTS = [
  { key: "exp", label: "EXP", name: "Experience" },
  { key: "pac", label: "PAC", name: "Pace" },
  { key: "rac", label: "RAC", name: "Racecraft" },
  { key: "aha", label: "AWA", name: "Awareness" },
];

function RatingPage({ recap }) {
  const r = recap.rating;
  if (!r?.after) return null;
  return (
    <div>
      <Eyebrow>Live rating · after this round</Eyebrow>
      <div className="mt-2 flex items-end gap-4">
        <BigNumber>{Math.round(r.after.overall)}</BigNumber>
        <span className="mb-1 flex flex-col">
          {r.delta && <Delta value={r.delta.overall} decimals={1} />}
          {r.rank != null && r.fieldSize != null && (
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">
              #{r.rank} of {r.fieldSize}
            </span>
          )}
        </span>
      </div>
      <div className="mt-5 space-y-3">
        {RATING_PARTS.map((p, idx) => {
          const v = r.after[p.key];
          const d = r.delta ? r.delta[p.key] : null;
          if (v == null) return null;
          return (
            <div key={p.key} className="recap-row" style={{ "--i": idx }}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-light" title={p.name}>
                  {p.label}
                </span>
                <span className="flex items-baseline gap-2">
                  <span className="font-mono text-sm font-bold tabular-nums text-dark">{Math.round(v)}</span>
                  {d != null && <Delta value={d} decimals={1} />}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface2">
                <div className="bar-fill h-full rounded-full bg-brand" style={{ "--w": `${Math.max(2, Math.min(100, v))}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-5 text-xs leading-relaxed text-light">
        {r.provisional ? "Still provisional: a few more starts and it settles. " : ""}
        Your card keeps its numbers for the whole season; this is the live form behind it, the one your My Rating tab shows.
      </p>
    </div>
  );
}

function PointsPage({ recap }) {
  const p = recap.points;
  if (!p) return null;
  const rows = [
    ...p.entries.map((e) => ({ label: e.title, value: `+${e.delta}` })),
    p.pending ? { label: p.pending.title, value: `+${p.pending.delta}`, tone: "text-light", note: "once the stewards are done" } : null,
  ];
  return (
    <div>
      <Eyebrow>NABS Points · this round</Eyebrow>
      <div className="mt-2 flex items-center gap-3">
        <TokenIcon className="h-10 w-10" />
        <BigNumber>
          <CountUp end={p.earned} prefix="+" />
        </BigNumber>
      </div>
      {p.rate > 1 && (
        <div className="mt-2 text-sm text-medium">
          Paid at ×{p.rate.toFixed(2)}: your Discord activity that week counted.
        </div>
      )}
      <div className="mt-5">
        <Rows rows={rows} />
      </div>
      {p.balance != null && (
        <div className="mt-5 flex items-baseline justify-between">
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">Balance now</span>
          <span className="flex items-center gap-1.5 font-display text-xl font-black tabular-nums text-dark">
            <TokenIcon className="h-4 w-4" />
            <CountUp end={p.balance} />
          </span>
        </div>
      )}
    </div>
  );
}

function FactsPage({ recap, onClose }) {
  const { race, results, quali } = recap;
  const { facts, dotd, dotdRow, hasDotd } = buildRaceFacts(race, results, quali);
  // A fact names its driver as a link to their profile. Following it should
  // not leave the recap standing over the profile page.
  const onClickCapture = (e) => {
    if (e.target.closest("a")) onClose();
  };
  return (
    <div onClickCapture={onClickCapture}>
      {hasDotd && (
        <div className="mb-4 border-b border-border pb-4">
          <Eyebrow>{dotd.pickedBy ? `${dotd.pickedBy}’s Driver of the Day` : "Driver of the Day"}</Eyebrow>
          <div className="mt-1 flex items-center gap-2">
            <span className="recap-pop font-display text-2xl font-black uppercase tracking-tight text-dark">{dotd.name || dotdRow?.name || NO_VALUE}</span>
            {dotdRow && <Flag code={countryFor(dotdRow.driverId, dotdRow.country)} w={18} h={13} />}
          </div>
        </div>
      )}
      {facts.length ? (
        <div className="divide-y divide-border">
          {facts.map((f, idx) => (
            <div key={f.key} className="recap-row" style={{ "--i": idx }}>
              <FactRow fact={f} />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-light">Not much on record for this round beyond the classification.</p>
      )}
    </div>
  );
}
