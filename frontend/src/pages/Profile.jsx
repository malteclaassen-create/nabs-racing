import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth, getUserToken, saveUser } from "../hooks/useAuth.js";
import { Spinner, ErrorBox, PageHeader, DriverAvatar, TierBadge } from "../components/ui.jsx";
import Flag from "../components/Flag.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import { COUNTRIES } from "../data/countries.js";
import { SocialIcon, SOCIAL_META } from "../components/SocialLinks.jsx";
import RatingCard, { cardPhotoFraming } from "../components/RatingCard.jsx";
import DriverProfile from "./DriverProfile.jsx";

// The public profile shows at most this many stat tiles.
const MAX_TILES = 9;

// The platforms a driver can self-link (Discord is their login identity, not a
// link). Pulled from the shared SOCIAL_META so icons/labels stay in sync.
const SOCIAL_FIELDS = SOCIAL_META.filter((m) => m.key !== "discord");
const SOCIAL_PLACEHOLDER = {
  twitch: "https://twitch.tv/yourname",
  youtube: "https://youtube.com/@yourname",
  instagram: "https://instagram.com/yourname",
  tiktok: "https://tiktok.com/@yourname",
  x: "https://x.com/yourname",
};

// The stat tiles of the public profile page — the driver picks which ones
// show. Keys match the backend's PROFILE_TILE_KEYS; the first six are the
// classic default set. Tiles marked `telemetry` only render on the public
// profile when the season actually has that data.
const PROFILE_TILES = [
  { key: "wins", label: "Wins" },
  { key: "podiums", label: "Podiums" },
  { key: "bestFinish", label: "Best Finish" },
  { key: "avgFinish", label: "Avg Finish" },
  { key: "poles", label: "Poles" },
  { key: "gained", label: "Places Gained" },
  { key: "top5", label: "Top 5s" },
  { key: "top10", label: "Top 10s" },
  { key: "pointsFinishes", label: "In the Points" },
  { key: "dnf", label: "DNFs" },
  { key: "avgGrid", label: "Avg Grid" },
  { key: "fastestLap", label: "Fastest Lap" },
  { key: "overtakes", label: "Overtakes", telemetry: true },
  { key: "contacts", label: "Contacts", telemetry: true },
  { key: "consistency", label: "Consistency", telemetry: true },
  { key: "penalties", label: "Penalty Time" },
];
const DEFAULT_TILE_KEYS = PROFILE_TILES.slice(0, 6).map((t) => t.key);

// Tidy a { platform: value } map into full URLs: drop blanks, and prefix a bare
// host (e.g. "twitch.tv/foo") with https:// so the backend accepts it.
function normalizeSocials(map) {
  const out = {};
  for (const [k, raw] of Object.entries(map)) {
    const v = (raw || "").trim();
    if (!v) continue;
    out[k] = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  }
  return out;
}

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

