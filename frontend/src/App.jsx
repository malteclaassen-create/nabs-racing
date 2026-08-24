import { useEffect, lazy, Suspense } from "react";
import { Routes, Route, Navigate, Link, useLocation, useParams, useNavigationType } from "react-router-dom";
import { useScrollReveal } from "./hooks/useScrollReveal.js";
import { api } from "./api/client.js";
import { setTrackCountryOverrides } from "./data/circuits.js";
import { SeasonProvider, useSeason } from "./context/SeasonContext.jsx";
import { SeriesProvider, useSeries, useSeriesPath } from "./context/SeriesContext.jsx";
import NavBar from "./components/NavBar.jsx";
import { TourProvider } from "./components/Tour.jsx";
import { ConfirmProvider } from "./components/overlay.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import Logo from "./components/Logo.jsx";
import SocialLinks, { useSocial, SocialIcon } from "./components/SocialLinks.jsx";
import { useAuth } from "./hooks/useAuth.js";
import PreviewToggle from "./components/PreviewToggle.jsx";
import ScrollBar from "./components/ScrollBar.jsx";
import FeedbackWidget from "./components/FeedbackWidget.jsx";
import { Skeleton } from "./components/ui.jsx";
import { usePreviewMode, applyPreviewFromUrl } from "./preview.js";
import { setFallbackTitle, titleFor } from "./utils/pageTitle.js";
import Home from "./pages/Home.jsx";
import Welcome from "./pages/Welcome.jsx";
import DriverStandings from "./pages/DriverStandings.jsx";
import DriverProfile from "./pages/DriverProfile.jsx";
import Constructors from "./pages/Constructors.jsx";
import TeamProfile from "./pages/TeamProfile.jsx";
import HallOfFame from "./pages/HallOfFame.jsx";
import Races from "./pages/Races.jsx";
import Attendance from "./pages/Attendance.jsx";
import Live from "./pages/Live.jsx";
import Downloads from "./pages/Downloads.jsx";
import DiscordCallback from "./pages/DiscordCallback.jsx";
import SteamCallback from "./pages/SteamCallback.jsx";
import NotFound from "./pages/NotFound.jsx";

// Pages that only a signed-in member or the admin ever opens are split into
// their own chunks, so a normal visitor never downloads them. The admin area is
// by far the biggest single piece of the app, and nobody browsing the standings
// has any use for it.
const Admin = lazy(() => import("./pages/Admin.jsx"));
const EditDriverCard = lazy(() => import("./pages/EditDriverCard.jsx"));
const CardGallery = lazy(() => import("./pages/CardGallery.jsx"));
// Profile pulls in the whole personal area (cockpit panels, the lap-time tools
// and the rating breakdown), so splitting it takes all of that off the critical
// path in one go. Cockpit and Tools are listed here for their own routes, but
// they land in Profile's chunk because Profile imports from both.
const Profile = lazy(() => import("./pages/Profile.jsx"));
const Cockpit = lazy(() => import("./pages/Cockpit.jsx"));
const Tools = lazy(() => import("./pages/Tools.jsx"));
// Your own feedback threads. Only ever opened from a notification or the
// feedback panel, so it has no business in the initial bundle.
const MyFeedback = lazy(() => import("./pages/MyFeedback.jsx"));
// Your own incident-report threads. Every report notification links here
// (/reports?id=…), and on a phone it is the way in.
const MyReports = lazy(() => import("./pages/MyReports.jsx"));
// "Add NABS to your home screen". Opened from the announcement in the bell and
// from the footer, i.e. once per member ever — no reason for it to sit in the
// bundle everybody downloads.
const InstallApp = lazy(() => import("./pages/InstallApp.jsx"));
// Development only. The ternary is what keeps it out of a built site:
// import.meta.env.DEV is replaced with a literal false at build time, so the
// dynamic import below it is dead code and the chunk is never emitted. Written
// as a lazy() call inside the route instead, the chunk still shipped — an
// unreachable file, but one that hands out logins, sitting in dist/.
const DevLogin = import.meta.env.DEV ? lazy(() => import("./pages/DevLogin.jsx")) : null;

