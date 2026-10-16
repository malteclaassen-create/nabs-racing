import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useAuth } from "../hooks/useAuth.js";
import {
  currentSubscription,
  disablePush,
  enablePush,
  needsHomeScreen,
  pushPermission,
  pushSupported,
} from "../utils/push.js";

// ---------------------------------------------------------------------------
// Settings -> Notifications: push on this device, and what gets pushed.
//
// Two different things on one card, and the card says which is which:
//
//   "This device"   is the browser's business. Each phone and each computer is
//                   switched on by itself, from itself, because the permission
//                   question can only be asked by the device that will show
//                   the messages.
//   "What to push"  is the account's. One choice, every device follows it.
//
// The card only exists while the league offers push to this member (admins
// first, then everyone: backend lib/push.js). The bell itself is untouched: an
// entry switched off here still lands in it, it just doesn't buzz.
// ---------------------------------------------------------------------------

function Switch({ checked, onChange, disabled = false, label }) {
  return (
    <span className="relative inline-flex shrink-0">
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="h-6 w-11 rounded-full bg-surface2 ring-1 ring-border transition peer-checked:bg-primary peer-disabled:opacity-50" />
      <span className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-card shadow transition peer-checked:translate-x-5" />
    </span>
  );
}

function Section({ title, hint, children }) {
  return (
    <section className="border-t border-border px-5 py-5 first:border-t-0 sm:px-6">
      <h3 className="mb-2 font-mono text-[11px] font-bold uppercase tracking-wider text-light">{title}</h3>
      {children}
      {hint && <p className="mt-2 text-xs leading-relaxed text-light">{hint}</p>}
    </section>
  );
}

// What the device itself can or cannot do, in the order a member hits them.
function deviceBlocker(perm) {
  if (needsHomeScreen()) return "home-screen";
  if (!pushSupported()) return "unsupported";
  if (perm === "denied") return "denied";
  return null;
}

const ERRORS = {
  denied: "Notifications are blocked for this site. Allow them in your browser's settings for this site, then switch this on again.",
  dismissed: "The question was closed without an answer. Switch it on again whenever you like.",
  unsupported: import.meta.env.DEV
    ? "Push needs the site's service worker, which only runs in a production build."
    : "This browser can't receive push notifications.",
};

const fmtDay = (iso) => {
  const t = iso ? new Date(iso) : null;
  return t && !isNaN(t) ? t.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null;
};

