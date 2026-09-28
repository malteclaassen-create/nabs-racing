import { useState } from "react";
import { Link } from "react-router-dom";
import { Copy, Check, RefreshCw, MonitorPlay } from "lucide-react";
import { api } from "../api/client.js";
import { useVisiblePoll } from "../hooks/useVisiblePoll.js";
import { useAsk } from "./overlay.jsx";
import { CardHead } from "./ui.jsx";

// Race control's own corner of the admin area: the pairing code for the game
// app, whether the app is connected, and the way to the TV board. Members with
// the race control role see only this; admins find it as a tab.

function clock(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function RaceControlDesk() {
  const ask = useAsk();
  const [me, setMe] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  // Every few seconds, so "connected" turns green while you watch.
  useVisiblePoll(
    async (alive) => {
      try {
        const r = await api.raceControlMe();
        if (alive()) {
          setMe(r);
          setError(null);
        }
      } catch (e) {
        if (alive()) setError(e.message);
      }
    },
    5000
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(me.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the code is on screen to type anyway */
    }
  };

  const renew = async () => {
    const ok = await ask({
      title: "Make a new code?",
      body: "The old code stops working at once. The game app then needs the new one.",
      confirmLabel: "New code",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api.newRaceControlCode();
      setMe((m) => ({ ...m, code: r.code, app: { connected: false, since: null, lastSeen: null } }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const openTv = () => {
    try {
      localStorage.setItem("nabs_live_rc", "1");
    } catch {
      /* then it is one click in there */
    }
  };

  const app = me?.app;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section className="card p-5">
        <CardHead eyebrow="Game app" title="Pairing code" />
        {!me && !error && <p className="text-sm text-light">Loading…</p>}
        {error && <p className="text-sm text-bad">{error}</p>}
        {me && !me.canPair && (
          <p className="text-sm text-medium">
            The code belongs to a person, so it needs a Discord login. Sign in with Discord to get yours.
          </p>
        )}
        {me?.canPair && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className="select-all rounded-xl border border-border bg-surface2 px-4 py-2 font-mono text-3xl font-bold tracking-[0.3em] text-dark">
                {me.code}
              </span>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={copy}>
                  {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                  {copied ? "Copied" : "Copy"}
                </button>
                <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={renew} disabled={busy}>
                  <RefreshCw className="h-4 w-4" aria-hidden />
                  New code
                </button>
              </div>
            </div>
            <p className="mt-3 text-sm text-medium">
              Type this once into the NABS Race Control app in Assetto Corsa. Keep it to yourself: whoever has it gets
              the collisions on their screen. If it got out, make a new one.
            </p>
            <div className="mt-4 flex items-center gap-2 border-t border-border pt-4 text-sm">
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${app?.connected ? "bg-emerald-500" : "bg-border"}`}
                aria-hidden
              />
              {app?.connected ? (
                <span className="text-dark">App connected since {clock(app.since)}</span>
              ) : (
                <span className="text-light">
                  App not connected{app?.lastSeen ? `, last seen at ${clock(app.lastSeen)}` : ""}
                </span>
              )}
            </div>
          </>
        )}
      </section>

      <section className="card p-5">
        <CardHead eyebrow="Race night" title="How it works" />
        <ol className="list-decimal space-y-2 pl-5 text-sm text-medium">
          <li>Put the NABS Race Control app into Assetto Corsa (apps/lua) and turn it on in the game.</li>
          <li>Open its window, enter the code once. It is kept for next time.</li>
          <li>
            Join the race server. Every contact over the threshold opens camera windows for that car by itself, about
            half a second after it happened.
          </li>
          <li>On a second screen, the TV board with race control on shows the bursts, who is off track and who stopped.</li>
        </ol>
        <Link
          to="/live?tv=1"
          onClick={openTv}
          className="btn-primary mt-4 inline-flex items-center gap-2"
        >
          <MonitorPlay className="h-4 w-4" aria-hidden />
          Open the TV board
        </Link>
      </section>
    </div>
  );
}
