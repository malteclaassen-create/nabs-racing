import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageCircle, Play, Square } from "lucide-react";
import { api } from "../api/client.js";
import { CardHead, ErrorBox, HelpNote, Notice, TeamDot } from "./ui.jsx";
import { copyText } from "../utils/copyText.js";

// Admin -> Attendance -> Briefing: who said they're in for the race but isn't
// in the briefing channel yet. The bot tells the site who sits in there, one
// channel for every series, so this looks across all series.

// fast while the bot is watching (somebody joins, the list should move right
// away), slow otherwise, just enough to notice the briefing starting
const LIVE_MS = 3_000;
const IDLE_MS = 15_000;

const when = (iso) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : "date TBA";

const raceLabel = (r) => `${r.series.name} · ${r.type === "TRAINING" ? "Training" : `R${r.number}`} ${r.track} · ${when(r.kickoff)}`;

const clock = (iso) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

function ago(iso, now) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

// the race whose start is closest to now, that's the one being briefed
function closestRace(races, now) {
  let best = null;
  for (const r of races) {
    if (!r.kickoff) continue;
    const gap = Math.abs(new Date(r.kickoff).getTime() - now);
    if (!best || gap < best.gap) best = { id: r.id, gap };
  }
  return best?.id || races[0]?.id || "";
}

function Row({ d }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
      <TeamDot color={d.teamColor || "var(--c-border)"} />
      <span className="min-w-0 flex-1 truncate font-semibold text-dark">{d.name}</span>
      <span className="hidden truncate text-xs text-light sm:inline">{d.team}</span>
      {d.discordName && <span className="font-mono text-xs text-medium">@{d.discordName}</span>}
      {d.discordUserId && (
        <span className="inline-flex items-center gap-2">
          {/* opens the Discord app on their profile, "Message" is one click from there */}
          <a
            href={`discord://-/users/${d.discordUserId}`}
            title={`Open ${d.name} in the Discord app to send a DM`}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-semibold text-link transition hover:border-[var(--c-primary)]"
          >
            <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
            DM
          </a>
          <a
            href={`https://discord.com/users/${d.discordUserId}`}
            target="_blank"
            rel="noreferrer"
            title="No Discord app on this computer? The same in the browser"
            className="text-xs text-light hover:text-link hover:underline"
          >
            web
          </a>
        </span>
      )}
    </li>
  );
}

const names = (list) => list.map((m) => m.name || m.discordName || m.discordId).join(", ");

