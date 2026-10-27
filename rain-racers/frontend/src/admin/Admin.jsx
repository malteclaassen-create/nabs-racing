import { useCallback, useEffect, useRef, useState } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useSite } from "../site.jsx";
import { dateTime } from "../format.js";
import { AdminScope, useScope } from "./scope.jsx";
import AdminNav, { NavToggle, useNavMode, NAV_RAIL } from "./AdminNav.jsx";
import { TABS, searchJobs, tabInfo } from "./tabs.js";
import RacesAdmin from "./RacesAdmin.jsx";
import EntriesAdmin from "./EntriesAdmin.jsx";
import TeamsAdmin from "./TeamsAdmin.jsx";
import SeriesAdmin from "./SeriesAdmin.jsx";
import DriversAdmin from "./DriversAdmin.jsx";
import AttendanceAdmin from "./AttendanceAdmin.jsx";
import MembersAdmin from "./MembersAdmin.jsx";
import DownloadsAdmin from "./DownloadsAdmin.jsx";
import SettingsAdmin from "./SettingsAdmin.jsx";
import LiveAdmin from "./LiveAdmin.jsx";
import VotesAdmin from "./VotesAdmin.jsx";

// The admin ("League office"). From the top:
//
//  * one row for what is true of the whole page: the title, which series and
//    season the scoped tabs work on, where the menu sits, and the way out;
//  * a search over what can be done, for whoever does not know which tab
//    holds it;
//  * what is waiting (rounds over without results, combo votes closed without
//    a combo picked, Discord accounts without a driver), each a click away
//    from where it is dealt with;
//  * the menu (four groups, across the top or down the left side) and the
//    tab's panel.

const PAGES = {
  races: RacesAdmin,
  attendance: AttendanceAdmin,
  votes: VotesAdmin,
  series: SeriesAdmin,
  entries: EntriesAdmin,
  teams: TeamsAdmin,
  drivers: DriversAdmin,
  members: MembersAdmin,
  live: LiveAdmin,
  raceinfo: () => <SettingsAdmin part="raceinfo" />,
  downloads: DownloadsAdmin,
  settings: SettingsAdmin,
};

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
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted">League office</div>
        <h1 className="h2 text-xl">Admin</h1>
      </div>
      <input className="input" type="password" inputMode="numeric" autoComplete="current-password" placeholder="PIN" value={pin} onChange={(e) => setPin(e.target.value)} autoFocus />
      {error && <p className="text-sm text-red-300">{error}</p>}
      <button className="btn-accent w-full" disabled={busy || !pin}>
        Sign in
      </button>
    </form>
  );
}

