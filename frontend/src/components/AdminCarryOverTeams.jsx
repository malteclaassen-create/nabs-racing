import { useEffect, useRef, useState } from "react";
import { CheckSquare, Layers, Plus, X } from "lucide-react";
import { api } from "../api/client.js";
import { Spinner, Notice, CheckField } from "./ui.jsx";
import TeamLogo from "./TeamLogo.jsx";

// ---------------------------------------------------------------------------
// "Which teams race?" Step 2 of the season wizard, before the drivers.
//
// One box per place a team can race: Tier 1, Tier 2 and, when the season runs
// it, Division 2. Last season's teams start in the box of their old tier with
// a tick (ticked = it races in the new season). "Races in" moves a team, and
// it jumps into the other box right away, lit up for a moment so the eye can
// follow it. New teams are added straight into a box. One switch says
// whether the season runs Division 2 at all; the Reserve pool always comes
// along. The drivers step then offers exactly these teams under "Drives for".
// ---------------------------------------------------------------------------

const TIERS = [
  { value: 1, label: "Tier 1", group: "Division 1" },
  { value: 2, label: "Tier 2", group: "Division 1" },
  { value: 3, label: "Division 2", group: "Division 2" },
];

const tierName = (v) => TIERS.find((t) => t.value === Number(v))?.label || "Tier 1";
const byName = (a, b) => a.name.localeCompare(b.name);

