import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox } from "./ui.jsx";
import SlidingTabs from "./SlidingTabs.jsx";

// ---------------------------------------------------------------------------
// Admin -> Notifications -> Push notifications: the league's switch.
//
// Push sends the bell's own entries to members' phones (backend lib/push.js),
// so every setting further down this tab decides what gets pushed as well.
// This card only decides who may switch it on: nobody, the admins (to try it
// on their own phones first), or everyone. Saves on the click, like the race
// recap's switch: it is not one of the settings the Save bar below belongs to.
// ---------------------------------------------------------------------------

const MODE_TEXT = {
  off: "Off. Nobody gets push notifications, and the switch is gone from everyone's settings.",
  admins:
    "Admins only. League admins can switch push on for their own devices and see it work; members don't see the option yet.",
  all: "Everyone. Every member can switch push on in their settings, per device, and choose what buzzes.",
};

export default function AdminPush() {
  const { data, error, reload } = useApi(useCallback(() => api.adminPush(), []));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function setMode(mode) {
    setBusy(true);
    setMsg(null);
    try {
      await api.setAdminPushMode(mode);
      setMsg(
        mode === "all"
          ? "Push is open to everyone. Members got a note in their bell telling them where to switch it on."
          : mode === "admins"
            ? "Push is on for admins only."
            : "Push is off."
      );
      reload();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;
  const { mode, devices = 0, members = 0 } = data;

  return (
    <div className="card space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">Push notifications</h3>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-medium">{MODE_TEXT[mode] || MODE_TEXT.off}</p>
        </div>
        <SlidingTabs
          items={[
            { key: "off", label: "Off" },
            { key: "admins", label: "Admins only" },
            { key: "all", label: "Everyone" },
          ]}
          value={mode || "off"}
          onChange={(m) => !busy && m !== mode && setMode(m)}
          wrapClassName="inline-flex rounded-xl border border-border bg-surface2/60 p-1"
          btnClassName="px-3 py-1.5 text-[13px]"
        />
      </div>
      <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-light">
        <li>
          A push is the bell entry itself, on the lock screen: the events below decide what is sent, exactly as they
          do for the bell. Admin to-dos are never pushed.
        </li>
        <li>
          Members switch it on per device under{" "}
          <Link to="/profile?tab=settings" className="font-semibold text-brand hover:underline">
            Settings &rarr; Notifications
          </Link>{" "}
          and pick which kinds of news may buzz. On an iPhone it needs the site on the Home Screen first.
        </li>
        <li>Race reminders wake the phone on race day and expire at kickoff, so a late one never arrives after the start.</li>
      </ul>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg bg-surface2/60 px-4 py-3 text-sm text-medium">
        <span>
          <b className="text-dark">{devices}</b> {devices === 1 ? "device" : "devices"}
        </span>
        <span>
          <b className="text-dark">{members}</b> {members === 1 ? "member" : "members"}
        </span>
      </div>
      {msg && <p className="text-sm font-medium text-medium">{msg}</p>}
    </div>
  );
}
