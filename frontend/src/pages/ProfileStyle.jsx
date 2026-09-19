// The profile studio: try designs on your own profile page and buy them with
// NABS Points. Ported from the league's design copy; the catalogue lives in
// shared/profileCosmetics.json, ownership and payment in the tokens API.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import { TOKENS_CHANGED_EVENT } from "../hooks/useTokenBalance.js";
import { useAuth } from "../hooks/useAuth.js";
import { useApi } from "../hooks/useApi.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { useSeries } from "../context/SeriesContext.jsx";
import { PageHeader } from "../components/ui.jsx";
import { useAsk } from "../components/overlay.jsx";
import TokenIcon from "../components/TokenIcon.jsx";
import ProfileAppearance, { ProfileBanner, PROFILE_COSMETICS, EMPTY_APPEARANCE, EMPTY_PROFILE_CONTENT, useProfilePageTheme } from "../components/ProfileAppearance.jsx";
import { PROFILE_SLOTS, profileItemPrice, applyProfileItem } from "../../../shared/profileCustomization.mjs";
import DriverProfile from "./DriverProfile.jsx";
import "./profileStyle.css";

const CATEGORIES = [{ id: "theme", label: "Themes" }, { id: "banner", label: "Banners" }, { id: "nameplate", label: "Name" }, { id: "stats", label: "Statistics" }, { id: "effect", label: "Effects" }, { id: "layout", label: "Layout" }];
const CATEGORY_FIELDS = {
  theme: ["accentColor"],
  banner: ["bannerImage", "bannerPosition", "bannerStrength"],
  nameplate: ["title", "nameCase", "nameScale"],
  stats: [],
  effect: ["effectStrength"],
  layout: ["panelShape", "density", "motion"],
};
function categoryStatus(id, appearance, content, baseline, baselineContent) {
  const design = PROFILE_COSMETICS.find(item => item.slot === id && item.id === appearance[id]);
  const value = (source, key) => source[key] ?? EMPTY_PROFILE_CONTENT[key];
  const customized = CATEGORY_FIELDS[id].some(key => value(content, key) !== EMPTY_PROFILE_CONTENT[key]);
  const changed = (appearance[id] ?? null) !== (baseline[id] ?? null) || CATEGORY_FIELDS[id].some(key => value(content, key) !== value(baselineContent, key));
  return { label: design?.name || (customized ? "Custom settings" : "Original"), active: !!design || customized, changed };
}
const same = (a, b) => PROFILE_SLOTS.every(s => a[s] === b[s]);
const FAVORITES_KEY = "nabs-profile-design-favorites";
function readFavorites() {
  try { const saved = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]"); return Array.isArray(saved) ? saved.filter(id => PROFILE_COSMETICS.some(item => item.id === id)) : []; } catch { return []; }
}
function RangeControl({ label, value, min = 0, max = 100, onChange, disabled = false }) {
  return <label className="shop-range"><span>{label}<span className="shop-range-value" aria-hidden="true">{value}%</span></span><input aria-label={label} type="range" min={min} max={max} value={value} disabled={disabled} onChange={e => onChange(Number(e.target.value))} /></label>;
}
function DesignSwatch({ item, driver, appearance, stats }) {
  const sample = { ...driver, id: undefined, profileContent: { ...EMPTY_PROFILE_CONTENT, motion: false } };
  const look = { ...EMPTY_APPEARANCE, theme: appearance.theme, [item.slot]: item.id };
  if (item.slot === "banner") return <ProfileBanner compact driver={{ ...sample, profileContent: EMPTY_PROFILE_CONTENT }} appearance={look} />;
  if (item.slot === "effect") return <div className="shop-effect-swatch"><div className="profile-surface-effect" data-finish={item.finish} /><span /></div>;
  return <ProfileAppearance driver={sample} appearance={look} className={`shop-design-swatch shop-design-swatch--${item.slot}`}>
    {item.slot === "theme" ? <div className="shop-palette"><span /><span /><span /><span /></div> : item.slot === "nameplate" ? <span className="profile-driver-name">{driver?.name || "Driver"}</span> : <div className="profile-stats"><div><span>WINS</span><strong className="font-display">{stats?.wins ?? 0}</strong></div><div><span>PODIUMS</span><strong className="font-display">{stats?.podiums ?? 0}</strong></div><div><span>POLES</span><strong className="font-display">{stats?.polePositions ?? 0}</strong></div></div>}
  </ProfileAppearance>;
}

