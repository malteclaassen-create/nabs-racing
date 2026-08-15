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

// Does this report have anything for the chip to draw? Exported because a
// caller that renders "lap 14" of its own next to the chip has to know: the
// chip carries the lap too, and a row printing it twice is the version of this
// nobody wants.
//
// The component itself bails on this exact call, rather than on a copy of the
// condition — a second copy is a thing that drifts, and the way it drifts is a
// row that reserves space for a chip which then renders nothing, or prints the
// lap twice. It asks the RENDERED values, not the raw ones, so an unusable
// figure (a negative second, an unparseable date) counts as nothing to draw,
// which is what it looks like on screen.
export function hasReplayAnchor(r) {
  if (!r) return false;
  return !!(
    mmss(r.sessionSecond) ||
    leagueClock(r.incidentAt) ||
    r.contactKph != null ||
    r.lap != null ||
    r.contactIndex != null
  );
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
export default function ReplayAnchor({
  second,
  approx = false,
  matched = false,
  at,
  kph,
  lap,
  eventIndex,
  readOnly = false,
  className = "",
}) {
  const [copied, setCopied] = useState(false);
  const into = mmss(second);
  const clock = leagueClock(at);

  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  if (!hasReplayAnchor({ sessionSecond: second, incidentAt: at, contactKph: kph, lap, contactIndex: eventIndex })) {
    return null;
  }

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

  const title = [
    into
      ? `${into} into the session. Drag the replay timeline here.${clock ? ` The league clock read ${clock} (${LEAGUE_TZ}).` : ""}`
      : `The league clock read ${clock} (${LEAGUE_TZ}). Scrub until webPenalty shows this.`,
    // Read off the live board as the report was fired rather than off the round's
    // result file, so it is a second or two rough. Worth saying: a steward who
    // lands a frame early should look, not conclude they have the wrong incident.
    approx && into
      ? "Taken from the live timing while the race was on, so it is good to a second or two. It is replaced by the exact figure once the round's result file is imported."
      : null,
    // An in-game report says when the BUTTON was pressed, which is the incident
    // plus however long the driver took to reach for it. This one was matched
    // to the collision the result file recorded just before that, so the figure
    // is the file's own and the details beside it are what a steward checks the
    // match against.
    matched
      ? "Matched to the contact Assetto Corsa recorded just before the report was sent, so this is the file's own timestamp rather than the moment the button was pressed. The impact speed, lap and event number are that contact's, so check them before acting on the match."
      : null,
    // The number is only useful if the reader knows where to spend it.
    eventIndex != null
      ? `This is entry ${eventIndex} of the round's result file, which is the number replayTools puts in front of the same incident in its own list. Its numbering counts every event in the file, so entries either side of it may be walls or taps.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  // WRAPS, and that is the whole point of the shape.
  //
  // This chip grew: it started as one figure and now carries the position, the
  // lap, the impact speed, the clock and the file's event number. On a desktop
  // that is one comfortable line. On a phone it was one line far wider than the
  // screen, inside a card that clips — so a steward opening a report on their
  // phone saw "· LAP 32" and no time at all, which is the one thing the chip
  // exists to show.
  //
  // So the box wraps and each PART holds together: "22 km/h" never splits
  // across two lines, but the parts after it move down as one. `rounded-2xl`
  // rather than `rounded-full` because a stadium radius on a two-line box curves
  // in far enough to crowd the first character of each line; at one line, at
  // this height, the two are indistinguishable.
  const shell = `inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-2xl border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-medium ${className}`;
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
      {/* No icon. There was one — a play-head, a tick crossing a timeline —
          and it failed twice over: at twelve pixels it drew a plus sign, and
          even drawn correctly it had to be explained, which is a symbol doing
          no work. The figure and the words say all of it, and the box, the
          hover and the pointer already say it can be pressed. */}
      {/* Each part is its own unbreakable token: the box wraps BETWEEN them,
          never inside one, so "22 km/h" and "into the race" always read whole.
          The leading separator travels with the part it belongs to, which is
          what makes a wrapped second line read as a continuation of the first
          rather than as something new. */}
      {into ? (
        <span className="whitespace-nowrap normal-case tracking-normal font-bold text-dark">
          {approx ? `~${into}` : into}
        </span>
      ) : (
        <span className="whitespace-nowrap normal-case tracking-normal font-bold text-dark">{clock}</span>
      )}
      {into && <span className="whitespace-nowrap text-faint">into the race</span>}
      {lap != null && <span className="whitespace-nowrap text-faint">· lap {lap}</span>}
      {kph != null && <span className="whitespace-nowrap text-faint">· {kph} km/h</span>}
      {into && clock && <span className="whitespace-nowrap text-faint">· {clock}</span>}
      {eventIndex != null && <span className="whitespace-nowrap text-faint">· event {eventIndex}</span>}
      {!readOnly && (
        <span role="status" aria-live="polite" className={copied ? "font-bold text-ok" : "sr-only"}>
          {copied ? "copied" : ""}
        </span>
      )}
    </Tag>
  );
}
