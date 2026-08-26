import { useCallback, useState } from "react";
import { api } from "../api/client.js";
import { useVisiblePoll } from "../hooks/useVisiblePoll.js";

// ---------------------------------------------------------------------------
// Which race server the Live page is showing.
//
// The league runs two, and until now a viewer only ever saw the one their
// series is assigned to (admin Live tab). A session on the other one was
// invisible — on the page whose entire job is to say whether anything is
// happening. So the switch does two things, and the second is the point:
//
//   * it moves the board to the other server, and
//   * it says, on the button itself, whether anybody is out there.
//
// The assignment stays the DEFAULT. Switching is for this visit only and is
// deliberately not remembered: a member opening the page on race night must
// land on the board the league is actually racing on, not on whatever they
// clicked a fortnight ago.
//
// It hides itself when there is only one server, or when the poll cannot
// answer. A switch with one option is furniture.
// ---------------------------------------------------------------------------

const POLL_MS = 15_000;

// Three states, and which one a server is in decides everything below.
//
// DRIVING is the one that matters and the one the switch exists for, and it is
// deliberately read off the cars, not off the relay's health: `onTrack` counts
// entries the server says are out there, where `live` also depends on the
// staleness flag, which flips back and forth on a quiet server between its
// ~30-second snapshots. Watching that flag made the dot blink on and off with
// nothing happening on track, which is worse than no dot.
//
// SESSION means a track is loaded and the server is idling on it. Worth
// showing, not worth a green light.
const driving = (s) => (s?.onTrack || 0) > 0;
const hasSession = (s) => !!s?.session;

// A ring rather than a plain circle: this mark has to survive being 8px wide on
// a phone, next to a name, in both themes. Only the driving one animates, and
// lite/reduced-motion still leave the colour, which is the fact.
function LiveDot({ server }) {
  if (driving(server)) {
    return (
      <span aria-hidden className="relative flex h-2 w-2 shrink-0">
        <span className="live-dot absolute inline-flex h-full w-full rounded-full bg-ok opacity-70" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
      </span>
    );
  }
  if (hasSession(server)) return <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-warn/70" />;
  return <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-faint" />;
}

// What a viewer wants off this button is whether it is worth pressing, so the
// busiest true thing wins.
function stateLabel(s) {
  if (driving(s)) return `${s.onTrack} on track`;
  if (hasSession(s)) return `${s.session || "session"} loaded, nobody out`;
  return "quiet";
}

export default function LiveServerSwitch({ current, onSwitch }) {
  const [servers, setServers] = useState(null);

  useVisiblePoll(
    useCallback((alive) => {
      api
        .liveServers()
        .then((d) => alive() && setServers(d?.servers?.length ? d : null))
        .catch(() => {});
    }, []),
    POLL_MS,
    true
  );

  if (!servers || servers.servers.length < 2) return null;

  // `current` is null until the viewer switches: that is the series' own server,
  // which the backend named for us.
  const activeKey = current || servers.defaultKey;
  // Worth interrupting someone for: cars are out on the board they are NOT
  // looking at. A merely loaded session on the other server is on its own dot
  // already and does not earn a sentence.
  const elsewhere = servers.servers.find((s) => s.key !== activeKey && driving(s));

  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="group"
        aria-label="Race server"
        className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-card p-1"
      >
        {servers.servers.map((s) => {
          const active = s.key === activeKey;
          return (
            <button
              key={s.key}
              type="button"
              aria-pressed={active}
              // Switching back to the series' own server clears the override
              // rather than pinning it, so a later change in the admin tab
              // still reaches this viewer.
              onClick={() => onSwitch(s.isDefault ? null : s.key)}
              title={`${s.name}${s.track ? ` · ${s.track}` : ""} · ${stateLabel(s)}`}
              className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                active ? "bg-brand text-ink" : "text-medium hover:bg-surface2 hover:text-dark"
              }`}
            >
              <LiveDot server={s} />
              <span className="whitespace-nowrap">{s.name}</span>
              {driving(s) && (
                <span
                  className={`rounded px-1 font-mono text-[10px] tabular-nums ${
                    active ? "bg-ink/15 text-ink" : "bg-ok/15 text-ok"
                  }`}
                >
                  {s.onTrack}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {/* Said in words as well as in a dot, because the dot is small and the
          fact is the whole point: there is a session on the board you are not
          looking at. One tap away, and the sentence says which tap. */}
      {elsewhere && (
        <button
          type="button"
          onClick={() => onSwitch(elsewhere.isDefault ? null : elsewhere.key)}
          className="self-start text-left text-xs font-semibold text-ok underline decoration-dotted underline-offset-2 transition hover:text-dark"
        >
          {elsewhere.onTrack} out on track on {elsewhere.name}
          {elsewhere.track ? ` (${elsewhere.track})` : ""}. Switch over.
        </button>
      )}
    </div>
  );
}
