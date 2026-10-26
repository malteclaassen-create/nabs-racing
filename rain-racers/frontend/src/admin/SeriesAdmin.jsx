import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useSite } from "../site.jsx";
import { useScope } from "./scope.jsx";
import { useAdminList, useAction, Message, Section, Field, PictureField, confirmDelete } from "./common.jsx";

const blankSeries = { name: "", slug: "", color: "#e10600", schedule: "", description: "", liveWsUrl: "", liveOrigin: "", order: 0 };

function SeriesForm({ initial, onSubmit, submitLabel, busy, onCancel, isNew, children }) {
  const [f, setF] = useState(initial);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  return (
    <form
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(f);
      }}
    >
      <Field label="Name">
        <input className="input" placeholder="RX8 Cup" value={f.name} onChange={set("name")} />
      </Field>
      <Field label="Address (/series/…)">
        <input className="input font-mono text-xs" placeholder="from the name" value={f.slug} onChange={set("slug")} />
      </Field>
      <Field label="Colour">
        <div className="flex items-center gap-2">
          <input type="color" className="h-9 w-11 cursor-pointer rounded border border-line bg-bg" value={f.color || "#ffffff"} onChange={set("color")} />
          <input className="input font-mono" value={f.color || ""} onChange={set("color")} />
        </div>
      </Field>
      <Field label="Schedule">
        <input className="input" placeholder="Sundays 19:00 CET" value={f.schedule ?? ""} onChange={set("schedule")} />
      </Field>
      <Field label="Description" className="sm:col-span-2">
        <input className="input" placeholder="The rotary on short and wacky circuits" value={f.description ?? ""} onChange={set("description")} />
      </Field>
      {isNew ? (
        <Field label="First season">
          <input className="input" placeholder={`Season ${new Date().getFullYear()}`} value={f.seasonName ?? ""} onChange={set("seasonName")} />
        </Field>
      ) : (
        <Field label="Order in the menu">
          <input className="input" type="number" value={f.order} onChange={set("order")} />
        </Field>
      )}
      {isNew ? (
        <div />
      ) : (
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={!!f.archived} onChange={set("archived")} />
          Archived (no longer runs)
        </label>
      )}
      <Field label="Live socket of this series' server (optional)" className="sm:col-span-2">
        <input className="input font-mono text-xs" placeholder="wss://…/api/race-control" value={f.liveWsUrl ?? ""} onChange={set("liveWsUrl")} />
      </Field>
      <Field label="Origin (optional)">
        <input className="input font-mono text-xs" placeholder="https://…" value={f.liveOrigin ?? ""} onChange={set("liveOrigin")} />
      </Field>
      {children && <div className="sm:col-span-2 lg:col-span-4">{children}</div>}
      <div className="flex items-end gap-2">
        <button className="btn-accent whitespace-nowrap" disabled={busy || !f.name.trim()}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function SeriesList() {
  const { reload: reloadSite } = useSite();
  const { series, reloadSeries, setSeriesId } = useScope();
  const { busy, message, run } = useAction();
  const [editing, setEditing] = useState(null);
  const [formKey, setFormKey] = useState(0);
  const done = async () => {
    await reloadSeries();
    reloadSite();
  };

  return (
    <div className="space-y-6">
      <Section title="New series">
        <p className="mb-4 text-sm text-muted">One championship the league runs, e.g. RX8 Cup or DTM 2002. It gets its own teams, seasons, calendar and standings.</p>
        <SeriesForm
          key={formKey}
          isNew
          initial={blankSeries}
          busy={busy}
          submitLabel="Create series"
          onSubmit={async (f) => {
            const created = await run(() => api.post("/admin/series", f), "Series created.");
            if (created) {
              setFormKey((k) => k + 1);
              await done();
              setSeriesId(created.id);
            }
          }}
        />
        <div className="mt-3">
          <Message message={message} />
        </div>
      </Section>
      <Section title="Series">
        <ul className="divide-y divide-line">
          {series.map((s) =>
            editing === s.id ? (
              <li key={s.id} className="py-4">
                <SeriesForm
                  initial={{ ...blankSeries, ...s, color: s.color || "#ffffff" }}
                  busy={busy}
                  submitLabel="Save"
                  onCancel={() => setEditing(null)}
                  onSubmit={async (f) => {
                    if (await run(() => api.put(`/admin/series/${s.id}`, f), "Saved.")) {
                      setEditing(null);
                      done();
                    }
                  }}
                >
                  <PictureField
                    label="Banner of the series"
                    url={s.imageUrl}
                    endpoint={`/admin/series/${s.id}/image`}
                    onChange={done}
                    hint="Optional: without one, the current season's banner is used."
                  />
                </SeriesForm>
              </li>
            ) : (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <span className="h-4 w-4 rounded-full" style={{ background: s.color || "#fff" }} />
                <span className="font-bold">{s.name}</span>
                <span className="font-mono text-xs text-muted">/series/{s.slug}</span>
                {s.schedule && <span className="text-muted">{s.schedule}</span>}
                <span className="text-xs text-muted">
                  {s._count.seasons} seasons · {s._count.teams} teams
                </span>
                {s.liveWsUrl && <span className="text-xs text-emerald-400">live server set</span>}
                {s.archived && <span className="rounded-full border border-line px-2 py-0.5 text-[10px] font-black uppercase text-muted">archived</span>}
                <div className="ml-auto flex gap-2">
                  <button className="btn-ghost py-1" onClick={() => setEditing(s.id)}>
                    Edit
                  </button>
                  <button
                    className="btn-danger py-1"
                    onClick={() => confirmDelete(`the series "${s.name}" with all its seasons, races, results and teams`) && run(() => api.del(`/admin/series/${s.id}`)).then(done)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ),
          )}
          {series.length === 0 && <li className="py-3 text-sm text-muted">No series yet.</li>}
        </ul>
      </Section>
    </div>
  );
}

function Seasons() {
  const { reload: reloadSite } = useSite();
  const { currentSeries, seasons, reloadSeasons, setSeasonId } = useScope();
  const { busy, message, run } = useAction();
  const [name, setName] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  if (!currentSeries) return null;
  const done = async () => {
    await reloadSeasons();
    reloadSite();
  };

  return (
    <Section title={`Seasons of ${currentSeries.name}`}>
      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const created = await run(() => api.post("/admin/seasons", { seriesId: currentSeries.id, name, copyEntriesFrom: copyFrom || null }), "Season created.");
          if (created) {
            setName("");
            await done();
            setSeasonId(created.id);
          }
        }}
      >
        <Field label="New season">
          <input className="input w-48" placeholder="Season 2027" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {seasons.length > 0 && (
          <Field label="Entry list taken over from">
            <select className="input w-56" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
              <option value="">Start empty</option>
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <button className="btn-accent" disabled={busy || !name.trim()}>
          Create
        </button>
      </form>
      <Message message={message} />
      <ul className="divide-y divide-line">
        {seasons.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
            <input
              className="input max-w-xs"
              defaultValue={s.name}
              onBlur={(e) => e.target.value !== s.name && run(() => api.put(`/admin/seasons/${s.id}`, { name: e.target.value }), "Saved.").then(done)}
            />
            <span className="text-xs text-muted">
              {s._count.races} races · {s._count.entries} entries
            </span>
            {s.isCurrent ? (
              <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-black uppercase text-accent-ink">Current</span>
            ) : (
              <button className="btn-ghost py-1" onClick={() => run(() => api.put(`/admin/seasons/${s.id}`, { isCurrent: true }), "Current season set.").then(done)}>
                Make current
              </button>
            )}
            <button
              className="btn-danger ml-auto py-1"
              onClick={() => confirmDelete(`"${s.name}" with all its races and results`) && run(() => api.del(`/admin/seasons/${s.id}`)).then(done)}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

const listText = (t) => (Array.isArray(t) ? t.join(", ") : "");

// The tables of rounds with 2, 3 or 4 races, as the form edits them: one
// table for every race, or (ticked) one per race.
function raceTablesForm(json) {
  let all = {};
  try {
    all = JSON.parse(json || "{}") || {};
  } catch {
    all = {};
  }
  const out = {};
  for (const n of [2, 3, 4]) {
    const v = all[n];
    const perRace = Array.isArray(v) && v.some((x) => x === null || Array.isArray(x));
    out[n] = { perRace, all: perRace ? "" : listText(v), races: Array.from({ length: n }, (_, i) => (perRace ? listText(v[i]) : "")) };
  }
  return out;
}

// The season being worked on: its words and banner, and its points rules.
function Rules() {
  const { currentSeason, reloadSeasons } = useScope();
  const { reload: reloadSite } = useSite();
  const { data: entryData } = useAdminList(currentSeason ? `/admin/seasons/${currentSeason.id}/entries` : null);
  const { busy, message, run } = useAction();
  const [f, setF] = useState(null);
  useEffect(() => {
    if (!currentSeason) return setF(null);
    const list = (j) => (j ? JSON.parse(j).join(", ") : "");
    setF({
      description: currentSeason.description ?? "",
      pointsMode: currentSeason.pointsMode || "TABLE",
      pointsTable: list(currentSeason.pointsTable),
      raceTables: raceTablesForm(currentSeason.raceTables),
      qualiPointsTable: list(currentSeason.qualiPointsTable),
      dropWorst: currentSeason.dropWorst,
      championId: currentSeason.championId ?? "",
      championNote: currentSeason.championNote ?? "",
    });
  }, [currentSeason]);
  if (!currentSeason || !f) return null;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setTables = (n, patch) => setF({ ...f, raceTables: { ...f.raceTables, [n]: { ...f.raceTables[n], ...patch } } });
  const reverse = f.pointsMode === "REVERSE";

  return (
    <Section title={`Season · ${currentSeason.name}`}>
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const raceTables = Object.fromEntries(Object.entries(f.raceTables).map(([n, t]) => [n, t.perRace ? t.races : t.all]));
          if (await run(() => api.put(`/admin/seasons/${currentSeason.id}`, { ...f, raceTables }), "Saved.")) {
            reloadSeasons();
            reloadSite();
          }
        }}
      >
        <Field label="About the season (shown on the series page)" className="sm:col-span-2">
          <textarea className="input" rows={3} value={f.description} onChange={set("description")} />
        </Field>
        <div className="sm:col-span-2">
          <PictureField
            label="Banner of the season"
            url={currentSeason.imageUrl}
            endpoint={`/admin/seasons/${currentSeason.id}/image`}
            onChange={() => {
              reloadSeasons();
              reloadSite();
            }}
            hint="Shown on the home page, the series page and in the history; rounds without a poster of their own fall back to it."
          />
        </div>
        <Field label="How races score" className="sm:col-span-2">
          <select className="input" value={f.pointsMode} onChange={set("pointsMode")}>
            <option value="TABLE">From the points tables</option>
            <option value="REVERSE">Back to front: the last classified driver gets 1, the one ahead 2, …</option>
          </select>
        </Field>
        {!reverse && (
          <>
            <Field label="Points for P1, P2, … of a single race (empty = the league's table)" className="sm:col-span-2">
              <input className="input font-mono" placeholder="50, 40, 35, 32, 30, 28, 26, 24, 22, 20" value={f.pointsTable} onChange={set("pointsTable")} />
            </Field>
            {[2, 3, 4].map((n) => {
              const t = f.raceTables[n];
              return (
                <div key={n} className="rounded-xl border border-line p-3 sm:col-span-2">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="label mb-0">Rounds with {n} races (empty = the table above)</span>
                    <label className="flex items-center gap-2 text-xs text-muted">
                      <input type="checkbox" checked={t.perRace} onChange={(e) => setTables(n, { perRace: e.target.checked })} />
                      own table per race (e.g. a sprint and a feature)
                    </label>
                  </div>
                  {t.perRace ? (
                    <div className="grid gap-2">
                      {t.races.map((v, i) => (
                        <input
                          key={i}
                          className="input font-mono"
                          placeholder={`Race ${i + 1}`}
                          value={v}
                          onChange={(e) => setTables(n, { races: t.races.map((x, j) => (j === i ? e.target.value : x)) })}
                        />
                      ))}
                    </div>
                  ) : (
                    <input className="input font-mono" placeholder={n === 2 ? "35, 29, 24, 21, 19, …" : "20, 17, 15, 13, 11, …"} value={t.all} onChange={(e) => setTables(n, { all: e.target.value })} />
                  )}
                </div>
              );
            })}
          </>
        )}
        <Field label="Qualifying points for P1, P2, … (empty = none)">
          <input className="input font-mono" placeholder="10, 8, 7, 6, 5, 4, 3, 2, 1, 1" value={f.qualiPointsTable} onChange={set("qualiPointsTable")} />
        </Field>
        <Field label="Drop each driver's worst rounds (raced ones, as the season ends)">
          <input className="input" type="number" min="0" max="20" value={f.dropWorst} onChange={set("dropWorst")} />
        </Field>
        <Field label="Champion named by hand (empty = whoever leads on points)">
          <select className="input" value={f.championId} onChange={set("championId")}>
            <option value="">By points</option>
            {(entryData?.entries || []).map((e) => (
              <option key={e.driverId} value={e.driverId}>
                {e.driver.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Note shown with the champion">
          <input className="input" placeholder="Title decided by the stewards' ruling" value={f.championNote} onChange={set("championNote")} />
        </Field>
        <div className="flex items-center gap-3 sm:col-span-2">
          <button className="btn-accent" disabled={busy}>
            Save season
          </button>
          <Message message={message} />
        </div>
      </form>
      <p className="mt-3 text-xs text-muted">A single round can have its own points table too (Races &amp; results → Edit), e.g. a finale.</p>
      <ManualPoints season={currentSeason} entries={entryData?.entries || []} />
    </Section>
  );
}

function ManualPoints({ season, entries }) {
  const { data, reload } = useAdminList(`/admin/seasons/${season.id}/manual`);
  const { busy, message, run } = useAction();
  const [f, setF] = useState({ driverId: "", points: "", note: "" });
  return (
    <div className="mt-8 border-t border-line pt-6">
      <h3 className="h2 mb-1 text-base">Manual points</h3>
      <p className="mb-4 text-sm text-muted">For what the results cannot show: a pole award, laps led, a stewards' deduction (negative), or a total from an old sheet. Driver standings only, marked M.</p>
      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => api.post(`/admin/seasons/${season.id}/manual`, f), "Added.")) {
            setF({ driverId: "", points: "", note: "" });
            reload();
          }
        }}
      >
        <Field label="Driver">
          <select className="input w-48" value={f.driverId} onChange={(e) => setF({ ...f, driverId: e.target.value })}>
            <option value="">Pick…</option>
            {entries.map((e) => (
              <option key={e.driverId} value={e.driverId}>
                {e.driver.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Points">
          <input className="input w-24" type="number" step="0.5" value={f.points} onChange={(e) => setF({ ...f, points: e.target.value })} />
        </Field>
        <Field label="Why">
          <input className="input w-64" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
        <button className="btn-accent" disabled={busy || !f.driverId || f.points === ""}>
          Add
        </button>
      </form>
      <Message message={message} />
      <ul className="divide-y divide-line text-sm">
        {data?.map((m) => (
          <li key={m.id} className="flex items-center gap-3 py-2">
            <span className="font-semibold">{m.driver.name}</span>
            <span className={`font-black tabular ${m.points < 0 ? "text-red-300" : "text-emerald-400"}`}>
              {m.points > 0 ? "+" : ""}
              {m.points}
            </span>
            <span className="text-muted">{m.note}</span>
            <button className="btn-danger ml-auto py-1" onClick={() => run(() => api.del(`/admin/manual/${m.id}`)).then(reload)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function SeriesAdmin() {
  return (
    <div className="space-y-6">
      <SeriesList />
      <Seasons />
      <Rules />
    </div>
  );
}
