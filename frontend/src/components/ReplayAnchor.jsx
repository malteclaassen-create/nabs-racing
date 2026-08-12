import { useEffect, useState } from "react";

// Where in the replay an incident is, as one clickable chip.
//
// A steward's job on a report is to go and WATCH the moment, and until this
// existed the only help on offer was a wall clock rendered in the reader's own
// browser timezone, buried inside the opened report. That number depends on
// which country the admin is sitting in, on which country the server is in,
// and on what the game's clock was set to — three chances to send somebody two
// hours down the wrong end of a replay.
//
// `second` is the honest anchor: how far into the session it happened. It is
// the same number whoever reads it and wherever they are, and it is the number
// Assetto Corsa's own replay timeline is measured in, so it can be dragged to
// directly. That is why it leads, and why it is what the click copies.
//
// The wall clock stays as a second opinion, pinned to the league's own timezone
// and labelled with it, for the admin who is scrubbing by webPenalty's on-screen
// clock instead of by the timeline.

// The league races on German evenings, and the in-game app's clock is read by
// people sitting in that timezone. Fixing it here means the figure on screen
// does not change depending on who opens the report.
const LEAGUE_TZ = "Europe/Berlin";

export function mmss(totalSeconds) {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) return null;
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  // Past an hour a bare "72:14" stops reading as a time at all.
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function leagueClock(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: LEAGUE_TZ,
    });
  } catch {
    return null;
  }
}

// `second` — seconds into the session (preferred). `at` — ISO moment.
// `kph` — impact speed when the report was pinned to a recorded contact.
// Renders nothing at all when there is no anchor of either kind.
//
// `readOnly` drops the copy behaviour and renders a plain span. The report LIST
// needs that: each row is itself one big button, and a button inside a button
// is invalid HTML that breaks tab order and confuses screen readers. In the
// list the chip is there to be READ while triaging a round; the copy lives in
// the opened report, one click further on, where it can be a real button.
export default function ReplayAnchor({ second, at, kph, lap, readOnly = false, className = "" }) {
  const [copied, setCopied] = useState(false);
  const into = mmss(second);
  const clock = leagueClock(at);

  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  if (!into && !clock && kph == null && lap == null) return null;

  // Copy the timeline figure when there is one, else the clock: whichever is
  // actually usable is what lands on the clipboard.
  const payload = into || clock;

  async function copy() {
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
    } catch {
      window.prompt("Copy it:", payload);
    }
  }

  const title = into
    ? `${into} into the session. Drag the replay timeline here.${clock ? ` The league clock read ${clock} (${LEAGUE_TZ}).` : ""}`
    : `The league clock read ${clock} (${LEAGUE_TZ}). Scrub until webPenalty shows this.`;

  const shell = `inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-medium ${className}`;
  const Tag = readOnly ? "span" : "button";
  const interactive = readOnly
    ? { title }
    : {
        type: "button",
        onClick: copy,
        title,
        "aria-label": `Copy the replay position ${payload}`,
      };

  return (
    <Tag {...interactive} className={readOnly ? shell : `${shell} transition hover:border-brand/50 hover:text-dark`}>
      {/* play-head on a timeline */}
      <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0 text-brand" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M3 12h18M9 8v8" />
      </svg>
      {into ? (
        <span className="normal-case tracking-normal font-bold text-dark">{into}</span>
      ) : (
        <span className="normal-case tracking-normal font-bold text-dark">{clock}</span>
      )}
      {into && <span className="text-faint">into the race</span>}
      {lap != null && <span className="text-faint">· lap {lap}</span>}
      {kph != null && <span className="text-faint">· {kph} km/h</span>}
      {into && clock && <span className="text-faint">· {clock}</span>}
      {!readOnly && (
        <span role="status" aria-live="polite" className={copied ? "font-bold text-ok" : "sr-only"}>
          {copied ? "copied" : ""}
        </span>
      )}
    </Tag>
  );
}
