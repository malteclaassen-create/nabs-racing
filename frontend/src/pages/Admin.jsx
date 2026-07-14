import { useCallback, useEffect, useRef, useState } from "react";
import { api, getToken, setToken } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth } from "../hooks/useAuth.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { useSeries } from "../context/SeriesContext.jsx";
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
import AdminNotifications from "../components/AdminNotifications.jsx";
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
  { id: "notify", label: "Notifications" },
  { id: "social", label: "Social Links" },
  { id: "tracks", label: "Tracks" },
  { id: "raceinfo", label: "Race Info" },
  { id: "faq", label: "Home FAQ" },
  { id: "downloads", label: "Downloads" },
  { id: "traffic", label: "Traffic" },
  { id: "health", label: "Health" },
  { id: "pin", label: "Change PIN" },
];

// Prominent bar at the top of the admin: shows WHICH series + season every
// scoped edit below applies to, and lets the admin switch both right here (no
// hunting for the nav selector). Switching remounts the page (App keys on the
// season / series), so we stash the current tab first — the admin stays where
// they were.
function AdminSeasonBar({ tab }) {
  const { seasons, season, setSeason, current } = useSeason();
  const { seriesList, current: series, setSlug } = useSeries();
  if (!seasons?.length && seriesList.length <= 1) return null;
  const isActive = current?.isActive;
  const isPrivate = current?.isPublic === false;
  const ordered = [...(seasons || [])].sort((a, b) => b.number - a.number);
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
              {seriesList.length > 1 && series ? `${series.name} · ` : ""}
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
      <div className="flex flex-wrap items-center gap-4">
        {seriesList.length > 1 && (
          <label className="flex items-center gap-2 text-sm">
            <span className="font-semibold text-medium">Series</span>
            <select
              className="input py-1.5"
              value={series?.slug ?? ""}
              onChange={(e) => {
                sessionStorage.setItem("nabs_admin_tab", tab); // survive the remount
                setSlug(e.target.value);
              }}
            >
              {seriesList.map((s) => (
                <option key={s.id} value={s.slug}>
                  {s.name}
                  {s.isActive ? " (primary)" : s.isPublic === false ? " (private)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
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
        {tab === "notify" && <AdminNotifications />}
        {tab === "social" && (
          <div className="space-y-4">
            <SocialAdmin />
            <LiveLinksAdmin />
          </div>
        )}
        {tab === "tracks" && <AdminTracks />}
        {tab === "raceinfo" && <AdminRaceInfo />}
        {tab === "faq" && <AdminWelcomeFaq />}
        {tab === "downloads" && <AdminDownloads />}
        {tab === "traffic" && <TrafficAdmin />}
        {tab === "health" && <AdminHealth />}
        {tab === "pin" && <ChangePin />}
      </div>
    </div>
  );
}

// --- DRIVER MARKET (admin override) ----------------------------------------
function MarketAdmin() {
  const market = useApi(useCallback(() => api.market(), []));
  // Full takeover record (completed races included) — read-only history.
  const history = useApi(useCallback(() => api.adminMarketHistory(), []));
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
      await Promise.all([market.reload(), history.reload()]);
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

      {/* --- takeover record ------------------------------------------------ */}
      <div className="card p-5">
        <CardHead eyebrow="Driver Market" title="Takeover history" />
        <p className="text-sm text-light">
          Every seat offer of this season, race by race, completed rounds included, so you can always trace
          who stood in for whom. &ldquo;In the result&rdquo; means the stored race result actually carries the
          takeover (the reserve scored for that team); if it says &ldquo;not in the result&rdquo;, check the
          round&rsquo;s results in Edit Results.
        </p>
        {history.loading && <p className="mt-3 text-sm text-light">Loading…</p>}
        {history.error && <div className="mt-3"><ErrorBox message={history.error} /></div>}
        {history.data && (history.data.races || []).length === 0 && (
          <p className="mt-3 text-sm text-faint">No seat offers in this season yet.</p>
        )}
        {(history.data?.races || []).map((race) => (
          <div key={race.id} className="mt-4 first:mt-3">
            <div className="mb-1.5 flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-medium">
              R{race.number} · {race.track}
              {race.isCompleted && <span className="pill bg-surface2 text-[10px] text-light">done</span>}
            </div>
            <ul className="divide-y divide-border border-t border-border">
              {race.offers.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <span className="min-w-0 font-semibold text-dark">
                    {o.filledBy ? o.filledBy.name : "—"}
                  </span>
                  <span className="text-light">
                    {o.filledBy ? "took over" : "no taker for"} the {o.team.name} seat of {o.offeredBy.name}
                  </span>
                  <span className="ml-auto flex items-center gap-1.5">
                    {o.confirmedInResult === true && (
                      <span className="pill bg-emerald-500/15 font-mono text-[10px] font-bold uppercase text-emerald-600">in the result</span>
                    )}
                    {o.confirmedInResult === false && (
                      <span className="pill bg-amber-500/15 font-mono text-[10px] font-bold uppercase text-amber-600">not in the result</span>
                    )}
                    {o.confirmedInResult === null && o.status === "FILLED" && (
                      <span className="pill bg-surface2 font-mono text-[10px] font-bold uppercase text-light">agreed · race pending</span>
                    )}
                    {o.confirmedInResult === null && o.status !== "FILLED" && (
                      <span className="pill bg-surface2 font-mono text-[10px] font-bold uppercase text-light">
                        {race.isCompleted ? "stayed unfilled" : "open"}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
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

// --- TRAFFIC ---------------------------------------------------------------
// The self-hosted visit counter: page views + anonymous daily-unique visitors
// (see backend lib/traffic.js for the privacy story — no cookies, no service).
function TrafficAdmin() {
  const { data, loading, error, reload } = useApi(useCallback(() => api.adminTraffic(), []));

  const Tile = ({ label, views, visitors }) => (
    <div className="rounded-xl border border-border p-4">
      <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">{label}</div>
      <div className="mt-1 font-display text-3xl font-black tabular-nums text-dark">{visitors}</div>
      <div className="font-mono text-[11px] text-light">visitors · {views} page views</div>
    </div>
  );

  const maxDay = Math.max(1, ...(data?.days || []).map((d) => d.views));
  const fmtDay = (iso) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardHead eyebrow="Traffic" title="Who's visiting" />
          <button className="btn-secondary py-1.5 text-sm" onClick={reload}>Refresh</button>
        </div>
        <p className="text-sm text-light">
          Counted on the site itself: no cookies, no external service, nothing personal stored. A visitor is an
          anonymous marker that resets every day, so people are counted once per day but can never be tracked
          across days. Bots and the admin area don&rsquo;t count.
        </p>
      </div>

      {error && <ErrorBox message={error} />}
      {loading && <div className="card p-8 text-center text-sm text-light">Counting…</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Today" views={data.views.today} visitors={data.visitors.today} />
            <Tile label="Last 7 days" views={data.views.last7} visitors={data.visitors.last7} />
            <Tile label="Last 30 days" views={data.views.last30} visitors={data.visitors.last30} />
            <Tile label="All time" views={data.views.total} visitors={data.visitors.total} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="card p-5">
              <CardHead eyebrow="Traffic" title="Last 14 days" />
              {data.days.length === 0 ? (
                <p className="text-sm text-faint">Nothing counted yet. Numbers appear with the first visit.</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.days.map((d) => (
                    <li key={d.day} className="flex items-center gap-3 text-sm">
                      <span className="w-28 shrink-0 font-mono text-xs text-light">{fmtDay(d.day)}</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface2">
                        <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.max(3, (d.views / maxDay) * 100)}%` }} />
                      </span>
                      <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums text-medium">
                        {d.visitors} · {d.views}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-faint">visitors · page views</p>
            </div>

            <div className="card p-5">
              <CardHead eyebrow="Traffic" title="Most visited (30 days)" />
              {data.topPages.length === 0 ? (
                <p className="text-sm text-faint">Nothing counted yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {data.topPages.map((p) => (
                    <li key={p.path} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                      <span className="min-w-0 truncate font-mono text-xs text-dark">{p.path}</span>
                      <span className="shrink-0 font-mono text-xs tabular-nums text-medium">{p.views}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
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

// --- LIVE TIMING LINKS -----------------------------------------------------
// The two external buttons on the Live page: the server manager's own live
// timing page, and a Content Manager "join" deep link for the running server.
function LiveLinksAdmin() {
  const { data, loading, error } = useApi(useCallback(() => api.getLiveLinks(), []));
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (data) setForm({ liveTimingUrl: data.liveTimingUrl || "", cmJoinUrl: data.cmJoinUrl || "" });
  }, [data]);

  if (loading || !form) return <div className="card p-5 text-sm text-light">Loading…</div>;
  if (error) return <ErrorBox message={error} />;

  async function save() {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      const res = await api.setLiveLinks(form);
      setForm({ liveTimingUrl: res.liveTimingUrl || "", cmJoinUrl: res.cmJoinUrl || "" });
      setSaved(true);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-5 p-5">
      <CardHead eyebrow="Live Timing" title="External buttons" />
      <p className="text-sm text-light">
        The two buttons at the top of the Live page. Leave the live-timing URL blank to fall back to the server
        manager default. Leave the Content Manager link blank to hide that button until a race is up.
      </p>
      {err && <Notice kind="error">{err}</Notice>}
      {saved && <Notice kind="success">Saved.</Notice>}
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-semibold text-medium">Full live timing URL</label>
          <input
            className="input"
            placeholder={data.defaults?.liveTimingUrl || "https://…/live-timing"}
            value={form.liveTimingUrl}
            onChange={(e) => setForm((f) => ({ ...f, liveTimingUrl: e.target.value }))}
          />
          <p className="mt-1 text-xs text-light">
            The server manager&rsquo;s own live-timing page. Default:{" "}
            <span className="font-mono">{data.defaults?.liveTimingUrl}</span>
          </p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold text-medium">Join in Content Manager (deep link)</label>
          <input
            className="input"
            placeholder="acstuff.ru/s/q:race/online/join?ip=…&httpPort=…"
            value={form.cmJoinUrl}
            onChange={(e) => setForm((f) => ({ ...f, cmJoinUrl: e.target.value }))}
          />
          <p className="mt-1 text-xs text-light">
            The one-click Content Manager join link for the running server (from CM: right-click the server &rarr;
            &ldquo;Copy direct join link&rdquo;). Hidden while empty.
          </p>
        </div>
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

// <input type="datetime-local"> value -> unambiguous ISO instant for the API.
// The raw "2026-08-15T19:00" string carries NO timezone; the deployed backend
// runs on UTC and would read it as 19:00 UTC (21:00 German time) — the admin
// would save a time and get a different one back. The browser parses the
// string in the admin's own zone, which is exactly what they meant.
function fromLocalInput(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function EditResults() {
  const { data: races, reload: reloadRaces } = useApi(useCallback(() => api.races(), []));
  const { data: teams } = useApi(useCallback(() => api.teams(), []));
  const [raceId, setRaceId] = useState("");
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ track: "", date: "", qualiMinutes: "", raceLaps: "", info: "" }); // race details editor
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
        setMeta({
          track: d.race?.track || "",
          date: toLocalInput(d.race?.date),
          qualiMinutes: d.race?.qualiMinutes ?? "",
          raceLaps: d.race?.raceLaps ?? "",
          info: d.race?.info || "",
        });
        setDotd(d.race?.driverOfTheDay?.driverId || "");
        setDotdBy(d.race?.driverOfTheDay?.pickedBy || "");
        setRows(
          d.results.map((r) => {
            const raw = r.rawPosition ?? r.position ?? "";
            return {
              driverId: r.driverId,
              // Who held this row when it was loaded — a driver swap sends this
              // as prevDriverId so the row's race data (time, grid, telemetry)
              // follows the correction instead of being wiped.
              origDriverId: r.driverId,
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

  // Season roster (from the teams payload) for the driver-swap dropdown, so a
  // wrongly mapped result can be reassigned to the person who actually drove.
  const roster = (teams || []).flatMap((t) =>
    (t.drivers || []).map((d) => ({ id: d.id, name: d.name, teamId: t.id, teamName: t.name }))
  );
  const rosterById = new Map(roster.map((d) => [d.id, d]));

  // Swap the person on a result row. The row keeps its finish, status, penalty
  // and race team: an "own team" drive is pinned to the OLD driver's team via
  // subForTeamId, otherwise the result would silently move to the new driver's
  // own team.
  function swapDriver(i, newId) {
    const nd = rosterById.get(newId);
    if (!nd) return;
    setRows((rs) =>
      rs.map((r, idx) => {
        if (idx !== i) return r;
        const oldOwn = rosterById.get(r.driverId);
        return {
          ...r,
          driverId: newId,
          name: nd.name,
          ownTeamName: nd.teamName,
          subForTeamId: r.subForTeamId || oldOwn?.teamId || "",
        };
      })
    );
  }

  // Normalised results for both the live preview and the save. A row keeps its
  // official points only while its finish/status are untouched; once changed,
  // points are derived from position (penalties are handled server-side).
  const toResults = (rs) =>
    rs.map((r) => ({
      driverId: r.driverId,
      // On a driver swap: tells the server whose stored race data this row
      // inherits (undefined when unchanged — JSON drops it).
      prevDriverId: r.origDriverId !== r.driverId ? r.origDriverId : undefined,
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
      // The swap is stored now; a second save must not point prevDriverId at a
      // row that no longer exists (that would drop the preserved race data).
      setRows((rs) => rs.map((r) => ({ ...r, origDriverId: r.driverId })));
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
      await api.updateEvent(raceId, {
        track: meta.track,
        date: fromLocalInput(meta.date),
        qualiMinutes: meta.qualiMinutes === "" ? null : meta.qualiMinutes,
        raceLaps: meta.raceLaps === "" ? null : meta.raceLaps,
        info: meta.info || null,
      });
      setMsg("Race details saved.");
      reloadRaces(); // the round selector shows the new name
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Remove the whole round, results included. The backend writes an automatic
  // backup first; standings recompute themselves from the remaining rounds.
  async function deleteRace() {
    const race = (races || []).find((r) => r.id === raceId);
    const label = race ? `Round ${race.number} · ${race.track}` : "this race";
    if (
      !window.confirm(
        `Delete ${label} and ALL its results?\n\nStandings will recalculate without this round. A backup is saved automatically, so it can be restored if this was a mistake.`
      )
    )
      return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api.deleteEvent(raceId, { force: true });
      setRaceId("");
      setRows([]);
      setMsg(`${label} deleted. Standings updated.`);
      reloadRaces();
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
          <label className="flex flex-col gap-1 text-xs font-semibold text-light">
            Qualifying (min)
            <input className="input w-32" type="number" min="1" value={meta.qualiMinutes}
              onChange={(e) => setMeta({ ...meta, qualiMinutes: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-light">
            Race laps
            <input className="input w-32" type="number" min="1" value={meta.raceLaps}
              onChange={(e) => setMeta({ ...meta, raceLaps: e.target.value })} />
          </label>
          <label className="flex w-full flex-col gap-1 text-xs font-semibold text-light">
            Details (rules, mods, links… shown in the Discord post and on the site)
            <textarea className="input min-h-20" value={meta.info}
              onChange={(e) => setMeta({ ...meta, info: e.target.value })} />
          </label>
          <button className="btn-secondary" disabled={busy || !meta.track.trim()} onClick={saveDetails}>
            Save details
          </button>
          <span className="pb-2 text-xs text-light">
            Renames the round everywhere; format &amp; details feed the announcement. Results stay untouched.
          </span>
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
                {rows.map((r, i) => {
                  // Everyone already in the results can't be picked a second time.
                  const usedIds = new Set(rows.map((x) => x.driverId));
                  const swapOptions = roster.filter((d) => !usedIds.has(d.id));
                  return (
                  <tr key={r.origDriverId} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      <select
                        className="input min-w-40 py-1 font-semibold"
                        title="Wrong person on this result? Pick who actually drove — finish, penalty and race data stay with the row."
                        value={r.driverId}
                        onChange={(e) => swapDriver(i, e.target.value)}
                      >
                        <option value={r.driverId}>{r.name}</option>
                        {swapOptions.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}{d.teamName ? ` · ${d.teamName}` : ""}
                          </option>
                        ))}
                      </select>
                    </td>
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
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-light">
            Wrong person on a result? Pick who actually drove in the{" "}
            <span className="font-semibold text-medium">Driver</span> column: the finish, penalty, race team and
            captured race data stay with the row, only the name changes.
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

          <DiscordResultsPost raceId={raceId} />
        </>
      )}

      {raceId && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-red-500/40 p-4">
          <div className="min-w-0">
            <div className="text-sm font-bold text-dark">Delete this race</div>
            <p className="text-xs text-light">
              Removes the round with all its results; the championship recalculates without it. A backup is
              saved automatically first. Linked replay downloads stay available, they just lose the race link.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary shrink-0 border-red-500/50 text-red-500 hover:bg-red-500/10"
            disabled={busy}
            onClick={deleteRace}
          >
            Delete race
          </button>
        </div>
      )}
    </div>
  );
}

// --- DISCORD RESULTS POST ----------------------------------------------------
// Generates the "#results" message for the selected round (classification with
// real @mentions + a stats block), lets the admin tweak it, then copy it or
// post it straight to the results-channel webhook. Save the results first —
// the draft is built from what's stored, not from unsaved edits above.
function DiscordResultsPost({ raceId }) {
  const { data: hook, reload: reloadHook } = useApi(useCallback(() => api.getResultsWebhook(), []));
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);

  // A different round starts from a clean slate.
  useEffect(() => {
    setText("");
    setMsg(null);
    setError(null);
  }, [raceId]);

  async function run(fn, doneMsg) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await fn();
      if (doneMsg) setMsg(doneMsg);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const generate = () =>
    run(async () => {
      const r = await api.getResultsPost(raceId);
      setText(r.text || "");
    });

  const copy = () =>
    run(async () => {
      await navigator.clipboard.writeText(text);
    }, "Copied. Paste it into Discord.");

  const post = () => {
    if (!window.confirm("Post this message to the results channel? Mentioned drivers get pinged.")) return;
    run(async () => {
      const r = await api.sendResultsPost(raceId, text);
      setMsg(r.messages > 1 ? `Posted as ${r.messages} messages (Discord length limit).` : "Posted to Discord.");
    });
  };

  const saveHook = () =>
    run(async () => {
      await api.setResultsWebhook(url.trim());
      setUrl("");
      reloadHook();
    }, "Results webhook saved.");

  // Clearing only stops the "Post to Discord" button; Copy keeps working. The
  // URL itself stays usable in Discord until it's deleted there too.
  const removeHook = () => {
    if (!window.confirm("Remove the saved results webhook? Posting from here stops until a new one is saved. (To fully revoke the URL, also delete the webhook in Discord.)")) return;
    run(async () => {
      await api.setResultsWebhook("");
      reloadHook();
    }, "Results webhook removed.");
  };

  return (
    <div className="card space-y-3 p-4">
      <CardHead eyebrow="Discord" title="Results post" />
      <p className="text-sm text-light">
        Builds the results message for this round: podium and classification with real @mentions, DNFs, and the
        stats block (pole, fastest lap, consistency, crashes, DOTD). Save the results above first, then generate,
        tweak the text if you like (team emojis, role pings), and post or copy it.
      </p>
      {error && <ErrorBox message={error} />}
      {msg && <Notice kind="success">{msg}</Notice>}

      {!text ? (
        <button className="btn-secondary" disabled={busy} onClick={generate}>
          {busy ? "Building…" : "Generate message"}
        </button>
      ) : (
        <>
          <textarea
            className="input min-h-72 w-full font-mono text-xs leading-relaxed"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
          />
          <p className="text-xs text-light">
            The &lt;@…&gt; codes turn into real @mentions once the message lands in Discord. Custom server emojis
            can be added as :emoji_name: if the webhook&rsquo;s server has them.
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy || !hook?.configured || !text.trim()} onClick={post}>
              Post to Discord
            </button>
            <button className="btn-secondary" disabled={busy || !text.trim()} onClick={copy}>
              Copy
            </button>
            <button className="btn-secondary" disabled={busy} onClick={generate}>
              Regenerate
            </button>
          </div>
        </>
      )}

      <div className="rounded-lg bg-surface2 p-3">
        <div className="text-sm">
          Results channel webhook:{" "}
          {hook?.configured ? (
            <span className="font-semibold text-emerald-600">connected ({hook.preview})</span>
          ) : (
            <span className="font-semibold text-light">not connected (copy still works)</span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            className="input max-w-md flex-1"
            placeholder="https://discord.com/api/webhooks/… (the #results channel)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button className="btn-secondary" disabled={busy || !url.trim()} onClick={saveHook}>
            Save webhook
          </button>
          {hook?.configured && (
            <button className="btn-secondary" disabled={busy} onClick={removeHook}>
              Remove
            </button>
          )}
        </div>
        <p className="mt-1.5 text-xs text-light">
          Separate from the events webhook, so results land in their own channel. Discord channel &rarr; Edit
          Channel &rarr; Integrations &rarr; Webhooks.
        </p>
      </div>
    </div>
  );
}

// --- DRIVERS ---------------------------------------------------------------
function Drivers() {
  const { data: teams, reload } = useApi(useCallback(() => api.teams(), []));
  // Known login accounts, to verify hand-entered Discord IDs on the spot.
  const { data: membersData } = useApi(useCallback(() => api.adminMembers(), []));
  const [form, setForm] = useState({ name: "", discordName: "", teamId: "", tier: 2 });
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const accounts = new Map(((membersData && membersData.members) || []).map((m) => [String(m.discordId), m]));
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
        <p className="mb-3 text-xs text-light">
          Use the dropdowns to move a driver to another team or change their tier. The Discord user ID field links
          the driver to their Discord account: it makes their website login connect instantly and lets the results
          post @mention them, even before their first login. (Discord: Settings → Advanced → Developer Mode, then
          right-click the user → Copy User ID.)
        </p>
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
                    <select className="input py-1 text-xs" value={d.role || ""} disabled={busy}
                      title="Special league role: shown on the profile and turns the rating card into the Safety Car edition"
                      onChange={(e) => patchDriver(d, { role: e.target.value })}>
                      <option value="">Driver</option>
                      <option value="safety">Safety Car</option>
                    </select>
                    <button className="text-xs font-semibold text-primary hover:underline" disabled={busy}
                      onClick={() => patchDriver(d, { isActive: !d.isActive })}>
                      {d.isActive ? "Deactivate" : "Reactivate"}
                    </button>
                    {/* Only a deactivated driver can be removed from the public
                        standings; reactivating brings them back automatically. */}
                    {!d.isActive && (
                      <button className="text-xs font-semibold text-primary hover:underline" disabled={busy}
                        title="Hidden drivers disappear from the public driver standings (everyone below moves up). Their race results and their team's points stay untouched."
                        onClick={() => patchDriver(d, { hideFromStandings: !d.hideFromStandings })}>
                        {d.hideFromStandings ? "Show in standings" : "Hide from standings"}
                      </button>
                    )}
                    {!d.isActive && d.hideFromStandings && (
                      <span className="pill bg-surface2 text-light" title="Not shown in the public driver standings">hidden</span>
                    )}
                    <DriverDiscordId d={d} busy={busy} accounts={accounts}
                      onSave={(v) => patchDriver(d, { discordUserId: v })} />
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

// Per-driver Discord user id (the long number). Login connects the member by
// this exact id, and the Discord results post pings <@id> — so filling it in
// for drivers who never signed in gives them a working login AND real
// mentions. Full width on its own line so the roster row above stays tidy.
// `accounts` (discordId -> login account) verifies entries on the spot: an id
// that matches a known login shows WHOSE login it is, so a typo in a
// hand-entered id is visible immediately instead of failing silently later.
function DriverDiscordId({ d, busy, accounts, onSave }) {
  const [val, setVal] = useState(d.discordUserId || "");
  useEffect(() => setVal(d.discordUserId || ""), [d.discordUserId]);
  const dirty = val.trim() !== (d.discordUserId || "");
  const acct = val.trim() ? accounts?.get(val.trim()) : null;
  return (
    <span className="flex w-full flex-wrap items-center gap-2">
      <input
        className="input w-52 py-1 font-mono text-xs"
        placeholder="Discord user ID (not set)"
        title="The 17-20 digit Discord user ID. In Discord: Settings → Advanced → Developer Mode on, then right-click the user → Copy User ID. Used to link their login and to @mention them in results posts."
        value={val}
        onChange={(e) => setVal(e.target.value.trim())}
      />
      {acct && (
        <span
          className="font-mono text-[10px] font-bold text-emerald-600"
          title={`This ID belongs to the login of ${acct.displayName || acct.username}`}
        >
          = @{acct.username}
        </span>
      )}
      {val.trim() && !acct && !dirty && (
        <span
          className="font-mono text-[10px] text-light"
          title="Nobody with this ID has logged in yet. Fine for someone who never signed in; if they HAVE logged in before, double-check the digits."
        >
          no login seen yet
        </span>
      )}
      {dirty && (
        <>
          <button className="text-xs font-semibold text-primary hover:underline" disabled={busy}
            onClick={() => onSave(val.trim())}>
            Save
          </button>
          <button className="text-xs font-semibold text-light hover:underline" disabled={busy}
            onClick={() => setVal(d.discordUserId || "")}>
            Cancel
          </button>
        </>
      )}
    </span>
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
  const [event, setEvent] = useState({
    number: "", track: "", date: "", type: "CHAMPIONSHIP",
    qualiMinutes: "", raceLaps: "", info: "",
  });

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

  // Clearing the webhook stops all event posts/updates; the URL itself keeps
  // working in Discord until it's deleted there too, hence the hint.
  async function removeWebhook() {
    if (!window.confirm("Remove the saved webhook? Event posts and RSVP updates to Discord stop until a new one is saved. (To fully revoke the URL, also delete the webhook in Discord.)")) return;
    setBusy(true); setError(null); setMsg(null);
    try {
      await api.setWebhook("");
      setMsg("Webhook removed.");
      reload();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function createEvent(e) {
    e.preventDefault();
    setBusy(true); setError(null); setMsg(null);
    const isChamp = event.type === "CHAMPIONSHIP";
    try {
      await api.createEvent({
        number: isChamp ? Number(event.number) : null,
        track: event.track,
        date: fromLocalInput(event.date),
        type: event.type,
        seasonId: current?.id,
        qualiMinutes: event.qualiMinutes || null,
        raceLaps: event.raceLaps || null,
        info: event.info || null,
      });
      setMsg(
        event.type === "SPECIAL"
          ? `Special event "${event.track}" created.`
          : event.type === "TRAINING"
            ? `Training session "${event.track}" created.`
            : `Round ${event.number} created.`
      );
      setEvent({ number: "", track: "", date: "", type: "CHAMPIONSHIP", qualiMinutes: "", raceLaps: "", info: "" });
      reloadRaces();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function deleteRace(id) {
    if (!window.confirm("Delete this race? Only works if it has no stored results.")) return;
    setBusy(true); setError(null); setMsg(null);
    try { await api.deleteEvent(id); setMsg("Race deleted."); reloadRaces(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  // Inline per-race editor: every schedule detail of a round is editable here,
  // before and after it ran. Saving also refreshes an already-announced
  // Discord post (the backend re-syncs the message automatically).
  const [editingId, setEditingId] = useState(null);
  const [edit, setEdit] = useState(null);

  function startEdit(r) {
    setEditingId(r.id);
    setEdit({
      track: r.track || "",
      date: toLocalInput(r.date),
      type: r.type || (r.isSpecialEvent ? "SPECIAL" : "CHAMPIONSHIP"),
      number: r.number ?? "",
      hasResults: (r.resultCount || 0) > 0,
      qualiMinutes: r.qualiMinutes ?? "",
      raceLaps: r.raceLaps ?? "",
      info: r.info || "",
    });
  }

  async function saveEdit() {
    setBusy(true); setError(null); setMsg(null);
    try {
      await api.updateEvent(editingId, {
        track: edit.track,
        date: fromLocalInput(edit.date),
        type: edit.type,
        number: edit.type === "CHAMPIONSHIP" && edit.number !== "" ? Number(edit.number) : undefined,
        qualiMinutes: edit.qualiMinutes === "" ? null : edit.qualiMinutes,
        raceLaps: edit.raceLaps === "" ? null : edit.raceLaps,
        info: edit.info || null,
      });
      setMsg("Race saved. An already-announced Discord post updates itself.");
      setEditingId(null);
      reloadRaces();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function announce(id) {
    setBusy(true); setError(null); setMsg(null);
    try {
      await api.announceEvent(id);
      setMsg("Event posted/updated in Discord.");
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

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
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={busy || !url.trim()}>Save</button>
          <button type="button" className="btn-secondary" disabled={busy || !hook?.configured} onClick={test}>
            Send test
          </button>
          {hook?.configured && (
            <button type="button" className="btn-secondary" disabled={busy} onClick={removeWebhook}>
              Remove
            </button>
          )}
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        {msg && <Notice kind="success">{msg}</Notice>}
      </form>

      {/* Create event + announce */}
      <div className="space-y-6 order-1">
        <form onSubmit={createEvent} className="card space-y-3 p-5">
          <CardHead eyebrow="Schedule" title="Create race / event" />
          <label className="flex flex-col gap-1 text-xs font-semibold text-light">
            Type
            <select className="input" value={event.type}
              onChange={(e) => setEvent({ ...event, type: e.target.value })}>
              <option value="CHAMPIONSHIP">Championship round (scored, has a round number)</option>
              <option value="TRAINING">Training / session (not scored, RSVP works)</option>
              <option value="SPECIAL">Special event (not scored, announcement only)</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            {event.type === "CHAMPIONSHIP" && (
              <input className="input" type="number" placeholder="Round #" value={event.number}
                onChange={(e) => setEvent({ ...event, number: e.target.value })} required />
            )}
            <input className={`input ${event.type !== "CHAMPIONSHIP" ? "col-span-2" : ""}`} placeholder="Track" value={event.track}
              onChange={(e) => setEvent({ ...event, track: e.target.value })} required />
          </div>
          <input className="input" type="datetime-local" value={event.date}
            onChange={(e) => setEvent({ ...event, date: e.target.value })} />
          {/* session format + free text: all optional, shown in the Discord
              announcement and on the site's upcoming-race panels */}
          <div className="grid grid-cols-2 gap-3">
            <input className="input" type="number" min="1" placeholder="Qualifying (min)" value={event.qualiMinutes}
              onChange={(e) => setEvent({ ...event, qualiMinutes: e.target.value })} />
            <input className="input" type="number" min="1" placeholder="Race laps" value={event.raceLaps}
              onChange={(e) => setEvent({ ...event, raceLaps: e.target.value })} />
          </div>
          <textarea className="input min-h-20" placeholder="Details for the announcement & website: rules, mods, links… (optional)"
            value={event.info} onChange={(e) => setEvent({ ...event, info: e.target.value })} />
          <button className="btn-primary w-full" disabled={busy}>Create</button>
        </form>

        <div className="card p-5">
          <CardHead eyebrow="Schedule" title="Season races" />
          <p className="mb-2 text-sm text-light">
            One place for the whole calendar: every detail (track, time, sessions, rules text) stays editable
            here, before and after a round ran. Saving updates an announced Discord post automatically.
          </p>
          <ul className="divide-y divide-border">
            {(races || []).map((r) => (
              <li key={r.id} className="py-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate font-semibold text-dark">
                    {r.type === "TRAINING" ? "Training" : r.type === "SPECIAL" || r.isSpecialEvent ? "SE" : `Round ${r.number}`} · {r.track}
                    {r.isCompleted && (
                      <span className="pill ml-2 bg-surface2 font-mono text-[10px] font-bold uppercase text-light">done</span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <button className="text-xs font-semibold text-primary hover:underline"
                      disabled={busy} onClick={() => (editingId === r.id ? setEditingId(null) : startEdit(r))}>
                      {editingId === r.id ? "Close" : "Edit"}
                    </button>
                    {/* Rounds AND training sessions get the RSVP post; specials stay site-only. */}
                    {r.type !== "SPECIAL" && !r.isCompleted && (
                      <button className="text-xs font-semibold text-primary hover:underline"
                        disabled={busy} onClick={() => announce(r.id)}>
                        Post to Discord
                      </button>
                    )}
                    {r.resultCount === 0 && (
                      <button className="text-xs font-semibold text-rose-500 hover:underline"
                        disabled={busy} onClick={() => deleteRace(r.id)}>
                        Delete
                      </button>
                    )}
                  </span>
                </div>
                {editingId === r.id && edit && (
                  <div className="mt-3 space-y-3 rounded-lg bg-surface2 p-3">
                    <div className="grid grid-cols-2 gap-3">
                      <label className="flex flex-col gap-1 text-xs font-semibold text-light">
                        Type
                        {/* A round with stored results must stay a championship
                            round — retyping it would pull its points out of the
                            standings (the backend refuses it too). */}
                        <select className="input" value={edit.type} disabled={edit.hasResults}
                          onChange={(e) => setEdit({ ...edit, type: e.target.value })}>
                          <option value="CHAMPIONSHIP">Championship round</option>
                          <option value="TRAINING">Training / session</option>
                          <option value="SPECIAL">Special event</option>
                        </select>
                      </label>
                      {edit.type === "CHAMPIONSHIP" && (
                        <label className="flex flex-col gap-1 text-xs font-semibold text-light">
                          Round #
                          <input className="input" type="number" min="1" value={edit.number}
                            onChange={(e) => setEdit({ ...edit, number: e.target.value })} />
                        </label>
                      )}
                      <label className="flex flex-col gap-1 text-xs font-semibold text-light">
                        Track
                        <input className="input" value={edit.track}
                          onChange={(e) => setEdit({ ...edit, track: e.target.value })} />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-semibold text-light">
                        Date &amp; time
                        <input className="input" type="datetime-local" value={edit.date}
                          onChange={(e) => setEdit({ ...edit, date: e.target.value })} />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-semibold text-light">
                        Qualifying (min)
                        <input className="input" type="number" min="1" value={edit.qualiMinutes}
                          onChange={(e) => setEdit({ ...edit, qualiMinutes: e.target.value })} />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-semibold text-light">
                        Race laps
                        <input className="input" type="number" min="1" value={edit.raceLaps}
                          onChange={(e) => setEdit({ ...edit, raceLaps: e.target.value })} />
                      </label>
                    </div>
                    <label className="flex flex-col gap-1 text-xs font-semibold text-light">
                      Details (rules, mods, links… shown in the Discord post and on the site)
                      <textarea className="input min-h-24" value={edit.info}
                        onChange={(e) => setEdit({ ...edit, info: e.target.value })} />
                    </label>
                    <div className="flex gap-2">
                      <button className="btn-primary py-1.5 text-sm" disabled={busy || !edit.track.trim()} onClick={saveEdit}>
                        Save
                      </button>
                      <button className="btn-secondary py-1.5 text-sm" disabled={busy} onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
            {(races || []).length === 0 && <li className="py-2 text-sm text-light">No races in this season yet.</li>}
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

// Home/Welcome main-card photo for one season. Uploads (no file-system access
// needed, e.g. Railway); a season without one falls back to the static
// /heroes/s<number>.jpg drop-in convention, then the shared default photo.
function SeasonHero({ season, onSaved, onError }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // clears the input so re-picking the same file still fires onChange
    if (!file) return;
    setBusy(true);
    try {
      await api.uploadSeasonHero(season.id, file);
      onSaved(`Main-card photo updated for ${season.name}.`);
    } catch (err) { onError(err.message); } finally { setBusy(false); }
  }

  async function clear() {
    if (!window.confirm(`Remove ${season.name}'s custom photo? The home page falls back to the default.`)) return;
    setBusy(true);
    try {
      await api.clearSeasonHero(season.id);
      onSaved(`Main-card photo reset for ${season.name}.`);
    } catch (err) { onError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-semibold text-light">Main-card photo</span>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={pick}
      />
      <button type="button" className="btn-secondary px-3 py-1 text-xs" disabled={busy}
        onClick={() => fileRef.current?.click()}>
        {season.heroImageUrl ? "Replace" : "Upload"}
      </button>
      {season.heroImageUrl && (
        <button type="button" className="font-semibold text-light transition hover:text-rose-500" disabled={busy}
          onClick={clear}>
          Reset to default
        </button>
      )}
      <span className="text-light" title="Shown on the Home/Welcome hero card, cropped to fill the panel">
        Recommended: wide landscape, at least 1920×800px
      </span>
    </div>
  );
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
    <div className="space-y-6">
    <SeriesPanel />
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
              <SeasonHero season={s} onSaved={(m) => { setMsg(m); reload(); }} onError={setError} />
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
    </div>
  );
}

// Dark-mode logo mark for one series (the nav wordmark on dark backgrounds).
// Light mode always shows the shared logo-light.png (a plain black mark reads
// fine on any series' colour), so only this one variant is overridable.
// Recommended: a transparent PNG, square, at least 512x512 — matches the
// shared default's own 1080x1080.
function SeriesLogo({ series, onSaved, onError }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      await api.uploadSeriesLogo(series.id, file);
      onSaved(`Logo updated for ${series.name}.`);
    } catch (err) { onError(err.message); } finally { setBusy(false); }
  }

  async function clear() {
    if (!window.confirm(`Remove ${series.name}'s custom logo? It falls back to the default NABS mark.`)) return;
    setBusy(true);
    try {
      await api.clearSeriesLogo(series.id);
      onSaved(`Logo reset for ${series.name}.`);
    } catch (err) { onError(err.message); } finally { setBusy(false); }
  }

  return (
    <>
      <input ref={fileRef} type="file" accept="image/png,image/webp,image/svg+xml" className="hidden" onChange={pick} />
      <button type="button" className="text-xs font-semibold text-primary hover:underline" disabled={busy}
        onClick={() => fileRef.current?.click()} title="Dark-mode nav logo, recommended: transparent PNG, square, 512px+">
        {series.logoDarkUrl ? "Replace logo" : "Upload logo"}
      </button>
      {series.logoDarkUrl && (
        <button type="button" className="text-xs font-semibold text-light transition hover:text-primary" disabled={busy}
          onClick={clear}>
          Reset logo
        </button>
      )}
    </>
  );
}

// --- SERIES ------------------------------------------------------------------
// The level above seasons: several championships (Friday F1, Sunday GT, …) in
// one deployment. The slug (the /s/<slug>/ URL identity) is set once at
// creation and never changes — renaming only touches the display name. The
// series switcher in the NavBar appears automatically once a second series
// exists (private ones only for admins).
function SeriesPanel() {
  const { data: series, reload } = useApi(useCallback(() => api.adminSeries(), []));
  const { setSlug } = useSeries();
  const [form, setForm] = useState({ name: "", game: "", accentColor: "" });
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Refetching the NavBar's series list happens via the auth event listeners;
  // nudging it after edits keeps the switcher in sync without a reload.
  const nudge = () => window.dispatchEvent(new Event("nabs-auth"));

  async function create(e) {
    e.preventDefault();
    setBusy(true); setError(null); setMsg(null);
    try {
      const s = await api.createSeries({
        name: form.name.trim(),
        game: form.game.trim() || null,
        accentColor: form.accentColor.trim() || null,
      });
      setMsg(`Series "${s.name}" created (URL: /s/${s.slug}). It starts private — build its seasons, then publish it. Pick it in the bar above to start editing.`);
      setForm({ name: "", game: "", accentColor: "" });
      reload(); nudge();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  // Accent colour: saved when the picker closes (blur), matching the team-
  // colour control. "Reset colour" clears it back to the default NABS pink.
  async function saveColor(s, hex) {
    setBusy(true); setError(null); setMsg(null);
    try {
      await api.updateSeries(s.id, { accentColor: hex });
      setMsg(hex ? `${s.name}'s accent colour updated.` : `${s.name} is back to the default NABS pink.`);
      reload(); nudge();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function rename(s) {
    const name = window.prompt(`New name for "${s.name}" (the URL /s/${s.slug} stays the same):`, s.name);
    if (name === null || !name.trim() || name.trim() === s.name) return;
    setBusy(true); setError(null); setMsg(null);
    try { await api.updateSeries(s.id, { name: name.trim() }); setMsg("Series renamed."); reload(); nudge(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function togglePublic(s) {
    setBusy(true); setError(null); setMsg(null);
    try {
      await api.updateSeries(s.id, { isPublic: !s.isPublic });
      setMsg(s.isPublic ? `${s.name} is now private — hidden from the public.` : `${s.name} is now public.`);
      reload(); nudge();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function activate(s) {
    setBusy(true); setError(null); setMsg(null);
    try {
      await api.activateSeries(s.id);
      setMsg(`${s.name} is now the primary series — "/" and old links land there.`);
      reload(); nudge();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function move(s, dir) {
    const sorted = [...(series || [])].sort((a, b) => a.order - b.order);
    const i = sorted.findIndex((x) => x.id === s.id);
    const other = sorted[i + dir];
    if (!other) return;
    setBusy(true); setError(null); setMsg(null);
    try {
      await api.updateSeries(s.id, { order: other.order });
      await api.updateSeries(other.id, { order: s.order });
      reload(); nudge();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function remove(s) {
    if (s.seasonCount === 0) {
      if (!window.confirm(`Delete the series "${s.name}"?`)) return;
    } else {
      const typed = window.prompt(
        `${s.name} still holds ${s.seasonCount} season(s) with all their teams, drivers and races.\n` +
        `Deleting removes ALL of it (a database backup is made first).\n\n` +
        `Type the series' name (${s.name}) to confirm:`
      );
      if (typed === null) return;
      if (typed.trim() !== s.name) { setError(`Not deleted. The typed name didn't match "${s.name}".`); return; }
    }
    setBusy(true); setError(null); setMsg(null);
    try {
      await api.deleteSeries(s.id, s.seasonCount > 0);
      setMsg(`${s.name} deleted${s.seasonCount > 0 ? " (backup created first, see the Health tab)" : ""}.`);
      reload(); nudge();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  const sorted = [...(series || [])].sort((a, b) => a.order - b.order);
  return (
    <div className="card space-y-4 p-5">
      <CardHead eyebrow="Series" title={`Racing series (${sorted.length})`} />
      <p className="text-sm text-light">
        A series is its own championship with its own seasons, teams, drivers and standings — Discord
        login, members and downloads stay shared. With a single series the public site looks exactly
        as before; the switcher in the top bar appears once a second one exists.
      </p>
      <ul className="divide-y divide-border">
        {sorted.map((s, i) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <div className="min-w-0">
              <span className="font-display text-base font-bold text-dark">{s.name}</span>
              {s.isActive && <span className="ml-2 pill bg-emerald-500/15 text-emerald-600">primary</span>}
              {!s.isActive && s.isPublic === false && (
                <span className="ml-2 pill bg-rose-500/15 text-rose-600">private · hidden</span>
              )}
              <div className="text-xs text-light">
                /s/{s.slug} · {s.seasonCount} season{s.seasonCount === 1 ? "" : "s"}{s.game ? ` · ${s.game}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {sorted.length > 1 && (
                <span className="flex items-center gap-1">
                  <button className="text-xs text-light transition hover:text-dark disabled:opacity-30" disabled={busy || i === 0}
                    onClick={() => move(s, -1)} title="Move up in the switcher">▲</button>
                  <button className="text-xs text-light transition hover:text-dark disabled:opacity-30" disabled={busy || i === sorted.length - 1}
                    onClick={() => move(s, 1)} title="Move down in the switcher">▼</button>
                </span>
              )}
              {/* Accent colour — saved when the picker closes (blur), same
                  pattern as a team's colour swatch. */}
              <input
                key={`${s.id}-${s.accentColor || "default"}`}
                type="color"
                defaultValue={s.accentColor || "#f4afc6"}
                disabled={busy}
                title="Accent colour for this series, click to change"
                onBlur={(e) => {
                  const v = e.target.value;
                  if (v && v.toLowerCase() !== (s.accentColor || "").toLowerCase()) saveColor(s, v);
                }}
                className="h-8 w-10 shrink-0 cursor-pointer rounded-lg border border-border bg-transparent"
              />
              {s.accentColor && (
                <button className="text-xs font-semibold text-light transition hover:text-primary" disabled={busy}
                  onClick={() => saveColor(s, null)} title="Back to the default NABS pink">
                  Reset colour
                </button>
              )}
              <SeriesLogo series={s} onSaved={(m) => { setMsg(m); reload(); }} onError={setError} />
              <button className="text-xs font-semibold text-primary hover:underline" disabled={busy}
                onClick={() => setSlug(s.slug)} title="Point the admin at this series (the bar above follows)">
                Edit this series →
              </button>
              <button className="text-xs font-semibold text-primary hover:underline" disabled={busy}
                onClick={() => rename(s)}>Rename</button>
              {!s.isActive && (
                <>
                  <button className="text-xs font-semibold text-primary hover:underline" disabled={busy}
                    onClick={() => togglePublic(s)}>
                    {s.isPublic ? "Make private" : "Make public"}
                  </button>
                  <button className="text-xs font-semibold text-primary hover:underline" disabled={busy}
                    onClick={() => activate(s)}>Make primary</button>
                  <button className="text-xs font-semibold text-light transition hover:text-primary" disabled={busy}
                    onClick={() => remove(s)}>Delete</button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      <form onSubmit={create} className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <input className="input min-w-44 flex-1" placeholder="New series name (e.g. Sunday GT)" value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <input className="input min-w-44 flex-1" placeholder="Game / subtitle (optional)" value={form.game}
          onChange={(e) => setForm({ ...form, game: e.target.value })} />
        <input
          type="color"
          value={form.accentColor || "#f4afc6"}
          onChange={(e) => setForm({ ...form, accentColor: e.target.value })}
          title="Accent colour (optional, defaults to NABS pink)"
          className="h-10 w-12 shrink-0 cursor-pointer rounded border border-border bg-transparent"
        />
        <input className="input w-28 font-mono" placeholder="#6de0fc" value={form.accentColor}
          onChange={(e) => setForm({ ...form, accentColor: e.target.value })} />
        <button className="btn-primary" disabled={busy || !form.name.trim()}>Create series</button>
      </form>
      {error && <Notice kind="error">{error}</Notice>}
      {msg && <Notice kind="success">{msg}</Notice>}
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
