import { useCallback, useEffect, useRef, useState } from "react";
import { useDismiss } from "./overlay.jsx";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import { useAuth } from "../hooks/useAuth.js";
import { useVisiblePoll } from "../hooks/useVisiblePoll.js";
import { useTour } from "./Tour.jsx";
import { motionOff } from "../hooks/motion.js";
import { GearIcon } from "./SettingsPanel.jsx";
import { ArrowLeftRight, Bell, Camera, ChatBubble, Clock, FlagCheckered, Inbox, Medal, Megaphone, Newspaper, RatingCard, UserPlus } from "./icons/filled.jsx";

// The bell in the nav bar. Logged-in members see league notifications
// (results, race day, downloads, driver market); the unread count polls once
// a minute, opening the panel loads the list and marks everything seen.
// Logged-out visitors still get the bell — it explains the feature. It also
// carries the Settings row at the bottom of the panel: the settings live in
// the personal area, which needs a Discord login behind it, so a plain visitor
// could not reach the theme or the Lite mode at all. The bell is in the bar for
// everyone, which makes it the one place the settings are always available
// from. The row points at /settings either way, and that address sends a
// signed-in member on to their own area — see pages/Settings.jsx.

// `ringing` swings the bell on a slow loop (see .bell-ring in index.css) — set
// while there is something unread and the panel is shut. The badge on its own
// is a 4px dot in a dark header, which on a phone is genuinely easy to miss;
// the movement is what gets noticed. It stops the moment the panel opens,
// because by then it has done its job and would just be fidgeting.
function BellIcon({ ringing = false }) {
  return <Bell className={`h-[18px] w-[18px] ${ringing ? "bell-ring" : ""}`} />;
}

// One small filled symbol per notification type (RESULTS/REMINDER/DOWNLOAD/
// MARKET/..., see backend lib/notifications.js). Falls back to the bell.
const TYPE_ICONS = {
  RESULTS: FlagCheckered,
  REMINDER: Clock,
  DOWNLOAD: Inbox,
  NEWS: Newspaper, // an article went out, or a draft waits on the desk
  PHOTOS: Camera, // a round's gallery went up
  MARKET: ArrowLeftRight,
  ANNOUNCE: Megaphone, // feature announcements and the ones an admin writes
  CARD: RatingCard,
  FEEDBACK: ChatBubble, // a bug report / idea landed (admins only)
  REPLY: ChatBubble, // somebody answered your comment under a news article
  ADMIN: UserPlus, // a login waiting to be given a driver
  AWARD: Medal, // achievement unlocks (Cockpit)
};
function TypeIcon({ type }) {
  const Icon = TYPE_ICONS[type];
  if (!Icon) return <BellIcon />;
  return <Icon className="h-4 w-4" />;
}

