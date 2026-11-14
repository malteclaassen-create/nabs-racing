import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, ChevronDown, ChevronUp, CheckSquare, ArrowRightLeft, UserX } from "lucide-react";
import { api } from "../api/client.js";
import { DriverAvatar, Spinner, Notice } from "./ui.jsx";
import TeamLogo from "./TeamLogo.jsx";

// ---------------------------------------------------------------------------
// "Who drives?" Step 3 of the season wizard, after the teams.
//
// The list is the NEW season's grid as it will be: Division 1 (Tier 1 and
// Tier 2), Division 2 and the Reserve pool, the teams of the new season inside,
// and every driver under the team they will drive for. Changing "Drives for"
// moves the driver to that team at once, lit up for a moment; unticking moves
// them to "Not in <season>" at the bottom. What you see is what gets copied.
//
// Where people start: the new season's copy of last season's team; the pool
// for reserves and for drivers whose team did not carry on. Ticked to start
// with: everybody who held a seat, and reserves who raced at least once.
// Reserves who never drove start unticked and folded away at the bottom; the
// attendance sign-up puts them back into the Reserve pool the first time they
// answer anyway.
// ---------------------------------------------------------------------------

// A place is "t:<team id of the new season>" or "pool:1" / "pool:2".
const poolPlace = (division, division2) => `pool:${division === 2 && division2 ? 2 : 1}`;

const TIER_LABEL = { 1: "Tier 1", 2: "Tier 2", 3: "Division 2" };

function startsLabel(n) {
  if (!n) return "No starts";
  return n === 1 ? "1 start" : `${n} starts`;
}

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

const bySeat = (a, b) => Number(b.seat) - Number(a.seat) || b.starts - a.starts || a.name.localeCompare(b.name);

