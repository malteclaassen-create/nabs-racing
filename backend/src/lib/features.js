// Site-wide switches for parts that are built but not on show.
//
// TRACK_EDITOR_ENABLED: the browser track editor (track-editor/). OFF takes
// it off the site: /track-editor answers with the site's not-found page, the
// sitemap stops listing it, no member is told about it and the announcements
// already sent are withdrawn from the bell. The code and its build stay, so
// flipping this back on brings it straight back.
export const TRACK_EDITOR_ENABLED = false;
