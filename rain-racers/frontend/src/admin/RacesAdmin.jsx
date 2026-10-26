import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { lapTime, raceTime, dateTime } from "../format.js";
import { useScope } from "./scope.jsx";
import { useAdminList, useAction, Message, Section, Field, PictureField, confirmDelete, toLocalInput } from "./common.jsx";

const STATUSES = ["FIN", "DNF", "DSQ", "DNS"];
// "R1" -> "Race 1", "QUALIFY" -> "Qualifying"
const sessionLabel = (s, race) => (s === "QUALIFY" ? "Qualifying" : race?.raceCount > 1 ? `Race ${s.slice(1)}` : "Race");

// The day's sessions: label, start and length, one row each.
function TimetableEditor({ rows, onChange, startsAt }) {
  const set = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <input className="input w-32" placeholder="Qualifying" value={r.label} onChange={(e) => set(i, { label: e.target.value })} />
          <input className="input w-52" type="datetime-local" value={r.at} onChange={(e) => set(i, { at: e.target.value })} />
          <input className="input w-28" placeholder="15 min" value={r.length} onChange={(e) => set(i, { length: e.target.value })} />
          <button type="button" className="text-muted hover:text-red-300" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove">
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn-ghost py-1.5"
        onClick={() => onChange([...rows, { label: rows.length ? "" : "Qualifying", at: rows.at(-1)?.at || startsAt || "", length: "" }])}
      >
        + Session
      </button>
    </div>
  );
}

function RaceForm({ initial, onSubmit, submitLabel, busy, onCancel, children }) {
  const [f, setF] = useState(initial);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  return (
    <form
      className="grid gap-3 sm:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        const iso = (v) => (v ? new Date(v).toISOString() : null);
        onSubmit({ ...f, startsAt: iso(f.startsAt), timetable: f.timetable.map((t) => ({ ...t, at: iso(t.at) })) });
      }}
    >
      <Field label="Round">
        <input className="input" inputMode="numeric" value={f.round} onChange={set("round")} />
      </Field>
      <Field label="Name" className="sm:col-span-3">
        <input className="input" placeholder="Frikandelle Frenzy" value={f.name} onChange={set("name")} />
      </Field>
      <Field label="Start of race 1 (your time)" className="sm:col-span-2">
        <input className="input" type="datetime-local" value={f.startsAt} onChange={set("startsAt")} />
      </Field>
      <Field label="Track" className="sm:col-span-2">
        <input className="input" placeholder="Tucuru Motorplex" value={f.track} onChange={set("track")} />
      </Field>
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input type="checkbox" checked={!!f.mysteryTrack} onChange={set("mysteryTrack")} />
        Mystery track
      </label>
      <Field label="Car" className="sm:col-span-2">
        <input className="input" placeholder="Mazda RX-8 Cup" value={f.car} onChange={set("car")} />
      </Field>
      <Field label="Races">
        <select className="input" value={f.raceCount} onChange={set("raceCount")}>
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? "race" : "races"}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Points ×">
        <input className="input" type="number" min="0" step="0.5" value={f.pointsMultiplier} onChange={set("pointsMultiplier")} />
      </Field>
      <Field label="This round's own points for every race (empty = the season's)" className="sm:col-span-3">
        <input className="input font-mono" placeholder="e.g. 75, 60, 53, 48" value={f.pointsTable} onChange={set("pointsTable")} />
      </Field>
      <Field label="Recording (YouTube link)" className="sm:col-span-3">
        <input className="input" placeholder="https://www.youtube.com/watch?v=..." value={f.videoUrl} onChange={set("videoUrl")} />
      </Field>
      <div className="sm:col-span-6">
        <span className="label">Timetable of the day (optional)</span>
        <TimetableEditor rows={f.timetable} onChange={(timetable) => setF({ ...f, timetable })} startsAt={f.startsAt} />
      </div>
      <Field label="Notes (shown on the race page)" className="sm:col-span-6">
        <textarea className="input min-h-[42px]" rows={2} value={f.notes} onChange={set("notes")} />
      </Field>
      {children && <div className="sm:col-span-6">{children}</div>}
      <div className="flex items-end gap-2 sm:col-span-6">
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

