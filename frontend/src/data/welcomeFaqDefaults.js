// Built-in FAQ for the Welcome (newcomer) page. Used to pre-fill the admin
// editor and as the "reset to standard text" content. The Welcome page still
// renders its own season-aware default questions when nothing is saved; these
// defaults are the editable starting point once an admin opens the editor.
//
// Placeholders resolved live from the season: {platform} {era} {rounds}
// {counted} {drop} {seasons} {pointsFirst} {pointsLast}. **words** = bold.
export const WELCOME_FAQ_DEFAULTS = [
  {
    q: "Do I need to be fast to join?",
    a: "Not at all. The grid is split by pace, and the reserve system exists too, so newer drivers can find their feet against similar competition. Clean, consistent racing matters far more than raw speed.",
  },
  {
    q: "What do I need to race?",
    a: "A PC copy of the season's game ({platform} right now), the current car mod, and a stable connection. A wheel helps but isn't required. Everything else (mods, server details, setup help) is in the Discord and on the Race Info page.",
  },
  {
    q: "How often do you race?",
    a: "Roughly one round a week through the season, plus the occasional special event like an endurance night. You sign up for each round, so you're never locked in.",
  },
  {
    q: "What if I can't make a race?",
    a: "Just mark yourself Declined for that round, no penalty. Teams can call on a reserve to fill the seat, which is often how new drivers get their first start.",
  },
  {
    // Kept to tokens that always resolve ({pointsFirst}/{pointsLast} fall back to
    // the league default table): a brand-new season with no rounds scheduled yet
    // would leave {rounds}/{counted} empty, and an unresolved token renders as a
    // literal "{rounds}", so the drop-count detail is described in words instead.
    q: "How do the standings work?",
    a: "You score points for your finishing position every round (P1 is {pointsFirst} down to {pointsLast} for the last points-paying place). Only your best results count toward the championship, with your weakest rounds dropped, so a single rough night never sinks your season. It's all calculated automatically and shown live on this site.",
  },
];
