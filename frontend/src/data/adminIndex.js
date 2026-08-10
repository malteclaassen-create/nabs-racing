// ---------------------------------------------------------------------------
// The admin's own map of itself: the tab strip, and a searchable list of what
// can actually be done in each tab.
//
// Twenty-two tabs is more than anyone keeps in their head, and the person who
// needs "where do I ban somebody" is exactly the person who did not build the
// site. So the search does not look at the tab names (which are the part you
// can already read) but at the JOBS: one entry per thing an admin goes looking
// for, each with the words they would actually type for it.
//
// Keeping this beside the tab list rather than inside the admin page means both
// halves are edited in the same file — a new tab whose entries are missing here
// is visible at a glance. When a feature moves, move its entry.
// ---------------------------------------------------------------------------

export const TAB_GROUPS = [
  {
    label: "Race weekend",
    tabs: [
      { id: "discord", label: "Races & Events" },
      { id: "attendance", label: "Attendance" },
      { id: "import", label: "Import Race" },
      { id: "edit", label: "Edit Results" },
      { id: "graphic", label: "Result Graphic" },
      { id: "photos", label: "Photos" },
    ],
  },
  {
    label: "League",
    tabs: [
      { id: "seasons", label: "Seasons" },
      { id: "teams", label: "Teams" },
      { id: "drivers", label: "Drivers" },
      { id: "market", label: "Driver Market" },
      { id: "ratings", label: "Ratings" },
      { id: "alltime", label: "All-time" },
    ],
  },
  {
    label: "Community",
    tabs: [
      { id: "members", label: "Members" },
      { id: "feedback", label: "Feedback" },
      { id: "notify", label: "Notifications" },
      { id: "downloads", label: "Downloads" },
      { id: "social", label: "Social & Live" },
    ],
  },
  {
    label: "Site content",
    tabs: [
      { id: "tracks", label: "Tracks" },
      { id: "raceinfo", label: "Race Info" },
      { id: "faq", label: "Home FAQ" },
    ],
  },
  {
    label: "System",
    tabs: [
      { id: "traffic", label: "Traffic" },
      { id: "health", label: "Health" },
      { id: "pin", label: "Change PIN" },
    ],
  },
];

// Tabs that are themselves split into views, so a hit can land on the right
// one instead of on whatever the tab happens to open with.
export const TAB_VIEWS = {
  attendance: {
    hotlaps: "Hotlap videos",
    signups: "Who can sign up",
    missing: "Still to answer",
    history: "Past sign-ups",
  },
};

const TAB_BY_ID = new Map();
for (const g of TAB_GROUPS) for (const t of g.tabs) TAB_BY_ID.set(t.id, { ...t, group: g.label });

export function tabInfo(id) {
  return TAB_BY_ID.get(id) || null;
}

