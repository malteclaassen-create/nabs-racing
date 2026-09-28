import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { CHANGELOG } from "../data/changelog.js";
import { mergeChangelog } from "../data/changelogMerge.mjs";

// ---------------------------------------------------------------------------
// The changelog as the site shows it (the file plus merged pull requests from
// /api/changelog), and whether this browser has opened /changelog since its
// newest entry went up.
//
// The feed is asked for once per page load and shared by everything that
// reads it, so the settings panel and the page do not each go and fetch it.
// Until it answers (or when it cannot) the file alone is the changelog.
//
// "Seen" is kept in this browser like the other settings: it only drives a
// small "New" mark, and a phone and a laptop each deserve to be told once.
// ---------------------------------------------------------------------------

const KEY = "nabs_changelog_seen";

let merged = mergeChangelog(CHANGELOG, null);
let request = null;
const feedListeners = new Set();

function loadFeed() {
  if (!request) {
    request = api
      .changelog()
      .then((feed) => {
        merged = mergeChangelog(CHANGELOG, feed);
        feedListeners.forEach((notify) => notify(merged));
      })
      .catch(() => {
        // The file is the changelog, then.
      });
  }
  return request;
}

export function useChangelog() {
  const [value, setValue] = useState(merged);
  useEffect(() => {
    setValue(merged);
    feedListeners.add(setValue);
    loadFeed();
    return () => feedListeners.delete(setValue);
  }, []);
  return value;
}

function read() {
  try {
    return localStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
}

let seen = read();
const seenListeners = new Set();

export function markChangelogSeen(latest) {
  if (!latest || seen >= latest) return;
  seen = latest;
  try {
    localStorage.setItem(KEY, seen);
  } catch {
    // Private mode: the mark just comes back next visit.
  }
  seenListeners.forEach((notify) => notify(seen));
}

export function useChangelogUnseen() {
  const { latest } = useChangelog();
  const [value, setValue] = useState(seen);
  useEffect(() => {
    setValue(seen);
    seenListeners.add(setValue);
    return () => seenListeners.delete(setValue);
  }, []);
  // Dates as YYYY-MM-DD compare correctly as strings.
  return !!latest && value < latest;
}
