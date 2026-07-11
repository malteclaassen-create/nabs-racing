import { useCallback, useEffect, useState } from "react";
import { api, getToken, setToken } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth } from "../hooks/useAuth.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { PageHeader, ErrorBox, Notice, CardHead } from "../components/ui.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import AdminImport from "../components/AdminImport.jsx";
import AdminRatings from "../components/AdminRatings.jsx";
import AdminDownloads from "../components/AdminDownloads.jsx";
import AdminRaceInfo from "../components/AdminRaceInfo.jsx";
import AdminWelcomeFaq from "../components/AdminWelcomeFaq.jsx";
import AdminTracks from "../components/AdminTracks.jsx";
import AdminHealth from "../components/AdminHealth.jsx";
import AdminMembers from "../components/AdminMembers.jsx";
import RacePreview from "../components/RacePreview.jsx";
import { SOCIAL_META } from "../components/SocialLinks.jsx";
import { fmtTimeCell } from "../utils/raceDuration.js";

const TABS = [
  { id: "seasons", label: "Seasons" },
  { id: "teams", label: "Teams" },
  { id: "import", label: "Import Race" },
  { id: "edit", label: "Edit Results" },
  { id: "ratings", label: "Ratings" },
  { id: "discord", label: "Races & Events" },
  { id: "market", label: "Driver Market" },
  { id: "drivers", label: "Drivers" },
  { id: "members", label: "Members" },
  { id: "social", label: "Social Links" },
  { id: "tracks", label: "Tracks" },
  { id: "raceinfo", label: "Race Info" },
  { id: "faq", label: "Home FAQ" },
  { id: "downloads", label: "Downloads" },
  { id: "health", label: "Health" },
  { id: "pin", label: "Change PIN" },
];

