// ---------------------------------------------------------------------------
// The admin's own map of itself: the tab strip, and a searchable list of what
// can actually be done in each tab.
//
// Twenty-odd tabs is more than anyone keeps in their head, and the person who
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
      // Poster, standings poster, Discord post and the members' race recap:
      // everything a finished round is turned into.
      { id: "content", label: "Content" },
      { id: "photos", label: "Photos & Videos" },
    ],
  },
  {
    label: "League",
    tabs: [
      { id: "seasons", label: "Seasons" },
      { id: "teams", label: "Teams" },
      { id: "drivers", label: "Drivers" },
      { id: "transfers", label: "Transfers" },
      { id: "market", label: "Driver Market" },
      // The telemetry view is held back from the members' side on purpose
      // while the league decides whether a driver's inputs are public. See
      // routes/telemetryLaps.js.
      { id: "ratings", label: "Ratings & Telemetry" },
    ],
  },
  {
    label: "Community",
    tabs: [
      { id: "members", label: "Members" },
      { id: "reports", label: "Reports" },
      { id: "feedback", label: "Feedback" },
      { id: "notify", label: "Notifications" },
      // What the race nights need on the Live page: its buttons and stream,
      // which server each series follows, the training board.
      { id: "live", label: "Live" },
      // Trial feature, and the tab carries its own on/off switch.
      { id: "tokens", label: "NABS Points" },
    ],
  },
  {
    label: "Site & system",
    tabs: [
      // The public pages' own words and pictures, one view per page.
      { id: "site", label: "Site texts" },
      { id: "downloads", label: "Downloads" },
      { id: "system", label: "System" },
    ],
  },
];

const KNOWN_TABS = new Set(TAB_GROUPS.flatMap((g) => g.tabs.map((t) => t.id)));

// Tabs that were folded into another one, and where each now lives. Links in
// notifications already sent (/admin?tab=social), a tab remembered in the
// browser and the admin search all still say the old names; they land on the
// tab that took the job over, at the right view.
export const TAB_ALIASES = {
  tracks: { tab: "site", view: "tracks" },
  raceinfo: { tab: "site", view: "raceinfo" },
  faq: { tab: "site", view: "faq" },
  privacy: { tab: "site", view: "privacy" },
  social: { tab: "live" },
  traffic: { tab: "system", view: "traffic" },
  health: { tab: "system", view: "health" },
  pin: { tab: "system", view: "access" },
  telemetry: { tab: "ratings", view: "telemetry" },
  recap: { tab: "content", view: "recap" },
  // All-time search is the admin search's second half now (AdminSearch).
  alltime: { tab: "discord" },
};

// The tab and view an id stands for today, or null for one nobody knows.
export function resolveTab(id) {
  if (!id) return null;
  if (TAB_ALIASES[id]) return TAB_ALIASES[id];
  return KNOWN_TABS.has(id) ? { tab: id } : null;
}

