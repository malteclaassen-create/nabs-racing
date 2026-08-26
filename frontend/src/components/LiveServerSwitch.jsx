import { useCallback, useState } from "react";
import { api } from "../api/client.js";
import { useVisiblePoll } from "../hooks/useVisiblePoll.js";

// ---------------------------------------------------------------------------
// Which race server the Live page is showing.
//
// The league runs two, and until now a viewer only ever saw the one their
// series is assigned to (admin Live tab). A session on the other one was
// invisible, on the page whose entire job is to say whether anything is
// happening. So this does two things, and the second is the point:
//
//   * it moves the board to the other server, and
//   * it says whether anybody is out there on the one you are not watching.
//
// Both live on the buttons themselves: each one carries its own dot and, when
// cars are out, the count. That keeps the answer where the action is instead of
// spending a banner on it, and it sits in the header row with the other
// controls rather than taking a strip of the page.
//
// The admin assignment stays the DEFAULT. Switching is for this visit only and
// is deliberately not remembered: a member opening the page on race night must
// land on the board the league is actually racing on, not on whatever they
// clicked a fortnight ago.
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

// "NABS Server 2" -> "Server 2". The page is already the NABS live page, and
// the prefix is most of the label's width in a header row that is short of it.
// The full name stays in the tooltip.
const shortName = (name) => String(name || "").replace(/^NABS\s+/i, "");

export function useLiveServers() {
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

  // Below two servers there is nothing to switch between, and a switch with one
  // option is furniture. Same answer when the poll cannot reach the endpoint.
  return servers && servers.servers.length >= 2 ? servers : null;
}

// `current` is the server the board on screen actually came from; before the
// first board arrives it can be null, and then the series' own is what is shown.
const activeKeyOf = (servers, current) => current || servers.defaultKey;

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

// The switch itself, sized to sit in the page header beside the external
// buttons: full width on a phone like its neighbours there, shrink-to-content
// from sm up so it stops stretching across the whole page.
export function LiveServerSwitch({ servers, current, onSwitch }) {
  if (!servers) return null;
  const activeKey = activeKeyOf(servers, current);

  return (
    <div
      role="group"
      aria-label="Race server"
      className="flex w-full items-center gap-1 rounded-xl border border-border bg-card p-1 sm:w-auto"
    >
      {servers.servers.map((s) => {
        const active = s.key === activeKey;
        return (
          <button
            key={s.key}
            type="button"
            aria-pressed={active}
            // Switching back to the series' own server clears the override
            // rather than pinning it, so a later change in the admin tab still
            // reaches this viewer.
            onClick={() => onSwitch(s.isDefault ? null : s.key)}
            title={`${s.name}${s.track ? ` · ${s.track}` : ""} · ${stateLabel(s)}`}
            className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold transition sm:flex-none ${
              active ? "bg-brand text-ink" : "text-medium hover:bg-surface2 hover:text-dark"
            }`}
          >
            <LiveDot server={s} />
            {shortName(s.name)}
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
  );
}
