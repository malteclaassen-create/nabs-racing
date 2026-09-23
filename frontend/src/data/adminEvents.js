// The window events the admin tabs fire when something the navigation counts
// has changed (a feedback answered, a member linked, a report decided). They
// live here rather than in the tabs that fire them so the navigation and the
// attention hook can listen without importing whole tabs: each tab is its own
// chunk, loaded when it is opened (pages/Admin.jsx), and a constant imported
// from one would pull the tab into the page's first download.
export const FEEDBACK_CHANGED_EVENT = "nabs-feedback-changed";
export const MEMBERS_CHANGED_EVENT = "nabs:members-changed";
export const REPORTS_CHANGED_EVENT = "nabs-reports-changed";
