// ---------------------------------------------------------------------------
// The site's history up to the day the changelog went up, newest first.
//
// This file is FINISHED. Updates after it come in by themselves: a merged pull
// request whose description has a "## Changelog" section becomes an entry on
// /changelog, and the site's number is read off GitHub (see
// backend/src/lib/changelogFeed.js and .github/pull_request_template.md).
// Only touch this file to correct what is already in it.
//
// Written for the drivers, not for the code. `tag` is one of:
//   "new"      something that was not there before
//   "better"   something that was there, and now works or reads better
//   "fixed"    something that was wrong
//
// `from` is optional: an entry covering several days has the first day in
// `from` and the last in `date`. `commits` is how many commits main had by the
// end of the entry (git rev-list --count main), shown as the entry's number.
// ---------------------------------------------------------------------------

export const CHANGELOG = [
  {
    date: "2026-09-28",
    commits: 698,
    title: "Designs and changelog",
    items: [
      { tag: "new", text: "You can now pick a design in the settings: Classic, Carbon, Midnight, Ocean or Paddock. Works in light and dark mode." },
      { tag: "new", text: "Changelog page, so you can see what changed on the site." },
      { tag: "better", text: "Training points now show under the lap count (e.g. +10 under 20/50)." },
    ],
  },
  {
    date: "2026-09-27",
    commits: 697,
    title: "Briefing",
    items: [
      { tag: "new", text: "Tokens page shows the multiplier for Sunday's race. It gets locked at the Friday briefing." },
      { tag: "new", text: "Admins can see who signed up for the race but isn't in the briefing channel yet." },
      { tag: "better", text: "DM links from the briefing open straight in the Discord app." },
      { tag: "fixed", text: "The selected series no longer resets when you reload your profile." },
    ],
  },
  {
    date: "2026-09-26",
    commits: 691,
    title: "Tokens and race recap",
    items: [
      { tag: "new", text: "Token counter in the nav bar animates when you get new tokens." },
      { tag: "new", text: "Race recap shows your championship position moving up or down." },
      { tag: "new", text: "Links shared on Discord or WhatsApp now show a proper preview image." },
      { tag: "better", text: "Each series can have its own token rewards for racing and training." },
      { tag: "better", text: "My reports are grouped by round." },
      { tag: "fixed", text: "Training laps are no longer lost when the site restarts." },
      { tag: "better", text: "The training popup closes for good when you press Ok, or by itself after 9 seconds." },
    ],
  },
  {
    date: "2026-09-25",
    commits: 685,
    title: "NABS Tokens",
    items: [
      { tag: "new", text: "NABS Points are now called NABS Tokens." },
      { tag: "better", text: "Training week and activity multiplier now reset at the briefing." },
      { tag: "better", text: "Training laps only count on the track of the next race." },
      { tag: "better", text: "Invites only count if the new driver enters your name when signing in." },
      { tag: "better", text: "Lap chart order now matches the official result." },
      { tag: "fixed", text: "Live timing reconnects by itself if it stops updating." },
    ],
  },
  {
    date: "2026-09-24",
    commits: 657,
    title: "Hotlap videos",
    items: [
      { tag: "new", text: "Hotlap video for the track in live timing, next to the map." },
      { tag: "better", text: "Finishing spread tabs only show up when there are enough races." },
    ],
  },
  {
    date: "2026-09-23",
    commits: 655,
    title: "Track strengths and stewarding",
    items: [
      { tag: "new", text: "Track strengths on driver profiles and driving tips in the lap comparison." },
      { tag: "new", text: "Telemetry got a redesign." },
      { tag: "better", text: "Licence points removed. Incident watch is now in the Reports tab." },
      { tag: "better", text: "Career page and telemetry work better on phones." },
    ],
  },
  {
    from: "2026-09-21",
    date: "2026-09-22",
    commits: 646,
    title: "Career page and phone fixes",
    items: [
      { tag: "new", text: "Everyone has a career page now with everything they ever raced, across both leagues." },
      { tag: "new", text: "Search also finds pages, not just drivers and teams." },
      { tag: "better", text: "Tapping your own name in the nav bar opens your own area." },
      { tag: "better", text: "Switching series keeps you on the page you were on." },
      { tag: "better", text: "Lots of phone fixes. Standings show three rounds at once and driver cards scroll smoothly." },
      { tag: "better", text: "The Sunday league is F3 again." },
      { tag: "fixed", text: "Your picture is the same everywhere now, not a different one per season." },
    ],
  },
  {
    date: "2026-09-20",
    commits: 606,
    title: "Race recap and training laps",
    items: [
      { tag: "new", text: "After a race you get a recap of your round the next time you open the site: result, pace, tyres, incidents." },
      { tag: "new", text: "Training laps on the practice servers pay points now. You can see your week on the live page." },
      { tag: "new", text: "When the grid is full, Accept puts you on a waiting list." },
      { tag: "new", text: "Profile studio has nine more effects, your own name style and your own background." },
      { tag: "better", text: "Sprint weekends are imported as one round: feature race first, then the sprint." },
    ],
  },
  {
    date: "2026-09-19",
    commits: 563,
    title: "NABS Points",
    items: [
      { tag: "new", text: "NABS Points (now Tokens): earn them for racing, training and Discord activity, and spend them in the shop." },
      { tag: "new", text: "Shop with card designs, flairs, car skins and a profile studio." },
      { tag: "new", text: "Leaderboard and a saving goal." },
      { tag: "better", text: "Buying something asks you to confirm first." },
    ],
  },
  {
    date: "2026-09-18",
    commits: 520,
    title: "Transfers and activity tracker",
    items: [
      { tag: "new", text: "Transfer centre: every team change and substitute, round by round." },
      { tag: "new", text: "Admins get an activity tracker for who is still showing up. It replaces the reserve spreadsheet." },
      { tag: "better", text: "Admins can merge two rows of the same driver." },
      { tag: "fixed", text: "A race whose server goes quiet is shown as over, not live." },
      { tag: "better", text: "Track editor is off the site for now." },
    ],
  },
  {
    from: "2026-09-15",
    date: "2026-09-17",
    commits: 486,
    title: "Sprint weekends",
    items: [
      { tag: "new", text: "Sprint races count everywhere: standings, profile, Hall of Fame, rating and season form." },
      { tag: "new", text: "Pole from qualifying and points for fastest lap." },
      { tag: "new", text: "Content Check page: tells you which file is behind a \"Checksum failed\" kick." },
      { tag: "new", text: "The live board can show the whole week's training times." },
      { tag: "better", text: "Buttons and the phone status bar use the series colour." },
      { tag: "better", text: "Your profile address uses your name now." },
    ],
  },
  {
    from: "2026-09-12",
    date: "2026-09-14",
    commits: 458,
    title: "Series settings",
    items: [
      { tag: "better", text: "Every series has its own live page, telemetry recorder and laps." },
      { tag: "better", text: "Driver profiles show the classified position after time penalties." },
      { tag: "better", text: "Admins can set up a new season's roster faster, also from another series." },
    ],
  },
  {
    from: "2026-09-07",
    date: "2026-09-08",
    commits: 446,
    title: "Lap comparison",
    items: [
      { tag: "new", text: "The lap comparison was rebuilt: track map with the real tarmac, racing lines, g-meter and steering wheel." },
      { tag: "better", text: "Playback continues from where you clicked instead of the start line." },
      { tag: "fixed", text: "Pit visits before and after the race don't mess up the tyre strategy any more." },
    ],
  },
  {
    from: "2026-09-04",
    date: "2026-09-05",
    commits: 429,
    title: "Live timing",
    items: [
      { tag: "new", text: "Live timing has a satellite map and a smaller session header." },
      { tag: "better", text: "Driving now on a phone shows every number, stacked." },
      { tag: "fixed", text: "The live map comes back by itself if it fails to load." },
      { tag: "fixed", text: "After the flag the order is by who crossed the line first." },
    ],
  },
  {
    from: "2026-08-30",
    date: "2026-09-03",
    commits: 417,
    title: "Track editor",
    items: [
      { tag: "new", text: "Track editor on the site: roads, pit lanes, garages, run off, catch fences, mountains around the map." },
      { tag: "better", text: "Open to every member from 3 September." },
      { tag: "better", text: "Hall of Fame counts every point ever scored, drops included." },
    ],
  },
  {
    from: "2026-08-25",
    date: "2026-08-29",
    commits: 354,
    title: "Two servers and a privacy page",
    items: [
      { tag: "new", text: "The live page can show either race server." },
      { tag: "new", text: "Full screen timing board." },
      { tag: "new", text: "Events can run a sprint and a feature race." },
      { tag: "new", text: "Privacy page, and you can delete your account yourself." },
      { tag: "new", text: "Subscribe to the race calendar, and home screen shortcuts on your phone." },
      { tag: "new", text: "A page that has been open since the last update tells you so." },
      { tag: "better", text: "Sectors on the live board build up while the lap is running." },
      { tag: "better", text: "The site opens without a connection instead of looking broken." },
    ],
  },
  {
    from: "2026-08-19",
    date: "2026-08-24",
    commits: 329,
    title: "Stewarding",
    items: [
      { tag: "new", text: "Install guide for putting the site on your phone." },
      { tag: "better", text: "Penalties from reports show up in the classification." },
      { tag: "better", text: "A crash with two penalties can be decided on one screen." },
      { tag: "better", text: "Result poster can be as long as you want and continues on a second page." },
      { tag: "better", text: "Fastest lap is purple on the live page, like on TV." },
      { tag: "fixed", text: "A clean record doesn't rate you last any more." },
    ],
  },
  {
    from: "2026-08-14",
    date: "2026-08-16",
    commits: 291,
    title: "Telemetry and in-game reports",
    items: [
      { tag: "new", text: "Telemetry: a recorder in the car, track map and notes per corner. Three laps per season, played back on the real track." },
      { tag: "new", text: "In-game reports get the replay time and are matched to the contact in the result file." },
      { tag: "new", text: "Lap by lap view of a round, and calendar cards show the country." },
      { tag: "better", text: "Entry list shows team logos and seat swaps." },
      { tag: "fixed", text: "Lap chart works with a full grid on a phone." },
    ],
  },
  {
    from: "2026-08-12",
    date: "2026-08-13",
    commits: 251,
    title: "Reports and free seats",
    items: [
      { tag: "new", text: "Race highlights and all videos of a race night in one tab." },
      { tag: "new", text: "The next round gets its own card on the home page." },
      { tag: "new", text: "Reserve drivers see free seats right away." },
      { tag: "new", text: "Driver cards are set for the whole season, like in FIFA." },
      { tag: "better", text: "A report can point at the exact contact and the time in the replay." },
      { tag: "better", text: "The report form asks three questions instead of showing eleven fields." },
      { tag: "better", text: "The live board shows flags and recognises drivers whose in-game name changed." },
    ],
  },
  {
    from: "2026-08-10",
    date: "2026-08-11",
    commits: 227,
    title: "Incident reports and result poster",
    items: [
      { tag: "new", text: "Incident reports: file one after a race and talk to the stewards in the thread, pictures included." },
      { tag: "new", text: "My reports page for your own reports." },
      { tag: "new", text: "Result poster made from the round, with two designs." },
      { tag: "new", text: "Admin search." },
      { tag: "better", text: "Tier 2 drivers get a T2 label." },
    ],
  },
  {
    from: "2026-08-08",
    date: "2026-08-09",
    commits: 179,
    title: "Polish week",
    items: [
      { tag: "new", text: "A tour for first time visitors." },
      { tag: "new", text: "Podium seals turned into trophies." },
      { tag: "new", text: "Live stream on the live page." },
      { tag: "better", text: "Standings show what changed in the last round." },
      { tag: "better", text: "Pit stops are detected properly now." },
      { tag: "better", text: "Offering your seat counts as your sign up answer, and you can take it back." },
      { tag: "better", text: "Loads of small fixes to animations, menus and the round picker." },
    ],
  },
  {
    from: "2026-08-01",
    date: "2026-08-05",
    commits: 142,
    title: "Race photos",
    items: [
      { tag: "new", text: "A photo gallery for every race night, and you can download the photos." },
      { tag: "new", text: "The bell tells you when a gallery is up." },
      { tag: "better", text: "Old seasons are filled in with data the result files never had." },
      { tag: "better", text: "Admins can take rounds off the sign up page." },
    ],
  },
  {
    from: "2026-07-27",
    date: "2026-07-30",
    commits: 127,
    title: "Feedback and the social wall",
    items: [
      { tag: "new", text: "Feedback button on every page to report a bug or an idea. Admins can answer and you can reply." },
      { tag: "new", text: "A wall with posts from the league's channels." },
      { tag: "new", text: "Sort the live timing board yourself." },
      { tag: "better", text: "Sign up page shows the track." },
      { tag: "fixed", text: "Spielberg and Poznan have their track outline, and everyone has their flag back." },
    ],
  },
  {
    from: "2026-07-25",
    date: "2026-07-26",
    commits: 121,
    title: "Faster and safer",
    items: [
      { tag: "new", text: "Link your Steam account." },
      { tag: "new", text: "Every race and every old season has its own address." },
      { tag: "better", text: "Home page leads with the last race." },
      { tag: "better", text: "Security and speed fixes all over the site." },
      { tag: "better", text: "Text is easier to read in both light and dark mode." },
    ],
  },
  {
    from: "2026-07-21",
    date: "2026-07-22",
    commits: 112,
    title: "My Rating",
    items: [
      { tag: "new", text: "My Rating: see how your driver rating is calculated, with a short tour." },
    ],
  },
  {
    from: "2026-07-17",
    date: "2026-07-20",
    commits: 110,
    title: "Members area",
    items: [
      { tag: "new", text: "Achievements in your profile, over 34 of them, some hidden." },
      { tag: "new", text: "Qualifying results are imported and shown." },
      { tag: "new", text: "Race winners on the calendar cards." },
      { tag: "better", text: "Live page goes quiet when nobody is driving." },
      { tag: "better", text: "Big mobile pass across the whole site." },
    ],
  },
  {
    from: "2026-07-14",
    date: "2026-07-16",
    commits: 98,
    title: "More than one league",
    items: [
      { tag: "new", text: "The site handles several racing series, each with its own colour and logo." },
      { tag: "new", text: "Notification bell for results, race day reminders and new downloads." },
      { tag: "new", text: "Driver rating cards with editions you can unlock." },
      { tag: "new", text: "Hall of Fame with all time records and champions." },
    ],
  },
  {
    from: "2026-07-10",
    date: "2026-07-13",
    commits: 77,
    title: "Live page and the new car",
    items: [
      { tag: "new", text: "Live page with a track map and F1 TV style tyre strategy." },
      { tag: "new", text: "Season 8 car reveal as a 3D model you can turn." },
      { tag: "new", text: "Replays for every race in the downloads." },
      { tag: "new", text: "Head to head points bar and a trophy shelf on driver pages." },
      { tag: "better", text: "You get logged out automatically when your session runs out." },
    ],
  },
  {
    from: "2026-07-05",
    date: "2026-07-09",
    commits: 48,
    title: "Telemetry and attendance",
    items: [
      { tag: "new", text: "Track outlines for every F1 circuit." },
      { tag: "new", text: "Season archive with old seasons." },
      { tag: "new", text: "Attendance page with consistency percentage." },
      { tag: "new", text: "First version of AC telemetry." },
      { tag: "better", text: "Race Info can be edited by admins." },
    ],
  },
  {
    from: "2026-06-29",
    date: "2026-07-02",
    commits: 34,
    title: "Discord login",
    items: [
      { tag: "new", text: "Log in with Discord and get your own profile." },
      { tag: "new", text: "Sign up for races on the site." },
      { tag: "new", text: "Driver ratings, based on results and contacts in AC." },
      { tag: "new", text: "Downloads page for AC files." },
      { tag: "new", text: "Social links on your profile." },
    ],
  },
  {
    from: "2026-06-23",
    date: "2026-06-28",
    commits: 26,
    title: "Seasons and teams",
    items: [
      { tag: "new", text: "More than one season on the site, with a season switcher." },
      { tag: "new", text: "Team logos everywhere and a countdown to the next race." },
      { tag: "new", text: "Driver market and time penalties." },
      { tag: "new", text: "Light and dark mode." },
    ],
  },
  {
    from: "2026-06-18",
    date: "2026-06-20",
    commits: 13,
    title: "The site goes up",
    items: [
      { tag: "new", text: "First version of the NABS Racing League site: standings, constructors, races and results for Season 7." },
      { tag: "new", text: "Race calendar with circuit maps." },
      { tag: "better", text: "Results show podium, grid and fastest lap." },
      { tag: "better", text: "Burger menu on phones." },
    ],
  },
];
