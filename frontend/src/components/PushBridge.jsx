import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.js";
import { useTour } from "./Tour.jsx";
import { syncPushSubscription } from "../utils/push.js";

// ---------------------------------------------------------------------------
// The app's end of the push notifications. Mounted once (App.jsx), renders
// nothing. Three jobs:
//
//   * A tapped notification, with the site already open in a tab: the worker
//     (public/sw.js) asks this tab to go there, and it does, as a normal
//     navigation inside the app, then confirms on the private channel so the
//     worker does not reload the page as well. A walk-through link
//     (/?tour=<name>) starts its tour, the way the bell does.
//   * A push that arrived while the tab is open: the bell counts it at once
//     instead of at its next minute's poll ("nabs-bell-refresh").
//   * The daily check-in: a device with push on tells the server it is still
//     there, under whoever is signed in now (utils/push.js).
// ---------------------------------------------------------------------------
export default function PushBridge() {
  const navigate = useNavigate();
  const { startTour } = useTour();
  const { user, isLoggedIn } = useAuth();
  const discordId = user?.discordId || null;

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return undefined;
    const onMessage = (e) => {
      const msg = e.data;
      if (msg?.type === "nabs-push") {
        window.dispatchEvent(new Event("nabs-bell-refresh"));
        return;
      }
      if (msg?.type !== "nabs-open") return;
      e.ports?.[0]?.postMessage("ok");
      const url = String(msg.url || "/");
      let parsed;
      try {
        parsed = new URL(url, window.location.origin);
      } catch {
        return;
      }
      const tour = parsed.searchParams.get("tour");
      if (tour) {
        startTour(tour);
        return;
      }
      navigate(parsed.pathname + parsed.search + parsed.hash);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [navigate, startTour]);

  useEffect(() => {
    if (!isLoggedIn) return;
    syncPushSubscription(discordId).catch(() => {});
  }, [isLoggedIn, discordId]);

  return null;
}
