import { useState } from "react";
import { api } from "../api.js";
import { useScope } from "./scope.jsx";
import { useAdminList, useAction, Message, Section, Field, confirmDelete } from "./common.jsx";

// A season's entry list (who drives, for which team, with which number) and
// the team changes during it.
export default function EntriesAdmin() {
  const { currentSeason, seriesId } = useScope();
  const { data, reload } = useAdminList(currentSeason ? `/admin/seasons/${currentSeason.id}/entries` : null);
  const { data: teams } = useAdminList(seriesId ? `/admin/teams?series=${seriesId}` : null);
  const { data: drivers, reload: reloadDrivers } = useAdminList("/admin/drivers");
  const { busy, message, run } = useAction();
  const [add, setAdd] = useState({ driverId: "", name: "", teamId: "", number: "" });
  const [moving, setMoving] = useState(null);
  if (!currentSeason) return <Section title="Entry list">Pick or create a season first.</Section>;
  const activeTeams = (teams || []).filter((t) => !t.archived);
  const entered = new Set((data?.entries || []).map((e) => e.driverId));
  const free = (drivers || []).filter((d) => !entered.has(d.id));
  const rounds = data?.rounds || [];

  return (
    <div className="space-y-6">
      <Section title="Add to the entry list">
        <p className="mb-4 text-sm text-muted">Drivers are also added on their own when a result file is imported.</p>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => api.post(`/admin/seasons/${currentSeason.id}/entries`, add), "Added.")) {
              setAdd({ driverId: "", name: "", teamId: "", number: "" });
              reload();
              reloadDrivers();
            }
          }}
        >
          <Field label="Driver">
            <select className="input w-52" value={add.driverId} onChange={(e) => setAdd({ ...add, driverId: e.target.value })}>
              <option value="">+ New driver…</option>
              {free.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          {!add.driverId && (
            <Field label="New driver's name">
              <input className="input w-48" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} />
            </Field>
          )}
          <Field label="Team">
            <select className="input w-48" value={add.teamId} onChange={(e) => setAdd({ ...add, teamId: e.target.value })}>
              <option value="">No team</option>
              {activeTeams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="No.">
            <input className="input w-20" inputMode="numeric" value={add.number} onChange={(e) => setAdd({ ...add, number: e.target.value })} />
          </Field>
          <button className="btn-accent" disabled={busy || (!add.driverId && !add.name.trim())}>
            Add
          </button>
        </form>
        <div className="mt-3">
          <Message message={message} />
        </div>
      </Section>

      <Section title={`Entry list · ${currentSeason.name} (${data?.entries.length ?? 0})`}>
        <p className="mb-4 text-sm text-muted">
          The team here is the one the driver starts the season with. A change during the season is a <b className="text-ink">move</b> from a round on: a round
          already raced moves its results and team points to the new team, a round ahead applies itself when its result is saved.
        </p>
        <ul className="divide-y divide-line">
          {data?.entries.map((e) => (
            <li key={e.id} className="py-3">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <input
                  className="input w-16"
                  inputMode="numeric"
                  placeholder="No."
                  defaultValue={e.number ?? ""}
                  onBlur={(ev) => String(e.number ?? "") !== ev.target.value && run(() => api.put(`/admin/entries/${e.id}`, { number: ev.target.value })).then(reload)}
                  aria-label="Number"
                />
                <span className="min-w-[140px] font-semibold">{e.driver.name}</span>
                <select
                  className="input w-48"
                  value={e.teamId ?? ""}
                  onChange={(ev) => run(() => api.put(`/admin/entries/${e.id}`, { teamId: ev.target.value || null }), "Saved.").then(reload)}
                  aria-label="Starting team"
                >
                  <option value="">No team</option>
                  {(teams || []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                {e.transfers.map((t) => (
                  <span key={t.id} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs">
                    from R{t.fromRound} → <b>{t.team?.name ?? "no team"}</b>
                    <button
                      className="text-muted hover:text-red-300"
                      title="Take back"
                      onClick={() => confirmDelete(`the move of ${e.driver.name} from round ${t.fromRound}`) && run(() => api.del(`/admin/transfers/${t.id}`), "Move taken back.").then(reload)}
                    >
                      ✕
                    </button>
                  </span>
                ))}
                <div className="ml-auto flex gap-2">
                  <button className="btn-ghost py-1" onClick={() => setMoving(moving === e.id ? null : e.id)}>
                    Move
                  </button>
                  <button
                    className="btn-danger py-1"
                    onClick={() => confirmDelete(`${e.driver.name} from this season's entry list (results stay)`) && run(() => api.del(`/admin/entries/${e.id}`)).then(reload)}
                  >
                    Remove
                  </button>
                </div>
              </div>
              {moving === e.id && (
                <MoveForm
                  rounds={rounds}
                  teams={activeTeams}
                  busy={busy}
                  onCancel={() => setMoving(null)}
                  onSubmit={async (f) => {
                    if (await run(() => api.post(`/admin/seasons/${currentSeason.id}/transfers`, { ...f, driverId: e.driverId }), "Move booked.")) {
                      setMoving(null);
                      reload();
                    }
                  }}
                />
              )}
            </li>
          ))}
          {data?.entries.length === 0 && <li className="py-3 text-sm text-muted">Nobody on the entry list yet.</li>}
        </ul>
      </Section>
    </div>
  );
}

function MoveForm({ rounds, teams, busy, onSubmit, onCancel }) {
  const next = rounds.find((r) => !r.importedAt) || rounds[rounds.length - 1];
  const [f, setF] = useState({ teamId: "", fromRound: next?.round ?? 1 });
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-3 rounded-xl bg-bg p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ teamId: f.teamId || null, fromRound: f.fromRound });
      }}
    >
      <Field label="New team">
        <select className="input w-48" value={f.teamId} onChange={(e) => setF({ ...f, teamId: e.target.value })}>
          <option value="">No team (leaves)</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="From round">
        <select className="input w-56" value={f.fromRound} onChange={(e) => setF({ ...f, fromRound: Number(e.target.value) })}>
          {rounds.map((r) => (
            <option key={r.round} value={r.round}>
              R{r.round} {r.track} {r.importedAt ? "(raced: its points move)" : ""}
            </option>
          ))}
        </select>
      </Field>
      <button className="btn-accent" disabled={busy || !rounds.length}>
        Book move
      </button>
      <button type="button" className="btn-ghost" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
