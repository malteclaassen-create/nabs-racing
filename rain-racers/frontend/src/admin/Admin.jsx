import { useState } from "react";
import { NavLink, Routes, Route, Navigate } from "react-router-dom";
import { api } from "../api.js";
import { useSite } from "../site.jsx";
import RacesAdmin from "./RacesAdmin.jsx";
import DriversAdmin from "./DriversAdmin.jsx";
import TeamsAdmin from "./TeamsAdmin.jsx";
import SeasonsAdmin from "./SeasonsAdmin.jsx";
import MembersAdmin from "./MembersAdmin.jsx";
import DownloadsAdmin from "./DownloadsAdmin.jsx";
import SettingsAdmin from "./SettingsAdmin.jsx";

const TABS = [
  ["races", "Races & results"],
  ["drivers", "Drivers"],
  ["teams", "Teams"],
  ["seasons", "Seasons"],
  ["members", "Members"],
  ["downloads", "Downloads"],
  ["settings", "Settings"],
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

export default function Admin() {
  const { me, reload } = useSite();
  if (!me.isAdmin) return <PinLogin />;
  return (
    <div>
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
              `-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-bold ${isActive ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"}`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Navigate to="races" replace />} />
        <Route path="races" element={<RacesAdmin />} />
        <Route path="drivers" element={<DriversAdmin />} />
        <Route path="teams" element={<TeamsAdmin />} />
        <Route path="seasons" element={<SeasonsAdmin />} />
        <Route path="members" element={<MembersAdmin />} />
        <Route path="downloads" element={<DownloadsAdmin />} />
        <Route path="settings" element={<SettingsAdmin />} />
        <Route path="*" element={<Navigate to="races" replace />} />
      </Routes>
    </div>
  );
}
