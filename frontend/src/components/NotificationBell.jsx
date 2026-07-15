import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import { useAuth } from "../hooks/useAuth.js";
import { SettingsDrawer, GearIcon } from "./SettingsPanel.jsx";

// The bell in the nav bar: took over the old gear slot, so its menu also
// carries the "Settings" row that opens the settings drawer. Logged-in
// members see league notifications (results, race day, downloads, driver
// market); the unread count polls once a minute, opening the panel loads the
// list and marks everything seen. Logged-out visitors still get the bell —
// it explains the feature and keeps Settings reachable.

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

// One small line-style icon per notification type (RESULTS/REMINDER/DOWNLOAD/
// MARKET, see backend lib/notifications.js). Falls back to the bell.
function TypeIcon({ type }) {
  const common = {
    viewBox: "0 0 24 24",
    className: "h-4 w-4",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };
  switch (type) {
    case "RESULTS": // chequered flag
      return (
        <svg {...common}>
          <path d="M4 21V4" />
          <path d="M4 4c3-1.5 6 1.5 9 0s7-1.5 7 0v9c-3 1.5-6-1.5-9 0s-7 1.5-7 0" />
        </svg>
      );
    case "REMINDER": // clock
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "DOWNLOAD": // arrow into tray
      return (
        <svg {...common}>
          <path d="M12 3v12M7 10l5 5 5-5" />
          <path d="M4 17v3h16v-3" />
        </svg>
      );
    case "MARKET": // swap arrows
      return (
        <svg {...common}>
          <path d="M16 3l4 4-4 4M20 7H7" />
          <path d="M8 21l-4-4 4-4M4 17h13" />
        </svg>
      );
    case "CARD": // rating card with a star
      return (
        <svg {...common}>
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <path d="M12 7.5l1.3 2.6 2.9.4-2.1 2 .5 2.9-2.6-1.4-2.6 1.4.5-2.9-2.1-2 2.9-.4z" />
        </svg>
      );
    default:
      return <BellIcon />;
  }
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
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState(null); // null = not loaded yet
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef(null);

  // Unread badge: poll once a minute while logged in; refetch on login/logout.
  useEffect(() => {
    if (!isLoggedIn) {
      setUnread(0);
      setItems(null);
      return;
    }
    let alive = true;
    const load = () =>
      api
        .notificationsCount()
        .then((d) => alive && setUnread(d?.unread || 0))
        .catch(() => {});
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [isLoggedIn]);

  const close = useCallback(() => setOpen(false), []);

  // Escape closes the panel (the drawer has its own handler and sits on top).
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

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
    if (n.link) navigate(n.link);
  }

  function openSettings() {
    close();
    setSettingsOpen(true);
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
        <BellIcon />
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 font-mono text-[10px] font-bold leading-none text-white"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Invisible click-catcher: tapping anywhere else closes the panel. */}
          <button type="button" aria-label="Close notifications" onClick={close} className="fixed inset-0 z-30 cursor-default" />
          <div className="notif-pop absolute right-0 top-full z-40 mt-2 w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-border bg-card shadow-2xl shadow-ink/20">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">Notifications</h2>
              {unreadCountLabel(items)}
            </div>

            <div className="max-h-[min(24rem,60vh)] overflow-y-auto">
              {!isLoggedIn ? (
                <p className="px-4 py-6 text-sm leading-relaxed text-light">
                  Log in with Discord to get notified about race results, race days, new downloads and the driver market.
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
                          <span className="mt-1 block font-mono text-[10px] uppercase tracking-wide text-light">
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

            {/* Settings moved in here when the bell took the gear's nav slot. */}
            <button
              type="button"
              onClick={openSettings}
              className="flex w-full items-center gap-2.5 border-t border-border px-4 py-3 text-sm font-semibold text-medium transition hover:bg-surface2"
            >
              <span className="text-light">
                <GearIcon />
              </span>
              Settings
            </button>
          </div>
        </>
      )}

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
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