const EMPTY_RACE = { name: "", track: "", mysteryTrack: false, car: "", startsAt: "", raceCount: 1, pointsMultiplier: 1, pointsTable: "", videoUrl: "", timetable: [], notes: "" };

const moveIn = (list, i, dir) => {
  const next = [...list];
  const [row] = next.splice(i, 1);
  next.splice(i + dir, 0, row);
  return next;
};

function Arrows({ i, n, onMove, disabled }) {
  return (
    <span className="whitespace-nowrap">
      <button type="button" className="px-1 text-muted hover:text-ink disabled:opacity-30" disabled={disabled || i === 0} onClick={() => onMove(i, -1)} aria-label="Move up">
        ▲
      </button>
      <button type="button" className="px-1 text-muted hover:text-ink disabled:opacity-30" disabled={disabled || i === n - 1} onClick={() => onMove(i, 1)} aria-label="Move down">
        ▼
      </button>
    </span>
  );
}

// Reads an AC result file, shows who is who, and saves it once checked.
function Importer({ race, session, drivers, teams, onDone }) {
  const [preview, setPreview] = useState(null);
  const { busy, message, run, setMessage } = useAction();
  const wantType = session === "QUALIFY" ? "QUALIFY" : "RACE";

  async function readFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPreview(null);
    let json;
    try {
      json = JSON.parse(await file.text());
    } catch {
      setMessage({ ok: false, text: "That file is not JSON. Pick the result file from the server's results folder." });
      return;
    }
    const p = await run(() => api.post(`/admin/races/${race.id}/import/preview`, { file: json, session }));
    if (p) {
      setPreview(p);
      if (p.type !== wantType) setMessage({ ok: false, text: `Careful: this is a ${p.type} file, and you are importing the ${sessionLabel(session, race).toLowerCase()}.` });
    }
  }

  const update = (i, patch) => setPreview({ ...preview, rows: preview.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  async function save() {
    if (preview.replaces && !window.confirm(`The ${sessionLabel(session, race).toLowerCase()} already has ${preview.replaces} rows. Replace them?`)) return;
    const ok = await run(() => api.post(`/admin/races/${race.id}/import`, { session, rows: preview.rows }), "Saved.");
    if (ok) {
      setPreview(null);
      onDone();
    }
  }

  return (
    <div className="space-y-3">
      <label className="btn-ghost cursor-pointer">
        {preview ? "Pick another file" : `Import ${session === "QUALIFY" ? "*_QUALIFY.json" : "*_RACE.json"}`}
        <input type="file" accept=".json,application/json" className="hidden" onChange={readFile} />
      </label>
      <Message message={message} />
      {preview && (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            {preview.track && (
              <>
                Track in the file: <b className="text-ink">{preview.track}</b>.{" "}
              </>
            )}
            Check who is who, fix the order if needed, then save. Drivers on the entry list race for their team of this round.
          </p>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="table">
              <thead>
                <tr>
                  <th>Pos</th>
                  <th>In the file</th>
                  <th>Book on driver</th>
                  <th>Team</th>
                  {session !== "QUALIFY" && <th>Status</th>}
                  {session !== "QUALIFY" && <th className="text-right">Laps</th>}
                  {session !== "QUALIFY" && <th className="text-right">Time</th>}
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
                      <select className="input w-48" value={r.driverId ?? ""} onChange={(e) => update(i, { driverId: e.target.value ? Number(e.target.value) : null, onEntryList: false })}>
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
                      {r.onEntryList ? (
                        <span className="text-xs text-muted">{teams.find((t) => t.id === r.teamId)?.name ?? "no team"} (entry list)</span>
                      ) : (
                        <select className="input w-40" value={r.teamId ?? ""} onChange={(e) => update(i, { teamId: e.target.value ? Number(e.target.value) : null })}>
                          <option value="">No team</option>
                          {teams.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    {session !== "QUALIFY" && (
                      <td>
                        <select className="input w-20" value={r.status} onChange={(e) => update(i, { status: e.target.value })}>
                          {STATUSES.map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </td>
                    )}
                    {session !== "QUALIFY" && <td className="text-right tabular">{r.laps}</td>}
                    {session !== "QUALIFY" && <td className="text-right font-mono text-xs">{raceTime(r.totalTimeMs)}</td>}
                    <td className="text-right font-mono text-xs">{lapTime(r.bestLapMs)}</td>
                    <td>
                      <Arrows i={i} n={preview.rows.length} onMove={(i, d) => setPreview({ ...preview, rows: moveIn(preview.rows, i, d) })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-3">
            <button className="btn-accent" disabled={busy} onClick={save}>
              Save {preview.rows.length} rows
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

// A result without a file: drivers of the entry list in finishing order.
function ManualEntry({ race, session, entries, onDone }) {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const { busy, message, run } = useAction();
  const left = entries.filter((e) => !rows.some((r) => r.driverId === e.driverId));
  if (!open) {
    return (
      <button className="btn-ghost" onClick={() => setOpen(true)}>
        Type in by hand
      </button>
    );
  }
  return (
    <div className="space-y-3 rounded-xl border border-line p-4">
      <p className="text-sm text-muted">Add the drivers in finishing order{session !== "QUALIFY" ? " and mark who did not finish" : ""}. Saving replaces this session's rows.</p>
      <ol className="space-y-1.5">
        {rows.map((r, i) => (
          <li key={r.driverId} className="flex items-center gap-3 text-sm">
            <span className="w-6 font-black">{i + 1}</span>
            <span className="min-w-[140px] font-semibold">{r.name}</span>
            {session !== "QUALIFY" && (
              <select className="input w-20" value={r.status} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, status: e.target.value } : x)))}>
                {STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            )}
            <Arrows i={i} n={rows.length} onMove={(i, d) => setRows(moveIn(rows, i, d))} />
            <button className="text-muted hover:text-red-300" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove">
              ✕
            </button>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <select
          className="input w-56"
          value=""
          onChange={(e) => {
            const entry = entries.find((x) => x.driverId === Number(e.target.value));
            if (entry) setRows([...rows, { driverId: entry.driverId, name: entry.driver.name, status: "FIN" }]);
          }}
        >
          <option value="">+ Add the next driver…</option>
          {left.map((e) => (
            <option key={e.driverId} value={e.driverId}>
              {e.driver.name}
            </option>
          ))}
        </select>
        <button
          className="btn-accent"
          disabled={busy || !rows.length}
          onClick={async () => {
            if (await run(() => api.post(`/admin/races/${race.id}/import`, { session, rows }), "Saved.")) {
              setRows([]);
              setOpen(false);
              onDone();
            }
          }}
        >
          Save {rows.length} rows
        </button>
        <button className="btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <Message message={message} />
      {entries.length === 0 && <p className="text-xs text-amber-300">The season's entry list is empty: add drivers under Entry list &amp; transfers first.</p>}
    </div>
  );
}

// The saved rows of one session: team, status, grid, penalty, points
// adjustment and the order.
function SessionEditor({ race, session, teams, onChange }) {
  const { data, reload } = useAdminList(`/admin/races/${race.id}/results?session=${session}`);
  const { busy, message, run } = useAction();
  const done = () => reload().then(onChange);

  if (!data?.length) return <p className="text-sm text-muted">Nothing saved for the {sessionLabel(session, race).toLowerCase()} yet.</p>;

  if (session === "QUALIFY") {
    return (
      <div className="space-y-3">
        <ol className="grid gap-1 text-sm sm:grid-cols-2">
          {data.map((q) => (
            <li key={q.id} className="flex gap-3">
              <span className="w-6 font-black">{q.position}</span>
              <span className="flex-1 font-semibold">{q.driver.name}</span>
              <span className="font-mono text-xs text-muted">{lapTime(q.bestLapMs)}</span>
            </li>
          ))}
        </ol>
        <p className="text-xs text-muted">The qualifying decides the pole, pays the season's qualifying points (if it has any) and fills race 1's grid where it has none of its own.</p>
        <button className="btn-danger" onClick={() => confirmDelete("the qualifying of this round") && run(() => api.del(`/admin/races/${race.id}/results?session=QUALIFY`)).then(done)}>
          Delete qualifying
        </button>
      </div>
    );
  }

  const patch = (r, body) => run(() => api.put(`/admin/results/${r.id}`, body), "Saved.").then(done);
  const move = async (i, dir) => {
    const order = moveIn(data, i, dir).map((r) => r.id);
    await run(() => api.put(`/admin/races/${race.id}/order`, { session, order }));
    done();
  };

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
              <th>Grid</th>
              <th className="text-right">Laps</th>
              <th className="text-right">Time</th>
              <th>Penalty (s)</th>
              <th>Reason</th>
              <th>± pts</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((r, i) => (
              <tr key={r.id}>
                <td className="font-black">{r.position}</td>
                <td className="font-semibold">{r.driver.name}</td>
                <td>
                  <select className="input w-36" value={r.teamId ?? ""} onChange={(e) => patch(r, { teamId: e.target.value || null })}>
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
                <td>
                  <input className="input w-14" inputMode="numeric" defaultValue={r.grid ?? ""} onBlur={(e) => String(r.grid ?? "") !== e.target.value && patch(r, { grid: e.target.value })} />
                </td>
                <td className="text-right tabular">{r.laps}</td>
                <td className="text-right font-mono text-xs">{raceTime(r.totalTimeMs)}</td>
                <td>
                  <input
                    className="input w-16"
                    type="number"
                    min="0"
                    step="1"
                    defaultValue={r.penaltyMs ? r.penaltyMs / 1000 : ""}
                    onBlur={(e) => Number(e.target.value || 0) * 1000 !== r.penaltyMs && patch(r, { penaltySeconds: e.target.value || 0 })}
                  />
                </td>
                <td>
                  <input className="input w-32" defaultValue={r.penaltyNote ?? ""} onBlur={(e) => (r.penaltyNote ?? "") !== e.target.value && patch(r, { penaltyNote: e.target.value })} />
                </td>
                <td>
                  <input
                    className="input w-16"
                    type="number"
                    step="0.5"
                    defaultValue={r.pointsAdjust}
                    onBlur={(e) => Number(e.target.value) !== r.pointsAdjust && patch(r, { pointsAdjust: e.target.value })}
                  />
                </td>
                <td>
                  <Arrows i={i} n={data.length} onMove={move} disabled={busy} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">A time penalty is added to the race time and re-orders the finishers by it. ± pts adds or takes off points on top of the table.</p>
      <div className="flex items-center gap-3">
        <button
          className="btn-danger"
          onClick={() => confirmDelete(`the ${sessionLabel(session, race).toLowerCase()} result of "${race.name}"`) && run(() => api.del(`/admin/races/${race.id}/results?session=${session}`)).then(done)}
        >
          Delete {sessionLabel(session, race).toLowerCase()} result
        </button>
        <Message message={message} />
      </div>
    </div>
  );
}

function ResultsPanel({ race, drivers, teams, entries, onChange }) {
  const sessions = ["QUALIFY", ...Array.from({ length: race.raceCount }, (_, i) => `R${i + 1}`)];
  const [session, setSession] = useState("R1");
  const count = (s) => race.counts[s] || 0;
  return (
    <div className="mt-4 space-y-4 rounded-xl bg-bg p-4">
      <div className="flex flex-wrap gap-1">
        {sessions.map((s) => (
          <button
            key={s}
            onClick={() => setSession(s)}
            className={`rounded-full px-3 py-1 text-xs font-black uppercase italic ${session === s ? "bg-accent text-accent-ink" : "border border-line text-muted"}`}
          >
            {sessionLabel(s, race)} {count(s) ? `· ${count(s)}` : ""}
          </button>
        ))}
      </div>
      {/* keyed on the counts, so a fresh import shows at once */}
      <SessionEditor key={`${session}-${count(session)}-${race.importedAt}`} race={race} session={session} teams={teams} onChange={onChange} />
      <div className="flex flex-wrap items-start gap-3 border-t border-line pt-4">
        <Importer key={`imp-${session}`} race={race} session={session} drivers={drivers} teams={teams} onDone={onChange} />
        <ManualEntry key={`man-${session}`} race={race} session={session} entries={entries} onDone={onChange} />
      </div>
    </div>
  );
}

function RaceItem({ race, drivers, teams, entries, reload }) {
  const [mode, setMode] = useState(null); // null | "edit" | "results"
  const { busy, message, run } = useAction();
  const raceKeys = Array.from({ length: race.raceCount }, (_, i) => `R${i + 1}`);
  const raced = raceKeys.some((k) => race.counts[k] > 0);

  return (
    <li className="py-4">
      {mode === "edit" ? (
        <RaceForm
          initial={{
            ...EMPTY_RACE,
            round: race.round,
            name: race.name,
            track: race.track,
            mysteryTrack: race.mysteryTrack,
            car: race.car ?? "",
            startsAt: toLocalInput(race.startsAt),
            raceCount: race.raceCount,
            pointsMultiplier: race.pointsMultiplier,
            pointsTable: race.pointsTable,
            videoUrl: race.videoUrl ?? "",
            timetable: race.timetable.map((t) => ({ label: t.label, at: toLocalInput(t.at), length: t.length ?? "" })),
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
        >
          <PictureField
            label="Poster of the round"
            url={race.imageUrl}
            endpoint={`/admin/races/${race.id}/image`}
            onChange={reload}
            hint="Shown on the calendar, the home page and the race page. Without one, the recording's thumbnail or the season's banner is used."
          />
        </RaceForm>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {race.imageUrl ? (
            <img src={race.imageUrl} alt="" className="h-10 w-16 rounded object-cover" />
          ) : (
            <span className="w-16 text-center font-black text-muted">R{race.round}</span>
          )}
          <div className="min-w-0">
            <Link to={`/races/${race.id}`} className="font-semibold hover:opacity-70">
              R{race.round} · {race.name}
            </Link>
            <div className="text-xs text-muted">
              {race.track || "no track yet"}
              {race.mysteryTrack && " (mystery)"} · {dateTime(race.startsAt)}
              {race.raceCount > 1 && ` · ${race.raceCount} races`}
              {race.car && ` · ${race.car}`}
              {race.pointsMultiplier !== 1 && ` · ×${race.pointsMultiplier} points`}
              {race.pointsTable && " · own points"}
              {race.videoUrl && " · recording"}
            </div>
          </div>
          <span className={`text-xs font-bold ${raced ? "text-emerald-400" : "text-muted"}`}>
            {raced
              ? [...raceKeys.map((k) => race.counts[k] && `${sessionLabel(k, race).toLowerCase()} ${race.counts[k]}`), race.counts.QUALIFY && `quali ${race.counts.QUALIFY}`].filter(Boolean).join(" · ")
              : `${race.counts.signups} sign-ups`}
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
      {mode === "results" && <ResultsPanel race={race} drivers={drivers} teams={teams} entries={entries} onChange={reload} />}
    </li>
  );
}

export default function RacesAdmin() {
  const { currentSeason, seriesId } = useScope();
  const seasonId = currentSeason?.id;
  const { data: races, reload } = useAdminList(seasonId ? `/admin/races?season=${seasonId}` : null);
  const { data: drivers, reload: reloadDrivers } = useAdminList("/admin/drivers");
  const { data: teams } = useAdminList(seriesId ? `/admin/teams?series=${seriesId}` : null);
  const { data: entryData, reload: reloadEntries } = useAdminList(seasonId ? `/admin/seasons/${seasonId}/entries` : null);
  const { busy, message, run } = useAction();
  const [formKey, setFormKey] = useState(0);
  const activeTeams = (teams || []).filter((t) => !t.archived);
  const refresh = () => {
    reload();
    reloadDrivers();
    reloadEntries();
  };

  if (!currentSeason) {
    return (
      <Section title="Start here">
        <p className="text-sm text-muted">
          Create a series and its first season under <Link to="/admin/series" className="text-ink underline">Series &amp; seasons</Link>, then add the races here.
        </p>
      </Section>
    );
  }

  return (
    <div className="space-y-6">
      <Section title="New race">
        <RaceForm
          key={`${formKey}-${races?.length ?? 0}-${seasonId}`}
          initial={{ ...EMPTY_RACE, round: (races?.length ?? 0) + 1 }}
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
      <Section title={`Calendar · ${currentSeason.name}`}>
        <ul className="divide-y divide-line">
          {races?.map((r) => (
            <RaceItem key={r.id} race={r} drivers={drivers || []} teams={activeTeams} entries={entryData?.entries || []} reload={refresh} />
          ))}
          {races?.length === 0 && <li className="py-3 text-sm text-muted">No races in this season yet.</li>}
        </ul>
      </Section>
    </div>
  );
}
