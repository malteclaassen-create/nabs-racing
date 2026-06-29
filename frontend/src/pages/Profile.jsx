import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth, getUserToken, saveUser } from "../hooks/useAuth.js";
import { Spinner, ErrorBox, PageHeader, DriverAvatar, TierBadge, CountUp } from "../components/ui.jsx";
import Flag from "../components/Flag.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import { COUNTRIES } from "../data/countries.js";
import { SocialIcon } from "../components/SocialLinks.jsx";

// ---------------------------------------------------------------------------
// /profile — login when logged out, the driver's own editable profile when in.
// Replaces the old Sign-Up page (RSVP + Driver Market moved to /races).
// ---------------------------------------------------------------------------

function DiscordLogin() {
  const discord = useApi(useCallback(() => api.discordConfig(), []));
  const enabled = discord.data?.enabled;

  function start() {
    if (discord.data?.url) window.location.href = discord.data.url;
  }

  return (
    <div>
      <PageHeader
        eyebrow="Members"
        title="Log in"
        subtitle="Sign in with your Discord account to manage your driver profile, set your attendance for races, and use the Driver Market."
      />
      <div className="mx-auto max-w-md">
        <div className="card flex flex-col items-center gap-5 p-8 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#5865F2]/15 text-[#5865F2]">
            <SocialIcon name="discord" className="h-7 w-7" />
          </span>
          <div>
            <h2 className="font-display text-xl font-extrabold uppercase tracking-tight text-dark">
              Sign in with Discord
            </h2>
            <p className="mt-1.5 text-sm text-light">
              We only read your Discord name and avatar to link you to your driver.
            </p>
          </div>
          {discord.loading ? (
            <span className="text-sm text-light">…</span>
          ) : enabled ? (
            <button
              onClick={start}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#5865F2] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#4752c4]"
            >
              <SocialIcon name="discord" className="h-5 w-5" />
              Continue with Discord
            </button>
          ) : (
            <p className="text-sm text-medium">Discord login is not configured yet.</p>
          )}
        </div>
        {/* Unobtrusive admin entry (moved out of the main nav). */}
        <div className="mt-3 text-right">
          <Link to="/admin" className="text-xs font-medium text-faint transition hover:text-light">
            Admin login
          </Link>
        </div>
      </div>
    </div>
  );
}

// A labelled field wrapper for the editor form.
function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[11px] font-bold uppercase tracking-wider text-medium">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-light">{hint}</span>}
    </label>
  );
}

function ProfileEditor({ me, onSaved }) {
  const fileRef = useRef(null);
  const [photoUrl, setPhotoUrl] = useState(me.photoUrl);
  const [hasCustomPhoto, setHasCustomPhoto] = useState(me.hasCustomPhoto);
  const [name, setName] = useState(me.name);
  const [number, setNumber] = useState(me.number ?? "");
  const [country, setCountry] = useState(me.country || "");
  const [bio, setBio] = useState(me.bio || "");

  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  const color = me.team?.color || "#888";

  async function onPickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const res = await api.uploadMyPhoto(file);
      setPhotoUrl(res.photoUrl);
      setHasCustomPhoto(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function resetPhoto() {
    setError(null);
    setUploading(true);
    try {
      const res = await api.clearMyPhoto();
      setPhotoUrl(res.photoUrl);
      setHasCustomPhoto(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      await api.updateMyProfile({ name: name.trim(), number, bio });
      await api.setMyCountry(country);
      // Keep the nav chip / stored identity in sync with the new display name.
      const token = getUserToken();
      const stored = (() => {
        try { return JSON.parse(localStorage.getItem("nabs_user") || "null"); } catch { return null; }
      })();
      if (token && stored) saveUser(token, { ...stored, driverName: name.trim(), avatarUrl: photoUrl });
      setSavedAt(Date.now());
      onSaved?.({ name: name.trim(), photoUrl });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card overflow-hidden">
      <h2 className="border-b border-border px-5 py-4 font-display text-lg font-extrabold uppercase tracking-tight text-dark">
        Edit your profile
      </h2>
      <div className="space-y-6 p-5 sm:p-6">
        {error && <ErrorBox message={error} />}

        {/* Profile picture */}
        <div className="flex flex-wrap items-center gap-5">
          <DriverAvatar name={name} photoUrl={photoUrl} color={color} size={84} className="text-2xl" />
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="btn-primary"
              >
                {uploading ? "…" : "Upload picture"}
              </button>
              {hasCustomPhoto && (
                <button type="button" onClick={resetPhoto} disabled={uploading} className="btn-secondary">
                  Use Discord picture
                </button>
              )}
            </div>
            <p className="text-xs text-light">PNG, JPG, WEBP or GIF · up to 8 MB.</p>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onPickFile} />
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Display name" hint="Shown across the site, including the standings.">
            <input
              className="input"
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
          </Field>
          <Field label="Racing number" hint="Optional, 0–999.">
            <input
              className="input"
              type="number"
              min={0}
              max={999}
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="—"
            />
          </Field>
          <Field label="Country">
            <div className="flex items-center gap-2.5">
              <Flag code={country} w={22} h={16} />
              <select className="input" value={country} onChange={(e) => setCountry(e.target.value)}>
                <option value="">— not set —</option>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </Field>
          <Field label="About me" hint={`${bio.length}/300`}>
            <textarea
              className="input min-h-[88px] resize-y"
              value={bio}
              maxLength={300}
              onChange={(e) => setBio(e.target.value)}
              placeholder="A short line about yourself (optional)."
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <button type="button" onClick={save} disabled={saving} className="btn-primary">
            {saving ? "Saving…" : "Save changes"}
          </button>
          {savedAt && <span className="text-sm font-semibold text-emerald-600">Saved.</span>}
        </div>
      </div>
    </div>
  );
}

// Read-only career snapshot + next-race attendance for the logged-in driver.
function ProfileStats({ driverId }) {
  const { data } = useApi(
    useCallback(
      () => Promise.all([api.driverProfile(driverId), api.events().catch(() => [])]),
      [driverId]
    )
  );
  if (!data) return null;
  const [profile, events] = data;
  const { championship, stats } = profile;

  // My status for the very next upcoming race, if any.
  const next = (events || [])[0];
  const myStatus = next
    ? ["ACCEPTED", "TENTATIVE", "DECLINED"].find((s) => next.rsvps[s].some((r) => r.driverId === driverId))
    : null;
  const STATUS_LABEL = { ACCEPTED: "Accepted ✅", TENTATIVE: "Tentative ❓", DECLINED: "Declined ❌" };

  const tiles = [
    { label: "Championship", value: championship.position ? `P${championship.position}` : "—", sub: `of ${championship.fieldSize}` },
    { label: "Points", value: championship.points ?? 0, sub: "this season" },
    { label: "Wins", value: stats.wins, sub: `${stats.podiums} podiums` },
    { label: "Best finish", value: stats.bestFinish ? `P${stats.bestFinish}` : "—", sub: `${stats.starts} starts` },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="card p-4">
            <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">{t.label}</div>
            <div className="mt-2 font-display text-3xl font-black tabular-nums text-dark">
              {typeof t.value === "number" ? <CountUp end={t.value} /> : t.value}
            </div>
            <div className="mt-1 text-xs text-light">{t.sub}</div>
          </div>
        ))}
      </div>

      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="text-sm text-medium">
          {next ? (
            <>
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">Next race · </span>
              <span className="font-semibold text-dark">R{next.number} {next.track}</span>
              {" — "}
              {myStatus ? (
                <span className="font-semibold text-dark">{STATUS_LABEL[myStatus]}</span>
              ) : (
                <span className="text-light">no response yet</span>
              )}
            </>
          ) : (
            <span className="text-light">No upcoming races scheduled.</span>
          )}
        </div>
        <Link to="/races" className="btn-secondary">
          {next ? "Set attendance" : "Race calendar"}
        </Link>
      </div>
    </div>
  );
}