// ---------------------------------------------------------------------------
// Card photo editor: the driver's OWN rating card as a live preview, with the
// picture draggable right on the card and a zoom slider next to it. Writes
// Driver.cardPhotoPos ({x,y,z}), which every card render site-wide then uses.
// ---------------------------------------------------------------------------
function CardPhotoEditor({ driver, rating, pos, setPos, onReset, resetting }) {
  const boxRef = useRef(null);
  const dragRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const p = cardPhotoFraming(pos);
  const round1 = (n) => Math.round(n * 10) / 10;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function onPointerDown(e) {
    e.preventDefault();
    // Keep receiving moves even when the pointer leaves the card mid-drag.
    // Capture can be unavailable (e.g. synthetic events); dragging still works.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    dragRef.current = { sx: e.clientX, sy: e.clientY, x: p.x, y: p.y };
    setDragging(true);
  }
  function onPointerMove(e) {
    const d = dragRef.current;
    const box = boxRef.current?.getBoundingClientRect();
    if (!d || !box) return;
    // Dragging the picture right reveals more of its LEFT side, i.e. the focal
    // point moves left — hence the minus. Zoomed in, the same hand movement
    // should shift the focus less, so the delta is divided by the zoom.
    const nx = clamp(d.x - (((e.clientX - d.sx) / box.width) * 100) / p.z, 0, 100);
    const ny = clamp(d.y - (((e.clientY - d.sy) / box.height) * 100) / p.z, 0, 100);
    setPos({ x: round1(nx), y: round1(ny), z: p.z });
  }
  function onPointerUp() {
    dragRef.current = null;
    setDragging(false);
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <RatingCard driver={{ ...driver, photoPos: p }} rating={rating} />
        {/* Invisible drag surface over the card's photo area (top two thirds). */}
        <div
          ref={boxRef}
          role="slider"
          aria-label="Drag to position your picture on the card"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="absolute left-0 top-0 h-[66%] w-full touch-none select-none"
          style={{ cursor: dragging ? "grabbing" : "grab" }}
          title="Drag to position your picture"
        />
      </div>
      <label className="block">
        <span className="mb-1.5 flex items-center justify-between font-mono text-[11px] font-bold uppercase tracking-wider text-medium">
          Zoom
          <span className="tabular-nums text-light">{p.z.toFixed(2)}×</span>
        </span>
        <input
          type="range"
          min="1"
          max="2.5"
          step="0.05"
          value={p.z}
          onChange={(e) => setPos({ x: p.x, y: p.y, z: Number(e.target.value) })}
          className="w-full"
          style={{ accentColor: driver.team?.color || "#e5548f" }}
          aria-label="Zoom"
        />
      </label>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-light">Drag the picture on the card to position it.</span>
        <button
          type="button"
          onClick={onReset}
          disabled={resetting}
          className="shrink-0 font-semibold text-light transition hover:text-dark"
        >
          Reset framing
        </button>
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

function ProfileEditor({ me, onDraftChange }) {
  const fileRef = useRef(null);
  const [photoUrl, setPhotoUrl] = useState(me.photoUrl);
  const [hasCustomPhoto, setHasCustomPhoto] = useState(me.hasCustomPhoto);
  const [name, setName] = useState(me.name);
  const [number, setNumber] = useState(me.number ?? "");
  const [country, setCountry] = useState(me.country || "");
  const [bio, setBio] = useState(me.bio || "");
  const [socials, setSocials] = useState(me.socials || {});
  // null/absent from the API means "the classic six" — expand so those toggles
  // start checked and the extra tiles start off.
  const [tiles, setTiles] = useState(me.profileTiles || DEFAULT_TILE_KEYS);

  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  // Rating card preview + photo framing. The rating only exists once the
  // driver has raced; without it (or without a picture) the block stays away.
  const ratingRes = useApi(useCallback(() => api.driverRating(me.driverId).catch(() => null), [me.driverId]));
  const [photoPos, setPhotoPos] = useState(me.photoPos || null);
  const [posDirty, setPosDirty] = useState(false);
  const [posSaving, setPosSaving] = useState(false);

  // Resets the card framing immediately (no separate save button — the main
  // "Save changes" persists a dragged/zoomed framing along with everything else).
  async function resetCardPhoto() {
    setError(null);
    setPosSaving(true);
    try {
      await api.setMyCardPhoto(null);
      setPhotoPos(null);
      setPosDirty(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setPosSaving(false);
    }
  }

  const color = me.team?.color || "#888";

  // Report the current (unsaved) edits upward — the page's live preview of the
  // public profile renders from this draft.
  useEffect(() => {
    onDraftChange?.({ name, number, country, bio, socials, tiles, photoUrl, photoPos });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, number, country, bio, socials, tiles, photoUrl, photoPos]);

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
      const cleanedSocials = normalizeSocials(socials);
      await api.updateMyProfile({ name: name.trim(), number, bio, socials: cleanedSocials });
      await api.setMyCountry(country);
      await api.setMyTiles(tiles);
      // A dragged/zoomed card framing rides along with the main save.
      if (posDirty) {
        const res = await api.setMyCardPhoto(photoPos);
        setPhotoPos(res.photoPos);
        setPosDirty(false);
      }
      // Keep the nav chip / stored identity in sync with the new display name.
      const token = getUserToken();
      const stored = (() => {
        try { return JSON.parse(localStorage.getItem("nabs_user") || "null"); } catch { return null; }
      })();
      if (token && stored) saveUser(token, { ...stored, driverName: name.trim(), avatarUrl: photoUrl });
      setSavedAt(Date.now());
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

        {/* Identity & fields (left) beside the driver card (right, lg+): one
            compact block instead of the old stacked photo row + card + form. */}
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_332px]">
          <div className="min-w-0 space-y-5">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
              {/* avatar with the upload button riding on it */}
              <div className="flex shrink-0 flex-col items-center gap-2 self-center sm:self-start">
                <div className="relative">
                  <DriverAvatar name={name} photoUrl={photoUrl} color={color} size={96} className="text-3xl" />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    title="Upload a new picture · PNG, JPG, WEBP or GIF, up to 8 MB"
                    aria-label="Upload a new picture"
                    className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full bg-brand text-ink shadow-md ring-2 ring-card transition hover:brightness-105"
                  >
                    {uploading ? (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink/30 border-t-ink" />
                    ) : (
                      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M4 8h3l2-3h6l2 3h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" />
                        <circle cx="12" cy="13.5" r="3.5" />
                      </svg>
                    )}
                  </button>
                </div>
                {hasCustomPhoto && (
                  <button
                    type="button"
                    onClick={resetPhoto}
                    disabled={uploading}
                    className="text-xs font-semibold text-light transition hover:text-dark"
                  >
                    Use Discord picture
                  </button>
                )}
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onPickFile} />
              </div>

              <div className="grid min-w-0 flex-1 gap-4 sm:grid-cols-2">
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
                      <option value="">Not set</option>
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
                    className="input min-h-[74px] resize-y"
                    value={bio}
                    maxLength={300}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder="A short line about yourself (optional)."
                  />
                </Field>
              </div>
            </div>

            {/* fixed identity — not editable here: team, tier, Discord login */}
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-light">
              {me.team && (
                <span className="flex items-center gap-2">
                  <TeamLogo id={me.team.id} name={me.team.name} color={color} logoUrl={me.team.logoUrl} size={18} />
                  <span className="font-display text-sm font-bold uppercase tracking-tight text-medium">{me.team.name}</span>
                </span>
              )}
              <TierBadge tier={me.tier} />
              <span className="text-faint">·</span>
              <span>{me.discordName}</span>
            </div>

            {/* Social links — optional, shown on the public driver profile. */}
            <div className="border-t border-border pt-5">
              <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-medium">Social links</span>
                <span className="text-xs text-light">Optional · shown on your public profile.</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {SOCIAL_FIELDS.map((m) => (
                  <label key={m.key} className="flex items-center gap-2.5">
                    <span
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface2 text-medium ring-1 ring-border"
                      title={m.label}
                    >
                      <SocialIcon name={m.key} className="h-[18px] w-[18px]" />
                    </span>
                    <input
                      className="input"
                      type="url"
                      inputMode="url"
                      value={socials[m.key] || ""}
                      onChange={(e) => setSocials((s) => ({ ...s, [m.key]: e.target.value }))}
                      placeholder={SOCIAL_PLACEHOLDER[m.key]}
                      aria-label={`${m.label} link`}
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Driver card with drag-to-position + zoom; saved by the main button. */}
          {ratingRes.data?.ratings && photoUrl && (
            <div className="mx-auto w-full max-w-[332px] lg:mx-0">
              <div className="mb-3 font-mono text-[11px] font-bold uppercase tracking-wider text-medium">Your driver card</div>
              <CardPhotoEditor
                driver={{
                  id: me.driverId,
                  name,
                  number: number === "" || number === null ? null : Number(number),
                  country,
                  photoUrl,
                  tier: me.tier,
                  team: me.team,
                }}
                rating={ratingRes.data}
                pos={photoPos}
                setPos={(p) => {
                  setPhotoPos(p);
                  setPosDirty(true);
                }}
                onReset={resetCardPhoto}
                resetting={posSaving}
              />
            </div>
          )}
        </div>

        {/* Stat tiles — pick which of the six headline stats the public
            profile shows. Unticked tiles simply disappear from the page. */}
        <div className="border-t border-border pt-5">
          <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-medium">Profile stats</span>
            <span className="text-xs text-light">
              Choose up to {MAX_TILES} stat tiles for your public profile. Overtakes, Contacts and Consistency
              need race telemetry and stay hidden in seasons without it.
            </span>
            <span
              className={`ml-auto font-mono text-[11px] font-bold tabular-nums ${
                tiles.length >= MAX_TILES ? "text-amber-600" : "text-light"
              }`}
            >
              {tiles.length}/{MAX_TILES}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {PROFILE_TILES.map((t) => {
              const on = tiles.includes(t.key);
              const full = !on && tiles.length >= MAX_TILES;
              return (
                <button
                  key={t.key}
                  type="button"
                  aria-pressed={on}
                  disabled={full}
                  title={full ? `Up to ${MAX_TILES} tiles: switch one off first` : undefined}
                  onClick={() =>
                    setTiles((cur) =>
                      on ? cur.filter((k) => k !== t.key) : cur.length >= MAX_TILES ? cur : [...cur, t.key]
                    )
                  }
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition ${
                    on
                      ? "border-brand/60 bg-brand/15 text-dark"
                      : full
                      ? "cursor-not-allowed border-border bg-surface2 text-faint"
                      : "border-border bg-surface2 text-light hover:text-medium"
                  }`}
                >
                  {on && (
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 12l5 5L20 7" />
                    </svg>
                  )}
                  {t.label}
                </button>
              );
            })}
          </div>
          {tiles.length === 0 && (
            <p className="mt-2 text-xs text-light">All tiles hidden: your public profile shows no stat tiles at all.</p>
          )}
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

// Small "share my profile" button — copies the public profile URL to the
// clipboard and flips to a confirmation for a moment.
function CopyProfileLink({ driverId }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    const url = `${window.location.origin}/drivers/${driverId}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy your profile link:", url);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  return (
    <button type="button" onClick={copy} className="btn-secondary inline-flex items-center gap-1.5">
      {copied ? (
        <>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>
          Copied
        </>
      ) : (
        <>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 007.07 0l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.07 0l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></svg>
          Copy link
        </>
      )}
    </button>
  );
}

function MyProfile() {
  const { user, logout } = useAuth();
  const me = useApi(useCallback(() => api.me(), []));

  // Current (unsaved) editor draft -> debounced into the live preview of the
  // public page at the bottom, so typing doesn't re-render the whole preview
  // on every keystroke.
  const [draft, setDraft] = useState(null);
  const [previewDraft, setPreviewDraft] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => setPreviewDraft(draft), 300);
    return () => clearTimeout(t);
  }, [draft]);

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

  return (
    <div className="space-y-6">
      {/* The old dark hero card is gone on purpose: everything it showed
          (name, flag, team, bio, socials) is editable right below and visible
          in the page preview — it only made the page longer. Its quick links
          live up here in the header now. */}
      <PageHeader
        eyebrow="Your profile"
        title="My Profile"
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/drivers/${d.driverId}`} className="btn-secondary">
              Public profile →
            </Link>
            <CopyProfileLink driverId={d.driverId} />
            <Link to="/tools" title="Fuel calculator, practice pace and pit strategy" className="btn-secondary">
              Race tools
            </Link>
            {user?.isAdmin && (
              <Link to="/admin" className="btn-primary">Admin area</Link>
            )}
            <button className="btn-secondary" onClick={logout}>Sign out</button>
          </div>
        }
      />

      <ProfileEditor me={d} onDraftChange={setDraft} />

      {/* Live preview of the PUBLIC driver page, overlaid with the unsaved
          edits above — change a tile or the bio and watch it land here.
          Links and race rows are deliberately inert (no accidental navigation
          mid-edit), but CONTROLS stay usable: the Season ⇄ All-time switch and
          the Head-to-Head opponent picker work right inside the preview. */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3">
          <div>
            <div className="font-mono text-[13px] font-bold uppercase tracking-[0.2em] text-eyebrow">Preview</div>
            <h2 className="font-display text-2xl font-extrabold uppercase tracking-tight text-dark">
              Your public page
            </h2>
          </div>
          <span className="text-xs text-light">
            Updates as you edit above; unsaved changes included.{" "}
            <Link to={`/drivers/${d.driverId}`} className="font-semibold text-primary hover:underline">
              Open the real page →
            </Link>
          </span>
        </div>
        <div className="pointer-events-none select-none overflow-hidden rounded-2xl border border-border bg-surface2/40 p-4 sm:p-6 [&_button]:pointer-events-auto [&_select]:pointer-events-auto">
          <DriverProfile
            previewId={d.driverId}
            preview={
              previewDraft
                ? {
                    name: (previewDraft.name || "").trim() || d.name,
                    number:
                      previewDraft.number === "" || previewDraft.number == null
                        ? null
                        : Number(previewDraft.number),
                    country: previewDraft.country || null,
                    bio: (previewDraft.bio || "").trim() || null,
                    socials: normalizeSocials(previewDraft.socials || {}),
                    profileTiles: previewDraft.tiles,
                    photoUrl: previewDraft.photoUrl,
                    photoPos: previewDraft.photoPos,
                  }
                : {}
            }
          />
        </div>
      </section>
    </div>
  );
}

export default function Profile() {
  const { isLoggedIn } = useAuth();
  return isLoggedIn ? <MyProfile /> : <DiscordLogin />;
}
