import { useEffect, useRef, useState } from "react";
import { CheckSquare, Layers, Plus, X, Search } from "lucide-react";
import { api } from "../api/client.js";
import { Spinner, Notice, CheckField } from "./ui.jsx";
import TeamLogo from "./TeamLogo.jsx";

// ---------------------------------------------------------------------------
// "Which teams race?" Step 2 of the season wizard, before the drivers.
//
// Two separate parts, because they are separate championships:
//   * Division 1, with a box for Tier 1 and one for Tier 2. Last season's
//     teams start in the box of their old tier. "Races in" switches a team
//     between Tier 1 and Tier 2, and it jumps into the other box right away,
//     lit up for a moment.
//   * Division 2, its own box. It has the same teams as Division 1 (two Red
//     Bulls, one per division, each a team of its own), so it starts as a copy
//     of Division 1's list; untick the ones that do not race there. A season
//     that ran Division 2 already starts with its Division 2 teams instead.
// Every box has a team search over every team the league ever had (logo and
// colour come along), and a name nobody had before makes a new team.
// The Reserve pool always comes along. The drivers step then offers exactly
// these teams under "Drives for".
// ---------------------------------------------------------------------------

const TIER_LABEL = { 1: "Tier 1", 2: "Tier 2", 3: "Division 2" };
const byName = (a, b) => a.name.localeCompare(b.name);
const norm = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
let keySeq = 0;
const nextKey = () => `k${++keySeq}`;

