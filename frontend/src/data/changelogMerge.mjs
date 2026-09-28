// ---------------------------------------------------------------------------
// The two halves of the changelog put together: the hand-written history in
// data/changelog.js, and the entries of merged pull requests that
// /api/changelog reads off GitHub (backend/src/lib/changelogFeed.js).
//
// A pull request only counts when it came after the file's newest entry, so
// the file and GitHub never show the same update twice. "After" is the commit
// number where GitHub knows it, and the date where it does not.
// ---------------------------------------------------------------------------

export function mergeChangelog(staticList, feed) {
  const list = Array.isArray(staticList) ? staticList : [];
  const newestStatic = list[0] || null;
  const staticCommits = newestStatic?.commits || 0;
  const staticDate = newestStatic?.date || "";

  const fresh = (Array.isArray(feed?.entries) ? feed.entries : []).filter((e) => {
    if (!e?.date || !Array.isArray(e.items) || !e.items.length) return false;
    return e.commits ? e.commits > staticCommits : e.date > staticDate;
  });

  const entries = [...fresh, ...list];
  const commits = Math.max(Number(feed?.commits) || 0, staticCommits);
  const latest = entries.reduce((max, e) => (e.date > max ? e.date : max), "");
  return { entries, commits, latest };
}
