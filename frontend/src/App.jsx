import { useEffect } from "react";
import { Routes, Route, Navigate, Link, useLocation } from "react-router-dom";
import { useScrollReveal } from "./hooks/useScrollReveal.js";
import { SeasonProvider, useSeason } from "./context/SeasonContext.jsx";
import NavBar from "./components/NavBar.jsx";
import Logo from "./components/Logo.jsx";
import SocialLinks, { useSocial, SocialIcon } from "./components/SocialLinks.jsx";
import { useAuth } from "./hooks/useAuth.js";
import PreviewToggle from "./components/PreviewToggle.jsx";
import { usePreviewMode, applyPreviewFromUrl } from "./preview.js";
import Home from "./pages/Home.jsx";
import Welcome from "./pages/Welcome.jsx";
import DriverStandings from "./pages/DriverStandings.jsx";
import DriverProfile from "./pages/DriverProfile.jsx";
import Constructors from "./pages/Constructors.jsx";
import TeamProfile from "./pages/TeamProfile.jsx";
import Races from "./pages/Races.jsx";
import Attendance from "./pages/Attendance.jsx";
import Live from "./pages/Live.jsx";
import Downloads from "./pages/Downloads.jsx";
import Tools from "./pages/Tools.jsx";
import Profile from "./pages/Profile.jsx";
import DiscordCallback from "./pages/DiscordCallback.jsx";
import Admin from "./pages/Admin.jsx";
import NotFound from "./pages/NotFound.jsx";

// Keeps the browser-tab title in sync with the season being viewed (the static
// title in index.html is just the pre-load fallback).
function TitleSync() {
  const { current } = useSeason();
  useEffect(() => {
    document.title = current ? `NABS Racing League · ${current.name}` : "NABS Racing League";
  }, [current?.name]);
  return null;
}

// Shown while a PRIVATE (unpublished) season is being viewed on the public
// site. Only admins can ever select one (the API hides them from everyone
// else), so this is the admin's reminder that visitors don't see this page
// yet: what they're looking at is a preview of an unreleased season.
function PrivateSeasonBanner() {
  const { current } = useSeason();
  if (!current || current.isPublic !== false) return null;
  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10">
      <div className="container-page flex items-center justify-center gap-2 py-2 text-center font-mono text-[11px] font-bold uppercase tracking-[0.15em] text-amber-700 dark:text-amber-400">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
          <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
        </svg>
        <span>Private preview · visitors can't see this season until you publish it</span>
      </div>
    </div>
  );
}

// Home route switches on login: logged-out visitors (newcomers we know nothing
// about) get the Welcome landing ("what is NABS / how to join"); logged-in
// members get the normal animated home.
function HomeRoute() {
  const { isLoggedIn } = useAuth();
  const preview = usePreviewMode(); // owner-only override: "welcome" | "home" | null
  const showWelcome = preview ? preview === "welcome" : !isLoggedIn;
  return showWelcome ? <Welcome /> : <Home />;
}