export default function ProfileStyle() {
  const ask = useAsk();
  const { user } = useAuth();
  const { season } = useSeason();
  const { slug } = useSeries();
  const [params, setParams] = useSearchParams();
  const roster = useApi(useCallback(() => api.driverStandings(season), [season, slug]));
  const [previewDriverId, setPreviewDriverId] = useState(() => params.get("driver") || localStorage.getItem("nabs-studio-preview-driver") || "");
  const [account, setAccount] = useState(null);
  const [me, setMe] = useState(null);
  const [draft, setDraft] = useState(EMPTY_APPEARANCE);
  const [content, setContent] = useState(EMPTY_PROFILE_CONTENT);
  const [slot, setSlot] = useState("theme");
  const [search, setSearch] = useState("");
  const [tone, setTone] = useState("all");
  const [favorites, setFavorites] = useState(readFavorites);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [comparing, setComparing] = useState(false);

  const [ownedOnly, setOwnedOnly] = useState(false);
  const [pageOnly, setPageOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const edited = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const [photo, setPhoto] = useState(null);
  const [files, setFiles] = useState({});
  const mediaUrls = useRef(new Set());
  const uploaded = useRef(new Map());
  const photoRef = useRef();
  const bannerRef = useRef();


  useEffect(() => {
    let active = true;
    setAccount(null); setMe(null); setDraft(EMPTY_APPEARANCE); setContent(EMPTY_PROFILE_CONTENT); setError(""); setFiles({}); edited.current = false;
    if (!user?.discordId) { setLoading(false); return; }
    setLoading(true);
    Promise.all([api.tokensStudio(), api.me()]).then(([shop, profile]) => {
      if (!active) return;
      setAccount(shop); setMe(profile); setDraft({ ...EMPTY_APPEARANCE, ...shop.equipped }); setContent({ ...EMPTY_PROFILE_CONTENT, ...shop.content });
    }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.discordId, reload]);
  useEffect(() => {
    const urls = mediaUrls.current;
    return () => urls.forEach(url => URL.revokeObjectURL(url));
  }, []);

  const publicDrivers = roster.data?.standings || [];
  const publicDriver = publicDrivers.find(d => d.driverId === previewDriverId) || publicDrivers[0];
  const driverId = me?.isLinked ? me.driverId : publicDriver?.driverId;
  const profile = useApi(useCallback(() => driverId ? api.driverProfile(driverId) : Promise.resolve(null), [driverId]));
  const loadedDriver = driverId && profile.data?.driver?.id === driverId ? profile.data.driver : null;
  const driver = loadedDriver || (me?.isLinked ? me : publicDriver);
  const editingDisabled = busy || loading || !loadedDriver || (!!user && !account);
  useEffect(() => {
    if (!user && driverId && profile.data?.driver?.id === driverId && !edited.current) {
      setDraft({ ...EMPTY_APPEARANCE, ...profile.data.driver.appearance });
      setContent({ ...EMPTY_PROFILE_CONTENT, ...profile.data.driver.profileContent });
    }
  }, [profile.data, driverId, user]);
  const picturedDriver = driver ? { ...driver, profileContent: content, ...(photo ? { photoUrl: photo } : {}) } : null;
  const owned = account?.owned || [];
  const catalogue = account?.items || PROFILE_COSMETICS;
  const selected = PROFILE_COSMETICS.find(i => i.id === draft[slot]);
  const price = selected ? profileItemPrice(catalogue, selected, owned) : 0;
  const locked = PROFILE_SLOTS.some(s => draft[s] && !owned.includes(draft[s]));
  const baseline = account?.equipped || loadedDriver?.appearance || EMPTY_APPEARANCE;
  const baselineContent = account?.content || loadedDriver?.profileContent || EMPTY_PROFILE_CONTENT;
  const previewAppearance = comparing ? baseline : draft;
  const previewContent = comparing ? { ...EMPTY_PROFILE_CONTENT, ...baselineContent } : content;
  useProfilePageTheme(previewAppearance.theme, true, previewContent, driver?.team?.color);
  const changed = !same(draft, baseline) || JSON.stringify(content) !== JSON.stringify(baselineContent);
  const items = PROFILE_COSMETICS.filter(i => i.slot === slot && (!ownedOnly || owned.includes(i.id)) && (!favoritesOnly || favorites.includes(i.id)) && (slot !== "theme" || tone === "all" || i.tone === tone) && i.name.toLowerCase().includes(search.trim().toLowerCase()));
  const missing = catalogue.filter(item => draft[item.slot] === item.id && !owned.includes(item.id));
  const missingCost = missing.reduce((sum, item) => sum + item.price, 0);
  const settings = { ...EMPTY_PROFILE_CONTENT, ...content };
  function changeCategory(id) { setSlot(id); setSearch(""); setNotice(""); }
  function toggleFavorite(id) {
    const next = favorites.includes(id) ? favorites.filter(f => f !== id) : [...favorites, id];
    setFavorites(next);
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(next)); } catch { /* Favorites still work for this visit if storage is unavailable. */ }
  }
  function choose(item) { if (editingDisabled) return; edited.current = true; setComparing(false); setDraft(d => applyProfileItem(PROFILE_COSMETICS, d, item)); setNotice(""); }


  function editContent(patch) { if (editingDisabled) return; edited.current = true; setComparing(false); setContent(c => ({ ...c, ...patch })); setNotice(""); }
  function reset() { edited.current = false; setComparing(false); setDraft({ ...EMPTY_APPEARANCE, ...baseline }); setContent({ ...EMPTY_PROFILE_CONTENT, ...baselineContent }); setFiles({}); setNotice(""); }
  function chooseDriver(id) {
    setPreviewDriverId(id); setPhoto(null); setFiles({}); setComparing(false); edited.current = false;
    setDraft(EMPTY_APPEARANCE); setContent(EMPTY_PROFILE_CONTENT);
    localStorage.setItem("nabs-studio-preview-driver", id);
    setParams({ driver: id }, { replace: true });
  }
  function pickImage(event, kind) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 8 * 1024 * 1024) { setError("Use a PNG, JPG or WebP image, up to 8 MB."); return; }
    const url = URL.createObjectURL(file); mediaUrls.current.add(url); setError("");
    if (kind === "profile") setPhoto(url);
    else { setFiles(f => ({ ...f, [kind]: file })); editContent({ bannerImage: url }); }
  }
  async function act(kind) {
    if (busyRef.current || !account) return;
    // Buying spends points and cannot be undone; applying a look can be
    // changed back any time, so only the purchase asks.
    if (kind === "buy") {
      const ok = await ask({
        title: `Buy ${selected.name}?`,
        body: `${price.toLocaleString()} points come off your balance. You have ${account.balance.toLocaleString()}.\n\nIt stays in your collection and you can put it on and take it off whenever you like.`,
        confirmLabel: `Buy for ${price.toLocaleString()}`,
      });
      if (!ok) return;
    }
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try {
      if (kind === "buy") {
        const result = await api.buyStudioItem(selected.id);
        setAccount(a => ({ ...a, ...result })); setNotice(`${selected.name} added to your collection.`);
        window.dispatchEvent(new Event(TOKENS_CHANGED_EVENT));
      } else {
        const next = { ...content };
        for (const [kind, file] of Object.entries(files)) {
          let url = uploaded.current.get(file);
          if (!url) { url = (await api.uploadStudioImage(kind, file)).url; uploaded.current.set(file, url); }
          next.bannerImage = url;
        }
        const result = await api.equipStudio({ appearance: draft, content: next });
        setAccount(a => ({ ...a, ...result })); setDraft(result.equipped); setContent(result.content); setFiles({}); setNotice("Profile updated.");
      }
    } catch (e) {
      setError(e.message);
      try { setAccount(await api.tokensStudio()); } catch { /* Preserve the original failure. */ }
    } finally { busyRef.current = false; setBusy(false); }
  }

  return <div className={`profile-shop ${pageOnly ? "profile-shop--page" : "space-y-6"}`} style={{ "--profile-team": driver?.team?.color || "#638daf" }}>
    {pageOnly ? <button className="shop-return btn-primary" onClick={() => setPageOnly(false)}>← Back to customization</button> : <>
      <PageHeader title="Profile Studio" right={<div className="flex flex-wrap items-center gap-3"><Link to="/profile?tab=tokens" className="btn-secondary">NABS Points</Link><Link to="/profile" className="btn-secondary">My profile</Link><button className="btn-primary" disabled={!driverId} onClick={() => setPageOnly(true)}>View full page ↗</button></div>} />
      <div className="shop-toolbar"><div className="shop-tabs" role="group" aria-label="Design category">{CATEGORIES.map(s => {
        const status = categoryStatus(s.id, draft, content, baseline, baselineContent);
        const description = `${status.label}${status.changed ? " · Unsaved changes" : status.active ? " · Saved" : ""}`;
        return <button key={s.id} type="button" aria-label={s.label} aria-describedby={`shop-category-${s.id}`} aria-pressed={slot === s.id} data-customized={status.active} data-changed={status.changed} title={`${s.label}: ${description}`} onClick={() => changeCategory(s.id)}>
          <span className="shop-tab-label">{s.label}{status.changed ? <span className="shop-tab-dot" aria-hidden="true" /> : status.active ? <span className="shop-tab-check" aria-hidden="true">✓</span> : null}</span>
          <span className="shop-tab-design" aria-hidden="true">{status.label}</span>
          <span className="sr-only" id={`shop-category-${s.id}`}>{description}</span>
        </button>;
      })}</div><div className="shop-balance"><TokenIcon className="h-6 w-6" /><span>NABS Points</span><strong>{account ? account.balance.toLocaleString() : "–"}</strong></div></div>
      {error && <div role="alert" className="shop-message shop-message--error">{error} {!account && user && <button className="btn-secondary" onClick={() => setReload(n => n + 1)}>Retry</button>}</div>}
      {loading && <p role="status">Loading your collection…</p>}
      <section className="shop-catalog" aria-label="Profile designs">
        <div className="shop-section-head"><h2>{CATEGORIES.find(s => s.id === slot).label}</h2>{slot !== "layout" && <div className="shop-filters"><input className="input shop-search" type="search" aria-label="Search designs" placeholder="Search designs" value={search} onChange={e => setSearch(e.target.value)} /><label><input type="checkbox" checked={favoritesOnly} onChange={e => setFavoritesOnly(e.target.checked)} /> Favorites</label><label><input type="checkbox" checked={ownedOnly} onChange={e => setOwnedOnly(e.target.checked)} /> Owned</label></div>}</div>
        {slot === "theme" && <div className="shop-tone-filter" role="group" aria-label="Theme brightness">{[["all", "All"], ["dark", "Dark"], ["light", "Light"]].map(([id, label]) => <button key={id} type="button" aria-pressed={tone === id} onClick={() => setTone(id)}>{label}</button>)}</div>}
        {slot !== "layout" && <>
        <div className="shop-items" data-category={slot}>
          <button type="button" className="shop-item shop-item--default" aria-pressed={!draft[slot]} disabled={editingDisabled} onClick={() => { edited.current = true; setComparing(false); setDraft(d => ({ ...d, [slot]: null })); }}><span className="shop-default-mark">↺</span><span className="shop-item-caption"><strong>Original</strong><span>Free</span></span></button>
          {items.map(item => <div className="shop-design-option" key={item.id}><button type="button" className="shop-item" aria-label={`Preview ${item.name}`} aria-pressed={draft[slot] === item.id} disabled={editingDisabled} onClick={() => choose(item)}>
            <div className={`shop-item-art shop-item-art--${slot}`} data-finish={item.finish} aria-hidden="true">
              <DesignSwatch item={item} driver={picturedDriver} appearance={draft} stats={loadedDriver ? profile.data.stats : null} />
            </div>
            <span className="shop-item-caption"><strong>{item.name}</strong><span>{profileItemPrice(catalogue, item, owned) === 0 ? "Owned" : `${profileItemPrice(catalogue, item, owned)} points`}</span></span>
          </button><button type="button" className="shop-favorite" aria-label={`${favorites.includes(item.id) ? "Remove" : "Add"} ${item.name} ${favorites.includes(item.id) ? "from" : "to"} favorites`} aria-pressed={favorites.includes(item.id)} onClick={() => toggleFavorite(item.id)}>{favorites.includes(item.id) ? "★" : "☆"}</button></div>)}
        </div>
        {!items.length && <div className="shop-empty"><span>No matching designs.</span><button type="button" className="text-link" onClick={() => { setSearch(""); setTone("all"); setFavoritesOnly(false); setOwnedOnly(false); }}>Clear filters</button></div>}
        </>}
        <fieldset className="shop-content-editor" disabled={editingDisabled}>
          {slot === "theme" && <div className="shop-accent"><label>Accent color<input type="color" aria-label="Accent color" value={settings.accentColor || driver?.team?.color || "#efaac1"} onInput={e => editContent({ accentColor: e.currentTarget.value })} onChange={e => editContent({ accentColor: e.target.value })} /></label><button type="button" className="btn-secondary" aria-pressed={!settings.accentColor} onClick={() => editContent({ accentColor: null })}>Theme color</button><button type="button" className="btn-secondary" onClick={() => editContent({ accentColor: driver?.team?.color || "#efaac1" })}>Team color</button></div>}
          {slot === "nameplate" && <><label>Personal title<input className="input" maxLength={32} value={settings.title} onChange={e => editContent({ title: e.target.value })} placeholder="Your own short title" /></label><label>Letter case<select className="input" value={settings.nameCase} onChange={e => editContent({ nameCase: e.target.value })}><option value="theme">Design default</option><option value="upper">UPPERCASE</option><option value="natural">Original spelling</option></select></label><RangeControl label="Name size" value={settings.nameScale} min={80} max={120} onChange={nameScale => editContent({ nameScale })} /></>}
          {slot === "banner" && <><button className="btn-secondary" onClick={() => bannerRef.current?.click()} type="button">{content.bannerImage ? "Change banner photo" : "Add banner photo"}</button><RangeControl label="Banner strength" value={settings.bannerStrength} disabled={!draft.banner && !content.bannerImage} onChange={bannerStrength => editContent({ bannerStrength })} />{content.bannerImage && <><RangeControl label="Photo position" value={settings.bannerPosition} onChange={bannerPosition => editContent({ bannerPosition })} /><button type="button" className="btn-secondary" onClick={() => { editContent({ bannerImage: null }); setFiles(f => { const next = { ...f }; delete next.banner; return next; }); }}>Remove photo</button></>}</>}
          {slot === "effect" && <RangeControl label="Effect strength" value={settings.effectStrength} disabled={!draft.effect} onChange={effectStrength => editContent({ effectStrength })} />}
          {slot === "layout" && <><label>Panel corners<select className="input" value={settings.panelShape} onChange={e => editContent({ panelShape: e.target.value })}><option value="theme">Theme default</option><option value="square">Square</option><option value="soft">Soft</option><option value="round">Rounded</option></select></label><label>Spacing<select className="input" value={settings.density} onChange={e => editContent({ density: e.target.value })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label><label className="shop-check"><input type="checkbox" checked={settings.motion} onChange={e => editContent({ motion: e.target.checked })} /> Animate decorations</label><button type="button" className="btn-secondary" onClick={() => editContent({ panelShape: "theme", density: "comfortable", motion: true })}>Reset layout</button></>}
        </fieldset>
        <input type="file" ref={bannerRef} hidden accept="image/png,image/jpeg,image/webp" onChange={e => pickImage(e, "banner")} />
        {slot !== "layout" && <div className="shop-selection"><div><strong>{selected?.name || "Original"}</strong><span>{price > 0 ? `${price} points` : "In your collection"}</span></div>{!user ? <Link to="/profile" className="btn-primary">Sign in to buy</Link> : selected && price > 0 ? <button className="btn-primary" disabled={busy || !account || account.balance < price} onClick={() => act("buy")}>{busy ? "Working…" : account && account.balance < price ? `${price - account.balance} points short` : `Buy for ${price} points`}</button> : <span className="shop-owned">✓ Owned</span>}</div>}
        <div className="shop-save"><button type="button" className="btn-primary" disabled={!account || editingDisabled || locked || !changed} onClick={() => act("save")}>{busy ? "Working…" : "Apply to profile"}</button><button type="button" className="btn-secondary" disabled={editingDisabled || !changed} onClick={reset}>Reset preview</button></div>
        {locked && <div className="shop-unlock-summary"><span>{missing.length} {missing.length === 1 ? "design" : "designs"} to unlock · {missingCost.toLocaleString()} points</span>{missing.map(item => <button key={item.id} type="button" onClick={() => changeCategory(item.slot)}>{item.name}</button>)}</div>}{notice && <p role="status" className="shop-message">{notice}</p>}
      </section>
      <div className="shop-section-head shop-profile-picker"><h2>{me?.isLinked ? "Your profile" : driver?.name || "Driver profile"}</h2><div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-secondary" aria-pressed={comparing} disabled={editingDisabled || !changed} onClick={() => setComparing(value => !value)}>{comparing ? "Back to your changes" : "Compare with saved"}</button>
        {!me?.isLinked && <label className="flex items-center gap-2">Driver<select className="input" aria-label="Preview driver" value={driverId || ""} onChange={e => chooseDriver(e.target.value)} disabled={roster.loading}>{publicDrivers.map(d => <option key={d.driverId} value={d.driverId}>{d.name} · {d.team.name}</option>)}</select></label>}
        {driverId && <Link to={`/drivers/${driverId}`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-link">Open profile ↗</Link>}
        {!me?.isLinked && driverId && <><input type="file" ref={photoRef} hidden accept="image/png,image/jpeg,image/webp" onChange={e => pickImage(e,"profile")} /><button className="btn-secondary" onClick={() => photoRef.current?.click()}>Try your picture</button>{photo && <button className="btn-secondary" onClick={() => setPhoto(null)}>Reset picture</button>}</>}
      </div></div>
    </>}
    <section className="shop-real-preview" aria-label="Profile preview">
      {(roster.error || profile.error) && <div role="alert" className="shop-message shop-message--error">{profile.error || roster.error}<button className="btn-secondary ml-3" onClick={() => { roster.reload(); profile.reload(); }}>Retry</button></div>}
      {driverId ? <DriverProfile key={driverId} previewId={driverId} preview={{ appearance: previewAppearance, profileContent: previewContent, ...(photo && !me?.isLinked && !comparing ? { photoUrl: photo, cardPhotoUrl: photo } : {}) }} /> : <p>{loading || roster.loading ? "Loading profile…" : "No public drivers in this season."}</p>}
    </section>

  </div>;
}
