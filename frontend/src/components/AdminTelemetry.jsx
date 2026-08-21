import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { CardBar } from "./ui.jsx";
import { useAsk } from "./overlay.jsx";
import TelemetryCompare from "./TelemetryCompare.jsx";
import { fmtLap } from "../utils/format.js";

// ---------------------------------------------------------------------------
// Is anything arriving?
//
// The recording half of this feature says nothing, anywhere: the in-game
// script draws no window, and a refused post is a status code that goes into a
// debug console nobody has open. An empty comparison therefore looked exactly
// the same whether the race server had never handed the script out, the key
// had been re-minted underneath it, or the cars were posting fine and nobody
// had set a clean lap yet. Three problems, one blank page, and the only way to
// tell them apart was a voice call with whoever runs the server.
//
// The split that does most of the work here is script downloads vs laps. A
// driver's game fetches the script when they join a server carrying the
// snippet, so a download proves the whole chain up to the car — config,
// restart, key, CSP. Which means:
//
//   nothing at all      -> the race server. The snippet, or the restart it
//                          has not had, or the wrong one of two servers.
//   scripts, no laps    -> the recorder in the car, or simply no clean lap yet.
//   laps                -> it works, and the page is a season/track question.
// ---------------------------------------------------------------------------

// "4 min ago". Written here rather than in utils/format.js because it exists
// for this panel's question — how stale is this number — and nothing else on
// the site asks it. The exact stamp rides along as a title.
function ago(iso) {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 90) return "a minute ago";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 7200) return "an hour ago";
  if (s < 86400) return `${Math.round(s / 3600)} hours ago`;
  return `${Math.round(s / 86400)} days ago`;
}

function Stat({ label, value, at, tone = "" }) {
  return (
    <div className="rounded-lg border border-border bg-surface2/40 p-3">
      <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">{label}</div>
      <div className={`mt-1 font-display text-2xl font-extrabold tabular-nums ${tone || "text-dark"}`}>{value}</div>
      <div className="mt-0.5 text-xs text-faint" title={at || ""}>{ago(at)}</div>
    </div>
  );
}

// The same wording the backend keeps (lib/telemetryIngestLog.js), shortened for
// a row. Kept in both places on purpose: the API's list is what an admin reads
// in a raw response, this is what fits in a column.
const EVENT_LABEL = {
  "script-served": "Script sent",
  "script-refused": "Script refused",
  "lap-kept": "Lap stored",
  "lap-slower": "Lap arrived (slower)",
  "lap-refused": "Lap refused",
  ping: "Connection test",
  "bad-key": "Wrong key",
  off: "Recording off",
  flooded: "Too many at once",
};

