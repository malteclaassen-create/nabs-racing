import { useEffect, useMemo, useState } from "react";
import { RotateCcw, ChevronDown, ChevronUp, CheckSquare, ArrowRightLeft, UserX } from "lucide-react";
import { api } from "../api/client.js";
import { DriverAvatar, TeamDot, Spinner, Notice } from "./ui.jsx";

// ---------------------------------------------------------------------------
// "Who drives in the new season?" Step 2 of the season wizard.
//
// Last season's field per team. One question per person, asked twice:
//   * the tick: is this person in the new season at all? Unticked people are
//     simply not copied. Nothing is deleted, and they can be added later.
//   * "Drives for": where they go. Their old team by default, any other team
//     of the season (a transfer, a reserve getting a seat) or the Reserve pool.
//
// Ticked to start with: everybody who held a seat, and reserves who raced at
// least once. Reserves who never drove start unticked and folded away; the
// attendance sign-up puts them back into the Reserve pool the first time they
// answer. The teams themselves are always copied whole, empty or not.
// ---------------------------------------------------------------------------

const POOL = "reserve";
const OWN = "own";

function teamLabel(tier) {
  if (tier === 1) return "Tier 1";
  if (tier === 2) return "Tier 2";
  if (tier === 3) return "Division 2";
  return "Reserve pool";
}

function startsLabel(n) {
  if (!n) return "No starts";
  return n === 1 ? "1 start" : `${n} starts`;
}

// A reserve who never drove: folded away until asked for. Decided by the
// person alone, never by the tick, so a row never vanishes under the finger
// that just unticked it.
function isQuiet(p) {
  return !p.seat && !p.starts && !p.already;
}

function suggested(teams) {
  const out = {};
  for (const t of teams) for (const p of t.people) out[p.driverId] = { on: p.picked, place: OWN };
  return out;
}

