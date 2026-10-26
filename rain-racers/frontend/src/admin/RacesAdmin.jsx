import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useSite } from "../site.jsx";
import { lapTime, raceTime, dateTime } from "../format.js";
import { useAdminList, useAction, Message, Section, Field, confirmDelete, toLocalInput } from "./common.jsx";

const STATUSES = ["FIN", "DNF", "DSQ", "DNS"];

function RaceForm({ initial, onSubmit, submitLabel, busy, onCancel }) {
  const [f, setF] = useState(initial);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form
      className="grid gap-3 sm:grid-cols-[70px_2fr_1.5fr_1.6fr_80px]"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ ...f, startsAt: f.startsAt ? new Date(f.startsAt).toISOString() : null });
      }}
    >
      <Field label="Round">
        <input className="input" inputMode="numeric" value={f.round} onChange={set("round")} />
      </Field>
      <Field label="Name">
        <input className="input" placeholder="Spa 2 Hours" value={f.name} onChange={set("name")} />
      </Field>
      <Field label="Track">
        <input className="input" placeholder="Spa-Francorchamps" value={f.track} onChange={set("track")} />
      </Field>
      <Field label="Start (your local time)">
        <input className="input" type="datetime-local" value={f.startsAt} onChange={set("startsAt")} />
      </Field>
      <Field label="Points ×">
        <input className="input" type="number" min="0" step="0.5" value={f.pointsMultiplier} onChange={set("pointsMultiplier")} />
      </Field>
      <Field label="Notes (shown on the race page)" className="sm:col-span-4">
        <textarea className="input min-h-[42px]" rows={1} value={f.notes} onChange={set("notes")} />
      </Field>
      <div className="flex items-end gap-2">
        <button className="btn-accent whitespace-nowrap" disabled={busy || !f.name.trim() || !f.startsAt}>
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

