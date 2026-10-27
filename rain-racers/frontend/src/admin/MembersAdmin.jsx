import { api } from "../api.js";
import { useSite } from "../site.jsx";
import { useAdminList, useAction, Message, Section, confirmDelete } from "./common.jsx";

export default function MembersAdmin() {
  const { me } = useSite();
  const { data, reload } = useAdminList("/admin/users");
  const { data: drivers, reload: reloadDrivers } = useAdminList("/admin/drivers");
  const { message, run } = useAction();

  return (
    <Section title="Members">
      <p className="mb-4 text-sm text-muted">
        Everyone who has signed in with Discord. Link a member to their driver, so the entry lists show their driver name and team.
        {!me.discordEnabled && " Discord login is not set up on the server yet (see the README)."}
      </p>
      <Message message={message} />
      <ul className="divide-y divide-line">
        {data?.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
            {u.avatar ? <img src={u.avatar} alt="" className="h-8 w-8 rounded-full" /> : <span className="h-8 w-8 rounded-full bg-line" />}
            <span className="font-semibold">{u.name}</span>
            <span className="font-mono text-xs text-muted">{u.discordId}</span>
            <select
              className="input ml-auto w-56"
              value={u.driver?.id ?? ""}
              onChange={(e) =>
                run(() => api.put(`/admin/users/${u.id}`, { driverId: e.target.value || null }), "Saved.").then(() => {
                  reload();
                  reloadDrivers();
                })
              }
            >
              <option value="">Not linked to a driver</option>
              {drivers?.map((d) => (
                <option key={d.id} value={d.id} disabled={d.userId && d.userId !== u.id}>
                  {d.name}
                  {d.userId && d.userId !== u.id ? " (linked)" : ""}
                </option>
              ))}
            </select>
            <button className="btn-danger py-1" onClick={() => confirmDelete(`the account of ${u.name} and their sign-ups`) && run(() => api.del(`/admin/users/${u.id}`)).then(reload)}>
              Remove
            </button>
          </li>
        ))}
        {data?.length === 0 && <li className="py-3 text-sm text-muted">Nobody has signed in yet.</li>}
      </ul>
    </Section>
  );
}