// `run(fn, doneMessage)` is the wizard's runner (busy flag, errors, reload).
export default function AdminCarryOver({ target, source, run, busy, showTeamsOnly }) {
  const [teams, setTeams] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [picks, setPicks] = useState({});
  // Per team: also list the reserves who never drove (folded away by default,
  // the pool holds a long sign-up list and most of it is this).
  const [showAll, setShowAll] = useState({});

  useEffect(() => {
    let live = true;
    setTeams(null);
    setLoadError(null);
    api
      .carryOverPreview(target.id, source.id)
      .then((r) => {
        if (!live) return;
        setTeams(r.teams || []);
        setPicks(suggested(r.teams || []));
      })
      .catch((err) => live && setLoadError(err.message));
    return () => {
      live = false;
    };
  }, [target.id, source.id]);

  const people = useMemo(() => (teams || []).flatMap((t) => t.people), [teams]);
  // The teams a driver can be put into, in list order (the pool is its own option).
  const seats = useMemo(() => (teams || []).filter((t) => t.tier !== 0), [teams]);
  const chosen = people.filter((p) => !p.already && picks[p.driverId]?.on);
  const leftOut = people.filter((p) => !p.already && !picks[p.driverId]?.on).length;

  function set(id, patch) {
    setPicks((cur) => ({ ...cur, [id]: { ...(cur[id] || { on: false, place: OWN }), ...patch } }));
  }

  function setTeam(team, on) {
    setPicks((cur) => {
      const next = { ...cur };
      for (const p of team.people) if (!p.already) next[p.driverId] = { ...(cur[p.driverId] || { place: OWN }), on };
      return next;
    });
  }

  function bringBack() {
    const body = chosen.map((p) => {
      const place = picks[p.driverId]?.place || OWN;
      if (place === POOL) return { driverId: p.driverId, to: "reserve" };
      if (place === OWN) return { driverId: p.driverId, to: p.seat ? "team" : "reserve" };
      return { driverId: p.driverId, to: "team", teamId: place };
    });
    run(
      () => api.carryOver(target.id, source.id, body),
      (r) => {
        const skipped = r.skipped?.length ? ` Left alone: ${r.skipped.map((s) => s.name).join(", ")} (already in ${target.name}).` : "";
        return `${r.driversCreated} driver(s) and ${r.teamsCreated} team(s) copied to ${target.name}, each driver linked to their earlier seasons.${skipped}`;
      }
    );
  }

  if (loadError) return <Notice kind="error">{loadError}</Notice>;
  if (!teams) return <Spinner label={`Reading ${source.name}…`} />;
  if (!teams.length) return <p className="text-sm text-light">{source.name} has no teams to bring over.</p>;

  const fresh = suggested(teams);
  const changed = people.some(
    (p) => !p.already && (!!picks[p.driverId]?.on !== fresh[p.driverId].on || (picks[p.driverId]?.place || OWN) !== OWN)
  );

  return (
    <div className="space-y-3">
      <ul className="space-y-2 rounded-xl border border-border bg-surface/40 p-3 text-sm text-medium">
        <li className="flex items-start gap-2">
          <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-brand" strokeWidth={2} aria-hidden="true" />
          <span>
            <b className="text-dark">Ticked</b> means this person is in {target.name}. We ticked everybody with a seat
            and every reserve who raced in {source.name}.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <ArrowRightLeft className="mt-0.5 h-4 w-4 shrink-0 text-brand" strokeWidth={2} aria-hidden="true" />
          <span>
            <b className="text-dark">Drives for</b> says where they go: their old team, another team (a transfer, or a
            reserve getting a seat) or the Reserve pool.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <UserX className="mt-0.5 h-4 w-4 shrink-0 text-light" strokeWidth={2} aria-hidden="true" />
          <span>
            <b className="text-dark">Not ticked</b> means not copied. Nothing is deleted: you can add them later in the
            Drivers tab, and reserves come back on their own when they sign up for a race.
          </span>
        </li>
      </ul>

      <div className="space-y-3">
        {teams.map((t) => {
          const open = t.people.filter((p) => !p.already);
          const on = open.filter((p) => picks[p.driverId]?.on).length;
          const quiet = t.people.filter((p) => isQuiet(p));
          const quietOn = quiet.filter((p) => picks[p.driverId]?.on).length;
          const isPool = t.tier === 0;
          return (
            <section key={t.id} className="rounded-xl border border-border bg-surface/40">
              <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-3 py-2">
                <TeamDot color={t.color || "#64748b"} />
                <span className="min-w-0 truncate font-semibold text-dark">{t.name}</span>
                <span className="text-xs text-light">{teamLabel(t.tier)}</span>
                <span className="ml-auto text-xs text-light">
                  {open.length ? `${on} of ${open.length} in ${target.name}` : "Team is copied"}
                </span>
                {open.length > 1 && !isPool && (
                  <button
                    type="button"
                    className="text-xs font-semibold text-link hover:underline"
                    onClick={() => setTeam(t, on < open.length)}
                  >
                    {on < open.length ? "Tick all" : "Untick all"}
                  </button>
                )}
              </header>
              {t.people.length === 0 ? (
                <p className="px-3 py-2 text-xs text-light">Nobody drove for this team. It is copied anyway.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {t.people.filter((p) => showAll[t.id] || !isQuiet(p)).map((p) => {
                    const pick = picks[p.driverId] || { on: false, place: OWN };
                    const id = `co-${p.driverId}`;
                    const ownLabel = p.seat ? `${t.name} (same team)` : "Reserve pool (same as now)";
                    return (
                      <li key={p.driverId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
                        <label htmlFor={id} className="flex min-w-[12rem] flex-1 cursor-pointer items-center gap-3">
                          <input
                            id={id}
                            type="checkbox"
                            className="h-5 w-5 shrink-0 accent-[var(--c-primary)] disabled:opacity-40"
                            checked={!p.already && pick.on}
                            disabled={p.already}
                            onChange={(e) => set(p.driverId, { on: e.target.checked })}
                          />
                          <DriverAvatar name={p.name} photoUrl={p.photoUrl} color={t.color || "#64748b"} size={28} />
                          <span className="min-w-0">
                            <span className={`block truncate text-sm font-semibold ${p.already || !pick.on ? "text-light" : "text-dark"}`}>
                              {p.name}
                            </span>
                            <span className="block text-xs text-light">
                              {[startsLabel(p.starts), !p.isActive && "inactive at the end", p.tier === 0 && p.division === 2 && "Division 2 pool"]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </span>
                        </label>
                        {p.already ? (
                          <span className="ml-auto text-xs font-semibold text-light">Already in {target.name}</span>
                        ) : pick.on ? (
                          <label className="ml-auto flex w-full items-center gap-2 text-xs text-light sm:w-auto">
                            <span className="shrink-0">Drives for</span>
                            <select
                              className="input min-w-0 flex-1 py-1.5 text-sm sm:w-56 sm:flex-none"
                              value={pick.place}
                              onChange={(e) => set(p.driverId, { place: e.target.value })}
                            >
                              <option value={OWN}>{ownLabel}</option>
                              {seats
                                .filter((s) => s.id !== t.id)
                                .map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name} ({teamLabel(s.tier)})
                                  </option>
                                ))}
                              {!isPool && <option value={POOL}>Reserve pool</option>}
                            </select>
                          </label>
                        ) : (
                          <span className="ml-auto text-xs text-light">Not copied</span>
                        )}
                      </li>
                    );
                  })}
                  {quiet.length > 0 && (
                    <li>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold text-medium hover:text-dark"
                        onClick={() => setShowAll((cur) => ({ ...cur, [t.id]: !cur[t.id] }))}
                        aria-expanded={!!showAll[t.id]}
                      >
                        {showAll[t.id] ? (
                          <ChevronUp className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                        ) : (
                          <ChevronDown className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                        )}
                        {showAll[t.id]
                          ? `Hide the ${quiet.length} who never drove`
                          : `Show ${quiet.length} more who signed up but never drove${quietOn ? ` (${quietOn} ticked)` : ""}`}
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <div className="space-y-2 rounded-xl border border-border bg-surface/40 p-3">
        <p className="text-sm text-medium">
          <b className="text-dark">{chosen.length}</b> {chosen.length === 1 ? "person goes" : "people go"} into{" "}
          {target.name}
          {leftOut ? (
            <>
              , <b className="text-dark">{leftOut}</b> {leftOut === 1 ? "is" : "are"} not copied
            </>
          ) : null}
          .{" "}
          {showTeamsOnly
            ? `All ${teams.length} teams are copied too.`
            : `Teams ${target.name} already has are kept, the missing ones are copied.`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary py-1.5 text-sm" disabled={busy} onClick={bringBack}>
            Copy to {target.name}
          </button>
          {showTeamsOnly && (
            <button
              type="button"
              className="btn-secondary py-1.5 text-sm"
              disabled={busy}
              onClick={() =>
                run(() => api.cloneTeams(target.id, source.id), (r) => `Copied ${r.created} team(s) from ${source.name}.`)
              }
            >
              Only the teams, no drivers
            </button>
          )}
          {changed && (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-medium hover:text-dark"
              onClick={() => setPicks(suggested(teams))}
              disabled={busy}
            >
              <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              Undo my changes
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
