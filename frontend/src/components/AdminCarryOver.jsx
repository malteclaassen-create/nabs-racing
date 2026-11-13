import { useEffect, useMemo, useState } from "react";
import { Users, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";
import { api } from "../api/client.js";
import { DriverAvatar, TeamDot, Spinner, Notice } from "./ui.jsx";
import SlidingTabs from "./SlidingTabs.jsx";

// ---------------------------------------------------------------------------
// "Who comes back?" Step 2 of the season wizard.
//
// Last season's field per team, one checkbox per person. Ticked to start with:
// everybody who held a seat, and reserves who raced at least once. Reserves who
// never drove start unticked; they are not lost, the attendance sign-up puts
// them back into the Reserve pool the first time they answer. A seat holder
// can come back into their old team or into the Reserve pool, for when the
// grid is being reshuffled. The teams themselves are always copied whole.
// ---------------------------------------------------------------------------

const PLACES = [
  { key: "team", label: "Same team" },
  { key: "reserve", label: "Reserve pool" },
];

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
  for (const t of teams) for (const p of t.people) out[p.driverId] = { on: p.picked, to: "team" };
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
  const chosen = people.filter((p) => !p.already && picks[p.driverId]?.on);
  const leftOut = people.filter((p) => !p.already && !picks[p.driverId]?.on).length;

  function set(id, patch) {
    setPicks((cur) => ({ ...cur, [id]: { ...(cur[id] || { on: false, to: "team" }), ...patch } }));
  }

  function setTeam(team, on) {
    setPicks((cur) => {
      const next = { ...cur };
      for (const p of team.people) if (!p.already) next[p.driverId] = { ...(cur[p.driverId] || { to: "team" }), on };
      return next;
    });
  }

  function bringBack() {
    const body = chosen.map((p) => ({ driverId: p.driverId, to: p.seat ? picks[p.driverId]?.to || "team" : "team" }));
    run(
      () => api.carryOver(target.id, source.id, body),
      (r) => {
        const skipped = r.skipped?.length ? ` Left alone: ${r.skipped.map((s) => s.name).join(", ")} (already in ${target.name}).` : "";
        return `Brought back ${r.driversCreated} driver(s) and copied ${r.teamsCreated} team(s) from ${source.name}, each linked to their earlier seasons.${skipped}`;
      }
    );
  }

  if (loadError) return <Notice kind="error">{loadError}</Notice>;
  if (!teams) return <Spinner label={`Reading ${source.name}…`} />;
  if (!teams.length) return <p className="text-sm text-light">{source.name} has no teams to bring over.</p>;

  const changed = people.some((p) => !p.already && (!!picks[p.driverId]?.on !== p.picked || picks[p.driverId]?.to === "reserve"));

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 text-sm text-light">
        <Users className="mt-0.5 h-4 w-4 shrink-0 text-medium" strokeWidth={2} aria-hidden="true" />
        <p>
          Who comes back from {source.name}? Ticked: everybody with a seat, and reserves who raced. Reserves who never
          drove come back on their own when they sign up for a race.
        </p>
      </div>

      <div className="space-y-3">
        {teams.map((t) => {
          const open = t.people.filter((p) => !p.already);
          const on = open.filter((p) => picks[p.driverId]?.on).length;
          const quiet = t.people.filter((p) => isQuiet(p));
          const quietOn = quiet.filter((p) => picks[p.driverId]?.on).length;
          return (
            <section key={t.id} className="rounded-xl border border-border bg-surface/40">
              <header className="flex items-center gap-2 border-b border-border px-3 py-2">
                <TeamDot color={t.color || "#64748b"} />
                <span className="min-w-0 flex-1 truncate font-semibold text-dark">{t.name}</span>
                <span className="text-xs text-light">{teamLabel(t.tier)}</span>
                {open.length > 0 && (
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs text-medium">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--c-primary)]"
                      checked={on === open.length}
                      ref={(el) => el && (el.indeterminate = on > 0 && on < open.length)}
                      onChange={(e) => setTeam(t, e.target.checked)}
                      aria-label={`Everybody from ${t.name}`}
                    />
                    <span className="font-mono">
                      {on}/{open.length}
                    </span>
                  </label>
                )}
              </header>
              {t.people.length === 0 ? (
                <p className="px-3 py-2 text-xs text-light">Nobody in this team. The team is copied anyway.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {t.people.filter((p) => showAll[t.id] || !isQuiet(p)).map((p) => {
                    const pick = picks[p.driverId] || { on: false, to: "team" };
                    const id = `co-${p.driverId}`;
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
                              {p.already
                                ? `Already in ${target.name}`
                                : [startsLabel(p.starts), !p.isActive && "inactive at the end", p.tier === 0 && p.division === 2 && "Division 2 pool"]
                                    .filter(Boolean)
                                    .join(" · ")}
                            </span>
                          </span>
                        </label>
                        {p.seat && !p.already && pick.on && (
                          <SlidingTabs
                            items={PLACES}
                            value={pick.to}
                            onChange={(to) => set(p.driverId, { to })}
                            className="ml-auto"
                            btnClassName="px-2.5 py-1 text-xs"
                          />
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
                          : `Show ${quiet.length} more who never drove${quietOn ? ` (${quietOn} ticked)` : ""}`}
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary py-1.5 text-sm" disabled={busy} onClick={bringBack}>
          Bring back {chosen.length} driver{chosen.length === 1 ? "" : "s"}
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
            Teams only
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
            Back to the suggestion
          </button>
        )}
      </div>
      <p className="text-xs text-light">
        {leftOut ? `${leftOut} stay behind. ` : ""}
        {showTeamsOnly
          ? `All ${teams.length} teams are copied. `
          : `Teams ${target.name} already has are used as they are, the others are copied. `}
        You can still add or move people in the Drivers tab afterwards.
      </p>
    </div>
  );
}