// Prominent bar at the top of the admin: shows WHICH season every season-scoped
// edit below applies to, and lets the admin switch it right here (no hunting for
// the nav selector). Switching remounts the page (App keys on the season), so we
// stash the current tab first — the admin stays where they were.
function AdminSeasonBar({ tab }) {
  const { seasons, season, setSeason, current } = useSeason();
  if (!seasons?.length) return null;
  const isActive = current?.isActive;
  const isPrivate = current?.isPublic === false;
  const ordered = [...seasons].sort((a, b) => b.number - a.number);
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-3 border-l-4 pl-3" style={{ borderColor: isActive ? "#10b981" : isPrivate ? "#f43f5e" : "#f59e0b" }}>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 6a2 2 0 012-2h12a2 2 0 012 2v13a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM4 9h16M8 3v4M16 3v4" />
          </svg>
        </span>
        <div>
          <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">Currently editing</div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-lg font-extrabold uppercase leading-none tracking-tight text-dark">
              {current?.name || "—"}
            </span>
            {isActive ? (
              <span className="pill bg-emerald-500/15 text-emerald-600">active · public</span>
            ) : isPrivate ? (
              <span className="pill bg-rose-500/15 text-rose-600">private · hidden</span>
            ) : (
              <span className="pill bg-amber-500/15 text-amber-600">archive · public</span>
            )}
          </div>
          {current?.game && <div className="mt-0.5 text-xs text-light">{current.game}</div>}
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <span className="font-semibold text-medium">Switch season</span>
        <select
          className="input py-1.5"
          value={season ?? ""}
          onChange={(e) => {
            sessionStorage.setItem("nabs_admin_tab", tab); // survive the remount
            setSeason(Number(e.target.value));
          }}
        >
          {ordered.map((s) => (
            <option key={s.id} value={s.number}>
              {s.name}
              {s.isActive ? " (active)" : ""}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

// Red launch-checklist banner while the shipped dev defaults are still in use.
// Disappears on its own once the PIN is changed / a real JWT secret is set.
function SecurityBanner() {
  const { data } = useApi(useCallback(() => api.adminSecurity(), []));
  if (!data || (!data.pinIsDefault && !data.jwtIsDefault)) return null;
  return (
    <div className="mb-4 space-y-2">
      {data.pinIsDefault && (
        <Notice kind="error">
          The admin PIN is still the built-in default (<span className="font-mono">nabs2026</span>), so anyone who has
          seen the project files can log in here. Change it in the <b>Change PIN</b> tab before sharing the site.
        </Notice>
      )}
      {data.jwtIsDefault && (
        <Notice kind="error">
          <span className="font-mono">JWT_SECRET</span> is not set, so sessions are signed with a publicly known default.
          Set a long random <span className="font-mono">JWT_SECRET</span> in <span className="font-mono">backend/.env</span>{" "}
          and restart the backend.
        </Notice>
      )}
    </div>
  );
}

export default function Admin() {
  // Two ways in: the PIN admin token, or a designated Discord admin (their user
  // login already carries admin rights, so no PIN screen). A 401 from any admin
  // request forces the login view regardless.
  const { user } = useAuth();
  const isDiscordAdmin = !!user?.isAdmin;
  const [pinAuthed, setPinAuthed] = useState(!!getToken());
  const [unauthorized, setUnauthorized] = useState(false);
  const authed = !unauthorized && (pinAuthed || isDiscordAdmin);
  const [expired, setExpired] = useState(false);
  // Changing the season remounts the whole page (App keys on it), which would
  // reset the tab — so a deliberate tab hand-off (e.g. "Schedule races" jumping
  // to Races & Events) survives via sessionStorage.
  // (Read-only initializer: React may run it twice in dev StrictMode, so the
  // clean-up happens in the effect below, not here.)
  const [tab, setTab] = useState(() => sessionStorage.getItem("nabs_admin_tab") || "seasons");
  useEffect(() => {
    sessionStorage.removeItem("nabs_admin_tab");
  }, []);
  const { setSeason } = useSeason();

  // If any admin request reports an expired/invalid token, bounce to the login.
  useEffect(() => {
    const onUnauth = () => {
      setUnauthorized(true);
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
          setUnauthorized(false);
          setPinAuthed(true);
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
            // Leave the admin area. Clears the PIN token; a Discord admin stays
            // signed in to the site (their admin rights come from their account).
            setToken(null);
            window.location.href = "/";
          }}
        >
          Log out
        </button>
      </div>

      <SecurityBanner />

      <AdminSeasonBar tab={tab} />

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
        {tab === "seasons" && (
          <Seasons
            // One click from a season row to its race calendar: select that
            // season in the global switcher, then jump to the Races tab.
            gotoRaces={(s) => {
              sessionStorage.setItem("nabs_admin_tab", "discord");
              setSeason(s.number); // remounts the page; the tab survives above
            }}
          />
        )}
        {tab === "teams" && <Teams />}
        {tab === "import" && <AdminImport />}
        {tab === "edit" && <EditResults />}
        {tab === "ratings" && <AdminRatings />}
        {tab === "discord" && <DiscordEvents />}
        {tab === "market" && <MarketAdmin />}
        {tab === "drivers" && <Drivers />}
        {tab === "members" && <AdminMembers />}
        {tab === "social" && <SocialAdmin />}
        {tab === "tracks" && <AdminTracks />}
        {tab === "raceinfo" && <AdminRaceInfo />}
        {tab === "faq" && <AdminWelcomeFaq />}
        {tab === "downloads" && <AdminDownloads />}
        {tab === "health" && <AdminHealth />}
        {tab === "pin" && <ChangePin />}
      </div>
    </div>
  );
}

// --- DRIVER MARKET (admin override) ----------------------------------------
function MarketAdmin() {
  const market = useApi(useCallback(() => api.market(), []));
  const { data: teams } = useApi(useCallback(() => api.teams(), []));
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const reserves = (teams || [])
    .filter((t) => t.tier === 0)
    .flatMap((t) => t.drivers.map((d) => ({ id: d.id, name: d.name })));

  async function act(key, fn) {
    setError(null);
    setBusy(key);
    try {
      await fn();
      await market.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  if (market.loading) return <div className="text-sm text-light">Loading…</div>;
  if (market.error) return <ErrorBox message={market.error} />;

  const races = (market.data?.races || []).filter((r) => r.offers.length > 0);

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <CardHead eyebrow="Driver Market" title="Seat offers" />
        <p className="text-sm text-light">
          Override who fills an offered seat, e.g. to keep a weak reserve out of a Tier-1 car. You can
          assign any reserve, clear the pick, or remove an offer entirely.
        </p>
      </div>

      {error && <Notice kind="error">{error}</Notice>}

      {races.length === 0 && (
        <div className="card p-8 text-center text-medium">No open seat offers right now.</div>
      )}

      {races.map((race) => (
        <div key={race.id} className="card overflow-hidden">
          <div className="border-b border-border bg-surface2 px-5 py-3 font-display text-lg font-extrabold uppercase tracking-tight text-dark">
            R{race.number} · {race.track}
          </div>
          <div className="space-y-4 p-5">
            {race.offers.map((offer) => (
              <OfferAdminRow
                key={offer.id}
                offer={offer}
                reserves={reserves}
                busy={busy}
                onAssign={(driverId) =>
                  act(`assign:${offer.id}`, () => api.adminAssignSeat(offer.id, driverId))
                }
                onDelete={() => act(`del:${offer.id}`, () => api.adminDeleteOffer(offer.id))}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function OfferAdminRow({ offer, reserves, busy, onAssign, onDelete }) {
  const [sel, setSel] = useState(offer.filledBy?.driverId || "");
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold text-dark">
          {offer.team.name}
          <span className="ml-1 text-sm font-normal text-light">· seat of {offer.offeredBy.name}</span>
        </div>
        {offer.status === "FILLED" ? (
          <span className="pill bg-emerald-500/15 text-emerald-600">Filled · {offer.filledBy.name}</span>
        ) : (
          <span className="pill bg-amber-500/15 text-amber-600">Open</span>
        )}
      </div>

      {offer.interests.length > 0 && (
        <div className="mt-2 text-sm text-medium">
          Interested: {offer.interests.map((i) => i.name).join(", ")}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          className="input max-w-[14rem] py-1.5 text-sm"
          value={sel}
          onChange={(e) => setSel(e.target.value)}
        >
          <option value="">Choose a reserve…</option>
          {reserves.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <button
          className="btn-primary"
          disabled={!sel || busy === `assign:${offer.id}`}
          onClick={() => onAssign(sel)}
        >
          Assign
        </button>
        {offer.status === "FILLED" && (
          <button
            className="btn-secondary"
            disabled={busy === `assign:${offer.id}`}
            onClick={() => onAssign(null)}
          >
            Clear pick
          </button>
        )}
        <button
          className="text-sm font-semibold text-primary hover:underline disabled:opacity-50"
          disabled={busy === `del:${offer.id}`}
          onClick={onDelete}
        >
          Remove offer
        </button>
      </div>
    </div>
  );
}

// --- SOCIAL LINKS ----------------------------------------------------------
function SocialAdmin() {
  const { data, loading, error } = useApi(useCallback(() => api.getSocial(), []));
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  if (loading || !form) return <div className="text-sm text-light">Loading…</div>;
  if (error) return <ErrorBox message={error} />;

  async function save() {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      const res = await api.setSocial(form);
      setForm(res);
      setSaved(true);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-5 p-5">
      <CardHead eyebrow="Site" title="Social links" />
      <p className="text-sm text-light">
        Paste each profile or invite URL. Empty fields are simply hidden. The Discord link also
        powers the “Join Discord” button in the top bar.
      </p>
      {err && <Notice kind="error">{err}</Notice>}
      {saved && <Notice kind="success">Saved.</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        {SOCIAL_META.map((m) => (
          <div key={m.key}>
            <label className="mb-1 block text-sm font-semibold text-medium">{m.label}</label>
            <input
              className="input"
              placeholder="https://…"
              value={form[m.key] || ""}
              onChange={(e) => setForm((f) => ({ ...f, [m.key]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <button className="btn-primary" onClick={save} disabled={busy}>
        {busy ? "Saving…" : "Save links"}
      </button>
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
        {expired && <Notice kind="info">Your session expired. Please log in again.</Notice>}
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

// Date -> value for a <input type="datetime-local"> in the admin's local time.
function toLocalInput(date) {
  if (!date) return "";
  const d = new Date(date);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function EditResults() {
  const { data: races, reload: reloadRaces } = useApi(useCallback(() => api.races(), []));
  const { data: teams } = useApi(useCallback(() => api.teams(), []));
  const [raceId, setRaceId] = useState("");
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ track: "", date: "" }); // race details editor
  const [dotd, setDotd] = useState(""); // Driver of the Day pick
  const [dotdBy, setDotdBy] = useState(""); // who made the pick (streamer)
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
        setMeta({ track: d.race?.track || "", date: toLocalInput(d.race?.date) });
        setDotd(d.race?.driverOfTheDay?.driverId || "");
        setDotdBy(d.race?.driverOfTheDay?.pickedBy || "");
        setRows(
          d.results.map((r) => {
            const raw = r.rawPosition ?? r.position ?? "";
            return {
              driverId: r.driverId,
              name: r.name,
              position: raw, // raw finishing position (penalty is separate)
              status: r.status,
              subForTeamId: r.subForTeam?.id || "",
              ownTeamName: r.team?.name || "", // so the sub dropdown can say which team "own team" is
              penaltySeconds: r.penaltySeconds || 0,
              totalTimeMs: r.totalTimeMs ?? null, // race time, needed to apply a time penalty
              // The STORED points (null = derived from position). Never round-trip
              // the computed display points — that would freeze them as official.
              points: r.storedPoints ?? null,
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

  // Rename the round / fix its date — independent of the results below.
  async function saveDetails() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api.updateEvent(raceId, { track: meta.track, date: meta.date || null });
      setMsg("Race details saved.");
      reloadRaces(); // the round selector shows the new name
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Driver of the Day — the fan-favourite pick shown on the race facts.
  async function saveDotd() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api.setDriverOfTheDay(raceId, dotd || null, dotd ? dotdBy.trim() || null : null);
      setMsg(dotd ? "Driver of the Day saved." : "Driver of the Day cleared.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-semibold text-medium">Race</label>
        <select className="input max-w-xs" value={raceId} onChange={(e) => setRaceId(e.target.value)}>
          <option value="">Select a round…</option>
          {(races || []).filter((r) => !r.isSpecialEvent).map((r) => (
            <option key={r.id} value={r.id}>
              Round {r.number} · {r.track}
            </option>
          ))}
        </select>
      </div>

      {error && <ErrorBox message={error} />}
      {msg && <Notice kind="success">{msg}</Notice>}

      {raceId && (
        <div className="card flex flex-wrap items-end gap-3 p-4">
          <label className="flex flex-col gap-1 text-xs font-semibold text-light">
            Track name
            <input className="input min-w-56" value={meta.track}
              onChange={(e) => setMeta({ ...meta, track: e.target.value })}
              placeholder="e.g. COTA" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-light">
            Date &amp; time
            <input className="input" type="datetime-local" value={meta.date}
              onChange={(e) => setMeta({ ...meta, date: e.target.value })} />
          </label>
          <button className="btn-secondary" disabled={busy || !meta.track.trim()} onClick={saveDetails}>
            Save details
          </button>
          <span className="pb-2 text-xs text-light">Renames the round everywhere. Results stay untouched.</span>
        </div>
      )}

      {rows.length > 0 && (
        <div className="card flex flex-wrap items-end gap-3 p-4">
          <label className="flex flex-col gap-1 text-xs font-semibold text-light">
            Driver of the Day
            <select className="input min-w-56" value={dotd} onChange={(e) => setDotd(e.target.value)}>
              <option value="">None</option>
              {rows.map((r) => (
                <option key={r.driverId} value={r.driverId}>{r.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-light">
            Picked by
            <input
              className="input min-w-48"
              type="text"
              placeholder="e.g. the round's streamer"
              value={dotdBy}
              onChange={(e) => setDotdBy(e.target.value)}
              disabled={!dotd}
            />
          </label>
          <button className="btn-secondary" disabled={busy} onClick={saveDotd}>
            Save pick
          </button>
          <span className="pb-2 text-xs text-light">Shown as the fan-favourite card on the race facts, with credit to whoever picked it.</span>
        </div>
      )}

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
                        <option value="">
                          {r.ownTeamName ? `Own team · ${r.ownTeamName}` : "Driver’s own team"}
                        </option>
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
            in seconds. It&rsquo;s added to the driver&rsquo;s race time and the field is re-sorted, so they drop
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
  const [form, setForm] = useState({ name: "", discordName: "", teamId: "", tier: 2 });
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
      // The permanent technical id is generated server-side from the name.
      await api.createDriver({
        name: form.name.trim(),
        discordName: form.discordName.trim() || form.name.trim(),
        teamId: form.teamId,
        tier: Number(form.tier),
      });
      setMsg(`Driver ${form.name} created.`);
      setForm({ name: "", discordName: "", teamId: "", tier: 2 });
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
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={create} className="card space-y-4 p-5">
        <CardHead eyebrow="Drivers" title="Add driver" />
        <div className="grid grid-cols-2 gap-3">
          <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <input className="input" placeholder="Discord name" value={form.discordName} onChange={(e) => setForm({ ...form, discordName: e.target.value })} />
        </div>
        <p className="text-xs leading-relaxed text-light">
          For race imports to auto-recognise a driver, make their <span className="font-semibold text-medium">Name</span>{" "}
          or <span className="font-semibold text-medium">Discord name</span> match their in-game name (as it
          appears in the results file) as closely as possible. (You can always pick the right driver by hand during import if the auto-match misses.)
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
      setMsg("Test message sent. Check your Discord channel!");
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
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Webhook (second on purpose: scheduling races is the everyday task) */}
      <form onSubmit={saveWebhook} className="card space-y-4 p-5 order-2">
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
      <div className="space-y-6 order-1">
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
                  {r.isSpecialEvent ? "SE" : `Round ${r.number}`} · {r.track}
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

// The league default points table, mirrored from the backend — shown as the
// placeholder so the admin can see what "default" means.
const DEFAULT_POINTS_HINT = "35, 30, 25, 22, 20, 18, 16, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1";

// Turn the comma-separated points input into an array (or null for "default").
// Returns { ok, value | error }.
function parsePointsInput(text) {
  const t = String(text || "").trim();
  if (!t) return { ok: true, value: null };
  const parts = t.split(/[\s,;]+/).filter(Boolean).map(Number);
  if (parts.length === 0) return { ok: true, value: null };
  if (parts.length > 40 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 1000)) {
    return { ok: false, error: "Points must be whole numbers (0 to 1000), separated by commas, e.g. 25, 18, 15" };
  }
  return { ok: true, value: parts };
}

// Per-season scoring editor: how many worst rounds are dropped (0 = none) and
// the points-per-position table (empty = league default).
function SeasonScoring({ season, onSaved, onError }) {
  const stored = season.pointsTable ? JSON.parse(season.pointsTable).join(", ") : "";
  const storedTeamDrop = season.teamDropWorst == null ? "" : String(season.teamDropWorst);
  const storedTeamMode = season.teamDropMode === "rounds" ? "rounds" : "results";
  const [drop, setDrop] = useState(String(season.dropWorst ?? 3));
  const [teamDrop, setTeamDrop] = useState(storedTeamDrop);
  const [teamMode, setTeamMode] = useState(storedTeamMode);
  const [points, setPoints] = useState(stored);
  const [saving, setSaving] = useState(false);
  const dirty =
    drop !== String(season.dropWorst ?? 3) ||
    teamDrop.trim() !== storedTeamDrop ||
    teamMode !== storedTeamMode ||
    points.trim() !== stored;

  async function save() {
    const n = Number(drop);
    if (!Number.isInteger(n) || n < 0 || n > 10) return onError("Dropped rounds must be a whole number between 0 and 10.");
    let teamVal = null;
    if (teamDrop.trim() !== "") {
      const t = Number(teamDrop);
      if (!Number.isInteger(t) || t < 0 || t > 24) return onError("Team dropped rounds must be a whole number between 0 and 24, or blank.");
      teamVal = t;
    }
    const parsed = parsePointsInput(points);
    if (!parsed.ok) return onError(parsed.error);
    setSaving(true); onError(null);
    try {
      await api.updateSeason(season.id, {
        dropWorst: n,
        teamDropWorst: teamDrop.trim() === "" ? null : teamVal,
        teamDropMode: teamDrop.trim() === "" ? null : teamMode,
        pointsTable: parsed.value,
      });
      onSaved(`Scoring for ${season.name} saved.`);
    } catch (err) { onError(err.message); } finally { setSaving(false); }
  }

  // What the team-drop number means in each mode, so the admin sees the
  // difference at a glance (e.g. 6 results ≈ 3 whole rounds for 2-car teams).
  const teamModeHint =
    teamMode === "rounds"
      ? "Drops each team's N lowest WHOLE round totals (unrun rounds count as 0). This is how the league's official sheet calculates."
      : "Drops each team's N lowest single-driver round scores, however they're spread across the drivers.";

  return (
    <div className="space-y-1.5 rounded-lg bg-surface2/60 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-light">
          Dropped rounds
          <input className="input w-14 py-1 text-center text-xs" type="number" min="0" max="10"
            value={drop} onChange={(e) => setDrop(e.target.value)} title="How many of each driver's lowest-scoring rounds don't count in the driver standings (0 = every round counts)" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-light">
          Team drop
          <input className="input w-14 py-1 text-center text-xs" type="number" min="0" max="24" placeholder="—"
            value={teamDrop} onChange={(e) => setTeamDrop(e.target.value)} title="How many the constructor standings drop per team. What gets counted depends on the style next to this. Leave blank to keep the old rule (teams inherit driver drops)." />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-light">
          counts
          <select className="input py-1 text-xs" value={teamMode} onChange={(e) => setTeamMode(e.target.value)}
            disabled={teamDrop.trim() === ""} title={teamModeHint}>
            <option value="results">single results</option>
            <option value="rounds">whole team rounds (sheet style)</option>
          </select>
        </label>
        <input className="input min-w-40 flex-1 py-1 font-mono text-xs" placeholder={`Points P1, P2, … (default: ${DEFAULT_POINTS_HINT})`}
          value={points} onChange={(e) => setPoints(e.target.value)} title="Points per finishing position, starting at P1. Leave empty for the league default." />
        <button className="btn-secondary px-3 py-1 text-xs" disabled={saving || !dirty} onClick={save}>
          {saving ? "Saving…" : "Save scoring"}
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-light">
        {Number(drop) > 0
          ? `Driver totals drop each driver's ${drop} lowest round${Number(drop) === 1 ? "" : "s"}.`
          : "Every round counts for drivers (no dropped rounds)."}{" "}
        {teamDrop.trim() !== "" && Number(teamDrop) > 0 && (
          <>Teams drop their {teamDrop} lowest {teamMode === "rounds" ? "whole round totals (like the official sheet)" : "single-driver round scores"}. </>
        )}
        {points.trim() ? "Custom points table." : "League default points table."}
      </p>
    </div>
  );
}

function Seasons({ gotoRaces }) {
  const { data: seasons, reload } = useApi(useCallback(() => api.adminSeasons(), []));
  const [form, setForm] = useState({ number: "", name: "", game: "", dropWorst: "3", points: "" });
  const [cloneFrom, setCloneFrom] = useState({}); // seasonId -> sourceSeasonId
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function create(e) {
    e.preventDefault();
    setBusy(true); setError(null); setMsg(null);
    try {
      const parsed = parsePointsInput(form.points);
      if (!parsed.ok) throw new Error(parsed.error);
      await api.createSeason({
        number: Number(form.number),
        name: form.name.trim(),
        game: form.game.trim() || null,
        dropWorst: Number(form.dropWorst) || 0,
        pointsTable: parsed.value,
      });
      setMsg(`Season ${form.name} created. It is not public yet. Activate it when ready.`);
      setForm({ number: "", name: "", game: "", dropWorst: "3", points: "" });
      reload();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function activate(id) {
    setBusy(true); setError(null); setMsg(null);
    try { await api.activateSeason(id); setMsg("Active season changed. Reload the site to see it as the default."); reload(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function togglePublic(s) {
    setBusy(true); setError(null); setMsg(null);
    try {
      await api.updateSeason(s.id, { isPublic: !s.isPublic });
      setMsg(s.isPublic ? `${s.name} is now private. It stays hidden from the public until you publish it.` : `${s.name} is now public.`);
      reload();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  // "Coming up" strip on Home/Welcome: an announced upcoming season advertises
  // itself there (name, game, opener + car picture) even while still private.
  async function toggleAnnounce(s) {
    setBusy(true); setError(null); setMsg(null);
    try {
      await api.updateSeason(s.id, { isAnnounced: !s.isAnnounced });
      setMsg(
        s.isAnnounced
          ? `${s.name} is no longer announced on the home page.`
          : `${s.name} now shows in the "Coming up" strip on the home page (name, game and opener only).`
      );
      reload();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function clone(targetId, withDrivers) {
    const fromId = cloneFrom[targetId];
    if (!fromId) return;
    setBusy(true); setError(null); setMsg(null);
    try {
      if (withDrivers) {
        const r = await api.cloneRoster(targetId, fromId);
        setMsg(`Copied ${r.teamsCreated} team(s) and ${r.driversCreated} driver(s) into this season. Adjust them under Teams / Drivers.`);
      } else {
        const r = await api.cloneTeams(targetId, fromId);
        setMsg(`Copied ${r.created} team(s) into this season. Edit them under the Teams tab.`);
      }
      reload();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function remove(s) {
    const { teams, drivers, races } = s._count;
    const hasContent = teams > 0 || drivers > 0 || races > 0;

    if (!hasContent) {
      if (!window.confirm(`Delete ${s.name}?`)) return;
    } else {
      // Deleting a filled season wipes its teams, drivers and races. Make the
      // admin type the season's name so this can't happen on a stray click.
      // (A DB backup is created automatically right before the delete.)
      const typed = window.prompt(
        `${s.name} still holds ${teams} team(s), ${drivers} driver(s) and ${races} race(s).\n` +
        `Deleting removes ALL of it (a database backup is made first).\n\n` +
        `Type the season's name (${s.name}) to confirm:`
      );
      if (typed === null) return;
      if (typed.trim() !== s.name) {
        setError(`Not deleted. The typed name didn't match "${s.name}".`);
        return;
      }
    }

    setBusy(true); setError(null); setMsg(null);
    try {
      await api.deleteSeason(s.id, hasContent);
      setMsg(`${s.name} deleted${hasContent ? " (backup created first, see the Health tab)" : ""}.`);
      reload();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={create} className="card space-y-4 p-5">
        <CardHead eyebrow="Seasons" title="Create a season" />
        <p className="text-sm text-light">
          A new season starts empty. Create it, copy or add teams &amp; drivers, schedule its races
          in the <span className="font-semibold text-medium">Races &amp; Events</span> tab (or via
          &ldquo;Schedule races&rdquo; below), then activate it to make it the public default. Old
          seasons stay available in the switcher.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <input className="input" type="number" placeholder="Number (e.g. 8)" value={form.number}
            onChange={(e) => setForm({ ...form, number: e.target.value })} required />
          <input className="input" placeholder="Name (e.g. Season 8)" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <input className="input" placeholder="Game / subtitle (e.g. F1 2010 · Assetto Corsa)" value={form.game}
          onChange={(e) => setForm({ ...form, game: e.target.value })} />
        {/* scoring rules — editable again later on each season in the list */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-light">
            Dropped rounds
            <input className="input w-14 py-1.5 text-center text-xs" type="number" min="0" max="10" value={form.dropWorst}
              onChange={(e) => setForm({ ...form, dropWorst: e.target.value })}
              title="How many of each driver's/team's lowest-scoring rounds don't count (0 = every round counts)" />
          </label>
          <input className="input min-w-40 flex-1 py-1.5 font-mono text-xs" value={form.points}
            onChange={(e) => setForm({ ...form, points: e.target.value })}
            placeholder="Points P1, P2, … (empty = league default)"
            title={`Points per finishing position, starting at P1. Default: ${DEFAULT_POINTS_HINT}`} />
        </div>
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
                  {!s.isActive && s.isPublic === false && (
                    <span className="ml-2 pill bg-rose-500/15 text-rose-600">private · hidden</span>
                  )}
                  {s.isAnnounced && !s.isActive && (
                    <span className="ml-2 pill bg-sky-500/15 text-sky-600">announced</span>
                  )}
                  <div className="text-xs text-light">
                    {s.game || "—"} · {s._count.teams} teams · {s._count.drivers} drivers · {s._count.races} races
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button className="text-xs font-semibold text-primary hover:underline" disabled={busy}
                    onClick={() => gotoRaces?.(s)}
                    title="Switch to this season and open the race calendar">
                    Schedule races →
                  </button>
                  {!s.isActive && (
                    <>
                      <button className="text-xs font-semibold text-primary hover:underline" disabled={busy}
                        onClick={() => togglePublic(s)}
                        title={s.isPublic ? "Hide this season from the public" : "Publish this season to the public"}>
                        {s.isPublic ? "Make private" : "Make public"}
                      </button>
                      {/* only an UPCOMING season can advertise itself */}
                      {s.number > ((seasons || []).find((o) => o.isActive)?.number ?? -Infinity) && (
                        <button className="text-xs font-semibold text-primary hover:underline" disabled={busy}
                          onClick={() => toggleAnnounce(s)}
                          title={s.isAnnounced
                            ? "Remove the 'Coming up' strip from the home page"
                            : "Show a 'Coming up' strip on the home page (name, game and opener only), even while the season is private"}>
                          {s.isAnnounced ? "Stop announcing" : "Announce on Home"}
                        </button>
                      )}
                      <button className="text-xs font-semibold text-primary hover:underline" disabled={busy}
                        onClick={() => activate(s.id)}>Make active</button>
                      {/* any non-active season is deletable; a filled one requires
                          typing its name and is backed up first (server-enforced) */}
                      <button className="text-xs font-semibold text-light transition hover:text-primary" disabled={busy}
                        onClick={() => remove(s)}>Delete</button>
                    </>
                  )}
                </div>
              </div>
              <SeasonScoring key={`${s.id}-${s.dropWorst}-${s.teamDropWorst ?? "x"}-${s.teamDropMode ?? "x"}-${s.pointsTable || ""}`} season={s}
                onSaved={(m) => { setMsg(m); reload(); }} onError={setError} />
              {/* clone teams (or the full roster) from another season */}
              {(seasons || []).length > 1 && (
                <div className="flex flex-wrap items-center gap-2">
                  <select className="input py-1 text-xs" value={cloneFrom[s.id] || ""}
                    onChange={(e) => setCloneFrom({ ...cloneFrom, [s.id]: e.target.value })}>
                    <option value="">Copy from…</option>
                    {(seasons || []).filter((o) => o.id !== s.id && o._count.teams > 0).map((o) => (
                      <option key={o.id} value={o.id}>{o.name} ({o._count.teams} teams, {o._count.drivers} drivers)</option>
                    ))}
                  </select>
                  <button className="btn-secondary px-3 py-1 text-xs" disabled={busy || !cloneFrom[s.id]}
                    onClick={() => clone(s.id, false)}>Teams only</button>
                  <button className="btn-secondary px-3 py-1 text-xs" disabled={busy || !cloneFrom[s.id]}
                    onClick={() => clone(s.id, true)} title="Copies teams AND drivers as the new season's starting roster">
                    Teams + drivers</button>
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
  const [renaming, setRenaming] = useState(null); // { id, name } while a team is being renamed
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

  async function saveRename() {
    const name = (renaming?.name || "").trim();
    if (!name) return;
    await saveTeam({ id: renaming.id }, { name });
    setRenaming(null);
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
            <p className="text-xs text-light">Unique across all seasons. A suffix like <code>_s8</code> helps.</p>
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
                {/* identity — the name is renameable in place (pencil) */}
                <div className="flex min-w-[12rem] flex-1 items-center gap-3">
                  <TeamLogo id={t.id} name={t.name} color={t.color} logoUrl={t.logoUrl} size={38} />
                  {renaming?.id === t.id ? (
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <input
                        autoFocus
                        className="input py-1.5 text-sm"
                        value={renaming.name}
                        onChange={(e) => setRenaming({ id: t.id, name: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveRename();
                          if (e.key === "Escape") setRenaming(null);
                        }}
                      />
                      <button className="btn-primary px-3 py-1.5 text-xs" disabled={busy || !renaming.name.trim()} onClick={saveRename}>
                        Save
                      </button>
                      <button className="text-xs font-semibold text-light transition hover:text-dark" onClick={() => setRenaming(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-display text-base font-bold tracking-tight text-dark">{t.name}</span>
                        <button
                          title="Rename team"
                          disabled={busy}
                          onClick={() => setRenaming({ id: t.id, name: t.name })}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-light transition hover:bg-surface2 hover:text-dark"
                        >
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
                          </svg>
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-light">
                        <span className="font-mono">{t.id}</span>
                        <span>·</span>
                        <span>{t.drivers?.length || 0} drivers</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* controls */}
                <div className="flex items-center gap-2">
                  {/* team colour — saved when the picker closes (blur) */}
                  <input
                    key={`${t.id}-${t.color}`}
                    type="color"
                    defaultValue={t.color}
                    disabled={busy}
                    title="Team colour, click to change"
                    onBlur={(e) => {
                      const v = e.target.value;
                      if (v && v.toLowerCase() !== (t.color || "").toLowerCase()) saveTeam(t, { color: v });
                    }}
                    className="h-8 w-10 shrink-0 cursor-pointer rounded-lg border border-border bg-transparent"
                  />
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
