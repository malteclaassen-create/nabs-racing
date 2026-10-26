import { useState } from "react";
import { NavLink, Routes, Route, Navigate, Link } from "react-router-dom";
import { api } from "../api.js";
import { useSite } from "../site.jsx";
import { AdminScope, useScope } from "./scope.jsx";
import RacesAdmin from "./RacesAdmin.jsx";
import EntriesAdmin from "./EntriesAdmin.jsx";
import TeamsAdmin from "./TeamsAdmin.jsx";
import SeriesAdmin from "./SeriesAdmin.jsx";
import DriversAdmin from "./DriversAdmin.jsx";
import AttendanceAdmin from "./AttendanceAdmin.jsx";
import MembersAdmin from "./MembersAdmin.jsx";
import DownloadsAdmin from "./DownloadsAdmin.jsx";
import SettingsAdmin from "./SettingsAdmin.jsx";

// [path, label, works on the picked series/season]
const TABS = [
  ["races", "Races & results", true],
  ["entries", "Entry list & transfers", true],
  ["teams", "Teams", true],
  ["attendance", "Attendance", true],
  ["series", "Series & seasons", true],
  ["drivers", "Drivers", false],
  ["members", "Members", false],
  ["downloads", "Downloads", false],
  ["settings", "Settings", false],
];

function PinLogin() {
  const { reload } = useSite();
  const [pin, setPin] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/admin", { pin });
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="card mx-auto mt-10 max-w-sm space-y-4 p-6">
      <h1 className="h2 text-xl">Admin</h1>
      <input className="input" type="password" inputMode="numeric" autoComplete="current-password" placeholder="PIN" value={pin} onChange={(e) => setPin(e.target.value)} autoFocus />
      {error && <p className="text-sm text-red-300">{error}</p>}
      <button className="btn-accent w-full" disabled={busy || !pin}>
        Sign in
      </button>
    </form>
  );
}

// Which series and season the scoped tabs work on.
function ScopeBar() {
  const { series, seriesId, setSeriesId, seasons, seasonId, setSeasonId, loaded } = useScope();
  if (!loaded) return null;
  if (!series.length) {
    return (
      <div className="card mb-6 p-4 text-sm text-muted">
        No series yet. Start under <Link to="/admin/series" className="text-ink underline">Series &amp; seasons</Link>.
      </div>
    );
  }
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-card px-4 py-3">
      <span className="label mb-0">Working on</span>
      <select className="input w-auto" value={seriesId ?? ""} onChange={(e) => setSeriesId(Number(e.target.value))} aria-label="Series">
        {series.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <select className="input w-auto" value={seasonId ?? ""} onChange={(e) => setSeasonId(Number(e.target.value))} aria-label="Season">
        {seasons.length === 0 && <option value="">No season</option>}
        {seasons.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.isCurrent ? " (current)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function Admin() {
  const { me, reload } = useSite();
  if (!me.isAdmin) return <PinLogin />;
  return (
    <AdminScope>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="h1">Admin</h1>
        <button
          className="text-sm text-muted hover:text-ink"
          onClick={async () => {
            await api.post("/auth/logout");
            reload();
          }}
        >
          Sign out
        </button>
      </div>
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map(([to, label]) => (
          <NavLink
            key={to}
            to={`/admin/${to}`}
            className={({ isActive }) =>
              `-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-bold ${isActive ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        {TABS.map(([path, , scoped]) => (
          <Route key={path} path={path} element={<Tab path={path} scoped={scoped} />} />
        ))}
        <Route path="*" element={<Navigate to="races" replace />} />
      </Routes>
    </AdminScope>
  );
}

const PAGES = {
  races: RacesAdmin,
  entries: EntriesAdmin,
  teams: TeamsAdmin,
  attendance: AttendanceAdmin,
  series: SeriesAdmin,
  drivers: DriversAdmin,
  members: MembersAdmin,
  downloads: DownloadsAdmin,
  settings: SettingsAdmin,
};

function Tab({ path, scoped }) {
  const Page = PAGES[path];
  return (
    <>
      {scoped && <ScopeBar />}
      <Page />
    </>
  );
}