// Keeps the browser-tab title in sync with the page and the season being viewed.
//
// It used to name only the season, which read fine in a tab but cost the site in
// search results: the server writes a title per page into the HTML it ships, and
// a crawler renders the page before indexing it, so this line was overwriting
// every one of those with the same generic label. utils/pageTitle mirrors the
// server's wording; a page with something more precise to say (a round, a driver)
// claims the title for itself through useSpecificTitle.
function TitleSync() {
  const { current } = useSeason();
  const { current: series, seriesList } = useSeries();
  const location = useLocation();
  const multi = seriesList.length > 1;
  useEffect(() => {
    setFallbackTitle(titleFor(location.pathname, { season: current, series, multi }));
  }, [location.pathname, current?.name, current?.number, current?.game, series?.name, series?.isActive, multi]);
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
      <div className="container-page flex items-center justify-center gap-2 py-2 text-center font-mono text-[11px] font-bold uppercase tracking-widest text-warn">
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

// Sends a flat legacy path to its series-prefixed home: the series being
// viewed (sticky across global pages), else the active one. Old bookmarks and
// every internal `/drivers/...` link keep working — they just normalise to
// /s/<slug>/… on arrival. `sub` may contain :params (filled from the URL) and
// the query string rides along (e.g. /races?race=<id>).
function ToSeries({ sub = "" }) {
  const { slug, active, loaded } = useSeries();
  const params = useParams();
  const location = useLocation();
  const target = slug || active?.slug || null;
  if (!target) return loaded ? <NotFound /> : null; // list still loading / no series at all
  const path = sub.replace(/:(\w+)/g, (_, k) => params[k] ?? "");
  return <Navigate to={`/s/${target}${path}${location.search}`} replace />;
}

// Season-scoped pages remount when the selected season changes, so their data
// refetches for the new season. Admin/live/auth are not season-scoped.
function AppRoutes() {
  const { season } = useSeason();
  const { active, loaded, unknownSlug } = useSeries();
  const location = useLocation();
  const navigationType = useNavigationType();
  // Jump to the top on every page NAVIGATION. Without this the old page's
  // scroll offset carries over, and since the incoming page is only a short
  // loading skeleton for a moment, the view clamps to the page's end — the
  // footer flashes into view until the real content pushes it back down.
  // Back/forward (POP) keeps the browser's own scroll restoration; changing
  // only the query string (e.g. ?race=… on Races) doesn't scroll either.
  useEffect(() => {
    if (navigationType !== "POP") window.scrollTo(0, 0);
  }, [location.pathname, navigationType]);
  // Anonymous page-view beacon for the admin Traffic tab. Fire-and-forget;
  // admin/auth paths are skipped here AND server-side.
  useEffect(() => {
    if (!location.pathname.startsWith("/admin") && !location.pathname.startsWith("/auth")) {
      api.hit(location.pathname);
    }
  }, [location.pathname]);
  // A /s/<slug> that doesn't resolve (typo, deleted series, private without
  // rights): hop to the same subpage of the active series — no white page.
  if (unknownSlug) {
    if (!active) return loaded ? <NotFound /> : null;
    const rest = location.pathname.replace(/^\/s\/[^/]+/, "");
    return <Navigate to={`/s/${active.slug}${rest}${location.search}`} replace />;
  }
  return (
    // min-h-screen on the content itself (not just flex-1): while a page is
    // still a short loading skeleton, the column would otherwise end exactly
    // at the viewport's bottom edge and the footer flashed into view for a
    // beat on every navigation. This keeps it below the fold from the start.
    <main id="main" key={season ?? "loading"} className="container-page min-h-screen w-full flex-1 py-6 sm:py-10">
      {/* Per-route crash guard: a page that throws shows a fallback here while
          the NavBar/Footer (outside this component) and every other route keep
          working. resetKey clears the error the moment the path changes. */}
      <ErrorBoundary resetKey={location.pathname}>
      {/* Keyed on the path so each navigation replays the fade-in entrance. */}
      <div key={location.pathname} className="page-in">
      {/* The lazily-loaded pages (admin, cockpit, tools, …) need a fallback for
          the moment their chunk is still on the wire. Same skeleton the pages
          use themselves, so the switch is not visible as a change of style. */}
      <Suspense fallback={<PageChunkSkeleton />}>
      <Routes location={location}>
        {/* Series-scoped pages live under /s/<slug>/… — the series is part of
            the page's identity, so links can be shared across series. */}
        <Route path="/s/:seriesSlug" element={<HomeRoute />} />
        <Route path="/s/:seriesSlug/drivers" element={<DriverStandings />} />
        <Route path="/s/:seriesSlug/drivers/:id" element={<DriverProfile />} />
        <Route path="/s/:seriesSlug/constructors" element={<Constructors />} />
        <Route path="/s/:seriesSlug/constructors/:id" element={<TeamProfile />} />
        <Route path="/s/:seriesSlug/teams" element={<Constructors />} />
        <Route path="/s/:seriesSlug/teams/:id" element={<TeamProfile />} />
        <Route path="/s/:seriesSlug/records" element={<HallOfFame />} />
        <Route path="/s/:seriesSlug/races" element={<Races />} />
        <Route path="/s/:seriesSlug/results" element={<Races />} />
        <Route path="/s/:seriesSlug/calendar" element={<Races />} />
        <Route path="/s/:seriesSlug/attendance" element={<Attendance />} />
        <Route path="/s/:seriesSlug/live" element={<Live />} />

        {/* The root shows the primary series' home ITSELF instead of bouncing to
            /s/<slug>. It used to be a redirect that happened in the browser,
            which meant the address everyone shares had no content of its own:
            Google fetched it, saw an empty page on its way somewhere else, and
            classified nabsracing.com as a soft 404 — which is why the homepage
            could not appear in search results at all. Nothing else changes: the
            series-scoped reads fall back to the primary series when the address
            carries no slug, and every link in the nav is built from the active
            series either way. */}
        <Route path="/" element={<HomeRoute />} />

        {/* Legacy flat paths -> the same page inside the current series, so
            old bookmarks and unprefixed internal links keep working. A direct
            hit from outside is answered by a real redirect on the server (see
            legacyRedirects in the backend); this handles in-app navigation,
            which never reaches the server. */}
        <Route path="/drivers" element={<ToSeries sub="/drivers" />} />
        <Route path="/drivers/:id" element={<ToSeries sub="/drivers/:id" />} />
        <Route path="/constructors" element={<ToSeries sub="/constructors" />} />
        <Route path="/constructors/:id" element={<ToSeries sub="/constructors/:id" />} />
        <Route path="/teams" element={<ToSeries sub="/teams" />} />
        <Route path="/teams/:id" element={<ToSeries sub="/teams/:id" />} />
        <Route path="/records" element={<ToSeries sub="/records" />} />
        <Route path="/races" element={<ToSeries sub="/races" />} />
        <Route path="/results" element={<ToSeries sub="/results" />} />
        <Route path="/calendar" element={<ToSeries sub="/calendar" />} />
        <Route path="/attendance" element={<ToSeries sub="/attendance" />} />
        <Route path="/live" element={<ToSeries sub="/live" />} />

        {/* Global pages (shared across series): no prefix. */}
        {/* The newcomer page under an address of its own. The home route shows
            it to signed-out visitors, but only they ever see it: a member who
            has signed in cannot get back to the rules and the FAQ, and there is
            no link to hand someone in a Discord listing or a forum post. Same
            page, always, whoever is looking. */}
        <Route path="/join" element={<Welcome />} />
        <Route path="/downloads" element={<Downloads />} />
        {/* How to put the site on a phone's home screen (Android, iOS and
            desktop). Linked from the footer and from the one-off announcement
            in the notification bell. */}
        <Route path="/app" element={<InstallApp />} />
        {/* Race-prep calculators. Not in the nav on purpose: linked from the
            upcoming-race panel and the private profile. */}
        <Route path="/tools" element={<Tools />} />
        <Route path="/profile" element={<Profile />} />
        {/* Your own feedback threads. Reached from the notification the admins'
            answer sends (/feedback?id=…) and from the feedback panel itself. */}
        <Route path="/feedback" element={<MyFeedback />} />
        <Route path="/reports" element={<MyReports />} />
        {/* Signing in as any driver, to try both sides of a report on one
            machine. `import.meta.env.DEV` is false in a build, so this route
            and the page behind it are removed from the shipped bundle; the API
            half refuses anything that is not a loopback request anyway. */}
        {import.meta.env.DEV && <Route path="/dev/login" element={<DevLogin />} />}
        {/* The member's private driver area (login required). */}
        <Route path="/cockpit" element={<Cockpit />} />
        {/* Focused editor for just the driver's rating card (linked from /profile). */}
        <Route path="/profile/card" element={<EditDriverCard />} />
        {/* No-login design preview of every card edition. Not in the nav. */}
        <Route path="/cards" element={<CardGallery />} />
        {/* Rules + downloads live together on the Race Info page. */}
        <Route path="/rules" element={<Navigate to="/downloads" replace />} />
        <Route path="/info" element={<Navigate to="/downloads" replace />} />
        {/* Sign-Up + Driver Market now live on the Races page; keep old links working. */}
        <Route path="/signup" element={<ToSeries sub="/races" />} />
        <Route path="/rennen" element={<ToSeries sub="/races" />} />
        <Route path="/market" element={<ToSeries sub="/races" />} />
        <Route path="/driver-market" element={<ToSeries sub="/races" />} />
        <Route path="/auth/discord/callback" element={<DiscordCallback />} />
        {/* Steam sends the member back here; the page hands the answer to the
            API with their session attached (see SteamCallback). */}
        <Route path="/auth/steam/callback" element={<SteamCallback />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      </Suspense>
      </div>
      </ErrorBoundary>
    </main>
  );
}

// Placeholder while a split-off page chunk downloads. Deliberately plain: these
// pages are behind a login or the admin PIN, so it is only ever seen for the
// fraction of a second before the real page's own skeleton takes over.
function PageChunkSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

// Footer quick links, built inside the component so the series-scoped ones
// carry the /s/<slug> prefix of the series being viewed ("global" pages like
// Race Info have none).
function footerLinks(p) {
  return [
    { to: p(""), label: "Home" },
    { to: p("/drivers"), label: "Drivers" },
    { to: p("/constructors"), label: "Constructors" },
    { to: p("/races"), label: "Races" },
    { to: p("/attendance"), label: "Attendance" },
    { to: p("/live"), label: "Live Timing" },
    // The newcomer page. Signed-out visitors meet it as the home page, but a
    // member never sees it again once they have logged in, and the rules and
    // the FAQ live there. This is also the only link on the site pointing at it,
    // which is what lets a search engine find it at all.
    { to: "/join", label: "How it works" },
    { to: "/downloads", label: "Race Info" },
    // The install walkthrough. Its own announcement in the bell fires once and
    // is then read; this is the standing way back to it.
    { to: "/app", label: "Add to phone" },
  ];
}

function Footer() {
  const { current } = useSeason();
  const { seriesPath } = useSeriesPath();
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
            {footerLinks(seriesPath).map((l) => (
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

// Series outside, season inside: the SeasonProvider remounts (fresh, already
// series-scoped season list) whenever the viewed series changes.
function SeriesScopedApp() {
  const { slug } = useSeries();
  return (
    // The tour sits ABOVE the season key, and has to. A tour walks from page to
    // page, and the first hop off an unprefixed page (say "/" to the standings)
    // puts a /s/<slug> in the address for the first time — which changes this
    // key, remounts everything under it, and took the running tour with it. The
    // tour would simply vanish one step in, on the very step that navigates.
    // Nothing in here reads the season, so it loses nothing by sitting outside.
    <TourProvider>
      <SeasonProvider key={slug || "default"}>
        <TitleSync />
        {/* Confirmations render as the site's own dialog rather than the
            browser's. High in the tree so any page can ask. */}
        <ConfirmProvider>
        <div className="flex min-h-screen flex-col">
          {/* First thing in the tab order: jumps straight past the logo, series
              switcher, six nav links, search, profile chip and bell. Invisible
              until it takes focus. */}
          <a
            href="#main"
            className="sr-only left-3 top-3 z-50 rounded-lg bg-brand px-4 py-2 text-sm font-bold text-ink shadow-lg focus:not-sr-only focus:fixed"
          >
            Skip to content
          </a>
          <NavBar />
          <PrivateSeasonBanner />
          <AppRoutes />
          <Footer />
        </div>
        <PreviewToggle />
        <ScrollBar />
        {/* Bug reports & feature wishes. Its own floating button on desktop
            (bottom right); on phones it has no button of its own and is opened
            from the "Feedback" row in the burger menu. */}
        <FeedbackWidget />
        </ConfirmProvider>
      </SeasonProvider>
    </TourProvider>
  );
}

export default function App() {
  useScrollReveal();
  useEffect(() => applyPreviewFromUrl(), []);
  // Admin-stored track flag countries, layered over the static circuit table
  // so edited (or circuit-less) tracks show the right flag site-wide.
  useEffect(() => {
    api.trackCountries().then(setTrackCountryOverrides).catch(() => {});
  }, []);
  return (
    <SeriesProvider>
      <SeriesScopedApp />
    </SeriesProvider>
  );
}
