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
// answer. The teams come from the step before (AdminCarryOverTeams): "Drives
// for" lists the NEW season's teams by division, and the Reserve pool, with a
// Division 2 side when the season runs Division 2. A driver whose team did
// not carry on starts out in the pool.
// ---------------------------------------------------------------------------

// A place is "t:<team id of the new season>" or "pool:1" / "pool:2".
const poolPlace = (division, division2) => `pool:${division === 2 && division2 ? 2 : 1}`;

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

// Where each person goes unless the admin says otherwise: the new season's
// copy of their team, else the pool (their own side of it).
function defaultPlace(team, p, division2) {
  if (team.tier !== 0 && team.targetTeamId) return `t:${team.targetTeamId}`;
  return poolPlace(p.division, division2);
}

function suggested(data) {
  const out = {};
  for (const t of data.teams)
    for (const p of t.people) out[p.driverId] = { on: p.picked, place: defaultPlace(t, p, data.division2) };
  return out;
}

// `run(fn, doneMessage)` is the wizard's runner (busy flag, errors, reload).
export default function AdminCarryOver({ target, source, run, busy }) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [picks, setPicks] = useState({});
  // Per team: also list the reserves who never drove (folded away by default,
  // the pool holds a long sign-up list and most of it is this).
  const [showAll, setShowAll] = useState({});

  useEffect(() => {
    let live = true;
    setData(null);
    setLoadError(null);
    api
      .carryOverPreview(target.id, source.id)
      .then((r) => {
        if (!live) return;
        const d = { teams: r.teams || [], targetTeams: r.targetTeams || [], division2: !!r.division2 };
        setData(d);
        setPicks(suggested(d));
      })
      .catch((err) => live && setLoadError(err.message));
    return () => {
      live = false;
    };
  }, [target.id, source.id]);

  const teams = data?.teams || null;
  const people = useMemo(() => (teams || []).flatMap((t) => t.people), [teams]);
  // The new season's teams a driver can be put into, by division.
  const div1Teams = (data?.targetTeams || []).filter((t) => t.tier === 1 || t.tier === 2);
  const div2Teams = (data?.targetTeams || []).filter((t) => t.tier === 3);
  const chosen = people.filter((p) => !p.already && picks[p.driverId]?.on);
  const leftOut = people.filter((p) => !p.already && !picks[p.driverId]?.on).length;

  function set(id, patch) {
    setPicks((cur) => ({ ...cur, [id]: { ...cur[id], ...patch } }));
  }

  function setTeam(team, on) {
    setPicks((cur) => {
      const next = { ...cur };
      for (const p of team.people) if (!p.already) next[p.driverId] = { ...cur[p.driverId], on };
      return next;
    });
  }

  function bringBack() {
    const body = chosen.map((p) => {
      const place = picks[p.driverId]?.place || "pool:1";
      if (place.startsWith("t:")) return { driverId: p.driverId, to: "team", targetTeamId: place.slice(2) };
      return { driverId: p.driverId, to: "reserve", division: place === "pool:2" ? 2 : 1 };
    });
    run(
      () => api.carryOver(target.id, source.id, body),
      (r) => {
        const skipped = r.skipped?.length ? ` Left alone: ${r.skipped.map((s) => s.name).join(", ")} (already in ${target.name}).` : "";
        return `${r.driversCreated} driver(s) copied to ${target.name}, each linked to their earlier seasons.${skipped}`;
      }
    );
  }

  if (loadError) return <Notice kind="error">{loadError}</Notice>;
  if (!teams) return <Spinner label={`Reading ${source.name}…`} />;
  if (!teams.length) return <p className="text-sm text-light">{source.name} has no teams to bring over.</p>;

  const fresh = suggested(data);
  const changed = people.some(
    (p) =>
      !p.already &&
      (!!picks[p.driverId]?.on !== fresh[p.driverId].on || picks[p.driverId]?.place !== fresh[p.driverId].place)
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
            <b className="text-dark">Drives for</b> says where they go: their old team, another team of {target.name} (a
            transfer, a reserve getting a seat, a move between Division 1 and Division 2) or the Reserve pool.
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
          const gone = !isPool && !t.targetTeamId;
          return (
            <section key={t.id} className="rounded-xl border border-border bg-surface/40">
              <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-3 py-2">
                <TeamDot color={t.color || "#64748b"} />
                <span className="min-w-0 truncate font-semibold text-dark">{t.name}</span>
                <span className="text-xs text-light">
                  {gone ? `${teamLabel(t.tier)}, not in ${target.name}` : teamLabel(t.tier)}
                </span>
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
                    const pick = picks[p.driverId] || { on: false, place: "pool:1" };
                    const id = `co-${p.driverId}`;
                    const own = fresh[p.driverId]?.place;
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
                              {[startsLabel(p.starts), gone && pick.on && `${t.name} is not in ${target.name}`, !p.isActive && "inactive at the end", p.tier === 0 && p.division === 2 && "Division 2 pool"]
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
                              className="input min-w-0 flex-1 py-1.5 text-sm sm:w-60 sm:flex-none"
                              value={pick.place}
                              onChange={(e) => set(p.driverId, { place: e.target.value })}
                            >
                              {div1Teams.length > 0 && (
                                <optgroup label={data.division2 ? "Division 1" : "Teams"}>
                                  {div1Teams.map((x) => (
                                    <option key={x.id} value={`t:${x.id}`}>
                                      {x.name} ({teamLabel(x.tier)}){own === `t:${x.id}` ? ", same team" : ""}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              {div2Teams.length > 0 && (
                                <optgroup label="Division 2">
                                  {div2Teams.map((x) => (
                                    <option key={x.id} value={`t:${x.id}`}>
                                      {x.name} (Division 2){own === `t:${x.id}` ? ", same team" : ""}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              <optgroup label="No seat">
                                <option value="pool:1">{data.division2 ? "Reserve pool, Division 1" : "Reserve pool"}</option>
                                {data.division2 && <option value="pool:2">Reserve pool, Division 2</option>}
                              </optgroup>
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
          .
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary py-1.5 text-sm" disabled={busy} onClick={bringBack}>
            Copy to {target.name}
          </button>
          {changed && (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-medium hover:text-dark"
              onClick={() => setPicks(suggested(data))}
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