// `run(fn, doneMessage)` is the wizard's runner (busy flag, errors, reload).
export default function AdminCarryOver({ target, source, run, busy }) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [picks, setPicks] = useState({});
  const [showQuiet, setShowQuiet] = useState(false);
  // The driver who just moved, lit up for a moment where they landed.
  const [flash, setFlash] = useState(null);
  const flashTimer = useRef(null);
  const scrollTo = useRef(null);
  const rowRefs = useRef({});

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
      clearTimeout(flashTimer.current);
    };
  }, [target.id, source.id]);

  // After a "Drives for" change, bring the driver into view where they landed.
  useEffect(() => {
    if (!scrollTo.current) return;
    rowRefs.current[scrollTo.current]?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    scrollTo.current = null;
  });

  // Every person once, with the team they came from.
  const people = useMemo(
    () =>
      (data?.teams || []).flatMap((t) =>
        t.people.map((p) => ({ ...p, from: { id: t.id, name: t.name, tier: t.tier, color: t.color, logoUrl: t.logoUrl } }))
      ),
    [data]
  );

  if (loadError) return <Notice kind="error">{loadError}</Notice>;
  if (!data) return <Spinner label={`Reading ${source.name}…`} />;
  if (!data.teams.length) return <p className="text-sm text-light">{source.name} has nobody to bring over.</p>;

  const fresh = suggested(data);
  const open = people.filter((p) => !p.already);
  const already = people.filter((p) => p.already);
  const ticked = open.filter((p) => picks[p.driverId]?.on);
  const out = open.filter((p) => !picks[p.driverId]?.on);
  // Unticked reserves who never drove: the long sign-up tail, folded away.
  const quiet = out.filter((p) => !p.seat && !p.starts);
  const outShown = out.filter((p) => p.seat || p.starts);
  const changed = open.some(
    (p) => !!picks[p.driverId]?.on !== fresh[p.driverId].on || picks[p.driverId]?.place !== fresh[p.driverId].place
  );
  const at = (place) => ticked.filter((p) => picks[p.driverId]?.place === place).sort(bySeat);
  const teamsOf = (tier) => data.targetTeams.filter((t) => t.tier === tier);
  const div2Teams = teamsOf(3);
  const placeName = (place) => {
    if (place === "pool:2") return "Reserve pool, Division 2";
    if (place?.startsWith("pool")) return data.division2 ? "Reserve pool, Division 1" : "Reserve pool";
    const t = data.targetTeams.find((x) => `t:${x.id}` === place);
    return t ? `${t.name} (${TIER_LABEL[t.tier]})` : "?";
  };

  function lightUp(id, scroll) {
    clearTimeout(flashTimer.current);
    setFlash(id);
    if (scroll) scrollTo.current = id;
    flashTimer.current = setTimeout(() => setFlash(null), 1600);
  }

  function set(id, patch, { scroll = false } = {}) {
    setPicks((cur) => ({ ...cur, [id]: { ...cur[id], ...patch } }));
    lightUp(id, scroll);
  }

  function bringBack() {
    const body = ticked.map((p) => {
      const place = picks[p.driverId]?.place || "pool:1";
      if (place.startsWith("t:")) return { driverId: p.driverId, to: "team", targetTeamId: place.slice(2) };
      return { driverId: p.driverId, to: "reserve", division: place === "pool:2" ? 2 : 1 };
    });
    run(
      () => api.carryOver(target.id, source.id, body),
      (r) => {
        const skipped = r.skipped?.length ? ` Left alone: ${r.skipped.map((s) => s.name).join(", ")} (already in ${target.name}).` : "";
        return `${r.driversCreated} driver(s) copied to ${target.name}, each linked to their earlier seasons. You can still move people in the Drivers tab.${skipped}`;
      }
    );
  }

  const select = (p) => (
    <label className="ml-auto flex w-full items-center gap-2 text-xs text-light sm:w-auto">
      <span className="shrink-0">Drives for</span>
      <select
        className="input min-w-0 flex-1 py-1.5 text-sm sm:w-60 sm:flex-none"
        value={picks[p.driverId]?.place}
        onChange={(e) => set(p.driverId, { place: e.target.value }, { scroll: true })}
      >
        {teamsOf(1).length + teamsOf(2).length > 0 && (
          <optgroup label="Division 1">
            {[...teamsOf(1), ...teamsOf(2)].map((x) => (
              <option key={x.id} value={`t:${x.id}`}>
                {x.name} ({TIER_LABEL[x.tier]})
              </option>
            ))}
          </optgroup>
        )}
        {div2Teams.length > 0 && (
          <optgroup label="Division 2">
            {div2Teams.map((x) => (
              <option key={x.id} value={`t:${x.id}`}>
                {x.name} (Division 2)
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
  );

  // One driver line. `inGrid`: ticked, sitting under their team.
  const row = (p, inGrid) => {
    const id = `co-${p.driverId}`;
    const place = picks[p.driverId]?.place;
    const moved = place !== fresh[p.driverId].place;
    const fromName = p.from.tier === 0 ? "Reserve pool" : `${p.from.name} (${TIER_LABEL[p.from.tier] || ""})`;
    const sub = [startsLabel(p.starts), `${moved || !inGrid ? "was" : "from"} ${fromName}`, !p.isActive && "inactive at the end"]
      .filter(Boolean)
      .join(" · ");
    return (
      <li
        key={p.driverId}
        ref={(el) => (rowRefs.current[p.driverId] = el)}
        className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 transition-colors duration-700 ${
          flash === p.driverId ? "bg-brand/15" : ""
        }`}
      >
        <label htmlFor={id} className="flex min-w-[12rem] flex-1 cursor-pointer items-center gap-3">
          <input
            id={id}
            type="checkbox"
            className="h-5 w-5 shrink-0 accent-[var(--c-primary)]"
            checked={inGrid}
            onChange={(e) => set(p.driverId, { on: e.target.checked })}
          />
          <DriverAvatar name={p.name} photoUrl={p.photoUrl} color={p.from.color || "#64748b"} size={28} />
          <span className="min-w-0">
            <span className={`block truncate text-sm font-semibold ${inGrid ? "text-dark" : "text-light"}`}>{p.name}</span>
            <span className="block text-xs text-light">{sub}</span>
          </span>
        </label>
        {inGrid ? (
          select(p)
        ) : (
          <span className="ml-auto text-xs text-light">Tick to bring back to {placeName(place)}</span>
        )}
      </li>
    );
  };

  const teamBlock = (team) => {
    const here = at(`t:${team.id}`);
    return (
      <div key={team.id} className="border-t border-border first:border-t-0">
        <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
          <TeamLogo id={team.id} name={team.name} color={team.color || "#64748b"} logoUrl={team.logoUrl} size={22} />
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-dark">{team.name}</span>
          {/* An empty Division 1 team is worth a look; Division 2 fills up with
              newcomers later, so empty is normal there. */}
          <span className={`text-xs ${here.length || team.tier === 3 ? "text-light" : "font-semibold text-warn"}`}>
            {here.length ? `${here.length} driver${here.length === 1 ? "" : "s"}` : "No driver yet"}
          </span>
        </div>
        {here.length > 0 && <ul className="divide-y divide-border">{here.map((p) => row(p, true))}</ul>}
      </div>
    );
  };

  const box = (key, title, sub, children) => (
    <section key={key} className="overflow-hidden rounded-xl border border-border bg-surface/40">
      <header className="flex flex-wrap items-baseline gap-x-2 border-b border-border bg-surface2/50 px-3 py-2">
        <span className="font-semibold text-dark">{title}</span>
        {sub && <span className="ml-auto text-xs text-light">{sub}</span>}
      </header>
      {children}
    </section>
  );

  const poolSide = (place, label) => {
    const here = at(place);
    return (
      <div key={place} className="border-t border-border first:border-t-0">
        {label && <div className="px-3 pb-1 pt-2.5 text-sm font-bold text-dark">{label}</div>}
        {here.length ? (
          <ul className="divide-y divide-border">{here.map((p) => row(p, true))}</ul>
        ) : (
          <p className="px-3 py-2 text-xs text-light">Nobody here.</p>
        )}
      </div>
    );
  };

  const partHead = (title) => (
    <h3 className="pt-2 font-display text-base font-black uppercase tracking-wide text-dark">{title}</h3>
  );
  const count = (tier) => {
    const n = teamsOf(tier).reduce((s, t) => s + at(`t:${t.id}`).length, 0);
    return `${n} driver${n === 1 ? "" : "s"}`;
  };

  return (
    <div className="space-y-3">
      <ul className="space-y-2 rounded-xl border border-border bg-surface/40 p-3 text-sm text-medium">
        <li className="flex items-start gap-2">
          <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-brand" strokeWidth={2} aria-hidden="true" />
          <span>
            This is the grid of {target.name} as it will be. Everybody <b className="text-dark">ticked</b> sits under
            the team they drive for. We ticked everybody with a seat and every reserve who raced in {source.name}.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <ArrowRightLeft className="mt-0.5 h-4 w-4 shrink-0 text-brand" strokeWidth={2} aria-hidden="true" />
          <span>
            Change <b className="text-dark">Drives for</b> and the driver moves to that team: a transfer, a reserve
            getting a seat, a move between Division 1 and Division 2, or into the Reserve pool.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <UserX className="mt-0.5 h-4 w-4 shrink-0 text-light" strokeWidth={2} aria-hidden="true" />
          <span>
            Untick someone and they move to <b className="text-dark">Not in {target.name}</b> at the bottom: not
            copied, nothing deleted. Reserves who never drove wait there too and come back on their own when they sign
            up for a race.
          </span>
        </li>
      </ul>

      {already.length > 0 && (
        <p className="rounded-xl border border-border bg-surface/40 px-3 py-2 text-xs text-light">
          Already in {target.name}, left as they are: {already.map((p) => p.name).join(", ")}.
        </p>
      )}

      {teamsOf(1).length + teamsOf(2).length > 0 && partHead(data.division2 ? "Division 1" : "Teams")}
      {[1, 2].map((tier) => (teamsOf(tier).length ? box(`t${tier}`, TIER_LABEL[tier], count(tier), teamsOf(tier).map(teamBlock)) : null))}

      {div2Teams.length > 0 && (
        <>
          {partHead("Division 2")}
          {box("d2", "Division 2", count(3), div2Teams.map(teamBlock))}
        </>
      )}

      {partHead("No seat")}
      {box(
        "pool",
        "Reserve pool",
        "can stand in for a team",
        data.division2
          ? [poolSide("pool:1", "Division 1 side"), poolSide("pool:2", "Division 2 side")]
          : poolSide("pool:1", null)
      )}

      {box(
        "out",
        `Not in ${target.name}`,
        "not copied, nothing deleted",
        <ul className="divide-y divide-border">
          {[...outShown].sort(bySeat).map((p) => row(p, false))}
          {!outShown.length && !quiet.length && <li className="px-3 py-2 text-xs text-light">Nobody. Everybody comes along.</li>}
          {quiet.length > 0 && (
            <>
              <li>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold text-medium hover:text-dark"
                  onClick={() => setShowQuiet((v) => !v)}
                  aria-expanded={showQuiet}
                >
                  {showQuiet ? (
                    <ChevronUp className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                  ) : (
                    <ChevronDown className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                  )}
                  {showQuiet ? `Hide the ${quiet.length} who never drove` : `Show ${quiet.length} who signed up but never drove`}
                </button>
              </li>
              {showQuiet && [...quiet].sort(bySeat).map((p) => row(p, false))}
            </>
          )}
        </ul>
      )}

      <div className="space-y-2 rounded-xl border border-border bg-surface/40 p-3">
        <p className="text-sm text-medium">
          <b className="text-dark">{ticked.length}</b> {ticked.length === 1 ? "person goes" : "people go"} into{" "}
          {target.name}
          {out.length ? (
            <>
              , <b className="text-dark">{out.length}</b> {out.length === 1 ? "is" : "are"} not copied
            </>
          ) : null}
          .
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary py-1.5 text-sm" disabled={busy || !ticked.length} onClick={bringBack}>
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
