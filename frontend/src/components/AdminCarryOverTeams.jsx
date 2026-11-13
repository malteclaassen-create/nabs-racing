import { useEffect, useState } from "react";
import { CheckSquare, Layers, Plus, X } from "lucide-react";
import { api } from "../api/client.js";
import { Spinner, Notice, CheckField } from "./ui.jsx";
import TeamLogo from "./TeamLogo.jsx";

// ---------------------------------------------------------------------------
// "Which teams race?" Step 2 of the season wizard, before the drivers.
//
// Last season's teams with a tick each (ticked = it races in the new season)
// and its division: Tier 1, Tier 2 or Division 2. New teams can be added on
// the spot, and one switch says whether the season runs Division 2 at all.
// The Reserve pool always comes along. The drivers step then offers exactly
// these teams under "Drives for".
// ---------------------------------------------------------------------------

const TIERS = [
  { value: 1, label: "Tier 1" },
  { value: 2, label: "Tier 2" },
  { value: 3, label: "Division 2" },
];

const tierName = (v) => TIERS.find((t) => t.value === Number(v))?.label || "Tier 1";

export default function AdminCarryOverTeams({ target, source, run, busy }) {
  const [teams, setTeams] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [keep, setKeep] = useState({}); // source team id -> { on, tier }
  const [added, setAdded] = useState([]); // [{ key, name, tier, color }]
  const [draft, setDraft] = useState({ name: "", tier: 1, color: "#64748b" });
  const [division2, setDivision2] = useState(!!(target.division2 || source.division2));

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
    };
  }, [target.id, source.id]);

  if (loadError) return <Notice kind="error">{loadError}</Notice>;
  if (!teams) return <Spinner label={`Reading ${source.name}…`} />;

  const kept = teams.filter((t) => keep[t.id]?.on);
  const all = [...kept.map((t) => ({ name: t.name, tier: keep[t.id].tier })), ...added];
  const div1 = all.filter((t) => t.tier !== 3).length;
  const div2 = all.filter((t) => t.tier === 3).length;
  const stuck = !division2 && div2 > 0;

  function addTeam(e) {
    e.preventDefault();
    const name = draft.name.trim();
    if (!name) return;
    setAdded((cur) => [...cur, { key: `${Date.now()}`, name, tier: Number(draft.tier), color: draft.color }]);
    setDraft({ name: "", tier: draft.tier, color: "#64748b" });
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
    <select className="input w-full py-1.5 text-sm sm:w-36" value={value} onChange={onChange} aria-label={label}>
      {TIERS.map((t) => (
        <option key={t.value} value={t.value} disabled={t.value === 3 && !division2}>
          {t.label}
        </option>
      ))}
    </select>
  );

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
            Next to each team you pick where it races: <b className="text-dark">Tier 1</b>,{" "}
            <b className="text-dark">Tier 2</b> or <b className="text-dark">Division 2</b>. The Reserve pool comes
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

      <section className="rounded-xl border border-border bg-surface/40">
        <header className="flex items-center gap-2 border-b border-border px-3 py-2">
          <span className="flex-1 font-semibold text-dark">Teams from {source.name}</span>
          <span className="text-xs text-light">
            {kept.length} of {teams.length} carry on
          </span>
        </header>
        <ul className="divide-y divide-border">
          {teams.map((t) => {
            const k = keep[t.id] || { on: false, tier: t.tier };
            const id = `ct-${t.id}`;
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
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
                      {tierName(t.tier)} in {source.name} · {t.people.length} driver{t.people.length === 1 ? "" : "s"}
                    </span>
                  </span>
                </label>
                {k.on ? (
                  <div className="ml-auto w-full sm:w-auto">
                    {tierSelect(
                      k.tier,
                      (e) => setKeep((cur) => ({ ...cur, [t.id]: { ...k, tier: Number(e.target.value) } })),
                      `Where ${t.name} races`
                    )}
                  </div>
                ) : (
                  <span className="ml-auto text-xs text-light">Not copied</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-xl border border-border bg-surface/40">
        <header className="border-b border-border px-3 py-2 font-semibold text-dark">New teams</header>
        {added.length > 0 && (
          <ul className="divide-y divide-border">
            {added.map((n) => (
              <li key={n.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
                <TeamLogo name={n.name} color={n.color} size={28} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-dark">{n.name}</span>
                <div className="w-full sm:w-auto">
                  {tierSelect(
                    n.tier,
                    (e) => setAdded((cur) => cur.map((x) => (x.key === n.key ? { ...x, tier: Number(e.target.value) } : x))),
                    `Where ${n.name} races`
                  )}
                </div>
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
          </ul>
        )}
        <form onSubmit={addTeam} className="flex flex-wrap items-center gap-2 px-3 py-2">
          <input
            type="color"
            className="h-9 w-9 shrink-0 cursor-pointer rounded border border-border bg-transparent"
            value={draft.color}
            onChange={(e) => setDraft({ ...draft, color: e.target.value })}
            aria-label="Team colour"
          />
          <input
            className="input min-w-[10rem] flex-1 py-1.5 text-sm"
            placeholder="Team name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <div className="w-full sm:w-auto">
            {tierSelect(draft.tier, (e) => setDraft({ ...draft, tier: Number(e.target.value) }), "Where the new team races")}
          </div>
          <button type="submit" className="btn-secondary inline-flex items-center gap-1.5 py-1.5 text-sm" disabled={!draft.name.trim()}>
            <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            Add team
          </button>
        </form>
      </section>

      <div className="space-y-2 rounded-xl border border-border bg-surface/40 p-3">
        <p className="text-sm text-medium">
          <b className="text-dark">{all.length}</b> team{all.length === 1 ? "" : "s"} race in {target.name}:{" "}
          {div1} in Division 1{division2 ? `, ${div2} in Division 2` : ""}. Plus the Reserve pool.
        </p>
        {stuck && (
          <p className="text-sm text-bad">
            Some teams are set to Division 2 while Division 2 is off. Switch it on, or put them in Tier 1 or Tier 2.
          </p>
        )}
        <button type="button" className="btn-primary py-1.5 text-sm" disabled={busy || stuck || !all.length} onClick={save}>
          Create these teams
        </button>
      </div>
    </div>
  );
}
