import { useCallback, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth } from "../hooks/useAuth.js";
import { Spinner, ErrorBox, PageHeader, TeamDot } from "../components/ui.jsx";
import Flag from "../components/Flag.jsx";
import { circuitFor } from "../data/circuits.js";
import { countryFor } from "../data/driverCountries.js";

const STATUS_UI = {
  ACCEPTED: { label: "✅ Accept", title: "Accepted", btn: "bg-green-600 hover:bg-green-700" },
  DECLINED: { label: "❌ Decline", title: "Declined", btn: "bg-red-600 hover:bg-red-700" },
  TENTATIVE: { label: "❓ Tentative", title: "Tentative", btn: "bg-amber-500 hover:bg-amber-600" },
};

function fmtDate(d) {
  if (!d) return "Date TBA";
  return new Date(d).toLocaleString("en-GB", {
    weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export default function RaceSignup() {
  const events = useApi(useCallback(() => api.events(), []));
  const discord = useApi(useCallback(() => api.discordConfig(), []));
  const { user, isLoggedIn, logout } = useAuth();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  // Identity always comes from the logged-in Discord account.
  const driverId = isLoggedIn ? user?.driverId : null;
  const discordEnabled = discord.data?.enabled;

  function startDiscordLogin() {
    if (discord.data?.url) window.location.href = discord.data.url;
  }

  async function setStatus(raceId, status) {
    setError(null);
    setBusy(`${raceId}:${status}`);
    try {
      await api.rsvp(raceId, driverId, status);
      await events.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function clear(raceId) {
    setBusy(`${raceId}:clear`);
    try {
      await api.removeRsvp(raceId, driverId);
      await events.reload();
    } finally {
      setBusy(null);
    }
  }

  if (events.loading) return <Spinner label="Loading upcoming races…" />;
  if (events.error) return <ErrorBox message={events.error} />;

  // Can this user actually sign up? Only when logged in AND linked to a driver.
  const canSignUp = isLoggedIn && !!driverId;

  return (
    <div>
      <PageHeader
        eyebrow="Race Sign-Up"
        title="Sign Up for Races"
        subtitle="Sign in with Discord and set your attendance. Your response is posted automatically in the Discord server."
      />

      {/* identity / login */}
      <div className="card mb-6 p-4">
        {isLoggedIn ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              Signed in as <span className="font-bold text-dark">{user.discordName}</span>
              {user.driverName ? (
                <span className="text-medium"> · Driver: <span className="font-semibold">{user.driverName}</span></span>
              ) : (
                <span className="ml-1 text-primary">
                  · your Discord account isn't linked to a driver yet — please contact an admin.
                </span>
              )}
            </div>
            <button className="btn-secondary" onClick={logout}>Sign out</button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            {discordEnabled ? (
              <>
                <button
                  onClick={startDiscordLogin}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#5865F2] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#4752c4]"
                >
                  <span>🎮</span> Sign in with Discord
                </button>
                <span className="text-sm text-light">Sign in to set your attendance.</span>
              </>
            ) : (
              <span className="text-sm text-medium">Discord login is not configured yet.</span>
            )}
          </div>
        )}
      </div>

      {error && <div className="mb-4"><ErrorBox message={error} /></div>}

      {events.data.length === 0 && (
        <div className="card p-8 text-center text-medium">No upcoming races scheduled right now.</div>
      )}

      <div className="space-y-6">
        {events.data.map((ev) => {
          const myStatus = ["ACCEPTED", "DECLINED", "TENTATIVE"].find((s) =>
            ev.rsvps[s].some((r) => r.driverId === driverId)
          );
          return (
            <div key={ev.id} className="card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface2 px-5 py-4">
                <div>
                  <h2 className="flex items-center gap-2.5 font-display text-xl font-extrabold uppercase tracking-tight text-dark">
                    {circuitFor(ev.track) && (
                      <Flag code={circuitFor(ev.track).country} title={circuitFor(ev.track).countryName} />
                    )}
                    <span className="text-light">R{ev.number}</span> {ev.track}
                  </h2>
                  <p className="mt-0.5 font-mono text-sm text-light">{fmtDate(ev.date)}</p>
                </div>
                {canSignUp ? (
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(STATUS_UI).map(([status, ui]) => (
                      <button
                        key={status}
                        onClick={() => setStatus(ev.id, status)}
                        disabled={busy === `${ev.id}:${status}`}
                        className={`rounded-lg px-3 py-2 text-sm font-semibold text-white transition disabled:opacity-50 ${ui.btn} ${
                          myStatus === status ? "ring-2 ring-offset-2 ring-dark" : ""
                        }`}
                      >
                        {ui.label}
                      </button>
                    ))}
                    {myStatus && (
                      <button
                        onClick={() => clear(ev.id)}
                        disabled={busy === `${ev.id}:clear`}
                        className="btn-secondary"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ) : (
                  <span className="text-sm text-light">Sign in to respond</span>
                )}
              </div>

              <div className="grid gap-4 p-5 sm:grid-cols-3">
                {["ACCEPTED", "DECLINED", "TENTATIVE"].map((status) => (
                  <div key={status}>
                    <div className="mb-2 font-mono text-xs font-bold uppercase tracking-wider text-medium">
                      {STATUS_UI[status].title}{" "}
                      <span className="text-light">
                        ({ev.rsvps[status].length}
                        {status === "ACCEPTED" ? `/${ev.capacity ?? 40}` : ""})
                      </span>
                    </div>
                    <ul className="space-y-1.5">
                      {ev.rsvps[status].map((r) => (
                        <li key={r.driverId} className="flex items-center gap-2 text-sm">
                          <TeamDot color={r.team.color} />
                          <span className={r.driverId === driverId ? "font-bold text-dark" : "text-dark"}>
                            {r.name}
                          </span>
                          <Flag code={countryFor(r.driverId)} w={16} h={12} />
                        </li>
                      ))}
                      {ev.rsvps[status].length === 0 && (
                        <li className="text-sm text-faint">—</li>
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
