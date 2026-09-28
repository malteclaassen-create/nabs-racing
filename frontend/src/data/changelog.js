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
    title: "Designs and a changelog",
    items: [
      { tag: "new", text: "Settings → Design: pick the colours the site is drawn in. Classic, Carbon, Midnight, Ocean or Paddock, each in Light and Dark." },
      { tag: "new", text: "This page. Everything that changes on the site gets a line here." },
      { tag: "better", text: "NABS Tokens → Training: what a server's week has paid now sits right under its lap count instead of up by the server's name." },
    ],
  },
  {
    date: "2026-09-27",
    title: "Race-night briefing",
    items: [
      { tag: "new", text: "NABS Tokens: see the multiplier a Sunday race will pay, locked in at Friday's briefing." },
      { tag: "new", text: "Admins see who has signed up for the race but is not in the briefing channel, with a Start now / Stop button and a list that follows joins within a few seconds." },
      { tag: "better", text: "A DM link from the briefing opens the Discord app straight on your profile, with the web link beside it." },
      { tag: "fixed", text: "The series you picked survives a reload on pages that do not carry it in the address, like your profile." },
    ],
  },
  {
    date: "2026-09-26",
    title: "Tokens in the nav bar and the race recap",
    items: [
      { tag: "new", text: "The token count in the nav bar comes alive while tokens come in after the race recap." },
      { tag: "new", text: "Race recap: championship and constructors places roll from the old one to the new one." },
      { tag: "new", text: "Link previews: every page shares its own picture and text on Discord and WhatsApp." },
      { tag: "better", text: "Each series can pay racing and training its own amounts, and the prices fit on a phone." },
      { tag: "better", text: "My reports are grouped by round, and each round folds open and shut." },
      { tag: "fixed", text: "Training laps carry on from the last count when the site restarts, instead of losing the laps in between." },
      { tag: "better", text: "The training cue closes for good on Ok, and goes by itself after 9 seconds." },
    ],
  },
  {
    date: "2026-09-25",
    title: "NABS Tokens",
    items: [
      { tag: "new", text: "NABS Points are called NABS Tokens now." },
      { tag: "better", text: "The training week and the activity multiplier run from briefing to briefing." },
      { tag: "better", text: "Training laps only count on the next round's circuit." },
      { tag: "better", text: "Invites are by name at sign-in only, and the ways to game one are closed." },
      { tag: "better", text: "Lap chart: ranked by the order cars cross the line, ending on the classification." },
      { tag: "fixed", text: "Live timing reconnects by itself when the upstream connection goes quiet while drivers are on the server." },
    ],
  },
  {
    date: "2026-09-24",
    title: "Hotlap videos",
    items: [
      { tag: "new", text: "Live timing: the circuit's hotlap video, as a tab in the map card." },
      { tag: "better", text: "Finishing-spread tabs only show for leagues with enough races to say something." },
    ],
  },
  {
    date: "2026-09-23",
    title: "Track strengths and stewarding",
    items: [
      { tag: "new", text: "Track strengths on the driver profile, and driving tips in the lap comparison." },
      { tag: "better", text: "Stewarding: licence points are gone, and Incident watch lives on the Reports tab." },
      { tag: "better", text: "The career page is polished for the phone, and the telemetry toolbar fits one row there." },
    ],
  },
];

// The newest entry's date, which is what "have you seen it" compares against.
export const CHANGELOG_LATEST = CHANGELOG[0]?.date || "";