export default function AdminCarryOverTeams({ target, source, run, busy }) {
  const [teams, setTeams] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [keep, setKeep] = useState({}); // source team id -> { on, tier }
  const [added, setAdded] = useState([]); // [{ key, name, tier, color }]
  const [drafts, setDrafts] = useState({}); // tier -> { name, color }
  const [division2, setDivision2] = useState(!!(target.division2 || source.division2));
  // The team that just changed box, lit up for a moment where it landed.
  const [flash, setFlash] = useState(null);
  const flashTimer = useRef(null);
  const rowRefs = useRef({});

  useEffect(() => {
    let live = true;
    api
      .carryOverPreview(target.id, source.id)
      .then((r) => {
        if (!live) return;
        const list = (r.teams || []).filter((t) => t.tier !== 0);
        setTeams(list);
        setKeep(Object.fromEntries(list.map((t) => [t.id, { on: true, tier: t.tier }])));
      })
      .catch((err) => live && setLoadError(err.message));
    return () => {
      live = false;
      clearTimeout(flashTimer.current);
    };
  }, [target.id, source.id]);

  // Bring the moved team into view in its new box (it may have jumped far).
  useEffect(() => {
    if (!flash) return;
    rowRefs.current[flash]?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [flash]);

  if (loadError) return <Notice kind="error">{loadError}</Notice>;
  if (!teams) return <Spinner label={`Reading ${source.name}…`} />;

  const kept = teams.filter((t) => keep[t.id]?.on);
  const all = [...kept.map((t) => ({ name: t.name, tier: keep[t.id].tier })), ...added];
  const div2 = all.filter((t) => t.tier === 3).length;
  const stuck = !division2 && div2 > 0;

  function lightUp(key) {
    clearTimeout(flashTimer.current);
    setFlash(key);
    flashTimer.current = setTimeout(() => setFlash(null), 1600);
  }

  function moveOld(t, tier) {
    setKeep((cur) => ({ ...cur, [t.id]: { ...cur[t.id], tier } }));
    lightUp(t.id);
  }

  function moveNew(n, tier) {
    setAdded((cur) => cur.map((x) => (x.key === n.key ? { ...x, tier } : x)));
    lightUp(n.key);
  }

  function addTeam(e, tier) {
    e.preventDefault();
    const d = drafts[tier] || {};
    const name = (d.name || "").trim();
    if (!name) return;
    const key = `new-${Date.now()}`;
    setAdded((cur) => [...cur, { key, name, tier, color: d.color || "#64748b" }]);
    setDrafts((cur) => ({ ...cur, [tier]: { name: "", color: "#64748b" } }));
    lightUp(key);
  }

  function save() {
    run(
      () =>
        api.carryOverTeams(target.id, source.id, {
          division2,
          teams: kept.map((t) => ({ sourceId: t.id, tier: keep[t.id].tier })),
          newTeams: added.map(({ name, tier, color }) => ({ name, tier, color })),
        }),
      (r) => `${r.teamsCreated} team(s) created in ${target.name}, Reserve pool included. Now the drivers.`
    );
  }

  const tierSelect = (value, onChange, label) => (
    <label className="flex w-full items-center gap-2 text-xs text-light sm:w-auto">
      <span className="shrink-0">Races in</span>
      <select className="input min-w-0 flex-1 py-1.5 text-sm sm:w-36 sm:flex-none" value={value} onChange={onChange} aria-label={label}>
        {TIERS.map((t) => (
          <option key={t.value} value={t.value} disabled={t.value === 3 && !division2}>
            {t.label}
          </option>
        ))}
      </select>
    </label>
  );

  const rowClass = (key) =>
    `flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 transition-colors duration-700 ${
      flash === key ? "bg-brand/15" : ""
    }`;

  // The boxes: Tier 1 and Tier 2 always, Division 2 when it runs (or when a
  // team still sits there, so it is never hidden from view).
  const boxes = TIERS.filter((b) => b.value !== 3 || division2 || all.some((t) => t.tier === 3) || added.some((t) => t.tier === 3));

  return (
    <div className="space-y-3">
      <ul className="space-y-2 rounded-xl border border-border bg-surface/40 p-3 text-sm text-medium">
        <li className="flex items-start gap-2">
          <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-brand" strokeWidth={2} aria-hidden="true" />
          <span>
            <b className="text-dark">Ticked</b> teams race in {target.name}. A team without a tick is not copied
            (nothing is deleted from {source.name}).
          </span>
        </li>
        <li className="flex items-start gap-2">
          <Layers className="mt-0.5 h-4 w-4 shrink-0 text-brand" strokeWidth={2} aria-hidden="true" />
          <span>
            Each box is one place to race: <b className="text-dark">Tier 1</b>, <b className="text-dark">Tier 2</b>
            {division2 ? (
              <>
                {" "}and <b className="text-dark">Division 2</b>
              </>
            ) : null}
            . Change <b className="text-dark">Races in</b> and the team moves to that box. The Reserve pool comes
            along by itself. Drivers come in the next step.
          </span>
        </li>
      </ul>

      <CheckField
        checked={division2}
        onChange={(e) => setDivision2(e.target.checked)}
        label={`Run Division 2 in ${target.name}`}
        hint="A second field for newcomers on the second server, the same evening, with its own teams and standings."
      />

      {boxes.map((box) => {
        const oldHere = teams.filter((t) => (keep[t.id]?.tier ?? t.tier) === box.value).sort(byName);
        const newHere = added.filter((n) => n.tier === box.value).sort(byName);
        const racing = oldHere.filter((t) => keep[t.id]?.on).length + newHere.length;
        const d = drafts[box.value] || { name: "", color: "#64748b" };
        const offBox = box.value === 3 && !division2;
        return (
          <section key={box.value} className={`rounded-xl border bg-surface/40 ${offBox ? "border-red-500/60" : "border-border"}`}>
            <header className="flex flex-wrap items-baseline gap-x-2 border-b border-border px-3 py-2">
              <span className="font-semibold text-dark">{box.label}</span>
              {box.value !== 3 && division2 && <span className="text-xs text-light">Division 1</span>}
              <span className="ml-auto text-xs text-light">
                {racing} team{racing === 1 ? "" : "s"} in {target.name}
              </span>
            </header>
            <ul className="divide-y divide-border">
              {oldHere.map((t) => {
                const k = keep[t.id] || { on: false, tier: t.tier };
                const id = `ct-${t.id}`;
                return (
                  <li key={t.id} ref={(el) => (rowRefs.current[t.id] = el)} className={rowClass(t.id)}>
                    <label htmlFor={id} className="flex min-w-[12rem] flex-1 cursor-pointer items-center gap-3">
                      <input
                        id={id}
                        type="checkbox"
                        className="h-5 w-5 shrink-0 accent-[var(--c-primary)]"
                        checked={k.on}
                        onChange={(e) => setKeep((cur) => ({ ...cur, [t.id]: { ...k, on: e.target.checked } }))}
                      />
                      <TeamLogo id={t.id} name={t.name} color={t.color || "#64748b"} logoUrl={t.logoUrl} size={28} />
                      <span className="min-w-0">
                        <span className={`block truncate text-sm font-semibold ${k.on ? "text-dark" : "text-light"}`}>{t.name}</span>
                        <span className="block text-xs text-light">
                          {k.tier !== t.tier ? `Was ${tierName(t.tier)}` : `${tierName(t.tier)} in ${source.name}`} ·{" "}
                          {t.people.length} driver{t.people.length === 1 ? "" : "s"}
                        </span>
                      </span>
                    </label>
                    {k.on ? (
                      tierSelect(k.tier, (e) => moveOld(t, Number(e.target.value)), `Where ${t.name} races`)
                    ) : (
                      <span className="ml-auto text-xs text-light">Not copied</span>
                    )}
                  </li>
                );
              })}
              {newHere.map((n) => (
                <li key={n.key} ref={(el) => (rowRefs.current[n.key] = el)} className={rowClass(n.key)}>
                  <div className="flex min-w-[12rem] flex-1 items-center gap-3">
                    <span className="h-5 w-5 shrink-0" aria-hidden="true" />
                    <TeamLogo name={n.name} color={n.color} size={28} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-dark">{n.name}</span>
                      <span className="block text-xs text-light">New team</span>
                    </span>
                  </div>
                  {tierSelect(n.tier, (e) => moveNew(n, Number(e.target.value)), `Where ${n.name} races`)}
                  <button
                    type="button"
                    className="text-light hover:text-dark"
                    onClick={() => setAdded((cur) => cur.filter((x) => x.key !== n.key))}
                    aria-label={`Remove ${n.name}`}
                  >
                    <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                  </button>
                </li>
              ))}
              {!oldHere.length && !newHere.length && (
                <li className="px-3 py-2 text-xs text-light">
                  No team here yet. Move one in with &ldquo;Races in&rdquo;, or add a new one below.
                </li>
              )}
              <li>
                <form onSubmit={(e) => addTeam(e, box.value)} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <input
                    type="color"
                    className="h-9 w-9 shrink-0 cursor-pointer rounded border border-border bg-transparent"
                    value={d.color || "#64748b"}
                    onChange={(e) => setDrafts((cur) => ({ ...cur, [box.value]: { ...d, color: e.target.value } }))}
                    aria-label={`Colour of the new ${box.label} team`}
                  />
                  <input
                    className="input min-w-[10rem] flex-1 py-1.5 text-sm"
                    placeholder={`New ${box.label} team`}
                    value={d.name || ""}
                    onChange={(e) => setDrafts((cur) => ({ ...cur, [box.value]: { ...d, name: e.target.value } }))}
                  />
                  <button
                    type="submit"
                    className="btn-secondary inline-flex items-center gap-1.5 py-1.5 text-sm"
                    disabled={!(d.name || "").trim() || offBox}
                  >
                    <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                    Add
                  </button>
                </form>
              </li>
            </ul>
          </section>
        );
      })}

      <div className="space-y-2 rounded-xl border border-border bg-surface/40 p-3">
        <p className="text-sm text-medium">
          <b className="text-dark">{all.length}</b> team{all.length === 1 ? "" : "s"} race in {target.name}:{" "}
          {all.filter((t) => t.tier === 1).length} in Tier 1, {all.filter((t) => t.tier === 2).length} in Tier 2
          {division2 ? `, ${div2} in Division 2` : ""}. Plus the Reserve pool.
          {division2 && !div2 ? " Division 2 has no team yet." : ""}
        </p>
        {stuck && (
          <p className="text-sm text-bad">
            Some teams are in Division 2 while Division 2 is off. Switch it on, or move them to Tier 1 or Tier 2.
          </p>
        )}
        <button type="button" className="btn-primary py-1.5 text-sm" disabled={busy || stuck || !all.length} onClick={save}>
          Create these teams
        </button>
      </div>
    </div>
  );
}
