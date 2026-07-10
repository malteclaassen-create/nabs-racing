import { useCallback, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { ErrorBox, DriverAvatar } from "./ui.jsx";
import TeamLogo from "./TeamLogo.jsx";
import AdminPersons from "./AdminPersons.jsx";

// Admin "Members" tab: every Discord account that has ever logged in on the
// site. The name matcher links most accounts to their roster driver on first
// login; this tab is for everything it can't do alone —
//   * see who logged in but is NOT linked to any driver (and link them by hand),
//   * see which roster drivers never logged in at all,
//   * ban an account (no more logins, running sessions stop working).
function fmtDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d) ? "—" : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function StatusPills({ m }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {m.isAdmin && (
        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary" title="Has full admin access on Discord login">
          admin
        </span>
      )}
      {m.banned && (
        <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-600" title={m.banReason || undefined}>
          banned{m.banReason ? ` · ${m.banReason}` : ""}
        </span>
      )}
      {m.driver ? (
        !m.driver.isActiveSeason && (
          <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-semibold text-sky-600">
            linked in {m.driver.seasonName || "older season"}
          </span>
        )
      ) : (
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-600">
          not linked to a driver
        </span>
      )}
    </span>
  );
}

export default function AdminMembers() {
  const { data, loading, error, reload } = useApi(useCallback(() => api.adminMembers(), []));
  // Teams of the ACTIVE season (new drivers always join the running season).
  const { active } = useSeason();
  const teamsApi = useApi(
    useCallback(() => (active ? api.teamsForSeason(active.number) : Promise.resolve([])), [active?.number])
  );
  const [busy, setBusy] = useState(null); // discordId of the row being changed
  const [msg, setMsg] = useState(null);
  const [linkChoice, setLinkChoice] = useState({}); // discordId -> driverId
  // "Create new driver" inline form: which account it's open for + its fields.
  const [creating, setCreating] = useState(null); // discordId | null
  const [createForm, setCreateForm] = useState({ name: "", teamId: "" });

  if (error) return <ErrorBox message={error} />;

  const members = data?.members || [];
  const unclaimed = data?.unclaimed || [];
  const unlinked = members.filter((m) => !m.driver);
  // Reserve first — that's where newcomers usually start.
  const teams = [...(teamsApi.data || [])].sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));

  async function act(id, fn) {
    setBusy(id);
    setMsg(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(null);
    }
  }

  function ban(m) {
    const reason = window.prompt(
      `Ban "${m.displayName || m.username}"?\n\nThey can no longer log in and their current session stops working.\nOptional: enter a reason (visible only to admins).`,
      ""
    );
    if (reason === null) return; // cancelled
    act(m.discordId, () => api.banMember(m.discordId, true, reason.trim() || null));
  }

  function unban(m) {
    if (!window.confirm(`Lift the ban for "${m.displayName || m.username}"?`)) return;
    act(m.discordId, () => api.banMember(m.discordId, false));
  }

  function link(m) {
    const driverId = linkChoice[m.discordId];
    if (!driverId) return;
    act(m.discordId, () => api.linkMember(m.discordId, driverId));
  }

  function unlink(m) {
    if (!window.confirm(`Unlink "${m.displayName || m.username}" from ${m.driver?.name}?\nThey stay logged in but lose their driver identity (RSVP, profile editing).`)) return;
    act(m.discordId, () => api.unlinkMember(m.discordId));
  }

  function toggleAdmin(m) {
    const next = !m.isAdmin;
    const name = m.displayName || m.username;
    const ok = next
      ? window.confirm(`Give "${name}" full admin access?\n\nThey reach the whole admin area straight after logging in with Discord, no PIN needed. Only do this for people you fully trust.`)
      : window.confirm(`Remove admin access from "${name}"? This takes effect immediately.`);
    if (!ok) return;
    act(m.discordId, () => api.setMemberAdmin(m.discordId, next));
  }

  function openCreate(m) {
    setCreating(m.discordId);
    const reserve = teams.find((t) => t.tier === 0);
    setCreateForm({ name: m.displayName || m.username, teamId: reserve?.id || teams[0]?.id || "" });
  }

  function createDriver(m) {
    if (!createForm.name.trim() || !createForm.teamId) return;
    act(m.discordId, async () => {
      await api.createDriverFromMember(m.discordId, { name: createForm.name.trim(), teamId: createForm.teamId });
      setCreating(null);
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-surface2/60 px-4 py-3 text-sm text-medium">
        Everyone who has logged in with Discord shows up here automatically. Most accounts link themselves to their
        roster driver by name on first login. Anything the matcher couldn&rsquo;t place lands in{" "}
        <b>Needs attention</b> below, where you can link it by hand. Banning an account blocks logins <i>and</i> cuts
        off its current session.
      </div>

      {msg && !msg.ok && <ErrorBox message={msg.text} />}
      {loading && <p className="text-sm text-light">Loading accounts…</p>}

      {/* --- unlinked accounts first: this is the actual to-do list ---------- */}
      {unlinked.length > 0 && (
        <div className="card border-amber-500/40 p-5">
          <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">
            Needs attention: logged in, but no driver
            <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 font-mono text-xs text-amber-600">{unlinked.length}</span>
          </h3>
          <p className="mt-1 text-sm text-light">
            These people signed in but the name matcher couldn&rsquo;t find them on the roster. Pick their driver entry
            to link them, or, for someone completely new to the league, create a fresh driver in one step with{" "}
            <b>New driver</b>.
          </p>
          <ul className="mt-3 divide-y divide-border">
            {unlinked.map((m) => (
              <li key={m.discordId} className="py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <DriverAvatar name={m.displayName || m.username} photoUrl={m.avatarUrl} color="#64748b" size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-dark">{m.displayName || m.username}</span>
                    <span className="block font-mono text-xs text-light">
                      @{m.username} · last login {fmtDate(m.lastLoginAt)}
                    </span>
                  </span>
                  <StatusPills m={m} />
                  <span className="flex items-center gap-2">
                    <select
                      className="input py-1.5 text-sm"
                      value={linkChoice[m.discordId] || ""}
                      onChange={(e) => setLinkChoice((c) => ({ ...c, [m.discordId]: e.target.value }))}
                    >
                      <option value="">Link to driver…</option>
                      {unclaimed.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.team?.name || "—"})
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn-primary py-1.5 text-sm disabled:opacity-50"
                      disabled={!linkChoice[m.discordId] || busy === m.discordId}
                      onClick={() => link(m)}
                    >
                      Link
                    </button>
                    <button
                      className="btn-secondary py-1.5 text-sm"
                      disabled={busy === m.discordId}
                      onClick={() => (creating === m.discordId ? setCreating(null) : openCreate(m))}
                    >
                      New driver
                    </button>
                    {m.banned ? (
                      <button className="btn-secondary py-1.5 text-sm" disabled={busy === m.discordId} onClick={() => unban(m)}>
                        Unban
                      </button>
                    ) : (
                      <button
                        className="rounded-lg border border-red-500/40 px-3 py-1.5 text-sm font-semibold text-red-600 transition hover:bg-red-500/10"
                        disabled={busy === m.discordId}
                        onClick={() => ban(m)}
                      >
                        Ban
                      </button>
                    )}
                  </span>
                </div>
                {/* one-step "create + link" for people not on the roster at all */}
                {creating === m.discordId && (
                  <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg bg-surface2/60 p-3">
                    <label className="min-w-[12rem] flex-1">
                      <span className="mb-1 block font-mono text-[11px] font-bold uppercase tracking-wider text-medium">Driver name</span>
                      <input
                        className="input w-full py-1.5 text-sm"
                        value={createForm.name}
                        onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                      />
                    </label>
                    <label className="min-w-[12rem] flex-1">
                      <span className="mb-1 block font-mono text-[11px] font-bold uppercase tracking-wider text-medium">Team ({active?.name || "active season"})</span>
                      <select
                        className="input w-full py-1.5 text-sm"
                        value={createForm.teamId}
                        onChange={(e) => setCreateForm((f) => ({ ...f, teamId: e.target.value }))}
                      >
                        {teams.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                            {t.tier === 0 ? " (Reserve)" : ` (Tier ${t.tier})`}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="flex items-center gap-2">
                      <button
                        className="btn-primary py-1.5 text-sm disabled:opacity-50"
                        disabled={!createForm.name.trim() || !createForm.teamId || busy === m.discordId}
                        onClick={() => createDriver(m)}
                      >
                        Create &amp; link
                      </button>
                      <button className="btn-secondary py-1.5 text-sm" onClick={() => setCreating(null)}>
                        Cancel
                      </button>
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* --- all accounts ----------------------------------------------------- */}
      <div className="card p-5">
        <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">
          All login accounts
          <span className="ml-2 rounded-full bg-surface2 px-2 py-0.5 font-mono text-xs text-light">{members.length}</span>
        </h3>
        {members.length === 0 && !loading ? (
          <p className="mt-2 text-sm text-light">
            Nobody has logged in with Discord yet. Accounts appear here automatically after the first login.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {members.map((m) => (
              <li key={m.discordId} className={`flex flex-wrap items-center gap-3 py-3 ${m.banned ? "opacity-70" : ""}`}>
                <DriverAvatar name={m.displayName || m.username} photoUrl={m.avatarUrl} color={m.driver?.team?.color || "#64748b"} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-dark">{m.displayName || m.username}</span>
                  <span className="block font-mono text-xs text-light">
                    @{m.username} · first {fmtDate(m.firstLoginAt)} · last {fmtDate(m.lastLoginAt)} · {m.loginCount}×
                  </span>
                </span>
                {m.driver && (
                  <span className="flex items-center gap-2 text-sm text-medium">
                    <TeamLogo
                      id={m.driver.team?.id}
                      name={m.driver.team?.name || ""}
                      color={m.driver.team?.color || "#64748b"}
                      size={18}
                    />
                    <span className="font-semibold text-dark">{m.driver.name}</span>
                  </span>
                )}
                <StatusPills m={m} />
                <span className="flex items-center gap-2">
                  <button
                    className={`py-1.5 text-sm font-semibold ${m.isAdmin ? "text-light hover:text-primary" : "text-primary hover:underline"}`}
                    disabled={busy === m.discordId}
                    onClick={() => toggleAdmin(m)}
                    title={m.isAdmin ? "Revoke admin access" : "Grant full admin access on Discord login"}
                  >
                    {m.isAdmin ? "Remove admin" : "Make admin"}
                  </button>
                  {m.driver && (
                    <button className="btn-secondary py-1.5 text-sm" disabled={busy === m.discordId} onClick={() => unlink(m)}>
                      Unlink
                    </button>
                  )}
                  {m.banned ? (
                    <button className="btn-secondary py-1.5 text-sm" disabled={busy === m.discordId} onClick={() => unban(m)}>
                      Unban
                    </button>
                  ) : (
                    <button
                      className="rounded-lg border border-red-500/40 px-3 py-1.5 text-sm font-semibold text-red-600 transition hover:bg-red-500/10"
                      disabled={busy === m.discordId}
                      onClick={() => ban(m)}
                    >
                      Ban
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* --- roster drivers who never logged in ------------------------------- */}
      <div className="card p-5">
        <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">
          Never logged in
          <span className="ml-2 rounded-full bg-surface2 px-2 py-0.5 font-mono text-xs text-light">{unclaimed.length}</span>
        </h3>
        <p className="mt-1 text-sm text-light">
          Drivers on the active season&rsquo;s roster without a Discord login yet. Worth a nudge on Discord so they get
          their profile, RSVP and market access.
        </p>
        {unclaimed.length > 0 && (
          <ul className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {unclaimed.map((d) => (
              <li key={d.id} className="flex items-center gap-2 py-1 text-sm">
                <TeamLogo id={d.team?.id} name={d.team?.name || ""} color={d.team?.color || "#64748b"} size={16} />
                <span className="font-semibold text-dark">{d.name}</span>
                <span className="truncate font-mono text-xs text-light">{d.discordName}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* --- cross-season person links --------------------------------------- */}
      <AdminPersons />
    </div>
  );
}