// `keywords` is where the searching really happens: the words somebody types
// when they don't know what we called it ("ban", "rickroll", "who is coming").
// Add generously — an unused keyword costs nothing, a missing one costs the
// colleague ten minutes of clicking through tabs.
export const ADMIN_INDEX = [
  // --- Race weekend ---------------------------------------------------------
  {
    tab: "discord",
    title: "Create a race or event",
    hint: "Put a new round, training session or special event on the calendar.",
    keywords: "add new schedule round fixture date time track laps qualifying training special event",
  },
  {
    tab: "discord",
    title: "The season's calendar",
    hint: "Rename a round, move its date, set its country flag, or delete it.",
    keywords: "season races edit rename move date time country flag round number delete reorder calendar",
  },
  {
    tab: "discord",
    title: "Discord webhook for announcements",
    hint: "The channel the site posts a new race and its sign-up list to.",
    keywords: "discord webhook url channel announce post integration bot",
  },
  {
    tab: "attendance",
    view: "hotlaps",
    title: "Hotlap videos for a circuit",
    hint: "The YouTube lap shown next to the sign-up. A track without one says the hotlap is coming soon.",
    keywords: "hotlap video youtube onboard lap circuit track guide learn coming soon rickroll",
  },
  {
    tab: "attendance",
    view: "signups",
    title: "Open or close sign-up for a race",
    hint: "Force one round open or closed, hide a race from the attendance page, or send a reminder now.",
    keywords: "sign up signup open close closed lock gate hide eye reminder nudge ping rsvp attendance",
  },
  {
    tab: "attendance",
    view: "missing",
    title: "Who hasn't answered yet",
    hint: "The roster minus the answers, with Discord handles and ready-made mentions to chase them.",
    keywords: "missing silent chase dm message mention ping late no answer not answered who is coming",
  },
  {
    tab: "attendance",
    view: "history",
    title: "What people answered for past races",
    hint: "Old sign-ups, including who accepted and never started.",
    keywords: "history past sign ups answered no show did not start archive",
  },
  {
    tab: "import",
    title: "Import a race result",
    hint: "Upload the Assetto Corsa results file and match its drivers to the roster.",
    keywords: "import upload json assetto corsa results file match steam guid telemetry",
  },
  {
    tab: "import",
    title: "Add qualifying to a stored race",
    hint: "Import a qualifying session for a round whose race is already saved.",
    keywords: "qualifying quali import json grid pole session",
  },
  {
    tab: "edit",
    title: "Fix a classification",
    hint: "Positions, DNF and DSQ, points, and time penalties in seconds.",
    keywords: "edit results positions finishing order status dnf dsq dns points penalty seconds steward correct fix",
  },
  {
    tab: "edit",
    title: "Driver of the Day",
    hint: "Pick the driver of the day for a round, and who made the call.",
    keywords: "dotd driver of the day pick vote award",
  },
  {
    tab: "edit",
    title: "Record pole and fastest lap by hand",
    hint: "For archive rounds with no imported data: the pole sitter and fastest lap, each with a time.",
    keywords: "honours pole position fastest lap fl time manual archive record",
  },
  {
    tab: "edit",
    title: "Grid, gaps, contacts and laps led",
    hint: "The per-driver columns an old round has no telemetry for.",
    keywords: "grid start position time gap contacts incidents laps led telemetry manual",
  },
  {
    tab: "edit",
    title: "Post a result to Discord",
    hint: "Send the finished classification to the results channel, mentioning the drivers.",
    keywords: "results post discord webhook announce mention ping publish",
  },
  {
    tab: "edit",
    title: "Delete a race or just its results",
    hint: "Wipe a saved classification, or remove the round entirely.",
    keywords: "delete remove wipe race results undo",
  },
  {
    tab: "graphic",
    title: "The result poster for a round",
    hint: "The picture for Discord, built from the round's own result. Pick a round, download the PNG.",
    keywords: "graphic poster image png share discord post podium top ten social instagram photoshop template",
  },
  {
    tab: "graphic",
    title: "Team cars and wordmarks",
    hint: "The cut-out car and the wide logo the result poster draws with. Uploaded once per team.",
    keywords: "car cars artwork wordmark wide logo graphic poster cutout render team art",
  },
  {
    tab: "photos",
    title: "Photos for a race",
    hint: "The picture gallery under a round's results.",
    keywords: "photos pictures images gallery upload carousel screenshots",
  },

  // --- League ---------------------------------------------------------------
  {
    tab: "seasons",
    title: "Create a season",
    hint: "Start a new season for a series.",
    keywords: "new season create add year championship",
  },
  {
    tab: "seasons",
    title: "Season settings",
    hint: "Which season is active, whether it's public, its points table, dropped results and rating cards.",
    keywords: "active public private points table scoring drop worst results cards rename game",
  },
  {
    tab: "seasons",
    title: "Racing series",
    hint: "A second championship with its own seasons, teams and standings.",
    keywords: "series championship second league primary slug colour logo",
  },
  {
    tab: "teams",
    title: "Add a team",
    hint: "A new constructor for this season, with its tier and colour.",
    keywords: "new team constructor create tier colour",
  },
  {
    tab: "teams",
    title: "Bring a team over from another season",
    hint: "Copy a constructor (and optionally its drivers) into the season you're editing.",
    keywords: "copy clone bring over previous season team roster",
  },
  {
    tab: "teams",
    title: "Team colours and logos",
    hint: "Rename a constructor, change its colour, tier or logo.",
    keywords: "team colour color logo tier rename delete constructor roster",
  },
  {
    tab: "drivers",
    title: "Add a driver",
    hint: "A new driver on this season's roster.",
    keywords: "new driver create add name discord tier team roster",
  },
  {
    tab: "drivers",
    title: "Move a driver, change tier, deactivate",
    hint: "Swap teams, switch between Tier 1, Tier 2 and Reserve, or take a driver out of the season.",
    keywords: "move team tier reserve deactivate reactivate remove hide from standings roster",
  },
  {
    tab: "drivers",
    title: "Safety car drivers",
    hint: "Mark who drives the safety car. Shows on their profile, in results and on the live board.",
    keywords: "safety car sc pace car role badge marshal",
  },
  {
    tab: "drivers",
    title: "Link a driver to their Discord or Steam account",
    hint: "The Discord user ID makes their login and result-post mentions work; the Steam ID is what imports match on.",
    keywords: "discord id steam guid link login connect mention account id",
  },
  {
    tab: "market",
    title: "Seat offers",
    hint: "Who has offered their seat, who is interested, and forcing the pick.",
    keywords: "driver market seat offer reserve substitute pick fill swap stand in",
  },
  {
    tab: "market",
    title: "Takeover history",
    hint: "The record of who actually stood in for whom.",
    keywords: "market history takeover record substitute past",
  },
  {
    tab: "ratings",
    title: "Rating formula tuning",
    hint: "The weights behind the RTG / EXP / RAC / AWA / PAC numbers on the driver cards.",
    keywords: "ratings rtg exp rac awa aha pac formula weights tuning driver cards numbers",
  },
  {
    tab: "alltime",
    title: "Find anything across all seasons",
    hint: "Search every season for a driver, team or race and jump straight to it.",
    keywords: "all time search find lookup any season driver team race jump",
  },

  // --- Community ------------------------------------------------------------
  {
    tab: "members",
    title: "Logins with no driver yet",
    hint: "People who signed in but aren't connected to a roster driver, including anyone who asked for a seat.",
    keywords: "needs attention unlinked new member login connect i want to race request",
  },
  {
    tab: "members",
    title: "Ban a login",
    hint: "Every Discord account that has signed in, and the switch to lock one out.",
    keywords: "ban block kick lock out accounts members login discord troll",
  },
  {
    tab: "members",
    title: "Drivers who never logged in",
    hint: "Roster entries with no account behind them yet.",
    keywords: "never logged in unclaimed no account roster",
  },
  {
    tab: "members",
    title: "Same person across seasons",
    hint: "Link a driver's rows from different seasons so their career, photo and login follow them.",
    keywords: "person link merge same driver career history rename former name",
  },
  {
    tab: "feedback",
    title: "Bug reports and ideas",
    hint: "What members sent through the feedback button, and replying to them.",
    keywords: "feedback bug report idea suggestion reply thread message inbox",
  },
  {
    tab: "notify",
    title: "Notifications and reminders",
    hint: "Which events ring the bell, when race reminders go out, and how many days before a race sign-up opens.",
    keywords: "notifications bell reminders race reminder seat offers attendance opens days hour settings",
  },
  {
    tab: "downloads",
    title: "Downloads: files, links and folders",
    // The mod names live in the hint rather than the keywords on purpose: they
    // are still searchable, but "penalty" then ranks the steward's tool above
    // the page that happens to host Real Penalty.
    hint: "The member-only downloads page: upload a file, register an external link, sort them into folders. Where CSP, Real Penalty and the track packs live.",
    keywords: "downloads files upload folder mod track car link drive replay zip external",
  },
  {
    tab: "social",
    title: "League social links",
    hint: "The Discord invite, YouTube, Twitch and the rest, shown site-wide.",
    keywords: "social links discord invite youtube twitch instagram tiktok patreon footer",
  },
  {
    tab: "social",
    title: "Social wall on the home page",
    hint: "The posts shown on the front page. YouTube fills itself; the others are added by hand.",
    keywords: "social wall feed posts home page instagram tiktok youtube videos",
  },
  {
    tab: "social",
    title: "Live page buttons and stream",
    hint: "The stream embedded on the live page, plus the Content Manager join and full-timing buttons.",
    keywords: "live timing stream youtube twitch embed buttons content manager join link",
  },
  {
    tab: "social",
    title: "Which race server a series follows",
    hint: "The server the live timing page reads for each series.",
    keywords: "live server race server acserver series which server timing",
  },

  // --- Site content ---------------------------------------------------------
  {
    tab: "tracks",
    title: "Track facts and map image",
    hint: "The per-circuit fun facts and the track map picture, including its rotation.",
    keywords: "track info facts map image picture rotation circuit layout",
  },
  {
    tab: "raceinfo",
    title: "Race Info page text",
    hint: "The rules cards, the sporting regulations and the footnotes on the Race Info page.",
    keywords: "race info rules regulations sporting page intro championship cards points footnote text",
  },
  {
    tab: "faq",
    title: "Home page FAQ",
    hint: "The questions and answers newcomers see on the front page.",
    keywords: "faq questions answers welcome home newcomer help",
  },

  // --- System ---------------------------------------------------------------
  {
    tab: "traffic",
    title: "Visitor numbers",
    hint: "Who is visiting, the last 14 days, and the most visited pages.",
    keywords: "traffic visitors analytics stats page views popular",
  },
  {
    tab: "health",
    title: "Data check",
    hint: "Warnings about the league data: missing results, odd points, drivers without a team.",
    keywords: "health data check integrity problems warnings errors validation",
  },
  {
    tab: "health",
    title: "Backups",
    hint: "Automatic database backups and the full download as a zip.",
    keywords: "backup backups database download zip restore save copy",
  },
  {
    tab: "health",
    title: "Disk, memory and the admin log",
    hint: "Server disk usage, memory, unused uploaded files and a log of recent admin changes.",
    keywords: "disk space storage memory heap server activity log recent changes unused files clean up",
  },
  {
    tab: "pin",
    title: "Change the admin PIN",
    hint: "The password for this office.",
    keywords: "pin password security change login secret",
  },
];

