import { useCallback, useEffect, useState } from "react";
import { api, getToken, setToken } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { PageHeader, ErrorBox, Notice, CardHead } from "../components/ui.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import AdminImport from "../components/AdminImport.jsx";
import RacePreview from "../components/RacePreview.jsx";
import { fmtTimeCell } from "../utils/raceDuration.js";

const TABS = [
  { id: "seasons", label: "Seasons" },
  { id: "teams", label: "Teams" },
  { id: "import", label: "Import Race" },
  { id: "edit", label: "Edit Results" },
  { id: "discord", label: "Discord & Events" },
  { id: "drivers", label: "Drivers" },
  { id: "pin", label: "Change PIN" },
];

// Small banner telling the admin which season their edits apply to.
function SeasonScope() {
  const { current } = useSeason();
  if (!current) return null;
  return (
    <div className="mb-4 rounded-lg border border-border bg-surface2 px-4 py-2 text-sm text-medium">
      Editing season: <span className="font-bold text-dark">{current.name}</span>
      {!current.isActive && <span className="ml-2 text-light">(not the active/public season)</span>}
      <span className="ml-2 text-light">— switch seasons from the top-right selector.</span>
    </div>
  );
}

export default function Admin() {
  const [authed, setAuthed] = useState(!!getToken());
  const [expired, setExpired] = useState(false);
  const [tab, setTab] = useState("seasons");

  // If any admin request reports an expired/invalid token, bounce to the login.
  useEffect(() => {
    const onUnauth = () => {
      setAuthed(false);
      setExpired(true);
    };
    window.addEventListener("nabs-admin-unauthorized", onUnauth);
    return () => window.removeEventListener("nabs-admin-unauthorized", onUnauth);
  }, []);

  if (!authed)
    return (
      <Login
        expired={expired}
        onSuccess={() => {
          setExpired(false);
          setAuthed(true);
        }}
      />
    );

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <PageHeader eyebrow="League Office" title="Admin" />
        <button
          className="btn-secondary"
          onClick={() => {
            setToken(null);
            setAuthed(false);
          }}
        >
          Log out
        </button>
      </div>

      <div className="mb-6 flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm font-semibold transition ${
              tab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-light hover:text-medium"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-[70vh]">
        {tab === "seasons" && <Seasons />}
        {tab === "teams" && <Teams />}
        {tab === "import" && <AdminImport />}
        {tab === "edit" && <EditResults />}
        {tab === "discord" && <DiscordEvents />}
        {tab === "drivers" && <Drivers />}
        {tab === "pin" && <ChangePin />}
      </div>
    </div>
  );
}

// --- LOGIN -----------------------------------------------------------------
function Login({ onSuccess, expired }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token } = await api.login(pin);
      setToken(token);
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm">
      <PageHeader eyebrow="League Office" title="Admin Login" />
      <form onSubmit={submit} className="card space-y-4 p-6">
        {expired && <Notice kind="info">Your session expired — please log in again.</Notice>}
        <div>
          <label className="mb-1 block text-sm font-semibold text-medium">Admin PIN</label>
          <input
            type="password"
            className="input"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="••••••••"
            autoFocus
          />
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Checking…" : "Log in"}
        </button>
      </form>
    </div>
  );
}

// --- EDIT RESULTS ----------------------------------------------------------
const STATUSES = ["FINISHED", "DNS", "DNF", "DSQ"];

