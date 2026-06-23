import { Routes, Route } from "react-router-dom";
import { useScrollReveal } from "./hooks/useScrollReveal.js";
import { SeasonProvider, useSeason } from "./context/SeasonContext.jsx";
import NavBar from "./components/NavBar.jsx";
import Home from "./pages/Home.jsx";
import DriverStandings from "./pages/DriverStandings.jsx";
import DriverProfile from "./pages/DriverProfile.jsx";
import Constructors from "./pages/Constructors.jsx";
import Races from "./pages/Races.jsx";
import Live from "./pages/Live.jsx";
import RaceSignup from "./pages/RaceSignup.jsx";
import DiscordCallback from "./pages/DiscordCallback.jsx";
import Admin from "./pages/Admin.jsx";

// Season-scoped pages remount when the selected season changes, so their data
// refetches for the new season. Admin/live/auth are not season-scoped.
function AppRoutes() {
  const { season } = useSeason();
  return (
    <main key={season ?? "loading"} className="container-page w-full flex-1 py-10">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/drivers" element={<DriverStandings />} />
        <Route path="/drivers/:id" element={<DriverProfile />} />
        <Route path="/constructors" element={<Constructors />} />
        <Route path="/teams" element={<Constructors />} />
        <Route path="/races" element={<Races />} />
        <Route path="/results" element={<Races />} />
        <Route path="/calendar" element={<Races />} />
        <Route path="/live" element={<Live />} />
        <Route path="/signup" element={<RaceSignup />} />
        <Route path="/rennen" element={<RaceSignup />} />
        <Route path="/auth/discord/callback" element={<DiscordCallback />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<div className="card p-8 text-center text-medium">Page not found.</div>} />
      </Routes>
    </main>
  );
}

function Footer() {
  const { current } = useSeason();
  const label = current
    ? `${current.name}${current.game ? ` · ${current.game}` : ""}`
    : "F1 on Assetto Corsa";
  return (
    <footer className="border-t border-border bg-card">
      <div className="container-page flex flex-col items-center justify-between gap-2 py-6 text-sm text-light sm:flex-row">
        <span>NABS Racing League · {label}</span>
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
  return (
    <SeasonProvider>
      <div className="flex min-h-screen flex-col">
        <NavBar />
        <AppRoutes />
        <Footer />
      </div>
    </SeasonProvider>
  );
}
