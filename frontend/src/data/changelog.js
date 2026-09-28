// ---------------------------------------------------------------------------
// What changed on the site, newest first — the list /changelog shows.
//
// Written for the drivers, not for the code: what you will notice, in a
// sentence, not how it was built. One entry per day something shipped, with
// the changes of that day as its items. A new day goes on TOP.
//
// `tag` sorts an item into one of the small coloured labels on the page:
//   "new"      something that was not there before
//   "better"   something that was there, and now works or reads better
//   "fixed"    something that was wrong
//
// The newest entry's `date` is also what the "New" mark in Settings compares
// against, so adding an entry here is all it takes to light it up for everyone
// who has not opened the page since.
// ---------------------------------------------------------------------------

export const CHANGELOG = [
  {
    date: "2026-09-28",
    title: "Designs and changelog",
    items: [
      { tag: "new", text: "You can now pick a design in the settings: Classic, Carbon, Midnight, Ocean or Paddock. Works in light and dark mode." },
      { tag: "new", text: "Changelog page, so you can see what changed on the site." },
      { tag: "better", text: "Training points now show under the lap count (e.g. +10 under 20/50)." },
    ],
  },
  {
    date: "2026-09-27",
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
    title: "Hotlap videos",
    items: [
      { tag: "new", text: "Hotlap video for the track in live timing, next to the map." },
      { tag: "better", text: "Finishing spread tabs only show up when there are enough races." },
    ],
  },
  {
    date: "2026-09-23",
    title: "Track strengths and stewarding",
    items: [
      { tag: "new", text: "Track strengths on driver profiles and driving tips in the lap comparison." },
      { tag: "better", text: "Licence points removed. Incident watch is now in the Reports tab." },
      { tag: "better", text: "Career page and telemetry work better on phones." },
    ],
  },
];

// The newest entry's date, which is what "have you seen it" compares against.
export const CHANGELOG_LATEST = CHANGELOG[0]?.date || "";