function IngestActivity({ configured }) {
  const { data, reload } = useApi(useCallback(() => api.telemetryActivity(), []));
  // While somebody is looking at this card they are usually mid-test — a
  // driver is joining, or about to cross the line. Twenty seconds is short
  // enough to feel live and long enough that leaving the tab open costs
  // nothing (in-memory counters and a directory listing, nothing parsed).
  useEffect(() => {
    const t = setInterval(reload, 20_000);
    return () => clearInterval(t);
  }, [reload]);

  if (!configured) return null;
  if (!data) return null;

  const scripts = data.scriptsServed || 0;
  const laps = data.lapsArrived || 0;
  const refused =
    (data.outcomes?.["bad-key"]?.count || 0) +
    (data.outcomes?.["lap-refused"]?.count || 0) +
    (data.outcomes?.["script-refused"]?.count || 0) +
    (data.outcomes?.flooded?.count || 0) +
    (data.outcomes?.off?.count || 0);
  // The most recent of them, so the tile does not say "never" while showing a
  // count. Strings, and ISO stamps sort as strings.
  const refusedAt =
    ["bad-key", "lap-refused", "script-refused", "flooded", "off"]
      .map((k) => data.outcomes?.[k]?.lastAt)
      .filter(Boolean)
      .sort()
      .pop() || null;

  // One sentence saying what the numbers mean, because the numbers alone still
  // need somebody who knows the chain to read them.
  const verdict =
    laps > 0
      ? "Laps are arriving. If the comparison below is still empty, it is a season or track question, not a recording one."
      : scripts > 0
        ? "Cars are being handed the script, so the race server and the key are right. Nothing has posted a lap yet — either nobody has set a clean one (four wheels off or the pit lane and it is never sent), or the recorder is failing in the car. That is the Lua debug console's answer, filter nabsTelemetry."
        : refused > 0
          ? "Something is knocking and being turned away. The reasons are listed below — a wrong key means the race server's config and this card have drifted apart."
          : "Nothing has asked for the script and nothing has posted. That points at the race server rather than at the site: the snippet missing, a restart it has not had, or it sitting on the server nobody was driving on.";

  return (
    <div className="card overflow-hidden">
      <CardBar
        title="Is anything arriving?"
        right={
          <button type="button" className="text-sm font-semibold text-light transition hover:text-dark" onClick={reload}>
            Refresh
          </button>
        }
      />
      <div className="space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Script handed to a car" value={scripts} at={data.outcomes?.["script-served"]?.lastAt} />
          <Stat
            label="Laps arrived"
            value={laps}
            at={
              data.outcomes?.["lap-kept"]?.lastAt || data.outcomes?.["lap-slower"]?.lastAt || null
            }
          />
          <Stat label="Turned away" value={refused} tone={refused ? "text-warn" : ""} at={refusedAt} />
        </div>

        <p className="text-sm leading-relaxed text-light">{verdict}</p>

        <p className="text-xs text-faint">
          Counted since the site last restarted (<span title={data.since}>{ago(data.since)}</span>), so an empty
          row means nothing since then rather than nothing ever. On disk right now:{" "}
          <span className="font-semibold text-light">
            {data.stored?.laps ?? 0} {data.stored?.laps === 1 ? "lap" : "laps"}
          </span>{" "}
          in Season {data.season || "?"}
          {data.stored?.newestAt ? `, newest ${ago(data.stored.newestAt)}` : ""}. Opening the script URL in a
          browser counts here too.
        </p>

        {data.events?.length > 0 && (
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {data.events.slice(0, 12).map((e, i) => (
              <div key={`${e.at}-${i}`} className="flex items-baseline gap-3 px-3 py-2 text-xs">
                <span className="font-mono text-[10px] tabular-nums text-faint" title={e.at}>
                  {ago(e.at)}
                </span>
                <span className={`font-semibold ${e.outcome.startsWith("lap-kept") ? "text-ok" : e.outcome.includes("refused") || e.outcome === "bad-key" || e.outcome === "off" || e.outcome === "flooded" ? "text-warn" : "text-light"}`}>
                  {EVENT_LABEL[e.outcome] || e.outcome}
                </span>
                <span className="min-w-0 flex-1 truncate text-light">
                  {[e.name, e.track, e.lapTimeMs ? fmtLap(e.lapTimeMs) : null, e.detail]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Admin → League → Telemetry: everything about laps from inside the car, in
// the order somebody needs it.
//
//   1. record   — mint the key, hand the race server its one line
//   2. check    — is anything actually arriving, and if not, whose end is it
//   3. show     — who may read what was recorded: the stewards, or the league
//   4. read     — the comparison itself
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
              "Every member will be able to open any driver's fastest lap at any track and put their own against it: throttle, brake, steering, and where the time goes. This is the decision the feature has been waiting on. It can be switched back, but the drivers will have seen it.",
            confirmLabel: "Show everyone",
          }
        : {
            title: "Back to admins only?",
            body:
              "The comparison disappears from the members' side. Nothing is deleted and recording carries on, but drivers who have been using it will find it gone.",
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
            Every driver who joins the race server sends their fastest clean laps: throttle, brake,
            steering, speed. Three per track are kept, and when a new season&rsquo;s first lap arrives the
            previous seasons are deleted, because the cars change with the season and their times are
            not something anybody is chasing.
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
                Into <span className="font-mono">csp_extra_options.ini</span>, where the penalty script
                lives. Drivers install nothing. The script shows nothing in the game either, so announce
                the recording in Discord.
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
                every driver: the key only ever adds their own laps, nothing else.
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
                  Key to use (optional, leave blank to make a fresh one)
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
                        "The URL stops working immediately, in every driver's game at once. Switching back on can reuse the same key by typing it into the field. Without it, the race server's config has to be pasted again.",
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

      {/* IS IT WORKING. Directly under the card that switches it on, because
          that is the moment the question comes up — and it is the card whose
          absence cost an evening of guessing. */}
      <IngestActivity configured={!!telIngest?.configured} />

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
        <p className="mt-3 text-xs text-faint">Recording carries on either way.</p>
      </div>

      <TelemetryCompare />
    </div>
  );
}
