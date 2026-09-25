// ---------------------------------------------------------------------------
// The pages themselves, as search results.
//
// The search box finds drivers, teams, races and seasons — everything the
// league HAS. It could not find the league's own pages, so somebody looking for
// the lap comparison had to already know it lives under Tools, and typing
// "telemetry" came back empty.
//
// This is a small catalogue matched in the browser, so page hits appear the
// moment you type rather than after a round trip. Each entry carries the words
// people actually reach for, including the German ones a mixed-language league
// types by reflex.
// ---------------------------------------------------------------------------

// `where`: "league" = the page lives under /s/<series>/…, "flat" = it does not.
// `needs`: "member" = only worth offering to somebody signed in, "admin" = to
// an admin, "points" = only while the NABS Tokens trial is switched on.
const PAGES = [
  { key: "home", label: "Home", hint: "Next race, standings, the season", icon: "home", where: "league", path: "" ,
    words: ["home", "start", "front", "startseite", "news"] },
  { key: "standings", label: "Driver standings", hint: "The championship table", icon: "trophy", where: "league", path: "/drivers",
    words: ["standings", "drivers", "championship", "table", "points", "tabelle", "fahrerwertung", "wm"] },
  { key: "constructors", label: "Constructors", hint: "Team standings and line-ups", icon: "users", where: "league", path: "/constructors",
    words: ["constructors", "teams", "wcc", "konstrukteure", "teamwertung"] },
  { key: "races", label: "Races", hint: "Calendar, results, replays", icon: "flag", where: "league", path: "/races",
    words: ["races", "calendar", "results", "schedule", "rennen", "kalender", "ergebnisse"] },
  { key: "attendance", label: "Attendance", hint: "Sign up for the next round", icon: "calendar", where: "league", path: "/attendance",
    words: ["attendance", "sign up", "signup", "rsvp", "entry", "anmeldung", "anmelden", "teilnahme"] },
  { key: "live", label: "Live timing", hint: "The board while a race runs", icon: "activity", where: "league", path: "/live",
    words: ["live", "timing", "leaderboard", "board", "zeiten"] },
  { key: "records", label: "Hall of Fame", hint: "Champions and all-time records", icon: "crown", where: "league", path: "/records",
    words: ["records", "hall of fame", "champions", "all time", "rekorde", "bestenliste"] },
  { key: "transfers", label: "Transfers", hint: "Seat moves between rounds", icon: "arrows", where: "league", path: "/transfers",
    words: ["transfers", "seats", "market", "wechsel", "transfermarkt"] },

  // One page, two reasons to look for it: the rules live at the top of the
  // downloads page, which is what the nav calls "Race Info".
  { key: "raceinfo", label: "Race info", hint: "Rules, regulations and downloads", icon: "book", where: "flat", path: "/downloads",
    words: ["race info", "rules", "regulations", "sporting", "regeln", "reglement", "downloads", "files", "mods", "skins", "replays", "dateien"] },
  { key: "tools", label: "Lap comparison", hint: "Compare telemetry laps", icon: "gauge", where: "flat", path: "/tools",
    words: ["tools", "telemetry", "telemetrie", "laps", "lap comparison", "compare", "data", "runden", "vergleich"] },
  { key: "cards", label: "Driver cards", hint: "Every card edition", icon: "cards", where: "flat", path: "/cards",
    words: ["cards", "editions", "collection", "karten", "sammlung"] },
  { key: "install", label: "Add to phone", hint: "Install the site as an app", icon: "phone", where: "flat", path: "/app",
    words: ["app", "install", "phone", "home screen", "handy", "installieren"] },
  { key: "privacy", label: "Privacy", hint: "What the site stores", icon: "shield", where: "flat", path: "/privacy",
    words: ["privacy", "data", "gdpr", "datenschutz"] },

  { key: "profile", label: "My profile", hint: "Name, country, picture, bio", icon: "user", where: "flat", path: "/profile", needs: "member",
    words: ["profile", "my profile", "me", "edit", "profil", "bearbeiten"] },
  { key: "career", label: "My career", hint: "Everything you have ever raced", icon: "history", where: "flat", path: "/profile?tab=career", needs: "member",
    words: ["career", "record", "all time", "history", "karriere", "laufbahn", "statistik"] },
  { key: "achievements", label: "Achievements", hint: "What you have unlocked", icon: "medal", where: "flat", path: "/profile?tab=achievements", needs: "member",
    words: ["achievements", "badges", "unlocks", "erfolge", "abzeichen"] },
  { key: "rating", label: "My rating", hint: "How your card is worked out", icon: "trending", where: "flat", path: "/profile?tab=rating", needs: "member",
    words: ["rating", "my rating", "rtg", "exp", "pac", "rac", "bewertung"] },
  { key: "mytelemetry", label: "My telemetry", hint: "Your own laps and traces", icon: "gauge", where: "flat", path: "/profile?tab=tools", needs: "member",
    words: ["telemetry", "telemetrie", "my telemetry", "traces", "laps", "daten"] },
  { key: "points", label: "NABS Tokens", hint: "Balance, shop, how to earn", icon: "coin", where: "flat", path: "/profile?tab=tokens", needs: "points",
    words: ["points", "nabs tokens", "tokens", "shop", "balance", "punkte", "muenzen"] },
  { key: "settings", label: "Settings", hint: "Theme, performance, account", icon: "sliders", where: "flat", path: "/profile?tab=settings", needs: "member",
    words: ["settings", "theme", "dark mode", "light mode", "performance", "einstellungen", "design"] },
  { key: "feedback", label: "Feedback", hint: "Report a bug or an idea", icon: "message", where: "flat", path: "/feedback", needs: "member",
    words: ["feedback", "bug", "idea", "report a bug", "fehler", "idee", "vorschlag"] },
  { key: "reports", label: "My reports", hint: "Your stewarding threads", icon: "alert", where: "flat", path: "/reports", needs: "member",
    words: ["reports", "stewards", "incident", "protest", "meldung", "vorfall"] },
  { key: "admin", label: "Admin", hint: "The league office", icon: "shield", where: "flat", path: "/admin", needs: "admin",
    words: ["admin", "office", "manage", "verwaltung"] },
];

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// How well one entry answers `term`, or 0 for not at all. A word that STARTS
// with what you typed beats one that merely contains it, so "tele" puts
// telemetry first and "rat" puts the rating ahead of "celebrated".
function score(entry, term) {
  const label = norm(entry.label);
  const words = [label, ...entry.words.map(norm)];
  let best = 0;
  for (const w of words) {
    if (w === term) best = Math.max(best, 100);
    else if (w.startsWith(term)) best = Math.max(best, 80);
    else if (w.split(" ").some((part) => part.startsWith(term))) best = Math.max(best, 60);
    else if (term.length >= 3 && w.includes(term)) best = Math.max(best, 40);
  }
  // A page the visitor cannot open anyway ranks below one they can.
  return best;
}

// The pages matching `term`, best first.
// `seriesPath` turns "/drivers" into the current league's address.
export function matchPages(term, { seriesPath = (p) => p || "/", isMember = false, isAdmin = false, pointsOn = false, limit = 5 } = {}) {
  const t = norm(term);
  if (!t) return [];
  const allowed = (e) => {
    if (e.needs === "admin") return isAdmin;
    if (e.needs === "points") return isMember && pointsOn;
    if (e.needs === "member") return isMember;
    return true;
  };
  return PAGES.filter(allowed)
    .map((e) => ({ e, s: score(e, t) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.e.label.localeCompare(b.e.label))
    .slice(0, limit)
    .map(({ e }) => ({
      type: "page",
      key: e.key,
      label: e.label,
      sub: e.hint,
      icon: e.icon,
      link: e.where === "league" ? seriesPath(e.path) : e.path,
    }));
}

export const PAGE_COUNT = PAGES.length;