// Tabs that are themselves split into views, so a hit can land on the right
// one instead of on whatever the tab happens to open with.
export const TAB_VIEWS = {
  attendance: {
    signups: "Who can sign up",
    grid: "Grid & waiting list",
    missing: "Still to answer",
    history: "Past sign-ups",
    activity: "Activity",
  },
  // The hotlap videos moved here from Attendance; the search hit said so only
  // by its title, and its view label came back empty.
  photos: {
    photos: "Race photos",
    highlights: "Race highlights",
    hotlaps: "Hotlap videos",
  },
  content: {
    graphic: "Result",
    standings: "Standings",
    post: "Discord post",
    recap: "Race recap",
  },
  ratings: {
    ratings: "Ratings",
    telemetry: "Telemetry",
  },
  site: {
    tracks: "Tracks",
    raceinfo: "Race Info",
    faq: "Home FAQ",
    social: "Social",
    privacy: "Privacy & app",
  },
  system: {
    health: "Health & backups",
    traffic: "Traffic",
    discord: "Discord",
    access: "Admin PIN",
  },
  tokens: {
    orders: "Orders",
    members: "Balances",
    rules: "Rules and prices",
    bot: "Discord bot",
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
  // --- Race weekend: the race recap -----------------------------------------
  {
    tab: "content",
    view: "recap",
    title: "Switch the race recap on or off",
    hint: "Off, admins only (to look at it first), or everyone. Members then see their recap once after each saved round.",
    keywords: "race recap summary after race popup overlay wrapped story switch on off enable disable admins only everyone members see once",
  },
  {
    tab: "content",
    view: "recap",
    title: "Preview a round's recap as any driver",
    hint: "Pick a finished round and a driver and open the pages exactly as that driver would see them.",
    keywords: "recap preview test look try round driver see what members see pages rating points championship",
  },
  // --- League: transfers ------------------------------------------------------
  {
    tab: "transfers",
    title: "Who drove for which team, round by round",
    hint: "The season's line-ups as a grid: every driver, every round, the team they drove for.",
    keywords: "transfers transfer market team history line-up lineup grid round by round who drove for which team season overview",
  },
  {
    tab: "transfers",
    title: "Book a team change for a coming round",
    hint: "Pick the driver, the team and the round it starts from; the move applies itself when that round is saved.",
    keywords: "transfer move team change switch swap future upcoming next round plan book schedule driver leaves joins",
  },
  {
    tab: "transfers",
    title: "Take a planned move back",
    hint: "The moves booked for rounds still ahead, each with a Take back button.",
    keywords: "undo cancel take back planned pending transfer move remove",
  },
  {
    tab: "transfers",
    title: "Export the team history",
    hint: "The grid as a CSV file, one row per driver.",
    keywords: "export csv download spreadsheet excel team history",
  },
  // --- Race weekend ---------------------------------------------------------
  {
    tab: "discord",
    title: "Create a race or event",
    hint: "Put a new round, training session or special event on the calendar.",
    keywords: "add new schedule round fixture date time track laps qualifying training special event",
  },
  {
    tab: "discord",
    title: "Feature + sprint race day",
    hint: "Give an event two races: the feature first and a short sprint after it, each with its own lap count.",
    keywords: "sprint feature two races f2 formula 2 double header race day format laps second race",
  },
  {
    tab: "discord",
    title: "The season's calendar",
    hint: "Rename a round, move its date, set its country flag, or delete it.",
    keywords: "season races edit rename move date time country flag round number delete reorder calendar",
  },
  {
    tab: "system",
    view: "discord",
    title: "Discord webhook for announcements",
    hint: "The channel the site posts a new race and its sign-up list to.",
    keywords: "discord webhook url channel announce post integration bot",
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
    view: "activity",
    title: "Who is still active, and who has stopped racing",
    hint: "Every driver against every round, split into Tier 1, Tier 2 and reserves, with a status per driver.",
    keywords: "activity active inactive tracker participation who is racing dropped out quit gone missing rounds attendance overview per driver season tier 1 tier 2 reserve drivers still racing",
  },
  {
    tab: "attendance",
    view: "activity",
    title: "Mark a driver full time, deserving or still in progress",
    hint: "The Progress label per driver, set by hand next to their season\u2019s numbers.",
    keywords: "progress label full time possibly reserve deserving in progress tentative spreadsheet sheet promote promotion seat earn judgement staff decision reserve pool mark set status",
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
    hint: "Pick the round, pull its session off the race server (or upload the Assetto Corsa file) and match the drivers to the roster.",
    keywords: "import upload json assetto corsa results file match steam guid telemetry round",
  },
  {
    tab: "import",
    title: "Add qualifying to a stored race",
    hint: "Pick a round whose race result is already saved; the qualifying card opens underneath.",
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
    title: "Enter results by hand",
    hint: "A round with no result file to import: add the drivers in finishing order and save.",
    keywords: "manual results by hand type in no json file missing lost import add driver row enter classification discord",
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
    title: "Delete a race or just its results",
    hint: "Wipe a saved classification, or remove the round entirely.",
    keywords: "delete remove wipe race results undo",
  },
  {
    tab: "content",
    view: "graphic",
    title: "The result poster for a round",
    hint: "The picture for Discord, built from the round's own result. Pick a round, download the PNG.",
    keywords: "graphic poster image png share discord post podium top ten social instagram photoshop template",
  },
  {
    tab: "content",
    view: "post",
    title: "Post a result to Discord",
    hint: "The message for the results channel, with the drivers mentioned and the poster attached.",
    keywords: "results post discord webhook announce mention ping publish message content channel",
  },
  {
    tab: "content",
    view: "post",
    title: "Short or full results message",
    hint: "Short is the round, the podium and a link, for when the poster says the rest. Full lists everyone.",
    keywords: "short long full length message version podium link brief summary results post",
  },
  {
    tab: "content",
    view: "post",
    title: "Which poster goes with the post",
    hint: "Black, pink, or no image at all, with a preview of the message as the channel will see it.",
    keywords: "image graphic attach poster black pink white design preview discord post picture none",
  },
  {
    tab: "content",
    view: "post",
    title: "Results channel webhook",
    hint: "Where the results message is posted. Separate from the events webhook.",
    keywords: "webhook results channel discord url connect integration",
  },
  {
    tab: "content",
    title: "Team cars and wide logos",
    // "wordmark" stays in the keywords: it is what a designer calls the long
    // logo, so it is what a designer will type, even though the page has
    // stopped using the word.
    hint: "The cut-out car, the long logo and the tile logo the result poster draws with. Uploaded once per team.",
    keywords: "car cars artwork wide logo wordmark long logo badge tile logo graphic poster cutout render team art",
  },
  {
    tab: "photos",
    view: "photos",
    title: "Photos for a race",
    hint: "The picture gallery under a round's results.",
    keywords: "photos pictures images gallery upload carousel screenshots",
  },
  {
    tab: "photos",
    view: "highlights",
    title: "Highlights video of a round",
    hint: "The Highlights button on a round's results. A YouTube cut plays on the page itself.",
    keywords: "highlights video youtube link clip cut recap watch race page button twitch",
  },
  {
    tab: "photos",
    view: "hotlaps",
    title: "Hotlap videos for a circuit",
    hint: "The YouTube lap shown next to the sign-up. A track without one says the hotlap is coming soon.",
    keywords: "hotlap video youtube onboard lap circuit track guide learn coming soon rickroll attendance",
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
    view: "ratings",
    title: "Rating formula tuning",
    hint: "The weights behind the RTG / EXP / RAC / AWA / PAC numbers on the driver cards.",
    keywords: "ratings rtg exp rac awa aha pac formula weights tuning driver cards numbers",
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
    tab: "reports",
    title: "Incident reports from drivers",
    hint: "Someone hit me on lap 14. Read the thread, decide, and tell the drivers. Grouped by round.",
    keywords: "report reports incident steward stewarding penalty crash contact protest complaint judge replay",
  },
  {
    tab: "members",
    title: "Make somebody a steward",
    hint: "They read and answer every incident report, and get no other admin access.",
    keywords: "steward stewards judge incident reports access role marshal official permission",
  },
  {
    tab: "reports",
    title: "Incident watch",
    hint: "Who keeps crashing: contacts, wall hits, cuts and in-game penalties per race, with the reports that named them.",
    keywords: "incident watch crash crashes contacts collisions walls cuts penalties dirty driver safety overview",
  },
  {
    tab: "reports",
    title: "Let somebody else read one report",
    hint: "A witness or a team mate, picked by name, for that thread only. They get told.",
    keywords: "viewer witness access permission let in share report private team mate",
  },
  {
    tab: "reports",
    title: "Reports from inside the race (webPenalty)",
    hint: "Switch on the in-game button and get the URL to paste into the app.",
    keywords: "webpenalty ingame in-game app key url ingest live report button assetto plugin",
  },
  {
    tab: "edit",
    title: "Check the stewards' penalties are entered",
    hint: "Under the results table: every penalty decided in Reports, and whether the seconds are actually in the classification.",
    keywords: "penalty penalties steward decided check entered missing seconds report classification verify",
  },
  {
    tab: "feedback",
    title: "Bug reports and ideas",
    hint: "What members sent through the feedback button, and replying to them.",
    keywords: "feedback bug report idea suggestion reply thread message inbox",
  },
  {
    tab: "tokens",
    title: "Switch NABS Points on or off",
    hint: "The whole reward currency is a trial. This is the switch that shows or hides it for every member.",
    keywords: "nabs points tokens reward currency trial enable disable switch on off shop referral invite",
  },
  {
    tab: "tokens",
    title: "Fill a shop order",
    hint: "Somebody redeemed a helmet, a car skin or a role. Mark it filled, or decline it and give the points back.",
    keywords: "tokens shop order redeem helmet skin livery role prize reward refund decline fill",
  },
  {
    tab: "tokens",
    title: "Give somebody points by hand",
    hint: "An award for something no rule measures, or a correction.",
    keywords: "tokens give award grant adjust correct balance points manual",
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
    tab: "site",
    view: "social",
    title: "League social links",
    hint: "The Discord invite, YouTube, Twitch and the rest, shown site-wide.",
    keywords: "social links discord invite youtube twitch instagram tiktok patreon footer",
  },
  {
    tab: "site",
    view: "social",
    title: "Social wall on the home page",
    hint: "The posts shown on the front page. YouTube fills itself; the others are added by hand.",
    keywords: "social wall feed posts home page instagram tiktok youtube videos",
  },
  {
    tab: "live",
    title: "Live page buttons and stream",
    hint: "The stream embedded on the live page, plus the Content Manager join and full-timing buttons.",
    keywords: "live timing stream youtube twitch embed buttons content manager join link",
  },
  {
    tab: "live",
    title: "Which race server a series follows",
    hint: "The server the live timing page reads for each series.",
    keywords: "live server race server acserver series which server timing",
  },
  {
    tab: "live",
    title: "Training best times on the live board",
    hint: "Carry the week's fastest practice laps onto the Live page from the server manager's session JSON files, sectors included — the race server wipes them on every session restart.",
    keywords:
      "training practice best times laps import upload json session file result files sectors live board session best carry over restart wiped hotlap week",
  },

  // --- Site content ---------------------------------------------------------
  {
    tab: "site",
    view: "tracks",
    title: "Track facts and map image",
    hint: "The per-circuit fun facts and the track map picture, including its rotation.",
    keywords: "track info facts map image picture rotation circuit layout",
  },
  {
    tab: "site",
    view: "raceinfo",
    title: "Race Info page text",
    hint: "The rules cards, the sporting regulations and the footnotes on the Race Info page.",
    keywords: "race info rules regulations sporting page intro championship cards points footnote text",
  },
  {
    tab: "site",
    view: "faq",
    title: "Home page FAQ",
    hint: "The questions and answers newcomers see on the front page.",
    keywords: "faq questions answers welcome home newcomer help",
  },
  {
    tab: "site",
    view: "privacy",
    title: "Privacy contact",
    hint: "Who is legally responsible for the site, and the email privacy requests go to.",
    keywords:
      "privacy policy data protection gdpr dsgvo datenschutz contact responsible controller imprint legal email address who is responsible",
  },
  {
    tab: "site",
    view: "privacy",
    title: "App name in the privacy policy",
    hint: "Google Play requires the policy to name the app. Set the store name here.",
    keywords: "app name google play store android privacy policy listing publish twa",
  },
  {
    tab: "site",
    view: "privacy",
    title: "Link the Android app to this domain",
    hint: "Package name and signing fingerprints, which produce the assetlinks.json the app is verified against.",
    keywords:
      "assetlinks digital asset links package name fingerprint sha256 signing key twa trusted web activity address bar url bar verification play console app integrity android",
  },

  // --- System ---------------------------------------------------------------
  {
    tab: "system",
    view: "traffic",
    title: "Visitor numbers",
    hint: "Who is visiting, the last 14 days, and the most visited pages.",
    keywords: "traffic visitors analytics stats page views popular",
  },
  {
    tab: "system",
    view: "health",
    title: "Data check",
    hint: "Warnings about the league data: missing results, odd points, drivers without a team.",
    keywords: "health data check integrity problems warnings errors validation",
  },
  {
    tab: "system",
    view: "health",
    // Was the red banner across the top of every tab until 2026-08-12; it is a
    // card in Health now, which means it has to be findable.
    title: "Default PIN and JWT secret",
    hint: "Whether the admin PIN and JWT_SECRET are still the ones the project shipped with.",
    keywords: "security secure default pin jwt secret warning red banner launch checklist before going public",
  },
  {
    tab: "system",
    view: "health",
    title: "Backups",
    hint: "Automatic database backups and the full download as a zip.",
    keywords: "backup backups database download zip restore save copy",
  },
  {
    tab: "system",
    view: "health",
    title: "Disk, memory and the admin log",
    hint: "Server disk usage, memory, unused uploaded files and a log of recent admin changes.",
    keywords: "disk space storage memory heap server activity log recent changes unused files clean up",
  },
  {
    tab: "system",
    view: "discord",
    title: "Everything connected to Discord",
    hint: "The events webhook, the results webhook and the bot, with whether each is connected.",
    keywords: "discord connections integration webhook bot channel connected not arriving nothing posted setup overview",
  },
  {
    tab: "ratings",
    view: "telemetry",
    title: "Lap comparison and who may see it",
    hint: "Compare two drivers' laps input by input, and decide whether members get to see the telemetry.",
    keywords: "telemetry laps compare inputs throttle brake steering trace visible public members who can see",
  },
  {
    tab: "system",
    view: "access",
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
