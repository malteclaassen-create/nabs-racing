import { useEffect, useState, lazy, Suspense } from "react";
import { Routes, Route, NavLink, Link, useLocation } from "react-router-dom";
import { SiteProvider, useSite } from "./site.jsx";
import { api } from "./api.js";
import { Logo, Loading, SocialIcon } from "./components/ui.jsx";
import Home from "./pages/Home.jsx";
import Drivers from "./pages/Drivers.jsx";
import DriverPage from "./pages/DriverPage.jsx";
import Teams from "./pages/Teams.jsx";
import Races from "./pages/Races.jsx";
import RacePage from "./pages/RacePage.jsx";
import Live from "./pages/Live.jsx";
import Info from "./pages/Info.jsx";
import NotFound from "./pages/NotFound.jsx";

// Only the admin ever opens it, so visitors never download it.
const Admin = lazy(() => import("./admin/Admin.jsx"));

function useNavLinks() {
  const { settings } = useSite();
  return [
    { to: "/", label: "Home", end: true },
    { to: "/drivers", label: "Drivers" },
    { to: "/teams", label: "Teams" },
    { to: "/races", label: "Races" },
    ...(settings?.liveEnabled ? [{ to: "/live", label: "Live" }] : []),
    { to: "/info", label: "Race Info" },
  ];
}

function Account() {
  const { me, reload } = useSite();
  if (me.user) {
    return (
      <div className="flex items-center gap-2">
        {me.user.avatar ? (
          <img src={me.user.avatar} alt="" className="h-8 w-8 rounded-full border border-line" />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-line text-xs font-bold">{me.user.name[0]}</span>
        )}
        <span className="hidden text-sm font-semibold lg:inline">{me.user.name}</span>
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
  if (!me.discordEnabled) return null;
  return (
    <a href="/api/auth/discord" className="btn bg-[#5865F2] px-3 py-1.5 text-white hover:bg-[#4752c4]">
      Sign in
    </a>
  );
}

function NavBar() {
  const { settings } = useSite();
  const links = useNavLinks();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const linkClass = ({ isActive }) =>
    `rounded-full px-3 py-1.5 text-sm font-black uppercase italic tracking-wide transition ${isActive ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`;

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
      <div className="page flex h-16 items-center gap-4">
        <Link to="/" className="flex items-center gap-3">
          <Logo size={40} />
          <span className="display text-xl">{settings?.leagueName ?? ""}</span>
        </Link>
        <nav className="ml-4 hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={linkClass}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto hidden md:block">
          <Account />
        </div>
        <button
          className="ml-auto rounded-lg border border-line p-2 md:hidden"
          aria-label="Menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>
      {open && (
        <div className="border-t border-line md:hidden">
          <nav className="page flex flex-col py-2">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={linkClass}>
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

function Shell() {
  const { settings } = useSite();
  const location = useLocation();
  // braces matter: newer browsers return a Promise from scrollTo, and React
  // would take that for a clean-up function
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  useEffect(() => {
    if (settings?.leagueName) document.title = settings.leagueName;
  }, [settings?.leagueName]);

  return (
    <div className="flex min-h-screen flex-col">
      <NavBar />
      <main className="page flex-1 py-8 sm:py-10">
        {!settings ? (
          <Loading />
        ) : (
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/drivers" element={<Drivers />} />
              <Route path="/drivers/:id" element={<DriverPage />} />
              <Route path="/teams" element={<Teams />} />
              <Route path="/races" element={<Races />} />
              <Route path="/races/:id" element={<RacePage />} />
              <Route path="/live" element={<Live />} />
              <Route path="/info" element={<Info />} />
              <Route path="/admin/*" element={<Admin />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        )}
      </main>
      <Footer />
    </div>
  );
}

export default function App() {
  return (
    <SiteProvider>
      <Shell />
    </SiteProvider>
  );
}
