// ---------------------------------------------------------------------------
// The version of the page's link-preview picture, in the address bar.
//
// The league shares pages in Discord by copying the address from the browser.
// The server draws each page's preview picture from what the page shows right
// now (backend lib/sharePictures.js), but Discord keeps a preview per address
// for a while: the same address posted again after the next round could still
// show last week's standings. So the address carries the version of the
// picture (?v=3fa2c): when the picture changes, the copied link is one
// Discord has not seen yet, and it fetches the new picture.
//
// Written with history.replaceState, past the router: the parameter means
// nothing to the app, so no page should see it in its search params or
// re-render over it. A page that later rewrites its own query string drops
// it, the location changes, and this puts it back.
// ---------------------------------------------------------------------------
import { useEffect } from "react";
import { api } from "../api/client.js";

// The pages that have a drawn picture: the landing page (/, /join, /s/<slug>)
// and a series' list pages (/s/<slug>/<page>). The server decides the rest and
// answers null for anything else.
const SHARED_PAGE = /^\/(?:join\/?)?$|^\/s\/[^/]+(?:\/[^/]+)?\/?$/;

export function useShareVersion(location) {
  const { pathname, search } = location;
  useEffect(() => {
    if (!SHARED_PAGE.test(pathname)) return;
    const params = new URLSearchParams(search);
    let live = true;
    api
      .shareVersion(pathname, { race: params.get("race"), season: params.get("season") })
      .then(({ version }) => {
        if (!live || window.location.pathname !== pathname) return;
        const url = new URL(window.location.href);
        if ((url.searchParams.get("v") || null) === (version || null)) return;
        if (version) url.searchParams.set("v", version);
        else url.searchParams.delete("v");
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [pathname, search]);
}
