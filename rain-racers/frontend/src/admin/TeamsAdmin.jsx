import { useState } from "react";
import { api } from "../api.js";
import { useAdminList, useAction, Message, Section, Field, confirmDelete } from "./common.jsx";
import { useScope } from "./scope.jsx";

function TeamRow({ team, onSaved, run }) {
  const [name, setName] = useState(team.name);
  const [color, setColor] = useState(team.color || "#38bdf8");
  const dirty = name !== team.name || color !== (team.color || "#38bdf8");
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <input type="color" className="h-9 w-11 cursor-pointer rounded border border-line bg-bg" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Team colour" />
      <input className="input max-w-xs" value={name} onChange={(e) => setName(e.target.value)} />
      <span className="text-sm text-muted">
        {team._count.entries} entries · {team._count.results} results
      </span>
      {team.archived && <span className="text-xs font-bold uppercase text-muted">archived</span>}
      <div className="ml-auto flex gap-2">
        {dirty && (
          <button className="btn-accent py-1" onClick={() => run(() => api.put(`/admin/teams/${team.id}`, { name, color }), "Saved.").then(onSaved)}>
            Save
          </button>
        )}
        <button className="btn-ghost py-1" onClick={() => run(() => api.put(`/admin/teams/${team.id}`, { archived: !team.archived })).then(onSaved)}>
          {team.archived ? "Restore" : "Archive"}
        </button>
        <button
          className="btn-danger py-1"
          onClick={() => confirmDelete(`team "${team.name}" (its results stay, without a team)`) && run(() => api.del(`/admin/teams/${team.id}`)).then(onSaved)}
        >
          Delete
        </button>
      </div>
    </li>
  );
}

export default function TeamsAdmin() {
  const { seriesId, currentSeries } = useScope();
  const { data, reload } = useAdminList(seriesId ? `/admin/teams?series=${seriesId}` : null);
  const { busy, message, run } = useAction();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#38bdf8");

  return (
    <div className="space-y-6">
      <Section title={`New team in ${currentSeries?.name ?? "…"}`}>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => api.post("/admin/teams", { name, color, seriesId }), "Team created.")) {
              setName("");
              reload();
            }
          }}
        >
          <Field label="Colour">
            <input type="color" className="h-9 w-11 cursor-pointer rounded border border-line bg-bg" value={color} onChange={(e) => setColor(e.target.value)} />
          </Field>
          <Field label="Name" className="w-full max-w-xs">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <button className="btn-accent" disabled={busy || !name.trim()}>
            Create
          </button>
        </form>
        <div className="mt-3">
          <Message message={message} />
        </div>
      </Section>
      <Section title={`Teams of ${currentSeries?.name ?? "…"}`}>
        <ul className="divide-y divide-line">
          {data?.map((t) => (
            <TeamRow key={`${t.id}-${t.name}-${t.color}-${t.archived}`} team={t} onSaved={reload} run={run} />
          ))}
          {data?.length === 0 && <li className="py-3 text-sm text-muted">No teams yet.</li>}
        </ul>
      </Section>
    </div>
  );
}