// Type a name: matching teams from earlier seasons, or a new team.
function TeamSearch({ pastTeams, taken, placeholder, onPick, onCreate }) {
  const [q, setQ] = useState("");
  const [color, setColor] = useState("#64748b");
  const [open, setOpen] = useState(false);
  const query = q.trim();
  const hits = query
    ? pastTeams.filter((t) => norm(t.name).includes(norm(query)) && !taken.has(norm(t.name))).slice(0, 6)
    : [];
  const exact = hits.find((t) => norm(t.name) === norm(query));
  const isTaken = query && taken.has(norm(query));

  function pick(t) {
    onPick(t);
    setQ("");
    setOpen(false);
  }

  function submit(e) {
    e.preventDefault();
    if (!query || isTaken) return;
    if (exact) return pick(exact);
    onCreate(query, color);
    setQ("");
    setColor("#64748b");
    setOpen(false);
  }

  return (
    <form onSubmit={submit} className="relative px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-light" strokeWidth={2} aria-hidden="true" />
          <input
            className="input w-full py-1.5 pl-8 text-sm"
            placeholder={placeholder}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
          />
        </div>
        {query && !exact && !hits.length && !isTaken && (
          <input
            type="color"
            className="h-9 w-9 shrink-0 cursor-pointer rounded border border-border bg-transparent"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            aria-label="Colour of the new team"
            title="Colour of the new team"
          />
        )}
        <button type="submit" className="btn-secondary inline-flex items-center gap-1.5 py-1.5 text-sm" disabled={!query || isTaken}>
          <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          {exact || !query ? "Add" : hits.length ? "Add as new team" : "Add new team"}
        </button>
      </div>
      {isTaken && <p className="mt-1 text-xs text-light">{query} is in this box already.</p>}
      {open && query && hits.length > 0 && (
        <ul className="absolute left-3 right-3 z-20 mt-1 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
          {hits.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface2"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(t)}
              >
                <TeamLogo id={t.id} name={t.name} color={t.color} logoUrl={t.logoUrl} size={24} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-dark">{t.name}</span>
                <span className="text-xs text-light">last in Season {t.seasonNumber}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

export default function AdminCarryOverTeams({ target, source, run, busy }) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  // Division 1 rows: last season's teams and teams added by search.
  // { key, sourceId?, name, color, logoUrl, tier (1|2), on, was?, from?, isNew? }
  const [d1, setD1] = useState([]);
  // Division 2 rows, same shape (tier 3).
  const [d2, setD2] = useState([]);
  // On to start with, as the league wants it for new seasons. One click
  // turns it off for a season with a single field.
  const [division2, setDivision2] = useState(true);
  const [flash, setFlash] = useState(null);
  const flashTimer = useRef(null);
  const scrollTo = useRef(null);
  const rowRefs = useRef({});

  useEffect(() => {
    let live = true;
    api
      .carryOverPreview(target.id, source.id)
      .then((r) => {
        if (!live) return;
        const old = (r.teams || []).filter((t) => t.tier !== 0);
        const row = (t, extra) => ({
          key: nextKey(),
          sourceId: t.id,
          name: t.name,
          color: t.color,
          logoUrl: t.logoUrl,
          drivers: t.people?.length ?? null,
          on: true,
          ...extra,
        });
        const one = old.filter((t) => t.tier === 1 || t.tier === 2);
        const two = old.filter((t) => t.tier === 3);
        setD1(one.map((t) => row(t, { tier: t.tier, was: t.tier })));
        // Division 2 starts as last season's Division 2, or a copy of Division 1.
        setD2((two.length ? two : one).map((t) => row(t, { tier: 3, drivers: two.length ? t.people.length : null })));
        setData({ pastTeams: r.pastTeams || [] });
      })
      .catch((err) => live && setLoadError(err.message));
    return () => {
      live = false;
      clearTimeout(flashTimer.current);
    };
  }, [target.id, source.id]);

  useEffect(() => {
    if (!scrollTo.current) return;
    rowRefs.current[scrollTo.current]?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    scrollTo.current = null;
  });

  if (loadError) return <Notice kind="error">{loadError}</Notice>;
  if (!data) return <Spinner label={`Reading ${source.name}…`} />;

  const racing1 = d1.filter((t) => t.on);
  const racing2 = division2 ? d2.filter((t) => t.on) : [];
  const total = racing1.length + racing2.length;

  function lightUp(key, scroll) {
    clearTimeout(flashTimer.current);
    setFlash(key);
    if (scroll) scrollTo.current = key;
    flashTimer.current = setTimeout(() => setFlash(null), 1600);
  }

  const patch = (setter, key, p) => setter((cur) => cur.map((x) => (x.key === key ? { ...x, ...p } : x)));

  function addTo(setter, tier, t) {
    const key = nextKey();
    setter((cur) => [
      ...cur,
      t.isNew
        ? { key, name: t.name, color: t.color, tier, on: true, isNew: true }
        : { key, sourceId: t.id, name: t.name, color: t.color, logoUrl: t.logoUrl, tier, on: true, from: t.seasonNumber },
    ]);
    lightUp(key, true);
  }

  function save() {
    const asPlan = (list, tier) => list.filter((t) => t.on && !t.isNew).map((t) => ({ sourceId: t.sourceId, tier: tier ?? t.tier }));
    const asNew = (list, tier) => list.filter((t) => t.on && t.isNew).map((t) => ({ name: t.name, tier: tier ?? t.tier, color: t.color }));
    run(
      () =>
        api.carryOverTeams(target.id, source.id, {
          division2,
          teams: [...asPlan(d1), ...(division2 ? asPlan(d2, 3) : [])],
          newTeams: [...asNew(d1), ...(division2 ? asNew(d2, 3) : [])],
        }),
      (r) => `${r.teamsCreated} team(s) created in ${target.name}, Reserve pool included. Now the drivers.`
    );
  }

  const rowClass = (key) =>
    `flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 transition-colors duration-700 ${flash === key ? "bg-brand/15" : ""}`;

  // One team line. `setter` is the list it lives in; `tierPick` shows the
  // Tier 1 / Tier 2 switch (Division 1 only).
  const teamRow = (t, setter, tierPick) => {
    const id = `ct-${t.key}`;
    const sub = t.isNew
      ? "New team"
      : t.from
        ? `Back from Season ${t.from}`
        : t.was && t.was !== t.tier
          ? `Was ${TIER_LABEL[t.was]} in ${source.name}`
          : t.drivers != null
            ? `${t.drivers} driver${t.drivers === 1 ? "" : "s"} in ${source.name}`
            : "Same team as in Division 1";
    return (
      <li key={t.key} ref={(el) => (rowRefs.current[t.key] = el)} className={rowClass(t.key)}>
        <label htmlFor={id} className="flex min-w-[12rem] flex-1 cursor-pointer items-center gap-3">
          <input
            id={id}
            type="checkbox"
            className="h-5 w-5 shrink-0 accent-[var(--c-primary)]"
            checked={t.on}
            onChange={(e) => patch(setter, t.key, { on: e.target.checked })}
          />
          <TeamLogo id={t.sourceId} name={t.name} color={t.color || "#64748b"} logoUrl={t.logoUrl} size={28} />
          <span className="min-w-0">
            <span className={`block truncate text-sm font-semibold ${t.on ? "text-dark" : "text-light"}`}>{t.name}</span>
            <span className="block text-xs text-light">{sub}</span>
          </span>
        </label>
        {!t.on ? (
          <span className="ml-auto text-xs text-light">Not copied</span>
        ) : tierPick ? (
          <label className="ml-auto flex w-full items-center gap-2 text-xs text-light sm:w-auto">
            <span className="shrink-0">Races in</span>
            <select
              className="input min-w-0 flex-1 py-1.5 text-sm sm:w-32 sm:flex-none"
              value={t.tier}
              onChange={(e) => {
                patch(setter, t.key, { tier: Number(e.target.value) });
                lightUp(t.key, true);
              }}
              aria-label={`Where ${t.name} races`}
            >
              <option value={1}>Tier 1</option>
              <option value={2}>Tier 2</option>
            </select>
          </label>
        ) : null}
        {(t.isNew || t.from) && (
          <button
            type="button"
            className="text-light hover:text-dark"
            onClick={() => setter((cur) => cur.filter((x) => x.key !== t.key))}
            aria-label={`Remove ${t.name}`}
          >
            <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </li>
    );
  };

  const box = (title, sub, rows, search) => (
    <section className="rounded-xl border border-border bg-surface/40">
      <header className="flex flex-wrap items-baseline gap-x-2 border-b border-border bg-surface2/50 px-3 py-2">
        <span className="font-semibold text-dark">{title}</span>
        <span className="ml-auto text-xs text-light">{sub}</span>
      </header>
      <ul className="divide-y divide-border">
        {rows}
        {!rows.length && <li className="px-3 py-2 text-xs text-light">No team here yet. Search for one below.</li>}
        <li>{search}</li>
      </ul>
    </section>
  );

  const count = (n) => `${n} team${n === 1 ? "" : "s"} in ${target.name}`;
  const takenIn = (list) => new Set(list.filter((t) => t.on).map((t) => norm(t.name)));
  const searchFor = (setter, tier, taken, label) => (
    <TeamSearch
      pastTeams={data.pastTeams}
      taken={taken}
      placeholder={`Add a ${label} team: search old teams or type a new name`}
      onPick={(t) => addTo(setter, tier, t)}
      onCreate={(name, color) => addTo(setter, tier, { isNew: true, name, color })}
    />
  );

  const partHead = (title, text) => (
    <div className="pt-2">
      <h3 className="font-display text-base font-black uppercase tracking-wide text-dark">{title}</h3>
      {text && <p className="text-xs text-light">{text}</p>}
    </div>
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
            <b className="text-dark">Division 1</b> has Tier 1 and Tier 2: <b className="text-dark">Races in</b>{" "}
            moves a team between them. <b className="text-dark">Division 2</b> is a separate championship with its own
            copy of the teams. The Reserve pool comes along by itself. Drivers come in the next step.
          </span>
        </li>
      </ul>

      <CheckField
        checked={division2}
        onChange={(e) => setDivision2(e.target.checked)}
        label={`Run Division 2 in ${target.name}`}
        hint="A second field for newcomers on the second server, the same evening, with its own teams and standings."
      />

      {partHead("Division 1", null)}
      {[1, 2].map((tier) => {
        const here = d1.filter((t) => t.tier === tier).sort(byName);
        return (
          <div key={tier}>
            {box(
              TIER_LABEL[tier],
              count(here.filter((t) => t.on).length),
              here.map((t) => teamRow(t, setD1, true)),
              searchFor(setD1, tier, takenIn(d1), TIER_LABEL[tier])
            )}
          </div>
        );
      })}

      {division2 && (
        <>
          {partHead(
            "Division 2",
            "Starts with the same teams as Division 1, each a team of its own here. Untick the ones that do not race in Division 2."
          )}
          {box(
            "Division 2",
            count(racing2.length),
            [...d2].sort(byName).map((t) => teamRow(t, setD2, false)),
            searchFor(setD2, 3, takenIn(d2), "Division 2")
          )}
        </>
      )}

      <div className="space-y-2 rounded-xl border border-border bg-surface/40 p-3">
        <p className="text-sm text-medium">
          <b className="text-dark">{total}</b> team{total === 1 ? "" : "s"} race in {target.name}:{" "}
          {racing1.filter((t) => t.tier === 1).length} in Tier 1, {racing1.filter((t) => t.tier === 2).length} in Tier 2
          {division2 ? `, ${racing2.length} in Division 2` : ""}. Plus the Reserve pool.
        </p>
        <button type="button" className="btn-primary py-1.5 text-sm" disabled={busy || !total} onClick={save}>
          Create these teams
        </button>
      </div>
    </div>
  );
}
