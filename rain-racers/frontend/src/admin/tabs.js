// The admin's map of itself: its tabs in four groups, and what can be done in
// each, for the search at the top of the admin.
//
// The search does not look at the tab names (those can be read in the menu)
// but at the jobs: one entry per thing an admin comes looking for, with the
// words they would type for it. A new tab or a feature that moves gets its
// entries here, beside the tab list.

// `scoped`: works on the series and season picked at the top.
export const TAB_GROUPS = [
  {
    label: "Race weekend",
    tabs: [
      { id: "races", label: "Races & results", scoped: true },
      { id: "attendance", label: "Attendance", scoped: true },
      { id: "votes", label: "Combo votes", scoped: true },
    ],
  },
  {
    label: "League",
    tabs: [
      { id: "series", label: "Series & seasons", scoped: true },
      { id: "entries", label: "Entry list", scoped: true },
      { id: "teams", label: "Teams", scoped: true },
      { id: "drivers", label: "Drivers" },
    ],
  },
  {
    label: "Community",
    tabs: [
      { id: "members", label: "Members" },
      { id: "live", label: "Live timing" },
    ],
  },
  {
    label: "Site & system",
    tabs: [
      { id: "raceinfo", label: "Race Info" },
      { id: "downloads", label: "Downloads" },
      { id: "settings", label: "Settings" },
    ],
  },
];

export const TABS = TAB_GROUPS.flatMap((g) => g.tabs.map((t) => ({ ...t, group: g.label })));
export const tabInfo = (id) => TABS.find((t) => t.id === id) || null;

export const JOBS = [
  { tab: "races", title: "Import a result file", words: "import upload json results race qualifying server file session" },
  { tab: "races", title: "Type in a result by hand", words: "manual result enter finishing order dnf dsq dns" },
  { tab: "races", title: "Time penalty or points deduction", words: "penalty seconds steward points adjust deduction bonus order" },
  { tab: "races", title: "Add or change a round", words: "round calendar date time track car add new race schedule" },
  { tab: "races", title: "Mystery track", words: "mystery track hidden secret reveal" },
  { tab: "races", title: "Round poster, recording and timetable", words: "poster picture image video youtube recording stream timetable practice qualifying" },
  { tab: "races", title: "A round's own points (finale, double points)", words: "finale double points multiplier round table" },
  { tab: "attendance", title: "Who turned up and who said yes", words: "attendance signups sign-ups no show csv export present" },
  { tab: "votes", title: "Combo vote: members pick the next car and track", words: "vote voting poll combo combos car track next round week sahara pick choose members" },
  { tab: "votes", title: "Race the winning combo", words: "vote winner result combo apply round car track tie closed" },
  { tab: "series", title: "New series or season", words: "series season new create start add" },
  { tab: "series", title: "Points rules of a season", words: "points table reverse back to front qualifying points drop worst rounds sprint feature races" },
  { tab: "series", title: "Champion, manual points", words: "champion manual points pole award deduction" },
  { tab: "series", title: "Banner, colour, archive a series", words: "banner picture colour color archive past history schedule description" },
  { tab: "entries", title: "Entry list: who drives, team, number", words: "entry list driver team number add season" },
  { tab: "entries", title: "Team change during the season", words: "transfer move team change" },
  { tab: "teams", title: "Teams and their colours", words: "team colour color logo add" },
  { tab: "drivers", title: "Drivers: name, number, country, Steam id", words: "driver rename number country flag steam guid merge" },
  { tab: "members", title: "Link a Discord account to a driver", words: "member discord account link user login" },
  { tab: "live", title: "Live timing servers, one per series", words: "live timing server servers socket wss race control emperor second two series" },
  { tab: "raceinfo", title: "Race Info text and rules", words: "race info rules text regulations" },
  { tab: "downloads", title: "Downloads: mods, cars, tracks, files", words: "download mod car track file link upload content" },
  { tab: "settings", title: "League name, logo, links and colour", words: "league name logo discord invite youtube tagline colour color" },
  { tab: "settings", title: "Default points table", words: "default points table fastest lap dnf classified" },
  { tab: "settings", title: "Load the Rain Racers history", words: "history load seed grid finder results past seasons" },
];

// The jobs that match every word typed, best first.
export function searchJobs(query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return JOBS.map((job) => {
    const hay = `${job.title} ${job.words} ${tabInfo(job.tab)?.label || ""}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) return null;
    const score = words.reduce((n, w) => n + (job.title.toLowerCase().includes(w) ? 2 : 1), 0);
    return { ...job, score };
  })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}