function MyProfile() {
  const { user, logout } = useAuth();
  const me = useApi(useCallback(() => api.me(), []));
  const [displayName, setDisplayName] = useState(null);

  if (me.loading) return <Spinner label="Loading your profile…" />;
  if (me.error) return <ErrorBox message={me.error} />;

  // Logged in with Discord but not yet matched to a roster driver.
  if (me.data && me.data.isLinked === false) {
    return (
      <div>
        <PageHeader eyebrow="Profile" title="Almost there" />
        <div className="mx-auto max-w-md space-y-4">
          <div className="card p-6 text-center">
            <p className="text-sm text-medium">
              You're signed in as <span className="font-bold text-dark">{me.data.discordName}</span>, but your
              Discord account isn't linked to a driver yet. Please contact an admin to get linked.
            </p>
          </div>
          <button className="btn-secondary w-full" onClick={logout}>Sign out</button>
        </div>
      </div>
    );
  }

  const d = me.data;
  const color = d.team?.color || "#888";
  const name = displayName || d.name;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Your profile" title="My Profile" right={<button className="btn-secondary" onClick={logout}>Sign out</button>} />

      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-ink text-white shadow-lg">
        <span className="absolute inset-x-0 top-0 z-10 h-1.5" style={{ backgroundColor: color }} />
        <div className="absolute inset-0" style={{ background: `radial-gradient(120% 140% at 88% 10%, ${color}55, transparent 55%)` }} />
        <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/85 to-transparent" />
        <div className="relative flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:gap-7 sm:p-8">
          <DriverAvatar name={name} photoUrl={d.photoUrl} color={color} size={104} className="text-3xl ring-4 ring-white/10" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              {d.number != null && (
                <span className="font-display text-3xl font-black leading-none tabular-nums text-white/40">#{d.number}</span>
              )}
              <h1 className="font-display text-4xl font-black uppercase tracking-tight sm:text-5xl">{name}</h1>
              <Flag code={d.country} w={28} h={20} />
              <TierBadge tier={d.tier} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-white/70">
              {d.team && (
                <Link to={`/teams/${d.team.id}`} className="group flex items-center gap-2">
                  <TeamLogo id={d.team.id} name={d.team.name} color={color} logoUrl={d.team.logoUrl} size={22} />
                  <span className="font-display text-base font-bold uppercase tracking-tight text-white/90 transition group-hover:text-white">
                    {d.team.name}
                  </span>
                </Link>
              )}
              <span className="text-white/30">·</span>
              <span className="text-sm">{d.discordName}</span>
            </div>
            {d.bio && <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/80">{d.bio}</p>}
          </div>
          <div className="shrink-0 sm:self-start">
            <Link to={`/drivers/${d.driverId}`} className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/15">
              Public profile →
            </Link>
          </div>
        </div>
      </div>

      <ProfileStats driverId={d.driverId} />
      <ProfileEditor me={d} onSaved={({ name: n }) => setDisplayName(n)} />
    </div>
  );
}

export default function Profile() {
  const { isLoggedIn } = useAuth();
  return isLoggedIn ? <MyProfile /> : <DiscordLogin />;
}
