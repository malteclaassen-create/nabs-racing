import { useState } from "react";
import { api } from "../api.js";
import { useAdminList, useAction, Message, Section, Field, confirmDelete } from "./common.jsx";

const blank = { name: "", number: "", country: "", steamGuid: "", teamId: "" };

function DriverForm({ initial, teams, onSubmit, submitLabel, busy, onCancel }) {
  const [f, setF] = useState(initial);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form
      className="grid gap-3 sm:grid-cols-[2fr_80px_70px_1.5fr_2fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(f, () => setF(blank));
      }}
    >
      <Field label="Name">
        <input className="input" value={f.name} onChange={set("name")} />
      </Field>
      <Field label="No.">
        <input className="input" inputMode="numeric" value={f.number ?? ""} onChange={set("number")} />
      </Field>
      <Field label="Country">
        <input className="input uppercase" maxLength={2} placeholder="DE" value={f.country ?? ""} onChange={set("country")} />
      </Field>
      <Field label="Team">
        <select className="input" value={f.teamId ?? ""} onChange={set("teamId")}>
          <option value="">No team</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Steam id (from the result files)">
        <input className="input font-mono text-xs" value={f.steamGuid ?? ""} onChange={set("steamGuid")} />
      </Field>
      <div className="flex gap-2">
        <button className="btn-accent" disabled={busy || !f.name.trim()}>
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

export default function DriversAdmin() {
  const { data, reload } = useAdminList("/admin/drivers");
  const { data: teams } = useAdminList("/admin/teams");
  const { busy, message, run } = useAction();
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState("");
  const activeTeams = (teams || []).filter((t) => !t.archived);
  const list = (data || []).filter((d) => d.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="space-y-6">
      <Section title="New driver">
        <p className="mb-4 text-sm text-muted">Drivers are also created automatically when a result file is imported.</p>
        <DriverForm
          initial={blank}
          teams={activeTeams}
          busy={busy}
          submitLabel="Add"
          onSubmit={async (f, clear) => {
            if (await run(() => api.post("/admin/drivers", f), "Driver added.")) {
              clear();
              reload();
            }
          }}
        />
        <div className="mt-3">
          <Message message={message} />
        </div>
      </Section>

      <Section title={`Drivers (${data?.length ?? 0})`} actions={<input className="input w-48" placeholder="Search" value={filter} onChange={(e) => setFilter(e.target.value)} />}>
        <ul className="divide-y divide-line">
          {list.map((d) =>
            editing === d.id ? (
              <li key={d.id} className="py-3">
                <DriverForm
                  initial={{ name: d.name, number: d.number ?? "", country: d.country ?? "", steamGuid: d.steamGuid ?? "", teamId: d.teamId ?? "" }}
                  teams={activeTeams}
                  busy={busy}
                  submitLabel="Save"
                  onCancel={() => setEditing(null)}
                  onSubmit={async (f) => {
                    if (await run(() => api.put(`/admin/drivers/${d.id}`, f), "Saved.")) {
                      setEditing(null);
                      reload();
                    }
                  }}
                />
              </li>
            ) : (
              <li key={d.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <span className="w-10 text-right font-mono text-muted">{d.number != null ? `#${d.number}` : ""}</span>
                <span className="font-semibold">{d.name}</span>
                <span className="text-muted">{d.team?.name ?? "no team"}</span>
                {d.user && <span className="text-xs text-[#8b95f5]">Discord: {d.user.name}</span>}
                {!d.steamGuid && <span className="text-xs text-amber-300">no Steam id</span>}
                <span className="text-xs text-muted">{d._count.results} results</span>
                <div className="ml-auto flex gap-2">
                  <button className="btn-ghost py-1" onClick={() => setEditing(d.id)}>
                    Edit
                  </button>
                  <button
                    className="btn-danger py-1"
                    onClick={() => confirmDelete(`"${d.name}" and all of their results`) && run(() => api.del(`/admin/drivers/${d.id}`)).then(reload)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      </Section>
    </div>
  );
}
