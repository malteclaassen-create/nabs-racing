// ---------------------------------------------------------------------------
// The season calendar as an iCalendar feed (RFC 5545), served from
// /api/races/calendar.ics so a member can put the rounds in the calendar app
// they already look at every morning.
//
// This is a SUBSCRIPTION, not a one-off download: calendar apps re-fetch the
// same URL on their own schedule, so a round that moves, gains a date or is
// added late reaches every subscriber without anyone doing anything. Two
// consequences run through the whole file:
//
//   * Each event's UID must be stable for the life of the race, or a moved
//     round arrives as a second entry instead of an edit of the first. The
//     race id is exactly that, so the UID is built from it.
//   * The endpoint is polled by machines, repeatedly, forever. It must stay
//     cheap: one query, no per-race lookups, no results tables. That is why
//     the description carries the session format (already on the race row)
//     and not the winner (which would mean loading every result).
//
// Pure and exported for tests. The route (routes/races.js) does the query and
// the caching headers; everything about the FORMAT lives here.
// ---------------------------------------------------------------------------

import { raceKickoff } from "./raceKickoff.js";
import { prettyTrack } from "./pageMeta.js";

// How long to block out in the calendar. The stored row knows the qualifying
// length and the race distance IN LAPS, and a lap count cannot become a
// duration without a lap time, which nothing here has. So the event is a
// deliberate two-hour estimate that covers a normal league evening, and the
// exact format goes in the description where it can be read rather than
// silently believed. Better a round number everybody understands as "the
// evening" than a false precision computed from a guessed lap time.
const EVENT_HOURS = 2;

// The right-hand side of every UID. Deliberately a CONSTANT rather than the
// request's own host: a UID identifies the event, not the address it was
// fetched from. Deriving it from the request would mint different UIDs for
// http and https, for a bare and a www host, and for the dev server, which is
// how one round ends up in somebody's calendar twice.
const UID_HOST = "nabsracing.com";

// Text escaping per RFC 5545 §3.3.11: backslash, semicolon and comma are
// structural in a property value, and a literal newline is written as \n.
// Track names and the admin's free-text info both reach this.
export function icsEscape(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// Content lines are capped at 75 OCTETS (§3.1), continued by CRLF + one space.
// Octets, not characters: a track name with an umlaut or a "·" is multi-byte in
// UTF-8, and folding by character length writes lines that are legal by the
// wrong measure. Splitting mid-character would corrupt it, so the fold walks
// whole characters and breaks before the one that would cross the limit.
export function foldLine(line) {
  const bytes = (s) => Buffer.byteLength(s, "utf8");
  if (bytes(line) <= 75) return line;
  const out = [];
  let cur = "";
  let limit = 75;
  for (const ch of String(line)) {
    if (bytes(cur) + bytes(ch) > limit) {
      out.push(cur);
      cur = " "; // the continuation marker counts towards the next line
      limit = 75;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out.join("\r\n");
}

// 20260824T170000Z. Calendar apps read this as an absolute instant, which is
// what we want: the league races on German time, and a member in another
// country should get the round at their own local hour, not at 19:00 theirs.
export function icsStamp(date) {
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// What the entry is called in a calendar app, where it sits among dentist
// appointments and school runs with no other context. So it leads with the
// league, then says which kind of session and where.
function summaryFor(race) {
  const track = prettyTrack(race.track || "") || "TBA";
  if (race.type === "TRAINING") return `NABS Training: ${track}`;
  if (race.type === "SPECIAL") return `NABS Special: ${track}`;
  return race.number ? `NABS Round ${race.number}: ${track}` : `NABS Race: ${track}`;
}

// The body of the entry: the session format if it was entered, whatever the
// admin typed into the race info, and a link back to the round on the site.
// Kept short, because most calendar apps show it in a cramped panel.
function descriptionFor(race, link) {
  const lines = [];
  const fmt = [];
  if (race.qualiMinutes) fmt.push(`Qualifying ${race.qualiMinutes} min`);
  if (race.raceLaps) fmt.push(`Race ${race.raceLaps} laps`);
  if (fmt.length) lines.push(fmt.join(", "));
  if (race.info) lines.push(String(race.info).trim());
  lines.push("Start time is the league's, converted to your own time zone.");
  if (link) lines.push(link);
  return lines.filter(Boolean).join("\n");
}

// One VEVENT. Returns null for a race with no date: a calendar entry with no
// time is not an entry, and a season always has rounds pencilled in without
// one. They reappear in the feed by themselves once a date is set, because the
// subscription re-reads.
function eventFor(race, { origin, stamp, linkFor, alarmMinutes }) {
  const kick = raceKickoff(race.date);
  if (!kick) return null;
  const start = icsStamp(kick);
  const end = icsStamp(new Date(kick.getTime() + EVENT_HOURS * 3600 * 1000));
  if (!start || !end) return null;

  const link = linkFor ? linkFor(race) : null;
  const url = link ? `${origin}${link}` : null;
  const out = [
    "BEGIN:VEVENT",
    `UID:race-${race.id}@${UID_HOST}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${icsEscape(summaryFor(race))}`,
    `LOCATION:${icsEscape(prettyTrack(race.track || "") || "TBA")}`,
    `DESCRIPTION:${icsEscape(descriptionFor(race, url))}`,
  ];
  if (url) out.push(`URL:${icsEscape(url)}`);
  // A finished round stays in the feed as history, but marked TRANSPARENT so it
  // stops making the subscriber look busy in a free/busy lookup.
  out.push(`TRANSP:${race.isCompleted ? "TRANSPARENT" : "OPAQUE"}`);
  out.push(`STATUS:${race.isCompleted ? "CONFIRMED" : "TENTATIVE"}`);
  // A reminder on a race that has already been run would be absurd, so the
  // alarm rides only on rounds still ahead.
  if (alarmMinutes && !race.isCompleted) {
    out.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${icsEscape(summaryFor(race))}`,
      `TRIGGER:-PT${alarmMinutes}M`,
      "END:VALARM"
    );
  }
  out.push("END:VEVENT");
  return out;
}

// The whole feed. `now` is injectable so a test does not depend on the clock.
//
// X-WR-CALNAME and X-WR-CALDESC are not in the RFC but are what Google
// Calendar, Apple Calendar and Outlook all read to name a subscribed calendar;
// without them the subscription shows up named after its URL.
// REFRESH-INTERVAL is the standard hint (RFC 7986) and X-PUBLISHED-TTL is
// Outlook's older spelling of the same thing, so both are written.
export function buildRaceCalendar(races, { origin, calName, calDesc, now = new Date(), linkFor = null, alarmMinutes = 60 } = {}) {
  const stamp = icsStamp(now);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//NABS Racing League//Race calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(calName || "NABS Racing League")}`,
    `X-WR-CALDESC:${icsEscape(calDesc || "Race calendar")}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT12H",
    "X-PUBLISHED-TTL:PT12H",
  ];
  for (const race of races || []) {
    const ev = eventFor(race, { origin, stamp, linkFor, alarmMinutes });
    if (ev) lines.push(...ev);
  }
  lines.push("END:VCALENDAR");

  // CRLF between lines and a trailing one, both required by §3.1.
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
