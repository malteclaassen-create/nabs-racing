import { useState } from "react";
import { api } from "../api.js";
import { useSite } from "../site.jsx";
import { useAdminList, useAction, Message, Section, confirmDelete } from "./common.jsx";

export default function SeasonsAdmin() {
  const { reload: reloadSite } = useSite();
  const { data, reload } = useAdminList("/admin/seasons");
  const { busy, message, run } = useAction();
  const [name, setName] = useState("");
  const done = async () => {
    await reload();
    await reloadSite();
  };

  return (
    <div className="space-y-6">
      <Section title="New season">
        <form
          className="flex flex-wrap gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => api.post("/admin/seasons", { name }), "Season created.")) {
              setName("");
              done();
            }
          }}
        >
          <input className="input max-w-xs" placeholder="Season 1" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn-accent" disabled={busy || !name.trim()}>
            Create
          </button>
        </form>
        <div className="mt-3">
          <Message message={message} />
        </div>
      </Section>

      <Section title="Seasons">
        <ul className="divide-y divide-line">
          {data?.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
              <input
                className="input max-w-xs"
                defaultValue={s.name}
                onBlur={(e) => e.target.value !== s.name && run(() => api.put(`/admin/seasons/${s.id}`, { name: e.target.value }), "Saved.").then(done)}
              />
              <span className="text-sm text-muted">{s._count.races} races</span>
              {s.isCurrent ? (
                <span className="rounded bg-accent px-2 py-0.5 text-xs font-black uppercase text-bg">Current</span>
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
          {data?.length === 0 && <li className="py-3 text-sm text-muted">No seasons yet. Create the first one above.</li>}
        </ul>
      </Section>
    </div>
  );
}
