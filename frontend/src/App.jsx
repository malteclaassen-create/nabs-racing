import { useEffect } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { useScrollReveal } from "./hooks/useScrollReveal.js";
import { SeasonProvider, useSeason } from "./context/SeasonContext.jsx";
import NavBar from "./components/NavBar.jsx";
import SocialLinks, { useSocial } from "./components/SocialLinks.jsx";
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
import Live from "./pages/Live.jsx";
import RaceSignup from "./pages/RaceSignup.jsx";
import DiscordCallback from "./pages/DiscordCallback.jsx";
import Admin from "./pages/Admin.jsx";

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
        <Route path="/live" element={<Live />} />
        <Route path="/signup" element={<RaceSignup />} />
        <Route path="/rennen" element={<RaceSignup />} />
        {/* Driver Market now lives inside the Sign-Up page; keep old links working. */}
        <Route path="/market" element={<RaceSignup />} />
        <Route path="/driver-market" element={<RaceSignup />} />
        <Route path="/auth/discord/callback" element={<DiscordCallback />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<div className="card p-8 text-center text-medium">Page not found.</div>} />
      </Routes>
      </div>
    </main>
  );
}

function Footer() {
  const { current } = useSeason();
  const social = useSocial();
  const label = current
    ? `${current.name}${current.game ? ` · ${current.game}` : ""}`
    : "F1 on Assetto Corsa";
  return (
    <footer className="border-t border-border bg-card">
      <div className="container-page flex flex-col items-center gap-4 py-6 text-sm text-light sm:flex-row sm:justify-between">
        <span>NABS Racing League · {label}</span>
        <SocialLinks links={social.data} />
        <span className="flex flex-col items-center gap-0.5 sm:items-end">
          <span>Built for the NABS Discord community</span>
          <span className="text-xs text-faint">
            Circuit outlines © OpenStreetMap contributors
          </span>
        </span>
      </div>
    </footer>
  );
}

export default function App() {
  useScrollReveal();
  useEffect(() => applyPreviewFromUrl(), []);
  return (
    <SeasonProvider>
      <div className="flex min-h-screen flex-col">
        <NavBar />
        <AppRoutes />
        <Footer />
      </div>
      <PreviewToggle />
    </SeasonProvider>
  );
}
