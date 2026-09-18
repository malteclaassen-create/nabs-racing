// Site-wide switches for parts that are built but not on show.
//
// TRACK_EDITOR_ENABLED: the browser track editor (track-editor/). OFF takes
// it off the site: /track-editor answers with the site's not-found page, the
// sitemap stops listing it, no member is told about it and the announcements
// already sent are withdrawn from the bell. The source stays in track-editor/
// but it is no longer part of the root build or CI (its build had become a
// point of failure for every deploy); to bring it back, flip this on and put
// `npm --prefix track-editor install && npm --prefix track-editor run build`
// back into the root package.json build script.
export const TRACK_EDITOR_ENABLED = false;