export default function AdminAttendanceBriefing() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [raceId, setRaceId] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(null);
  const [fallbackText, setFallbackText] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .adminBriefing()
      .then((d) => {
        setData(d);
        setError(null);
        setNow(Date.now());
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(load, [load]);
  // keeps itself fresh while the tab is open, pauses in a background tab
  const live = !!data?.room?.watching || !!data?.manualUntil;
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
      else setNow(Date.now());
    }, live ? LIVE_MS : IDLE_MS);
    return () => clearInterval(t);
  }, [load, live]);

  const races = useMemo(() => data?.races || [], [data]);
  useEffect(() => {
    if (races.length && !races.some((r) => r.id === raceId)) setRaceId(closestRace(races, Date.now()));
  }, [races, raceId]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 4000);
    return () => clearTimeout(t);
  }, [copied]);

  async function setWatch(on) {
    setBusy(true);
    try {
      const r = await api.adminBriefingWatch(on);
      setData((d) => d && { ...d, manualUntil: r.manualUntil });
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function copy(text, what) {
    setFallbackText(null);
    if (await copyText(text)) setCopied(`Copied ${what} to the clipboard.`);
    else setFallbackText(text);
  }

  const race = races.find((r) => r.id === raceId) || null;
  const room = data?.room || null;
  const watching = !!room?.watching;
  const win = data?.window || { beforeMin: 5, afterMin: 60 };
  const opensAt = race?.kickoff ? new Date(race.kickoff).getTime() - win.beforeMin * 60_000 : null;
  const manualUntil = data?.manualUntil || null;
  const manualMin = data?.manualMin || 60;
  // pressed a while ago and the bot still hasn't said anything
  const botSilent = manualUntil && !watching && new Date(manualUntil).getTime() - manualMin * 60_000 < now - 2 * 60_000;
  const channel = room?.channelName ? `#${room.channelName}` : "the briefing channel";
  const pingable = race ? race.missing.filter((d) => d.discordUserId) : [];

  return (
    <div className="card space-y-4 p-5">
      <CardHead eyebrow="Discord" title="Briefing" />
      <p className="text-sm text-light">
        Who is in for the race but not in the briefing channel yet, so you know who to DM. Updates by itself.
      </p>
      <HelpNote label="Where this comes from">
        <ul className="space-y-1">
          <li>
            The Discord bot looks at the briefing channel from {win.beforeMin} minutes before a race&rsquo;s start until{" "}
            {win.afterMin} minutes after, and not at all the rest of the week.
          </li>
          <li>
            <strong className="font-semibold text-medium">Start now</strong> makes it look straight away, for the next{" "}
            {manualMin} minutes. The bot notices within a minute.
          </li>
          <li>&ldquo;In for the race&rdquo; means they pressed Accept on the attendance page (or you did it for them).</li>
          <li>One briefing channel for every series, so the list covers the next races of all of them.</li>
          <li>Somebody with no Discord login linked can&rsquo;t be matched, they show up under &ldquo;Can&rsquo;t check&rdquo;.</li>
        </ul>
      </HelpNote>

      {error && <ErrorBox message={error} onRetry={load} />}
      {!data && !error && <p className="text-sm text-light">Loading…</p>}

      {data && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="min-w-0 text-sm text-medium">
            {watching ? (
              <>
                {room.count === 0 ? (
                  <>Nobody in {channel} right now.</>
                ) : (
                  <>
                    <span className="font-semibold text-dark">{room.count}</span> in {channel}
                  </>
                )}
                <span className="text-light"> · bot update {ago(room.at, now)}</span>
                {manualUntil && <span className="text-light"> · started by hand, runs till {clock(manualUntil)}</span>}
              </>
            ) : manualUntil ? (
              <>Starting. The bot picks it up within a minute.</>
            ) : (
              <>
                The bot isn&rsquo;t looking at the briefing channel right now. It starts {win.beforeMin} minutes before a
                race&rsquo;s start
                {opensAt && opensAt > now ? (
                  <>
                    , for this race at <span className="font-semibold text-dark">{when(new Date(opensAt).toISOString())}</span>
                  </>
                ) : null}
                .
              </>
            )}
          </p>
          {manualUntil ? (
            <button type="button" className="btn-secondary inline-flex items-center gap-1.5 py-1.5 text-xs" disabled={busy} onClick={() => setWatch(false)}>
              <Square className="h-3.5 w-3.5" aria-hidden="true" />
              Stop
            </button>
          ) : (
            !watching && (
              <button
                type="button"
                className="btn-secondary inline-flex items-center gap-1.5 py-1.5 text-xs"
                disabled={busy}
                title={`The bot looks at the briefing channel for the next ${manualMin} minutes`}
                onClick={() => setWatch(true)}
              >
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
                Start now
              </button>
            )
          )}
        </div>
      )}
      {botSilent && (
        <Notice kind="warn">The bot hasn&rsquo;t picked it up yet. It may be offline or on an older version.</Notice>
      )}
      {watching && room.stale && room.count > 0 && (
        <Notice kind="warn">
          The bot has gone quiet for a few minutes. It may be offline, so this list could be out of date.
        </Notice>
      )}

      {data && races.length === 0 && <p className="text-sm text-light">No upcoming race in any series.</p>}

      {races.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="briefing-race" className="text-sm font-semibold text-medium">
            Race
          </label>
          <select id="briefing-race" className="input max-w-md" value={raceId} onChange={(e) => setRaceId(e.target.value)}>
            {races.map((r) => (
              <option key={r.id} value={r.id}>
                {raceLabel(r)}
              </option>
            ))}
          </select>
        </div>
      )}

      {copied && <Notice kind="success">{copied}</Notice>}
      {fallbackText && (
        <textarea
          aria-label="Text to copy"
          className="input h-24 font-mono text-xs"
          readOnly
          value={fallbackText}
          onFocus={(e) => e.target.select()}
          key={fallbackText}
          autoFocus
        />
      )}

      {race && (
        <>
          <p className="text-sm text-medium">
            {watching ? (
              <>
                <span className="font-semibold text-dark">
                  {race.present.length} of {race.onGrid}
                </span>{" "}
                on the grid are in the briefing.
              </>
            ) : (
              <>
                <span className="font-semibold text-dark">{race.onGrid}</span> in for this race.
              </>
            )}
          </p>

          {watching && (
          <div className="border-t border-border pt-4">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">
                Not in the briefing <span className="text-light">({race.missing.length})</span>
              </h3>
              {race.missing.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn-secondary py-1.5 text-xs disabled:opacity-40"
                    disabled={!pingable.length}
                    title="Ready-made @mentions to paste into a Discord channel"
                    onClick={() =>
                      copy(pingable.map((d) => `<@${d.discordUserId}>`).join(" "), `${pingable.length} mention${pingable.length === 1 ? "" : "s"}`)
                    }
                  >
                    Copy @mentions
                  </button>
                  <button
                    className="btn-secondary py-1.5 text-xs"
                    title="The Discord handles, comma separated"
                    onClick={() =>
                      copy(
                        race.missing.map((d) => d.discordName || d.name).join(", "),
                        `${race.missing.length} handle${race.missing.length === 1 ? "" : "s"}`
                      )
                    }
                  >
                    Copy handles
                  </button>
                </div>
              )}
            </div>
            {race.missing.length === 0 ? (
              <p className="mt-2 text-sm text-ok">
                {race.onGrid ? "Everyone who is in for this race is in the briefing." : "Nobody has accepted this race yet."}
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-border border-y border-border">
                {race.missing.map((d) => (
                  <Row key={d.driverId} d={d} />
                ))}
              </ul>
            )}
          </div>
          )}

          {race.unlinked.length > 0 && (
            <div className="border-t border-border pt-4">
              <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">
                Can&rsquo;t check <span className="text-light">({race.unlinked.length})</span>
              </h3>
              <p className="mt-0.5 text-xs text-light">
                In for the race, but no Discord login is linked, so the bot can&rsquo;t tell if they&rsquo;re there. Look for them by hand, or link them in the Drivers tab.
              </p>
              <ul className="mt-2 divide-y divide-border border-y border-border">
                {race.unlinked.map((d) => (
                  <Row key={d.driverId} d={d} />
                ))}
              </ul>
            </div>
          )}

          {watching && (race.present.length > 0 || race.extras.length > 0) && (
            <div className="space-y-1 border-t border-border pt-4 text-sm">
              {race.present.length > 0 && (
                <p className="text-light">
                  <span className="font-semibold text-medium">In the briefing:</span> {names(race.present)}
                </p>
              )}
              {race.extras.length > 0 && (
                <p className="text-light">
                  <span className="font-semibold text-medium">Also there, not on this grid:</span> {names(race.extras)}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