// Which series and season the scoped tabs work on. Shown on every tab, but
// faded on the tabs it does not apply to.
function ScopePicker({ scoped }) {
  const { series, seriesId, setSeriesId, seasons, seasonId, setSeasonId, loaded } = useScope();
  if (!loaded) return null;
  if (!series.length) return <span className="text-sm text-muted">No series yet: start under Series &amp; seasons.</span>;
  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-2 transition-opacity ${scoped ? "" : "opacity-50"}`} title={scoped ? undefined : "This tab is the same for every series"}>
      <span className="label mb-0 hidden sm:inline">Working on</span>
      <select className="input w-auto max-w-[14rem] py-1.5" value={seriesId ?? ""} onChange={(e) => setSeriesId(Number(e.target.value))} aria-label="Series">
        {series.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.archived ? " (archived)" : ""}
          </option>
        ))}
      </select>
      <select className="input w-auto py-1.5" value={seasonId ?? ""} onChange={(e) => setSeasonId(Number(e.target.value))} aria-label="Season">
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

// "What do you want to do?": jumps to the tab that does it.
function AdminSearch({ onGo }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const box = useRef(null);
  const hits = searchJobs(q);
  useEffect(() => setI(0), [q]);
  useEffect(() => {
    const close = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const go = (hit) => {
    onGo(hit.tab);
    setQ("");
    setOpen(false);
  };
  return (
    <div ref={box} className="relative mb-4">
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      <input
        className="input pl-10"
        type="search"
        placeholder="What do you want to do? e.g. import results, penalty, new season"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setI((n) => Math.min(n + 1, hits.length - 1));
          else if (e.key === "ArrowUp") setI((n) => Math.max(n - 1, 0));
          else if (e.key === "Enter" && hits[i]) go(hits[i]);
          else if (e.key === "Escape") setOpen(false);
          else return;
          e.preventDefault();
        }}
        aria-label="Search the admin"
      />
      {open && q.trim() && (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-line bg-card shadow-2xl">
          {hits.length === 0 && <li className="px-4 py-3 text-sm text-muted">Nothing found for “{q}”.</li>}
          {hits.map((hit, n) => (
            <li key={`${hit.tab}-${hit.title}`}>
              <button
                type="button"
                onMouseEnter={() => setI(n)}
                onClick={() => go(hit)}
                className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm ${n === i ? "bg-white/5 text-ink" : "text-muted"}`}
              >
                <span className="font-semibold text-ink">{hit.title}</span>
                <span className="shrink-0 text-xs">
                  {tabInfo(hit.tab)?.group} › {tabInfo(hit.tab)?.label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// What is waiting on the admins. Gone when nothing is.
function TodoCard({ todo, onRound, onGo }) {
  if (!todo) return null;
  const { overdue, unlinked, votes = [] } = todo;
  if (!overdue.length && !unlinked && !votes.length) return null;
  return (
    <section className="mb-6 rounded-2xl border border-line bg-card p-4 sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted">
        <span className="h-2 w-2 rounded-full bg-red-600" aria-hidden="true" />
        To do
      </h2>
      <ul className="divide-y divide-line">
        {overdue.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5">
            <span className="min-w-0">
              <span className="block font-bold text-ink">
                <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: r.color || "rgb(var(--ink))" }} aria-hidden="true" />
                {r.series} · R{r.round} {r.name}
              </span>
              <span className="block text-sm text-muted">
                {r.track || "Mystery track"} · {dateTime(r.startsAt)} · no results yet
              </span>
            </span>
            <button type="button" className="btn-ghost py-1.5" onClick={() => onRound(r)}>
              Add results
            </button>
          </li>
        ))}
        {votes.map((v) => (
          <li key={`vote-${v.id}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5">
            <span className="min-w-0">
              <span className="block font-bold text-ink">
                <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: v.color || "rgb(var(--ink))" }} aria-hidden="true" />
                {v.series} · R{v.round} {v.name}
              </span>
              <span className="block text-sm text-muted">Combo vote closed · {dateTime(v.startsAt)} · no combo picked yet</span>
            </span>
            <button type="button" className="btn-ghost py-1.5" onClick={() => onRound(v, "votes")}>
              Pick the combo
            </button>
          </li>
        ))}
        {unlinked > 0 && (
          <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5">
            <span className="min-w-0">
              <span className="block font-bold text-ink">
                {unlinked} Discord {unlinked === 1 ? "account" : "accounts"} without a driver
              </span>
              <span className="block text-sm text-muted">Link them, so the entry lists show their driver name and team.</span>
            </span>
            <button type="button" className="btn-ghost py-1.5" onClick={() => onGo("members")}>
              Link
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}

function Office() {
  const { reload } = useSite();
  const { setSeriesId, setSeasonId } = useScope();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useNavMode();
  const tab = location.pathname.split("/")[2] || "races";
  const info = tabInfo(tab);

  // the to-do list, again on every tab change (a result just imported takes
  // its round off it)
  const [todo, setTodo] = useState(null);
  const loadTodo = useCallback(() => {
    api
      .get("/admin/todo")
      .then(setTodo)
      .catch(() => setTodo(null));
  }, []);
  useEffect(loadTodo, [loadTodo, tab]);
  const badges = { races: todo?.overdue.length || 0, votes: todo?.votes?.length || 0, members: todo?.unlinked || 0 };

  const go = (id) => navigate(`/admin/${id}`);
  const signOut = async () => {
    await api.post("/auth/logout");
    reload();
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 sm:mb-6">
        <div className="flex w-full items-end justify-between gap-3 lg:w-auto">
          <div>
            <div className="hidden text-[11px] font-bold uppercase tracking-wider text-muted sm:block">League office</div>
            <h1 className="h1">Admin</h1>
          </div>
          <button className="btn-ghost shrink-0 py-1.5 lg:hidden" onClick={signOut}>
            Sign out
          </button>
        </div>
        <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 lg:w-auto">
          <ScopePicker scoped={!!info?.scoped} />
          <span className="hidden lg:contents">
            <NavToggle mode={mode} onChange={setMode} />
            <button className="btn-ghost py-1.5" onClick={signOut}>
              Sign out
            </button>
          </span>
        </div>
      </div>

      <AdminSearch onGo={go} />

      <TodoCard
        todo={todo}
        onGo={go}
        onRound={(r, tab = "races") => {
          setSeriesId(r.seriesId);
          setSeasonId(r.seasonId);
          go(tab);
        }}
      />

      <div className={mode === NAV_RAIL ? "grid grid-cols-1 items-start gap-x-6 lg:grid-cols-[15rem_minmax(0,1fr)]" : ""}>
        <AdminNav mode={mode} tab={tab} badges={badges} />
        <div key={tab} className="rise min-h-[60vh] min-w-0">
          <Routes>
            {TABS.map((t) => {
              const Page = PAGES[t.id];
              return <Route key={t.id} path={t.id} element={<Page />} />;
            })}
            <Route path="*" element={<Navigate to="races" replace />} />
          </Routes>
        </div>
      </div>
    </>
  );
}

export default function Admin() {
  const { me } = useSite();
  if (!me.isAdmin) return <PinLogin />;
  return (
    <AdminScope>
      <Office />
    </AdminScope>
  );
}
