// ---------------------------------------------------------------------------
// The profile page's own navigation, as data.
//
// It used to be nine entries in one sliding tab bar. On a phone that meant a
// sideways scroll showing four of them with nothing to say the rest were there
// — and the bar told the same lie to everyone, because those nine entries did
// three different things behind one identical pill: some swap the panel in
// place, Feedback opens a panel, and My reports and Admin leave the page
// altogether.
//
// So the list is grouped and every entry says what KIND of thing it is. The
// sections are the page; everything else is elsewhere, and says so. ProfileNav
// renders it as a column on desktop and a sheet on phones — this file stays
// free of React so the shape itself can be tested.
// ---------------------------------------------------------------------------

// `kind` drives the renderer: "section" swaps the panel and owns ?tab=,
// "panel" opens an overlay, "page" is a real navigation and is drawn as a link
// (middle-click, open-in-new-tab, and the right announcement).
export function profileNav({ isAdmin = false, tokens = null, reportsOpen = false, cockpitTabs = [] } = {}) {
  return {
    sections: [
      { kind: "section", key: "profile", label: "Edit Profile", icon: "profile" },
      // Achievements (and whatever else the cockpit lends the page later).
      ...cockpitTabs.map((t) => ({ kind: "section", key: t.key, label: t.label, icon: t.key, dataTour: t.dataTour })),
      { kind: "section", key: "rating", label: "My Rating", icon: "rating", dataTour: "tab-rating" },
      // Everything you have ever raced, both leagues in one place. A panel
      // here rather than a page away: it belongs with the other things that
      // are about you.
      { kind: "section", key: "career", label: "Career", icon: "career" },
      // Only while the token trial is switched on. The hook answers null when
      // it is off, which is the same answer it gives the nav bar, so the row
      // and the count up there appear and disappear together.
      ...(tokens === null ? [] : [{ kind: "section", key: "tokens", label: "NABS Points", icon: "tokens", count: tokens }]),
      // The key stays "tools": ?tab=tools is in bell links and bookmarks.
      { kind: "section", key: "tools", label: "Telemetry", icon: "tools" },
      // Theme, performance, where your own name in the bar leads, and the way
      // out of the account. A panel like the ones above it rather than a
      // drawer over them or a page away from them: everything about you is in
      // this one place, and the settings are about you too. /settings still
      // exists for a visitor, who has no personal area to hold a panel — it
      // sends a signed-in member here. Last, because it is the entry you open
      // once and the ones above are the ones you come back to.
      { kind: "section", key: "settings", label: "Settings", icon: "settings" },
    ],
    elsewhere: [
      // Feedback used to be a floating button in the bottom right corner. That
      // corner is the Report widget's now, and this is where the things you do
      // ABOUT the site rather than in it belong anyway.
      { kind: "panel", key: "feedback", label: "Feedback", icon: "feedback" },
      // Stewarding threads. A page rather than a panel, because it is where a
      // notification lands and a notification has to have somewhere to land.
      ...(reportsOpen ? [{ kind: "page", key: "reports", label: "My reports", icon: "reports", to: "/reports" }] : []),
      ...(isAdmin ? [{ kind: "page", key: "admin", label: "Admin", icon: "admin", to: "/admin" }] : []),
    ],
  };
}

// Every key a ?tab= may legitimately carry, gating aside.
//
// Deliberately NOT read off a gated nav: the token balance is null for the
// first moment of every page load, and validating against that would make
// ?tab=tokens invalid just long enough to flash the editor before the balance
// lands and the real panel takes over.
export function sectionKeys(cockpitTabs = []) {
  return profileNav({ tokens: 0, cockpitTabs }).sections.map((s) => s.key);
}