function EditResults() {
  const { data: races } = useApi(useCallback(() => api.races(), []));
  const { data: teams } = useApi(useCallback(() => api.teams(), []));
  const [raceId, setRaceId] = useState("");
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!raceId) return;
    setError(null);
    setMsg(null);
    api
      .raceResults(raceId)
      .then((d) => {
        setRows(
          d.results.map((r) => {
            const raw = r.rawPosition ?? r.position ?? "";
            return {
              driverId: r.driverId,
              name: r.name,
              position: raw, // raw finishing position (penalty is separate)
              status: r.status,
              subForTeamId: r.subForTeam?.id || "",
              penaltySeconds: r.penaltySeconds || 0,
              totalTimeMs: r.totalTimeMs ?? null, // race time, needed to apply a time penalty
              points: r.points, // official points, kept unless this row changes
              origPos: String(raw),
              origStatus: r.status,
              canSub: r.driverTier === 0,
            };
          })
        );
      })
      .catch((e) => setError(e.message));
  }, [raceId]);

  function setRow(i, patch) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  // Normalised results for both the live preview and the save. A row keeps its
  // official points only while its finish/status are untouched; once changed,
  // points are derived from position (penalties are handled server-side).
  const toResults = (rs) =>
    rs.map((r) => ({
      driverId: r.driverId,
      position: r.position === "" ? null : Number(r.position),
      status: r.status,
      subForTeamId: r.subForTeamId || null,
      penaltySeconds: Number(r.penaltySeconds) || 0,
      totalTimeMs: r.totalTimeMs ?? null,
      points:
        String(r.position) !== r.origPos || r.status !== r.origStatus ? null : r.points ?? null,
    }));

  // Leader's race time (fastest finisher) -> drives the gap column. Null for
  // legacy rounds with no stored times (the column then shows "–").
  const finishTimes = rows.filter((r) => r.status === "FINISHED" && r.totalTimeMs > 0).map((r) => r.totalTimeMs);
  const leaderMs = finishTimes.length ? Math.min(...finishTimes) : null;

  async function save() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api.editResults(raceId, toResults(rows));
      setMsg("Results saved and standings recalculated.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <SeasonScope />
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-semibold text-medium">Race</label>
        <select className="input max-w-xs" value={raceId} onChange={(e) => setRaceId(e.target.value)}>
          <option value="">Select a round…</option>
          {(races || []).filter((r) => !r.isSpecialEvent).map((r) => (
            <option key={r.id} value={r.id}>
              Round {r.number} — {r.track}
            </option>
          ))}
        </select>
      </div>

      {error && <ErrorBox message={error} />}
      {msg && <Notice kind="success">{msg}</Notice>}

      {rows.length > 0 && (
        <>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface2 text-left text-light">
                  <th className="px-3 py-2">Driver</th>
                  <th className="px-3 py-2 w-20 text-center" title="Raw finishing position from the race">Finish</th>
                  <th className="px-3 py-2 text-center" title="Total race time (leader) or gap behind the leader">Time / Gap</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Team (this race)</th>
                  <th
                    className="px-3 py-2 text-center"
                    title="Time penalty in seconds (e.g. 5 or 10), added to the driver's race time. The final order & points update live in the preview below."
                  >
                    Penalty (sec)
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.driverId} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-semibold text-dark">{r.name}</td>
                    <td className="px-3 py-2">
                      <input
                        className="input w-16 py-1 text-center"
                        value={r.position}
                        onChange={(e) => setRow(i, { position: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2 text-center font-mono text-xs text-light">{fmtTimeCell(r, leaderMs)}</td>
                    <td className="px-3 py-2">
                      <select className="input py-1" value={r.status} onChange={(e) => setRow(i, { status: e.target.value })}>
                        {STATUSES.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className="input py-1"
                        value={r.subForTeamId}
                        onChange={(e) => setRow(i, { subForTeamId: e.target.value })}
                      >
                        <option value="">— driver’s team —</option>
                        {(teams || [])
                          .filter((t) => t.tier === 1 || t.tier === 2)
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        {(teams || [])
                          .filter((t) => t.tier === 0)
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              No team ({t.name})
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        className="input w-16 py-1 text-center"
                        type="number"
                        min="0"
                        step="5"
                        value={r.penaltySeconds}
                        onChange={(e) => setRow(i, { penaltySeconds: e.target.value })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-light">
            Enter each driver&rsquo;s <span className="font-semibold text-medium">raw finishing position</span> in
            &ldquo;Finish&rdquo;. <span className="font-semibold text-medium">Penalty (sec)</span> is a time penalty
            in seconds — it&rsquo;s added to the driver&rsquo;s race time and the field is re-sorted, so they drop
            behind everyone now ahead on time. (Needs imported race times; rounds without them can&rsquo;t be
            re-sorted.) The final order, points and the championship update live below before you save.
          </p>

          <RacePreview request={{ raceId, results: toResults(rows) }} />

          <button className="btn-primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save results"}
          </button>
        </>
      )}
    </div>
  );
}

// --- DRIVERS ---------------------------------------------------------------
function Drivers() {
  const { data: teams, reload } = useApi(useCallback(() => api.teams(), []));
  const [form, setForm] = useState({ id: "", name: "", discordName: "", teamId: "", tier: 2 });
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const allDrivers = (teams || []).flatMap((t) => t.drivers.map((d) => ({ ...d, teamName: t.name })));

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api.createDriver({
        id: form.id.trim(),
        name: form.name.trim(),
        discordName: form.discordName.trim() || form.name.trim(),
        teamId: form.teamId,
        tier: Number(form.tier),
      });
      setMsg(`Driver ${form.name} created.`);
      setForm({ id: "", name: "", discordName: "", teamId: "", tier: 2 });
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function patchDriver(d, patch) {
    setBusy(true); setError(null); setMsg(null);
    try { await api.updateDriver(d.id, patch); reload(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  // Teams with their drivers — grouped by team, ordered Tier 1 → Tier 2 →
  // Reserve. (Tier values are 1, 2, 0, so we rank them explicitly to keep
  // Reserve last instead of first.)
  const tierRank = (tier) => (tier === 1 ? 0 : tier === 2 ? 1 : 2);
  const teamGroups = [...(teams || [])].sort(
    (a, b) => tierRank(a.tier) - tierRank(b.tier) || a.name.localeCompare(b.name)
  );

  return (
    <div>
    <SeasonScope />
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={create} className="card space-y-4 p-5">
        <CardHead eyebrow="Drivers" title="Add driver" />
        <div className="grid grid-cols-2 gap-3">
          <input className="input" placeholder="id, e.g. max_mustermann" title="Permanent, unique handle — lowercase, no spaces" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} required />
          <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <input className="input" placeholder="Discord name" value={form.discordName} onChange={(e) => setForm({ ...form, discordName: e.target.value })} />
        <p className="text-xs leading-relaxed text-light">
          <span className="font-semibold text-medium">id</span> is a permanent, unique handle — lowercase, no spaces
          (e.g. <span className="font-mono">max_mustermann</span>). It can&rsquo;t easily be changed later.<br />
          For race imports to auto-recognise a driver, make their <span className="font-semibold text-medium">Name</span>{" "}
          or <span className="font-semibold text-medium">Discord name</span> match the in-game Assetto Corsa name as
          closely as possible. (You can always pick the right driver by hand during import if the auto-match misses.)
        </p>
        <div className="grid grid-cols-2 gap-3">
          <select className="input" value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })} required>
            <option value="">Team…</option>
            {(teams || []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select className="input" value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}>
            <option value={1}>Tier 1</option>
            <option value={2}>Tier 2</option>
            <option value={0}>Reserve</option>
          </select>
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        {msg && <Notice kind="success">{msg}</Notice>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Saving…" : "Create driver"}
        </button>
      </form>

      <div className="card max-h-[640px] overflow-y-auto p-5">
        <CardHead eyebrow="Roster" title={`Drivers by team (${allDrivers.length})`} />
        <p className="mb-3 text-xs text-light">Use the dropdowns to move a driver to another team or change their tier.</p>
        <div className="space-y-5">
          {teamGroups.map((t) => (
            <div key={t.id}>
              <div className="mb-1.5 flex items-center gap-2">
                <TeamLogo id={t.id} name={t.name} color={t.color} logoUrl={t.logoUrl} size={20} />
                <span className="font-display text-sm font-bold uppercase tracking-tight text-dark">{t.name}</span>
                <span className="text-xs text-light">{TIER_LABEL[t.tier]} · {t.drivers.length}</span>
              </div>
              <ul className="divide-y divide-border border-t border-border">
                {t.drivers.length === 0 && <li className="py-2 text-xs text-light">No drivers.</li>}
                {t.drivers.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <span className={`min-w-0 flex-1 truncate font-semibold ${d.isActive ? "text-dark" : "text-light line-through"}`}>
                      {d.name}
                    </span>
                    <select className="input py-1 text-xs" value={d.teamId} disabled={busy}
                      onChange={(e) => patchDriver(d, { teamId: e.target.value })}>
                      {teamGroups.map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                    <select className="input py-1 text-xs" value={d.tier} disabled={busy}
                      onChange={(e) => patchDriver(d, { tier: Number(e.target.value) })}>
                      <option value={1}>T1</option>
                      <option value={2}>T2</option>
                      <option value={0}>Res</option>
                    </select>
                    <button className="text-xs font-semibold text-primary hover:underline" disabled={busy}
                      onClick={() => patchDriver(d, { isActive: !d.isActive })}>
                      {d.isActive ? "Deactivate" : "Reactivate"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
    </div>
  );
}

// --- DISCORD & EVENTS ------------------------------------------------------
function DiscordEvents() {
  const { current } = useSeason();
  const { data: hook, reload } = useApi(useCallback(() => api.getWebhook(), []));
  const { data: races, reload: reloadRaces } = useApi(useCallback(() => api.races(), []));
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [event, setEvent] = useState({ number: "", track: "", date: "", isSpecialEvent: false });

  async function saveWebhook(e) {
    e.preventDefault();
    setBusy(true); setError(null); setMsg(null);
    try {
      await api.setWebhook(url);
      setMsg("Webhook saved.");
      setUrl("");
      reload();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function test() {
    setBusy(true); setError(null); setMsg(null);
    try {
      await api.testWebhook();
      setMsg("Test message sent — check your Discord channel!");
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function createEvent(e) {
    e.preventDefault();
    setBusy(true); setError(null); setMsg(null);
    try {
      await api.createEvent({
        number: event.isSpecialEvent ? null : Number(event.number),
        track: event.track,
        date: event.date || null,
        isSpecialEvent: event.isSpecialEvent,
        seasonId: current?.id,
      });
      setMsg(event.isSpecialEvent ? `Special event "${event.track}" created.` : `Round ${event.number} created.`);
      setEvent({ number: "", track: "", date: "", isSpecialEvent: false });
      reloadRaces();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function deleteRace(id) {
    if (!window.confirm("Delete this race? Only works if it has no stored results.")) return;
    setBusy(true); setError(null); setMsg(null);
    try { await api.deleteEvent(id); setMsg("Race deleted."); reloadRaces(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function announce(id) {
    setBusy(true); setError(null); setMsg(null);
    try {
      await api.announceEvent(id);
      setMsg("Event posted/updated in Discord.");
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  const upcoming = (races || []).filter((r) => !r.isCompleted);

  return (
    <div>
    <SeasonScope />
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Webhook */}
      <form onSubmit={saveWebhook} className="card space-y-4 p-5">
        <CardHead eyebrow="Integration" title="Discord Webhook" />
        <p className="text-sm text-light">
          Discord channel → Edit Channel → Integrations → Webhooks → "New Webhook" →
          "Copy Webhook URL" and paste it here.
        </p>
        <div className="rounded-lg bg-surface2 p-3 text-sm">
          Status:{" "}
          {hook?.configured ? (
            <span className="font-semibold text-emerald-600">connected ({hook.preview})</span>
          ) : (
            <span className="font-semibold text-light">not connected</span>
          )}
        </div>
        <input
          className="input"
          placeholder="https://discord.com/api/webhooks/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <div className="flex gap-2">
          <button className="btn-primary" disabled={busy}>Save</button>
          <button type="button" className="btn-secondary" disabled={busy || !hook?.configured} onClick={test}>
            Send test
          </button>
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        {msg && <Notice kind="success">{msg}</Notice>}
      </form>

      {/* Create event + announce */}
      <div className="space-y-6">
        <form onSubmit={createEvent} className="card space-y-3 p-5">
          <CardHead eyebrow="Schedule" title="Create race / event" />
          <label className="flex items-center gap-2 text-sm text-medium">
            <input type="checkbox" checked={event.isSpecialEvent}
              onChange={(e) => setEvent({ ...event, isSpecialEvent: e.target.checked })} />
            Special event (no round number, not scored)
          </label>
          <div className="grid grid-cols-2 gap-3">
            {!event.isSpecialEvent && (
              <input className="input" type="number" placeholder="Round #" value={event.number}
                onChange={(e) => setEvent({ ...event, number: e.target.value })} required />
            )}
            <input className={`input ${event.isSpecialEvent ? "col-span-2" : ""}`} placeholder="Track" value={event.track}
              onChange={(e) => setEvent({ ...event, track: e.target.value })} required />
          </div>
          <input className="input" type="datetime-local" value={event.date}
            onChange={(e) => setEvent({ ...event, date: e.target.value })} />
          <button className="btn-primary w-full" disabled={busy}>Create</button>
        </form>

        <div className="card p-5">
          <CardHead eyebrow="Schedule" title="Upcoming races" />
          <ul className="divide-y divide-border">
            {upcoming.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                <span className="font-semibold text-dark">
                  {r.isSpecialEvent ? "SE" : `Round ${r.number}`} — {r.track}
                </span>
                <span className="flex items-center gap-3">
                  {!r.isSpecialEvent && (
                    <button className="text-xs font-semibold text-primary hover:underline"
                      disabled={busy} onClick={() => announce(r.id)}>
                      Post to Discord
                    </button>
                  )}
                  <button className="text-xs font-semibold text-rose-500 hover:underline"
                    disabled={busy} onClick={() => deleteRace(r.id)}>
                    Delete
                  </button>
                </span>
              </li>
            ))}
            {upcoming.length === 0 && <li className="py-2 text-sm text-light">No upcoming races.</li>}
          </ul>
        </div>
      </div>
    </div>
    </div>
  );
}

// --- SEASONS ---------------------------------------------------------------
function Seasons() {
  const { data: seasons, reload } = useApi(useCallback(() => api.adminSeasons(), []));
  const [form, setForm] = useState({ number: "", name: "", game: "" });
  const [cloneFrom, setCloneFrom] = useState({}); // seasonId -> sourceSeasonId
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function create(e) {
    e.preventDefault();
    setBusy(true); setError(null); setMsg(null);
    try {
      await api.createSeason({ number: Number(form.number), name: form.name.trim(), game: form.game.trim() || null });
      setMsg(`Season ${form.name} created. It is not public yet — activate it when ready.`);
      setForm({ number: "", name: "", game: "" });
      reload();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function activate(id) {
    setBusy(true); setError(null); setMsg(null);
    try { await api.activateSeason(id); setMsg("Active season changed. Reload the site to see it as the default."); reload(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function clone(targetId) {
    const fromId = cloneFrom[targetId];
    if (!fromId) return;
    setBusy(true); setError(null); setMsg(null);
    try {
      const r = await api.cloneTeams(targetId, fromId);
      setMsg(`Copied ${r.created} team(s) into this season. Edit them under the Teams tab.`);
      reload();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={create} className="card space-y-4 p-5">
        <CardHead eyebrow="Seasons" title="Create a season" />
        <p className="text-sm text-light">
          A new season starts empty. Create it, copy or add teams &amp; drivers, schedule its races,
          then activate it to make it the public default. Old seasons stay available in the switcher.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <input className="input" type="number" placeholder="Number (e.g. 8)" value={form.number}
            onChange={(e) => setForm({ ...form, number: e.target.value })} required />
          <input className="input" placeholder="Name (e.g. Season 8)" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <input className="input" placeholder="Game / subtitle (e.g. F1 2010 · Assetto Corsa)" value={form.game}
          onChange={(e) => setForm({ ...form, game: e.target.value })} />
        {error && <Notice kind="error">{error}</Notice>}
        {msg && <Notice kind="success">{msg}</Notice>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Saving…" : "Create season"}</button>
      </form>

      <div className="card p-5">
        <CardHead eyebrow="All seasons" title={`Seasons (${(seasons || []).length})`} />
        <ul className="divide-y divide-border">
          {(seasons || []).map((s) => (
            <li key={s.id} className="space-y-2 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-display text-base font-bold text-dark">{s.name}</span>
                  {s.isActive && <span className="ml-2 pill bg-emerald-500/15 text-emerald-600">active</span>}
                  <div className="text-xs text-light">
                    {s.game || "—"} · {s._count.teams} teams · {s._count.drivers} drivers · {s._count.races} races
                  </div>
                </div>
                {!s.isActive && (
                  <button className="text-xs font-semibold text-primary hover:underline" disabled={busy}
                    onClick={() => activate(s.id)}>Make active</button>
                )}
              </div>
              {/* clone teams from another season */}
              {(seasons || []).length > 1 && (
                <div className="flex items-center gap-2">
                  <select className="input py-1 text-xs" value={cloneFrom[s.id] || ""}
                    onChange={(e) => setCloneFrom({ ...cloneFrom, [s.id]: e.target.value })}>
                    <option value="">Copy teams from…</option>
                    {(seasons || []).filter((o) => o.id !== s.id && o._count.teams > 0).map((o) => (
                      <option key={o.id} value={o.id}>{o.name} ({o._count.teams})</option>
                    ))}
                  </select>
                  <button className="btn-secondary px-3 py-1 text-xs" disabled={busy || !cloneFrom[s.id]}
                    onClick={() => clone(s.id)}>Copy</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// --- TEAMS -----------------------------------------------------------------
const TIER_LABEL = { 0: "Reserve", 1: "Tier 1", 2: "Tier 2" };

function Teams() {
  const { current } = useSeason();
  const { data: teams, reload } = useApi(useCallback(() => api.teams(), []));
  const [form, setForm] = useState({ id: "", name: "", tier: 2, color: "#888888" });
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function create(e) {
    e.preventDefault();
    setBusy(true); setError(null); setMsg(null);
    try {
      await api.createTeam({
        id: form.id.trim(), name: form.name.trim(), tier: Number(form.tier), color: form.color,
        seasonId: current?.id,
      });
      setMsg(`Team ${form.name} created.`);
      setForm({ id: "", name: "", tier: 2, color: "#888888" });
      reload();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function saveTeam(t, patch) {
    setBusy(true); setError(null); setMsg(null);
    try { await api.updateTeam(t.id, patch); reload(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function uploadLogo(t, file) {
    if (!file) return;
    setBusy(true); setError(null); setMsg(null);
    try { await api.uploadTeamLogo(t.id, file); setMsg(`Logo updated for ${t.name}.`); reload(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function remove(t) {
    if (!window.confirm(`Delete team "${t.name}"? This only works if it has no drivers or results.`)) return;
    setBusy(true); setError(null); setMsg(null);
    try { await api.deleteTeam(t.id); reload(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div>
      <SeasonScope />
      {error && <div className="mb-4"><Notice kind="error">{error}</Notice></div>}
      {msg && <div className="mb-4"><Notice kind="success">{msg}</Notice></div>}
      <div className="grid items-start gap-6 lg:grid-cols-3">
        {/* Add team */}
        <form onSubmit={create} className="card space-y-4 p-5 lg:col-span-1">
          <CardHead eyebrow="Teams" title="Add team" />
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-light">Name</label>
            <input className="input" placeholder="e.g. Mercedes" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-light">ID (slug)</label>
            <input className="input" placeholder="e.g. mercedes_s8" value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })} required />
            <p className="text-xs text-light">Unique across all seasons — a suffix like <code>_s8</code> helps.</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-light">Tier</label>
            <select className="input" value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}>
              <option value={1}>Tier 1</option>
              <option value={2}>Tier 2</option>
              <option value={0}>Reserve</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-light">Colour</label>
            <div className="flex items-center gap-2">
              <input className="h-10 w-12 shrink-0 cursor-pointer rounded border border-border bg-transparent" type="color"
                value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
              <input className="input font-mono" value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })} />
            </div>
          </div>
          <button className="btn-primary w-full" disabled={busy}>{busy ? "Saving…" : "Create team"}</button>
          <p className="text-xs text-light">Upload each team's logo from the list after creating it.</p>
        </form>

        {/* Roster */}
        <div className="card p-5 lg:col-span-2">
          <CardHead eyebrow="Roster" title={`Teams (${(teams || []).length})`} />
          <ul className="mt-1 divide-y divide-border">
            {(teams || []).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 py-3">
                {/* identity */}
                <div className="flex min-w-[12rem] flex-1 items-center gap-3">
                  <TeamLogo id={t.id} name={t.name} color={t.color} logoUrl={t.logoUrl} size={38} />
                  <div className="min-w-0">
                    <div className="truncate font-display text-base font-bold tracking-tight text-dark">{t.name}</div>
                    <div className="flex items-center gap-1.5 text-xs text-light">
                      <span className="font-mono">{t.id}</span>
                      <span>·</span>
                      <span>{t.drivers?.length || 0} drivers</span>
                    </div>
                  </div>
                </div>

                {/* controls */}
                <div className="flex items-center gap-2">
                  <select className="input w-28 py-1.5 text-sm" value={t.tier} disabled={busy}
                    onChange={(e) => saveTeam(t, { tier: Number(e.target.value) })}>
                    <option value={1}>Tier 1</option>
                    <option value={2}>Tier 2</option>
                    <option value={0}>Reserve</option>
                  </select>
                  <label className="btn-secondary cursor-pointer whitespace-nowrap px-3 py-1.5 text-xs">
                    {t.logoUrl ? "Change logo" : "Upload logo"}
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden"
                      onChange={(e) => uploadLogo(t, e.target.files?.[0])} />
                  </label>
                  <button title="Delete team" disabled={busy} onClick={() => remove(t)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-light transition hover:bg-rose-500/10 hover:text-rose-500">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
                    </svg>
                  </button>
                </div>
              </li>
            ))}
            {(teams || []).length === 0 && <li className="py-3 text-sm text-light">No teams in this season yet.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}

// --- CHANGE PIN ------------------------------------------------------------
function ChangePin() {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setMsg(null);
    setError(null);
    if (pin.length < 4) return setError("PIN must be at least 4 characters.");
    if (pin !== confirm) return setError("PINs do not match.");
    setBusy(true);
    try {
      await api.changePin(pin);
      setMsg("PIN updated.");
      setPin("");
      setConfirm("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card max-w-sm space-y-4 p-6">
      <CardHead eyebrow="Security" title="Change admin PIN" />
      <input type="password" className="input" placeholder="New PIN" value={pin} onChange={(e) => setPin(e.target.value)} />
      <input type="password" className="input" placeholder="Confirm new PIN" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      {error && <Notice kind="error">{error}</Notice>}
      {msg && <Notice kind="success">{msg}</Notice>}
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? "Saving…" : "Update PIN"}
      </button>
    </form>
  );
}