// Season-scoped pages remount when the selected season changes, so their data
// refetches for the new season. Admin/live/auth are not season-scoped.
function AppRoutes() {
  const { season } = useSeason();
  const location = useLocation();
  return (
    <main key={season ?? "loading"} className="container-page w-full flex-1 py-10">
      {/* Keyed on the path so each navigation replays the fade-in entrance. */}
      <div key={location.pathname} className="page-in">
      <Routes location={location}>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/drivers" element={<DriverStandings />} />
        <Route path="/drivers/:id" element={<DriverProfile />} />
        <Route path="/constructors" element={<Constructors />} />
        <Route path="/constructors/:id" element={<TeamProfile />} />
        <Route path="/teams" element={<Constructors />} />
        <Route path="/teams/:id" element={<TeamProfile />} />
        <Route path="/races" element={<Races />} />
        <Route path="/results" element={<Races />} />
        <Route path="/calendar" element={<Races />} />
        <Route path="/attendance" element={<Attendance />} />
        <Route path="/live" element={<Live />} />
        <Route path="/downloads" element={<Downloads />} />
        {/* Race-prep calculators. Not in the nav on purpose: linked from the
            upcoming-race panel and the private profile. */}
        <Route path="/tools" element={<Tools />} />
        <Route path="/profile" element={<Profile />} />
        {/* Rules + downloads live together on the Race Info page. */}
        <Route path="/rules" element={<Navigate to="/downloads" replace />} />
        <Route path="/info" element={<Navigate to="/downloads" replace />} />
        {/* Sign-Up + Driver Market now live on the Races page; keep old links working. */}
        <Route path="/signup" element={<Navigate to="/races" replace />} />
        <Route path="/rennen" element={<Navigate to="/races" replace />} />
        <Route path="/market" element={<Navigate to="/races" replace />} />
        <Route path="/driver-market" element={<Navigate to="/races" replace />} />
        <Route path="/auth/discord/callback" element={<DiscordCallback />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      </div>
    </main>
  );
}

const FOOTER_LINKS = [
  { to: "/", label: "Home" },
  { to: "/drivers", label: "Drivers" },
  { to: "/constructors", label: "Constructors" },
  { to: "/races", label: "Races" },
  { to: "/attendance", label: "Attendance" },
  { to: "/live", label: "Live Timing" },
  { to: "/downloads", label: "Race Info" },
];

function Footer() {
  const { current } = useSeason();
  const social = useSocial();
  const discord = social.data?.discord;
  const year = new Date().getFullYear();

  return (
    <footer className="mt-16 border-t border-border bg-card">
      <div className="container-page grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1.2fr]">
        {/* brand + claim + socials */}
        <div className="space-y-4">
          <Link to="/" className="inline-flex items-center gap-3">
            <Logo size={40} />
            <span className="flex flex-col leading-none">
              <span className="font-display text-lg font-black uppercase tracking-tight text-dark">
                NABS Racing
              </span>
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">
                Racing League
              </span>
            </span>
          </Link>
          <p className="max-w-xs text-sm leading-relaxed text-light">
            A community-run sim racing championship on Assetto Corsa. Results, standings and live timing,
            updated after every round.
          </p>
          <SocialLinks links={social.data} />
        </div>

        {/* quick links */}
        <nav className="space-y-3">
          <h3 className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">Explore</h3>
          <ul className="space-y-2 text-sm">
            {FOOTER_LINKS.map((l) => (
              <li key={l.to}>
                <Link to={l.to} className="text-medium transition hover:text-dark">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* join CTA */}
        <div className="space-y-3">
          <h3 className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">
            Get on the grid
          </h3>
          <p className="max-w-xs text-sm leading-relaxed text-light">
            Everything happens in our Discord: sign-ups, stewarding and banter. New drivers welcome every
            season.
          </p>
          {discord && (
            <a
              href={discord}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-[#5865F2] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#4752c4]"
            >
              <SocialIcon name="discord" className="h-5 w-5" />
              Join the Discord
            </a>
          )}
        </div>
      </div>

      {/* bottom bar */}
      <div className="border-t border-border">
        <div className="container-page flex flex-col items-center gap-2 py-5 text-xs text-faint sm:flex-row sm:justify-between">
          <span>
            © {year} NABS Racing League
            {current ? ` · ${current.name}${current.game ? ` · ${current.game}` : ""}` : ""}
          </span>
          <span className="flex items-center gap-1.5">
            Circuit outlines © OpenStreetMap contributors
            <span className="text-border">·</span>
            <Link to="/admin" className="transition hover:text-light">Admin</Link>
          </span>
        </div>
      </div>
    </footer>
  );
}

export default function App() {
  useScrollReveal();
  useEffect(() => applyPreviewFromUrl(), []);
  return (
    <SeasonProvider>
      <TitleSync />
      <div className="flex min-h-screen flex-col">
        <NavBar />
        <PrivateSeasonBanner />
        <AppRoutes />
        <Footer />
      </div>
      <PreviewToggle />
    </SeasonProvider>
  );
}