// Reads an AC result file, shows who is who, and saves it once checked.
function Importer({ race, drivers, teams, onDone }) {
  const [preview, setPreview] = useState(null);
  const { busy, message, run, setMessage } = useAction();

  async function readFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPreview(null);
    let json;
    try {
      json = JSON.parse(await file.text());
    } catch {
      setMessage({ ok: false, text: "That file is not JSON. Pick the *_RACE.json from the server's results folder." });
      return;
    }
    const p = await run(() => api.post(`/admin/races/${race.id}/import/preview`, { file: json }));
    if (p) {
      setPreview(p);
      if (p.type !== "RACE") setMessage({ ok: false, text: `Careful: this is a ${p.type} file, not a race.` });
    }
  }

  const update = (i, patch) => setPreview({ ...preview, rows: preview.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const move = (i, dir) => {
    const rows = [...preview.rows];
    const [row] = rows.splice(i, 1);
    rows.splice(i + dir, 0, row);
    setPreview({ ...preview, rows });
  };

  async function save() {
    if (preview.replaces && !window.confirm(`This race already has ${preview.replaces} results. Replace them?`)) return;
    const ok = await run(() => api.post(`/admin/races/${race.id}/import`, { rows: preview.rows }), "Results saved.");
    if (ok) {
      setPreview(null);
      onDone();
    }
  }

  return (
    <div className="space-y-4">
      <label className="btn-ghost cursor-pointer">
        {preview ? "Pick another file" : "Import result file (.json)"}
        <input type="file" accept=".json,application/json" className="hidden" onChange={readFile} />
      </label>
      <Message message={message} />
      {preview && (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            {preview.track && <>Track in the file: <b className="text-ink">{preview.track}</b>. </>}
            Check the drivers and teams, fix the order if needed, then save.
          </p>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="table">
              <thead>
                <tr>
                  <th>Pos</th>
                  <th>In the file</th>
                  <th>Book on driver</th>
                  <th>Team</th>
                  <th>Status</th>
                  <th className="text-right">Laps</th>
                  <th className="text-right">Time</th>
                  <th className="text-right">Best</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={`${r.guid}-${r.name}`}>
                    <td className="font-black">{i + 1}</td>
                    <td>
                      <div className="font-semibold">{r.name}</div>
                      <div className="text-xs text-muted">{r.team || ""}</div>
                    </td>
                    <td>
                      <select className="input w-48" value={r.driverId ?? ""} onChange={(e) => update(i, { driverId: e.target.value ? Number(e.target.value) : null })}>
                        <option value="">+ New driver "{r.name}"</option>
                        {drivers.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                      {r.matchedBy && <div className="mt-0.5 text-[10px] uppercase text-muted">matched by {r.matchedBy === "steam" ? "Steam id" : "name"}</div>}
                    </td>
                    <td>
                      <select className="input w-40" value={r.teamId ?? ""} onChange={(e) => update(i, { teamId: e.target.value ? Number(e.target.value) : null })}>
                        <option value="">No team</option>
                        {teams.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select className="input w-20" value={r.status} onChange={(e) => update(i, { status: e.target.value })}>
                        {STATUSES.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                    <td className="text-right tabular">{r.laps}</td>
                    <td className="text-right font-mono text-xs">{raceTime(r.totalTimeMs)}</td>
                    <td className="text-right font-mono text-xs">{lapTime(r.bestLapMs)}</td>
                    <td className="whitespace-nowrap">
                      <button className="px-1 text-muted hover:text-ink disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                        ▲
                      </button>
                      <button className="px-1 text-muted hover:text-ink disabled:opacity-30" disabled={i === preview.rows.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                        ▼
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-3">
            <button className="btn-accent" disabled={busy} onClick={save}>
              Save {preview.rows.length} results
            </button>
            <button className="btn-ghost" onClick={() => setPreview(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// The saved results of a race: status, team, penalties and the order.
function ResultsEditor({ race, teams, onChange }) {
  const { data, reload } = useAdminList(`/admin/races/${race.id}/results`);
  const { busy, message, run } = useAction();
  const done = () => reload().then(onChange);

  const move = async (i, dir) => {
    const order = data.map((r) => r.id);
    const [id] = order.splice(i, 1);
    order.splice(i + dir, 0, id);
    await run(() => api.put(`/admin/races/${race.id}/order`, { order }));
    done();
  };
  const patch = (r, body) => run(() => api.put(`/admin/results/${r.id}`, body), "Saved.").then(done);

  if (!data?.length) return null;
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="table">
          <thead>
            <tr>
              <th>Pos</th>
              <th>Driver</th>
              <th>Team</th>
              <th>Status</th>
              <th className="text-right">Laps</th>
              <th className="text-right">Best</th>
              <th>Penalty / bonus pts</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((r, i) => (
              <tr key={r.id}>
                <td className="font-black">{r.position}</td>
                <td className="font-semibold">{r.driver.name}</td>
                <td>
                  <select className="input w-40" value={r.teamId ?? ""} onChange={(e) => patch(r, { teamId: e.target.value || null })}>
                    <option value="">No team</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select className="input w-20" value={r.status} onChange={(e) => patch(r, { status: e.target.value })}>
                    {STATUSES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </td>
                <td className="text-right tabular">{r.laps}</td>
                <td className="text-right font-mono text-xs">{lapTime(r.bestLapMs)}</td>
                <td>
                  <input
                    className="input w-20"
                    type="number"
                    step="0.5"
                    defaultValue={r.pointsAdjust}
                    onBlur={(e) => Number(e.target.value) !== r.pointsAdjust && patch(r, { pointsAdjust: e.target.value })}
                  />
                </td>
                <td className="whitespace-nowrap">
                  <button className="px-1 text-muted hover:text-ink disabled:opacity-30" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                    ▲
                  </button>
                  <button className="px-1 text-muted hover:text-ink disabled:opacity-30" disabled={busy || i === data.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                    ▼
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3">
        <button
          className="btn-danger"
          onClick={() => confirmDelete(`all results of "${race.name}"`) && run(() => api.del(`/admin/races/${race.id}/results`)).then(done)}
        >
          Delete results
        </button>
        <Message message={message} />
      </div>
    </div>
  );
}

function RaceItem({ race, drivers, teams, reload }) {
  const [mode, setMode] = useState(null); // null | "edit" | "results"
  const { busy, message, run } = useAction();
  const hasResults = race._count.results > 0;

  return (
    <li className="py-4">
      {mode === "edit" ? (
        <RaceForm
          initial={{
            round: race.round,
            name: race.name,
            track: race.track,
            startsAt: toLocalInput(race.startsAt),
            pointsMultiplier: race.pointsMultiplier,
            notes: race.notes ?? "",
          }}
          busy={busy}
          submitLabel="Save"
          onCancel={() => setMode(null)}
          onSubmit={async (f) => {
            if (await run(() => api.put(`/admin/races/${race.id}`, f), "Saved.")) {
              setMode(null);
              reload();
            }
          }}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="w-10 font-black text-muted">R{race.round}</span>
          <div className="min-w-0">
            <Link to={`/races/${race.id}`} className="font-semibold hover:opacity-70">
              {race.name}
            </Link>
            <div className="text-xs text-muted">
              {race.track} · {dateTime(race.startsAt)}
              {race.pointsMultiplier !== 1 && ` · ×${race.pointsMultiplier} points`}
            </div>
          </div>
          <span className={`text-xs font-bold ${hasResults ? "text-emerald-400" : "text-muted"}`}>
            {hasResults ? `${race._count.results} results` : `${race._count.signups} sign-ups`}
          </span>
          <div className="ml-auto flex gap-2">
            <button className={mode === "results" ? "btn-accent py-1" : "btn-ghost py-1"} onClick={() => setMode(mode === "results" ? null : "results")}>
              Results
            </button>
            <button className="btn-ghost py-1" onClick={() => setMode("edit")}>
              Edit
            </button>
            <button
              className="btn-danger py-1"
              onClick={() => confirmDelete(`"${race.name}" with its results and sign-ups`) && run(() => api.del(`/admin/races/${race.id}`)).then(reload)}
            >
              Delete
            </button>
          </div>
        </div>
      )}
      <Message message={message} />
      {mode === "results" && (
        <div className="mt-4 space-y-4 rounded-xl bg-bg p-4">
          {/* keyed on the import time, so a fresh import shows at once */}
          <ResultsEditor key={race.importedAt || "none"} race={race} teams={teams} onChange={reload} />
          <Importer race={race} drivers={drivers} teams={teams} onDone={reload} />
        </div>
      )}
    </li>
  );
}

export default function RacesAdmin() {
  const { seasons, reload: reloadSite } = useSite();
  const [seasonId, setSeasonId] = useState(null);
  useEffect(() => {
    if (!seasonId && seasons.length) setSeasonId((seasons.find((s) => s.isCurrent) || seasons[0]).id);
  }, [seasons, seasonId]);
  const { data: races, reload } = useAdminList(seasonId ? `/admin/races?season=${seasonId}` : null);
  const { data: drivers, reload: reloadDrivers } = useAdminList("/admin/drivers");
  const { data: teams } = useAdminList("/admin/teams");
  const { busy, message, run } = useAction();
  const [formKey, setFormKey] = useState(0);
  const activeTeams = (teams || []).filter((t) => !t.archived);
  const refresh = () => {
    reload();
    reloadDrivers();
  };

  if (!seasons.length) {
    return (
      <Section title="Start here">
        <p className="text-sm text-muted">
          There is no season yet. Create one under <Link to="/admin/seasons" className="text-accent">Seasons</Link>, then add the races here.
        </p>
        <button className="btn-ghost mt-4" onClick={reloadSite}>
          Reload
        </button>
      </Section>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className="label mb-0">Season</span>
        <select className="input w-auto" value={seasonId ?? ""} onChange={(e) => setSeasonId(Number(e.target.value))}>
          {seasons.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <Section title="New race">
        <RaceForm
          key={`${formKey}-${races?.length ?? 0}`}
          initial={{ round: (races?.length ?? 0) + 1, name: "", track: "", startsAt: "", pointsMultiplier: 1, notes: "" }}
          busy={busy}
          submitLabel="Add race"
          onSubmit={async (f) => {
            if (await run(() => api.post("/admin/races", { ...f, seasonId }), "Race added.")) {
              setFormKey((k) => k + 1);
              reload();
            }
          }}
        />
        <div className="mt-3">
          <Message message={message} />
        </div>
      </Section>
      <Section title="Calendar">
        <ul className="divide-y divide-line">
          {races?.map((r) => (
            <RaceItem key={r.id} race={r} drivers={drivers || []} teams={activeTeams} reload={refresh} />
          ))}
          {races?.length === 0 && <li className="py-3 text-sm text-muted">No races in this season yet.</li>}
        </ul>
      </Section>
    </div>
  );
}
