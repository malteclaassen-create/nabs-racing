import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { Routes, Route, NavLink, Link, Navigate, useLocation, useNavigate, matchPath } from "react-router-dom";
import { SiteProvider, useSite } from "./site.jsx";
import { api } from "./api.js";
import { Logo, Loading, SocialIcon } from "./components/ui.jsx";
import Overview from "./pages/Overview.jsx";
import SeriesHome from "./pages/SeriesHome.jsx";
import Drivers from "./pages/Drivers.jsx";
import DriverPage from "./pages/DriverPage.jsx";
import Teams from "./pages/Teams.jsx";
import Races from "./pages/Races.jsx";
import RacePage from "./pages/RacePage.jsx";
import Transfers from "./pages/Transfers.jsx";
import Live from "./pages/Live.jsx";
import Info from "./pages/Info.jsx";
import History from "./pages/History.jsx";
import NotFound from "./pages/NotFound.jsx";
import { useRainTransition, RainOverlay } from "./components/RainTransition.jsx";
import DiscordButton from "./components/DiscordButton.jsx";

// Only the admin ever opens it, so visitors never download it.
const Admin = lazy(() => import("./admin/Admin.jsx"));

const linkClass = ({ isActive }) =>
  `whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-black uppercase italic tracking-wide transition ${isActive ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`;

// The pages of the series being looked at.
function useSeriesLinks() {
  const { seriesPath, series } = useSite();
  if (!series) return [];
  return [
    { to: seriesPath("/drivers"), label: "Standings" },
    ...(series.hasTeams ? [{ to: seriesPath("/teams"), label: "Teams" }] : []),
    { to: seriesPath("/races"), label: "Races" },
    ...(series.hasTeams ? [{ to: seriesPath("/transfers"), label: "Transfers" }] : []),
  ];
}

function Account({ floating }) {
  const { me, reload } = useSite();
  if (me.user) {
    return (
      <div className="flex items-center gap-2">
        {me.user.avatar ? (
          <img src={me.user.avatar} alt="" className="h-8 w-8 rounded-full border border-line" />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-line text-xs font-bold">{me.user.name[0]}</span>
        )}
        <span className="hidden text-sm font-semibold xl:inline">{me.user.name}</span>
        <button
          className="text-xs text-muted hover:text-ink"
          onClick={async () => {
            await api.post("/auth/logout");
            reload();
          }}
        >
          Sign out
        </button>
      </div>
    );
  }
  return (
    <DiscordButton className="px-3 py-1.5" floating={floating}>
      Sign in
    </DiscordButton>
  );
}

