import { useCallback, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { CardBar } from "./ui.jsx";
import { useAsk } from "./overlay.jsx";
import TelemetryCompare from "./TelemetryCompare.jsx";

// ---------------------------------------------------------------------------
// Admin → League → Telemetry: everything about laps from inside the car, in
// the order somebody needs it.
//
//   1. record   — mint the key, hand the race server its one line
//   2. show     — who may read what was recorded: the stewards, or the league
//   3. read     — the comparison itself
//
// The recording card used to live on the Reports tab, next to the in-race
// reporting key, because the two share a contract: a Lua app in the game
// posting to the site with a key in the URL. That is a fact about the code,
// and it was the wrong reason to put a telemetry switch under a heading that
// says "Reports".
// ---------------------------------------------------------------------------
export default function AdminTelemetry() {
  const ask = useAsk();
  const [busy, setBusy] = useState(false);

  // Recording: is there a key, and what is it.
  const { data: telIngest, reload: reloadTelIngest } = useApi(useCallback(() => api.telemetryIngest(), []));
  const [telUnlocked, setTelUnlocked] = useState(false);
  // A key typed in rather than minted — see the field below.
  const [telGivenKey, setTelGivenKey] = useState("");
  const telGivenKeyOk = !telGivenKey.trim() || /^[a-f0-9]{32}$/i.test(telGivenKey.trim());

  // Reading: may the members' side see any of it.
  const { data: vis, reload: reloadVis } = useApi(useCallback(() => api.telemetryVisibility(), []));
  const isPublic = vis?.public === true;

  // Both directions ask first, and for opposite reasons. Opening it up is the
  // decision this whole feature was held back for, and not one to make by
  // mis-clicking. Closing it again is the awkward one: the laps were visible,
  // drivers have seen each other's, and taking that away is a thing people
  // notice — so it says so rather than quietly reverting.
  async function flipVisibility() {
    const next = !isPublic;
    const ok = await ask(
      next
        ? {
            title: "Show recorded laps to everyone?",
            body:
              "Every member will be able to open any driver's fastest lap at any track and put their own against it — throttle, brake, steering, and where the time goes. This is the decision the feature has been waiting on. It can be switched back, but the drivers will have seen it.",
            confirmLabel: "Show everyone",
          }
        : {
            title: "Back to admins only?",
            body:
              "The comparison disappears from the members' side. Nothing is deleted and recording carries on — but drivers who have been using it will find it gone.",
            confirmLabel: "Admins only",
          }
    );
    if (!ok) return;
    setBusy(true);
    try {
      await api.setTelemetryVisibility(next);
      reloadVis();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <h2 className="font-display text-lg font-extrabold uppercase tracking-tight text-dark">
          Laps from inside the car
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-light">
          Throttle, brake, steering and speed over a lap, sampled by position on the track rather than by
          time — so two laps line up slice for slice and the difference between them is a subtraction
          rather than a guess. The site keeps a driver's three fastest clean laps per track, and starts
          fresh every season, because the cars change with it.
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-light">
          Nothing is recorded until the key below is minted, and no driver appears in the comparison who
          has not sent a lap.
        </p>
      </div>

      {/* RECORDING: the key, and the line the race server needs.
          This lived on the Reports tab until this tab existed, because it
          shares its key contract with the in-race reporting app — a good
          reason for two pieces of CODE to sit together and a poor one for two
          admin CARDS to. "Reports" means incident reports, and nobody hunting
          for the telemetry recorder would think to open it. */}
      <div className="card overflow-hidden">
        <CardBar title="Telemetry from inside the car" />
        <div className="space-y-3 p-5">
          <p className="text-sm text-light">
            A URL for the nabsTelemetry app. Every driver who joins the race server sends their fastest
            clean laps — throttle, brake, steering, speed — for the comparison below. Three per track per
            season are kept; anything slower than those is dropped on arrival.
          </p>
          {telIngest?.configured ? (
            <>
              <label className="block font-mono text-[11px] font-bold uppercase tracking-wider text-light">
                Paste this into the race server&rsquo;s CSP extra options
              </label>
              {/* The whole point of the server route: CSP hands this script to
                  every driver who joins, so nobody installs anything. The same
                  key gates the script download and rides inside it as the
                  ingest address — one mint invalidates both. */}
              <textarea
                readOnly
                aria-label="csp_extra_options snippet"
                className="input w-full font-mono text-xs"
                rows={2}
                value={`[SCRIPT_NABS_TELEMETRY]
SCRIPT = "${window.location.origin}/api/telemetry-laps/app.lua?key=${telIngest.key}"`}
                onFocus={(e) => e.target.select()}
              />
              <p className="text-xs text-light">
                Into <span className="font-mono">csp_extra_options.ini</span> in the server panel (where the
                penalty script lives). From then on every driver who joins records automatically — nothing
                to install. The script shows nothing in the game — no window, no message — so the drivers
                only know about the recording if you tell them. Announce it in Discord.
              </p>
              <label className="block font-mono text-[11px] font-bold uppercase tracking-wider text-light">
                Hand-install URL (testing, or drivers without the server script)
              </label>
              <input
                readOnly
                aria-label="nabsTelemetry URL"
                className="input w-full font-mono text-xs"
                value={`${window.location.origin}/api/telemetry-laps/ingest?key=${telIngest.key}`}
                onFocus={(e) => e.target.select()}
              />
              <p className="text-xs text-light">
                For the nabsTelemetry app&rsquo;s settings. Unlike the reports URL, either of these may go to
                every driver — the key only ever adds their own laps, nothing else.
              </p>
            </>
          ) : (
            <p className="text-sm text-light">Telemetry recording is off.</p>
          )}
          {telIngest?.configured && !telUnlocked ? (
            <button className="btn-secondary" onClick={() => setTelUnlocked(true)}>
              Change this
            </button>
          ) : (
            <div className="space-y-2">
            {/* The race server's config is written by whoever runs the server,
                which is often not the person standing here. If those two lines
                already carry a key — settled up front, or surviving a database
                restore — this is how the site is told to honour it instead of
                minting a new one and breaking a config nobody wants to redo.
                Only on the way ON: switching off needs no key. */}
            {!telIngest?.configured && (
              <>
                <label className="block font-mono text-[11px] font-bold uppercase tracking-wider text-light">
                  Key to use (optional &mdash; leave blank to make a fresh one)
                </label>
                <input
                  className="input w-full font-mono text-xs"
                  placeholder="32 characters, 0-9 and a-f"
                  value={telGivenKey}
                  onChange={(e) => setTelGivenKey(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                />
                {!telGivenKeyOk && (
                  <p className="text-xs text-bad">That is not a key: 32 characters, digits and a&ndash;f only.</p>
                )}
              </>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="btn-secondary"
                disabled={busy || !telGivenKeyOk}
                onClick={async () => {
                  const off = !!telIngest?.configured;
                  if (
                    off &&
                    !(await ask({
                      title: "Switch off telemetry recording?",
                      body:
                        "The URL stops working immediately, in every driver's game at once. Switching back on can reuse the same key — type it into the field — but without it the race server's config has to be pasted again.",
                      danger: true,
                      confirmLabel: "Switch off",
                    }))
                  )
                    return;
                  setBusy(true);
                  try {
                    await api.setTelemetryIngest(!off, telGivenKey.trim().toLowerCase() || undefined);
                    setTelGivenKey("");
                    reloadTelIngest();
                    setTelUnlocked(false);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {telIngest?.configured
                  ? "Switch off"
                  : telGivenKey.trim()
                    ? "Switch on with this key"
                    : "Switch on and make a key"}
              </button>
              {telIngest?.configured && (
                <button
                  type="button"
                  className="text-sm font-semibold text-light transition hover:text-dark"
                  onClick={() => setTelUnlocked(false)}
                >
                  Cancel
                </button>
              )}
            </div>
            </div>
          )}
        </div>
      </div>

      {/* WHO MAY LOOK. Separate from the key above, and the separation is the
          point: that one decides whether cars record, this one decides whether
          the league gets to see it. */}
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">
              Who can see these laps
            </h3>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-light">
              {isPublic
                ? "Everyone. Members see the comparison on the Tools page and can put their own lap against anybody's."
                : "Admins only. The comparison exists here and nowhere else, which is where it stays until the league says otherwise."}
            </p>
          </div>
          <span className={`pill ${isPublic ? "bg-emerald-500/15 text-ok" : "bg-surface2 text-light"}`}>
            {isPublic ? "everyone" : "admins only"}
          </span>
        </div>
        <button className="btn-secondary mt-4" disabled={busy || !vis} onClick={flipVisibility}>
          {busy ? "Saving…" : isPublic ? "Go back to admins only" : "Show everyone"}
        </button>
        <p className="mt-3 max-w-2xl text-xs leading-relaxed text-faint">
          Recording is unaffected either way: laps keep arriving and keep being stored while this is shut.
        </p>
      </div>

      <TelemetryCompare />
    </div>
  );
}