export default function PushSettings() {
  const { user } = useAuth();
  const [status, setStatus] = useState(null);
  const [here, setHere] = useState(undefined); // this browser's endpoint; null = none
  const [perm, setPerm] = useState(pushPermission);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }

  const load = useCallback(() => {
    api
      .pushStatus()
      .then(setStatus)
      .catch(() => setStatus({ available: false }));
    currentSubscription()
      .then((s) => setHere(s?.endpoint || null))
      .catch(() => setHere(null));
  }, []);
  useEffect(load, [load]);

  if (!status?.available) return null;

  const devices = status.devices || [];
  const onHere = !!here && devices.some((d) => d.endpoint === here);
  const blocker = deviceBlocker(perm);
  const others = devices.filter((d) => d.endpoint !== here);

  async function toggleHere(on) {
    setBusy(true);
    setMsg(null);
    try {
      if (on) {
        const res = await enablePush(status.publicKey, user?.discordId || null);
        setHere(res.endpoint);
        setStatus((s) => ({ ...s, devices: res.devices || s.devices }));
        setMsg({ ok: true, text: "Push is on for this device. Send a test to see one arrive." });
      } else {
        const res = await disablePush();
        setHere(null);
        if (res?.devices) setStatus((s) => ({ ...s, devices: res.devices }));
        setMsg({ ok: true, text: "Push is off for this device. The bell still has everything." });
      }
    } catch (e) {
      setMsg({ ok: false, text: ERRORS[e?.code] || e?.message || "That didn't work. Try again." });
    } finally {
      setPerm(pushPermission());
      setBusy(false);
      // The bell's "get these on this device" row asks again (NotificationBell).
      window.dispatchEvent(new Event("nabs-push-changed"));
    }
  }

  async function sendTest() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.pushTest();
      const n = res.sent || 0;
      setStatus((s) => ({ ...s, devices: res.devices || s.devices }));
      setMsg(
        n
          ? { ok: true, text: `Sent to ${n === 1 ? "your device" : `${n} devices`}. It should arrive within a few seconds.` }
          : { ok: false, text: "No device took it. Switch push off and on again on the device that should get it." }
      );
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function forget(endpoint) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.pushUnsubscribe(endpoint);
      setStatus((s) => ({ ...s, devices: res.devices || s.devices.filter((d) => d.endpoint !== endpoint) }));
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function setPref(key, on) {
    const before = status.prefs;
    const next = { ...before, [key]: on };
    setStatus((s) => ({ ...s, prefs: next }));
    try {
      const res = await api.pushSavePrefs(next);
      setStatus((s) => ({ ...s, prefs: res.prefs }));
    } catch (e) {
      setStatus((s) => ({ ...s, prefs: before }));
      setMsg({ ok: false, text: e.message });
    }
  }

  return (
    <div className="card overflow-hidden" id="push">
      <div className="border-b border-border bg-surface2/40 px-5 py-3 font-display text-sm font-extrabold uppercase tracking-wide text-dark sm:px-6">
        Notifications
      </div>

      <Section
        title="Push on this device"
        hint="Each phone and computer is switched on by itself, from itself. The bell keeps everything either way."
      >
        {blocker === "home-screen" ? (
          <p className="text-sm leading-relaxed text-medium">
            On an iPhone or iPad, push works once NABS is on your Home Screen. Add it there,{" "}
            <Link to="/app" className="font-semibold text-brand hover:underline">
              the steps are here
            </Link>
            , open it from the Home Screen and switch this on from inside the app.
          </p>
        ) : blocker === "unsupported" ? (
          <p className="text-sm leading-relaxed text-medium">{ERRORS.unsupported}</p>
        ) : blocker === "denied" ? (
          <p className="text-sm leading-relaxed text-medium">{ERRORS.denied}</p>
        ) : (
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-border bg-surface2 px-4 py-3">
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-dark">
                {onHere ? "On for this device" : "Off for this device"}
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-light">
                {onHere
                  ? "Race reminders, results and anything addressed to you arrive here, even with the site closed."
                  : "Turn it on and your browser asks whether this site may show notifications."}
              </span>
            </span>
            <Switch
              label="Push notifications on this device"
              checked={onHere}
              disabled={busy || here === undefined}
              onChange={toggleHere}
            />
          </label>
        )}

        {devices.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {onHere && (
              <button
                type="button"
                onClick={sendTest}
                disabled={busy}
                className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold text-dark transition hover:border-accent/40 disabled:opacity-50"
              >
                Send a test
              </button>
            )}
            {others.length > 0 && (
              <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
                {others.map((d) => (
                  <li key={d.endpoint} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-dark">{d.device}</span>
                      <span className="block text-xs text-light">
                        {fmtDay(d.since) ? `On since ${fmtDay(d.since)}` : "On"}
                        {fmtDay(d.lastDelivered) ? ` · last message ${fmtDay(d.lastDelivered)}` : ""}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => forget(d.endpoint)}
                      disabled={busy}
                      className="shrink-0 text-xs font-semibold text-light transition hover:text-bad disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {msg && (
          <p role="status" className={`mt-3 text-sm font-medium ${msg.ok ? "text-ok" : "text-bad"}`}>
            {msg.text}
          </p>
        )}
      </Section>

      <Section
        title="What to push"
        hint="Your choice for every device. Switched off means it stays in the bell and doesn't buzz."
      >
        <div className="divide-y divide-border rounded-xl border border-border">
          {(status.categories || []).map((c) => (
            <label key={c.key} className="flex cursor-pointer items-start justify-between gap-4 px-4 py-3">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-dark">{c.label}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-light">{c.help}</span>
              </span>
              <Switch label={c.label} checked={status.prefs?.[c.key] !== false} onChange={(on) => setPref(c.key, on)} />
            </label>
          ))}
        </div>
      </Section>
    </div>
  );
}