// Which series the series pages show. Switching keeps the page you are on
// (standings stay standings), on the other series.
function SeriesSwitcher({ inline = false }) {
  const { seriesList, series } = useSite();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  if (!series) return null;
  // the running series, and an archived one while it is being looked at
  const shown = seriesList.filter((s) => !s.archived || s.slug === series.slug);
  const sub = matchPath("/series/:slug/:page/*", location.pathname)?.params.page;
  const go = (slug) => {
    setOpen(false);
    navigate(`/series/${slug}${sub ? `/${sub}` : ""}`);
  };
  const dot = (s) => <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color || "rgb(var(--ink))" }} />;

  if (inline) {
    return (
      <div className="flex flex-wrap gap-2 px-3 py-2">
        {shown.map((s) => (
          <button key={s.slug} onClick={() => go(s.slug)} className={`btn border py-1.5 ${s.slug === series.slug ? "border-ink" : "border-line text-muted"}`}>
            {dot(s)}
            {s.name}
          </button>
        ))}
      </div>
    );
  }
  if (shown.length < 2) {
    return (
      <NavLink to={`/series/${series.slug}`} end className={linkClass}>
        <span className="inline-flex items-center gap-2">
          {dot(series)}
          {series.name}
        </span>
      </NavLink>
    );
  }
  return (
    <div className="relative" ref={ref}>
      <button
        className="inline-flex max-w-[16rem] items-center gap-2 whitespace-nowrap rounded-full border border-line px-3 py-1.5 text-sm font-black uppercase italic hover:border-ink"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {dot(series)}
        <span className="truncate">{series.name}</span>
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul className="absolute left-0 top-full z-40 mt-2 min-w-[220px] overflow-hidden rounded-xl border border-line bg-card py-1 shadow-2xl" role="listbox">
          {shown.map((s) => (
            <li key={s.slug}>
              <button
                onClick={() => go(s.slug)}
                className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm hover:bg-white/5 ${s.slug === series.slug ? "font-bold" : ""}`}
                role="option"
                aria-selected={s.slug === series.slug}
              >
                {dot(s)}
                <span className="flex-1">{s.name}</span>
                {s.archived ? <span className="text-xs text-muted">archived</span> : s.schedule && <span className="text-xs text-muted">{s.schedule}</span>}
              </button>
            </li>
          ))}
          <li className="mt-1 border-t border-line">
            <Link to="/history" onClick={() => setOpen(false)} className="block px-4 py-2.5 text-sm text-muted hover:bg-white/5 hover:text-ink">
              Past series &amp; seasons →
            </Link>
          </li>
        </ul>
      )}
    </div>
  );
}

function NavBar() {
  const { settings } = useSite();
  const seriesLinks = useSeriesLinks();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);
  const tail = [...(settings?.liveEnabled ? [{ to: "/live", label: "Live" }] : []), { to: "/history", label: "History" }, { to: "/info", label: "Race Info" }];
  // a touch more weight once the page scrolls under the bar
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-30 border-b md:backdrop-blur-md transition-[background-color,border-color,box-shadow] duration-300 ${
        scrolled ? "border-line bg-bg/95 md:bg-bg/90 shadow-[0_10px_30px_-15px_rgba(0,0,0,0.9)]" : "border-transparent bg-bg/85 md:bg-bg/60"
      }`}
    >
      <div className="page flex h-16 items-center gap-3">
        <Link to="/" className="group flex shrink-0 items-center gap-3">
          <span className="transition-transform duration-500 group-hover:rotate-[-20deg]">
            <Logo size={40} />
          </span>
          <span className="display text-xl">{settings?.leagueName ?? ""}</span>
        </Link>
        <nav className="ml-3 hidden items-center gap-1 lg:flex">
          <SeriesSwitcher />
          {seriesLinks.map((l) => (
            <NavLink key={l.to} to={l.to} className={linkClass}>
              {l.label}
            </NavLink>
          ))}
          {seriesLinks.length > 0 && <span className="mx-1 h-5 w-px bg-line" />}
          {tail.map((l) => (
            <NavLink key={l.to} to={l.to} className={linkClass}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto hidden lg:block">
          <Account floating />
        </div>
        <button className="ml-auto rounded-lg border border-line p-2 lg:hidden" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>
      {open && (
        <div className="rise max-h-[calc(100vh-4rem)] overflow-y-auto border-t border-line lg:hidden">
          <nav className="page flex flex-col py-2">
            <NavLink to="/" end className={linkClass}>
              Home
            </NavLink>
            {seriesLinks.length > 0 && <div className="mt-2 px-3 text-[11px] font-bold uppercase tracking-wider text-muted">Series</div>}
            <SeriesSwitcher inline />
            {seriesLinks.map((l) => (
              <NavLink key={l.to} to={l.to} className={linkClass}>
                {l.label}
              </NavLink>
            ))}
            {seriesLinks.length > 0 && <div className="my-2 h-px bg-line" />}
            {tail.map((l) => (
              <NavLink key={l.to} to={l.to} className={linkClass}>
                {l.label}
              </NavLink>
            ))}
            <div className="px-3 py-3">
              <Account />
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}

function Footer() {
  const { settings } = useSite();
  return (
    <footer className="mt-16 border-t border-line">
      <div className="page flex flex-col gap-3 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Logo size={28} />
          <span>
            © {new Date().getFullYear()} {settings?.leagueName}
          </span>
        </div>
        <div className="flex items-center gap-4">
          {settings?.discordInvite && (
            <a href={settings.discordInvite} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:text-ink">
              <SocialIcon name="discord" />
              Discord
            </a>
          )}
          {settings?.youtubeUrl && (
            <a href={settings.youtubeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:text-ink">
              <SocialIcon name="youtube" />
              YouTube
            </a>
          )}
          <Link to="/admin" className="hover:text-ink">
            Admin
          </Link>
        </div>
      </div>
    </footer>
  );
}

// Old flat addresses (/drivers, /races, ...) go to the same page of the
// series being looked at.
function ToSeries({ sub }) {
  const { series, seriesList } = useSite();
  if (!seriesList.length) return <Loading />;
  return <Navigate to={series ? `/series/${series.slug}${sub}` : "/"} replace />;
}

function Shell({ transition }) {
  const { settings } = useSite();
  // the page shown follows the address once the streaks cover the screen
  const { display, displayKey, phase, enter } = transition;
  useEffect(() => {
    if (settings?.leagueName) document.title = settings.leagueName;
  }, [settings?.leagueName]);

  return (
    <div className="flex min-h-screen flex-col">
      <NavBar />
      <main className="page flex-1 py-8 sm:py-10" style={{ "--enter": enter }}>
        {!settings ? (
          <Loading />
        ) : (
          <Suspense fallback={<Loading />}>
            {/* keyed on the page, so every page rises in (the admin's tabs
                stay one page, so the series picked there is kept) */}
            <div key={displayKey} className="page-in">
            <Routes location={display}>
              <Route path="/" element={<Overview />} />
              <Route path="/series/:slug" element={<SeriesHome />} />
              <Route path="/series/:slug/drivers" element={<Drivers />} />
              <Route path="/series/:slug/teams" element={<Teams />} />
              <Route path="/series/:slug/races" element={<Races />} />
              <Route path="/series/:slug/transfers" element={<Transfers />} />
              <Route path="/drivers" element={<ToSeries sub="/drivers" />} />
              <Route path="/teams" element={<ToSeries sub="/teams" />} />
              <Route path="/races" element={<ToSeries sub="/races" />} />
              <Route path="/drivers/:id" element={<DriverPage />} />
              <Route path="/races/:id" element={<RacePage />} />
              <Route path="/live" element={<Live />} />
              <Route path="/info" element={<Info />} />
              <Route path="/history" element={<History />} />
              <Route path="/admin/*" element={<Admin />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
            </div>
          </Suspense>
        )}
      </main>
      <Footer />
      <RainOverlay phase={phase} />
    </div>
  );
}

export default function App() {
  const location = useLocation();
  const transition = useRainTransition(location);
  // the site's data follows the page on screen, not the address
  return (
    <SiteProvider location={transition.display}>
      <Shell transition={transition} />
    </SiteProvider>
  );
}