// "5m ago" / "3h ago" / "2d ago" — enough precision for a bell menu.
function timeAgo(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const POLL_MS = 60_000;

export default function NotificationBell({ className = "" }) {
  const { isLoggedIn } = useAuth();
  const navigate = useNavigate();
  const { startTour } = useTour();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState(null); // null = not loaded yet
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef(null);

  // Logging out has to clear what the previous account left behind, which is
  // its own concern now that the polling below is only about polling.
  useEffect(() => {
    if (isLoggedIn) return;
    setUnread(0);
    setItems(null);
  }, [isLoggedIn]);

  // Unread badge: poll once a minute while logged in; refetch on login/logout.
  // A hidden tab does not poll at all and refetches the moment it is looked at
  // again (see useVisiblePoll), so the badge is one roundtrip behind on the
  // switch back and current from then on.
  useVisiblePoll(
    (alive) => {
      api
        .notificationsCount()
        .then((d) => alive() && setUnread(d?.unread || 0))
        .catch(() => {});
    },
    POLL_MS,
    isLoggedIn,
  );

  // Closing plays the opening backwards before the panel goes: `shown` keeps
  // it mounted for that moment, `open` is already false (so the bell, the
  // dismiss layer and a quick reopen all see it as shut).
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (open) {
      setShown(true);
      return undefined;
    }
    const t = setTimeout(() => setShown(false), motionOff() ? 0 : 180);
    return () => clearTimeout(t);
  }, [open]);
  // The red count leaves the same way: it shrinks away instead of blinking out
  // when the panel marks everything seen. `badge` is the last count shown.
  const [badge, setBadge] = useState(0);
  useEffect(() => {
    if (unread > 0) {
      setBadge(unread);
      return undefined;
    }
    const t = setTimeout(() => setBadge(0), motionOff() ? 0 : 220);
    return () => clearTimeout(t);
  }, [unread]);

  const close = useCallback(() => setOpen(false), []);

  // Escape and click-outside come from the shared overlay layer. That also
  // retires the invisible full-screen catcher this used to paint over the page
  // just to notice an outside click: a real element that had to be stacked
  // between the panel and everything else, and got it wrong (it sat at the
  // header's own level, BELOW its own panel and below the mobile nav panel).
  // The bell lives inside wrapRef, so a click on it counts as inside and the
  // button's own toggle decides — no close-then-instantly-reopen.
  useDismiss(open, close, { ref: wrapRef });

  function openPanel() {
    if (open) return close();
    setOpen(true);
    if (!isLoggedIn) return;
    setLoading(true);
    api
      .notifications()
      .then((d) => {
        setItems(d?.items || []);
        // The list keeps its "new" markers for this viewing; the badge clears.
        return api.markNotificationsSeen().then(() => setUnread(0));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  function onItemClick(n) {
    close();
    if (!n.link) return;
    // A `tour:<name>` link doesn't jump straight to a page — it kicks off a
    // guided walk-through that spotlights the buttons to press on the way there.
    if (n.link.startsWith("tour:")) return startTour(n.link.slice(5));
    // The track editor is its own page served by the backend, not a route of
    // this app: a client-side navigation there lands on the 404. Real load.
    if (n.link.startsWith("/track-editor")) {
      window.location.assign(n.link.endsWith("/") ? n.link : `${n.link}/`);
      return;
    }
    // An admin's announcement may point off the site (the server only lets
    // http(s) through). The router would read it as a path of this app, so it
    // opens in a new tab and the site stays where it was.
    if (/^https?:\/\//i.test(n.link)) {
      window.open(n.link, "_blank", "noopener,noreferrer");
      return;
    }
    navigate(n.link);
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={openPanel}
        aria-label={unread > 0 ? `Notifications (${unread} new)` : "Notifications"}
        title="Notifications"
        aria-expanded={open}
        className={`relative flex items-center justify-center rounded-lg text-light transition hover:bg-surface2 ${className}`}
      >
        <BellIcon ringing={unread > 0 && !open} />
        {badge > 0 && (
          <span
            aria-hidden
            className={`absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 font-mono text-[10px] font-bold leading-none text-white ${
              unread === 0 ? "bell-badge-out" : open ? "" : "bell-badge-pulse"
            }`}
          >
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </button>

      {(open || shown) && (
        <>
          {/* The panel hangs off the bell's right edge, and on a phone the bell
              itself sits ~60px in from the screen edge (the burger is to its
              right). The old clamp only subtracted the page gutter, so on
              narrow phones the panel's LEFT edge ran off screen. Subtracting
              5.5rem accounts for the burger plus a margin, so it always fits. */}
          <div className={`liquid-glass glass-dense ${open ? "glass-pop" : "glass-pop-out"} absolute right-0 top-full z-dropdown mt-2 w-80 max-w-[calc(100vw-5.5rem)] origin-top-right overflow-hidden rounded-[22px] lg:max-w-[calc(100vw-1.5rem)]`}>
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">Notifications</h2>
              {unreadCountLabel(items)}
            </div>

            <div className="max-h-[min(24rem,60vh)] overflow-y-auto">
              {!isLoggedIn ? (
                <p className="px-4 py-6 text-sm leading-relaxed text-light">
                  Sign in with Discord to get notified about race results, race days, new downloads and the driver market.
                </p>
              ) : loading && items === null ? (
                <p className="px-4 py-6 text-sm text-light">Loading&hellip;</p>
              ) : !items || items.length === 0 ? (
                <p className="px-4 py-6 text-sm leading-relaxed text-light">
                  Nothing yet. Race results, race-day reminders, new downloads and driver market news will show up here.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {items.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => onItemClick(n)}
                        className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-surface2"
                      >
                        <span className={`mt-0.5 shrink-0 ${n.unread ? "text-dark" : "text-light"}`}>
                          <TypeIcon type={n.type} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={`block text-sm leading-snug ${n.unread ? "font-bold text-dark" : "font-semibold text-medium"}`}>
                            {n.title}
                          </span>
                          {n.body && <span className="mt-0.5 block text-xs leading-relaxed text-light">{n.body}</span>}
                          <span className="mt-1 block font-mono text-[10px] uppercase tracking-wider text-light">
                            {timeAgo(n.createdAt)}
                          </span>
                        </span>
                        {n.unread && <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Settings live down here, and that is the whole point: theme and
                the Lite performance mode are otherwise a panel of the personal
                area, which needs a Discord login behind it. A visitor who just
                wants the light theme, or someone on a slow machine who wants
                the animations off, could not get to either. The bell is in the
                bar for everyone, signed in or not, so it is the one place that
                always works. A link rather than a button opening a drawer:
                /settings is an address, and for a member it leads on to the
                same panel their profile shows. */}
            <Link
              to="/settings"
              onClick={close}
              className="flex w-full items-center gap-2.5 border-t border-border px-4 py-3 text-left text-sm font-semibold text-medium transition hover:bg-surface2 hover:text-dark"
            >
              <GearIcon />
              Settings
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

// "3 new" chip next to the header while the freshly-opened list still carries
// unread rows; nothing when everything was seen before.
function unreadCountLabel(items) {
  const n = (items || []).filter((i) => i.unread).length;
  if (!n) return null;
  return <span className="font-mono text-[11px] font-bold text-brand">{n} new</span>;
}