// Apostrophes are DROPPED rather than turned into a space, so somebody typing
// "who hasnt answered" still finds "Who hasn't answered yet" — nobody reaches
// for the curly quote while searching. Everything else that isn't a letter or a
// digit becomes a space, so "social & live" and "sign-up" match either way.
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Every typed word must appear somewhere in the entry, so "safety car" narrows
// rather than widening the way an OR would.
//
// Ranked by how central the match is. The five steps matter because the whole
// text of an entry is searched: a word in the NAME of the thing is what you
// meant, a word among its keywords is probably what you meant, and a word that
// only turns up in the sentence describing it usually is not — "penalty"
// appears in the downloads blurb (Real Penalty, the mod) and in the steward's
// tool, and only one of those is the answer.
export function searchAdmin(query, limit = 8) {
  const q = norm(query);
  if (q.length < 2) return [];
  const words = q.split(" ");
  const hits = [];
  for (const e of ADMIN_INDEX) {
    const tab = TAB_BY_ID.get(e.tab);
    const viewLabel = e.view ? TAB_VIEWS[e.tab]?.[e.view] : null;
    const hay = norm([e.title, e.hint, e.keywords, tab?.label, tab?.group, viewLabel].join(" "));
    if (!words.every((w) => hay.includes(w))) continue;
    const title = norm(e.title);
    const named = norm([e.title, e.keywords].join(" "));
    const score = title.startsWith(q)
      ? 0
      : title.includes(q)
        ? 1
        : words.every((w) => title.includes(w))
          ? 2
          : words.every((w) => named.includes(w))
            ? 3
            : 4;
    hits.push({ ...e, tabLabel: tab?.label || e.tab, groupLabel: tab?.group || "", viewLabel, score });
  }
  return hits.sort((a, b) => a.score - b.score || a.title.localeCompare(b.title)).slice(0, limit);
}
