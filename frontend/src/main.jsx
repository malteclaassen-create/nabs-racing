import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import "./index.css";

// Chrome decides a site is installable at some point after load and fires
// `beforeinstallprompt` exactly once. Preventing its default suppresses the
// browser's own mini-infobar and hands us the event to replay from a button of
// our own — but only if something is listening AT THAT MOMENT, which is long
// before anybody opens /app. So it is parked on `window` here, at startup, and
// the install page picks it up whenever it mounts (see pages/InstallApp.jsx).
// Browsers that never fire it (every iOS browser, Firefox) simply leave this
// null and the page shows its written steps, which is the path that always
// works anyway.
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  window.__nabsInstallPrompt = e;
});

// The service worker (public/sw.js: offline page + asset cache, never data).
//
// Production builds only. In dev, Vite serves modules the worker knows nothing
// about and a cached bundle fights hot reload for the rest of the afternoon;
// the worker is about the deployed site, so that is where it runs.
//
// Registered after `load` so it never competes with the first paint for
// bandwidth, and a failure is swallowed: a site that works is worth more than a
// site that caches, and every browser without service worker support (and every
// page opened over plain http) simply carries on as before.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {/* Outermost crash guard. App.jsx has one per route, but it sits BELOW the
        nav bar, the footer and the series/season providers — so a throw in any
        of those unwound past it and left a white page with no way back. This one
        catches that last case. It is outside the router on purpose: the router
        itself is one of the things it has to survive. */}
    <ErrorBoundary root>
      {/* opt in to the v7 behaviours now to silence the upgrade warnings */}
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
