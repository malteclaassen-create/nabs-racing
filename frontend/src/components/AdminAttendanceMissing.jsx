import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { CardHead, ErrorBox, Notice, TeamDot } from "./ui.jsx";
import Flag from "./Flag.jsx";
import { flagFor } from "../data/circuits.js";
import { fmtDateShort } from "../utils/format.js";

// Admin → Attendance → "Still to answer": the roster minus the answers, for one
// upcoming race.
//
// Everything else about attendance is built from sign-up rows, and silence
// leaves no row — so "who has not answered" is the one question the sign-up
// lists structurally cannot show. It is also the question the admin acts on:
// the day before a race you don't chase the people who said yes.
//
// Full-timers and reserves are kept apart because they mean different things. A
// Tier-1/2 driver saying nothing is a hole in the grid; a reserve saying nothing
// is a reserve who isn't needed. The reserve pool is usually the larger half of
// the roster by far, so it stays folded away until asked for.

const fmtDate = (d) => (d ? fmtDateShort(d) : "date TBA");

// A single chased driver. The Discord handle is what an admin types into the
// search box to open a DM, so it sits right next to the name rather than behind
// a hover. The team colour makes the grouping visible without reading: a run of
// the same dot is a car with nobody in it.
function DriverRow({ d }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5 text-sm">
      <TeamDot color={d.teamColor || "var(--c-border)"} />
      <span className="min-w-0 flex-1 truncate font-semibold text-dark">{d.name}</span>
      <span className="truncate text-xs text-light">{d.team}</span>
      <span className="font-mono text-xs text-medium">@{d.discordName}</span>
      {!d.discordUserId && (
        <span
          className="pill bg-surface2 text-faint"
          title="No Discord login is linked to this driver, so a paste-in mention would not reach them. Link their account in the Drivers tab."
        >
          no login
        </span>
      )}
    </li>
  );
}

// One group (full-timers or reserves) with its two copy buttons. `collapsible`
// folds the reserves away — sixty-odd names above the ten that matter would
// bury them.
function Group({ title, hint, people, collapsible = false, onCopy }) {
  const [open, setOpen] = useState(!collapsible);
  const pingable = people.filter((d) => d.discordUserId);

  return (
    <div className="border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">
            {title} <span className="text-light">({people.length})</span>
          </h3>
          <p className="mt-0.5 text-xs text-light">{hint}</p>
        </div>
        {people.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-secondary py-1.5 text-xs"
              title="The Discord handles, comma separated. Paste one into Discord's search to open a DM."
              onClick={() => onCopy(people.map((d) => d.discordName).join(", "), `${people.length} handle${people.length === 1 ? "" : "s"}`)}
            >
              Copy handles
            </button>
            <button
              className="btn-secondary py-1.5 text-xs disabled:opacity-40"
              disabled={pingable.length === 0}
              title={
                pingable.length
                  ? "Ready-made @mentions. Paste them into a Discord channel to ping everyone on this list at once."
                  : "Nobody on this list has a linked Discord login, so there is nothing to mention."
              }
              onClick={() =>
                onCopy(
                  pingable.map((d) => `<@${d.discordUserId}>`).join(" "),
                  `${pingable.length} mention${pingable.length === 1 ? "" : "s"}`
                )
              }
            >
              Copy @mentions{pingable.length !== people.length ? ` (${pingable.length})` : ""}
            </button>
            {collapsible && (
              <button className="btn-secondary py-1.5 text-xs" onClick={() => setOpen((o) => !o)}>
                {open ? "Hide list" : "Show list"}
              </button>
            )}
          </div>
        )}
      </div>

      {people.length === 0 ? (
        <p className="mt-2 text-sm text-ok">Everyone has answered.</p>
      ) : (
        open && (
          <ul className="mt-2 divide-y divide-border border-y border-border">
            {people.map((d) => (
              <DriverRow key={d.driverId} d={d} />
            ))}
          </ul>
        )
      )}
    </div>
  );
}

// `races` are the upcoming rounds the parent already loaded for its other
// views — asking for them a second time here would only mean the two lists
// could disagree.
export default function AdminAttendanceMissing({ races = [], racesError = null, onReloadRaces }) {
  // A hidden race is off the attendance page and sends no reminders, so nobody
  // is expected to have answered it and chasing them would be nonsense.
  const upcoming = useMemo(() => races.filter((r) => !r.hidden), [races]);
  const [raceId, setRaceId] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(null);
  // Set only when the browser refused to copy for us — see copy() below.
  const [fallbackText, setFallbackText] = useState(null);

  // Start on the next round — the one the attendance page is showing.
  useEffect(() => {
    if (!raceId && upcoming.length) setRaceId(upcoming[0].id);
  }, [upcoming, raceId]);

  const load = useCallback(() => {
    if (!raceId) return;
    setLoading(true);
    setError(null);
    api
      .attendanceMissing(raceId)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [raceId]);
  useEffect(load, [load]);

  // Copying is the whole point of the two buttons, so it gets a way out at
  // every step: the modern clipboard API, then the old execCommand one (no
  // permission needed), and if a browser refuses both, the text itself in a
  // selected box. "It didn't copy and here is why" would leave the admin
  // retyping thirty handles.
  async function copy(text, what) {
    setError(null);
    setFallbackText(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(`Copied ${what} to the clipboard.`);
      return;
    } catch {
      /* no clipboard permission — try the old way below */
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) {
        setCopied(`Copied ${what} to the clipboard.`);
        return;
      }
    } catch {
      /* fall through to showing the text */
    }
    setFallbackText(text);
  }
  // The confirmation is a moment's feedback, not a message to dismiss.
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 4000);
    return () => clearTimeout(t);
  }, [copied]);

  const race = upcoming.find((r) => r.id === raceId) || null;
  const selectedCircuit = race ? flagFor(race.track, race.country) : null;
  // Sign-up not open yet means nobody COULD have answered — the list would be
  // the whole roster and mean nothing, so say that instead of implying they are
  // all late.
  const notOpenYet = race?.attendanceOpensAt && new Date(race.attendanceOpensAt) > new Date();

  return (
    <div className="card space-y-4 p-5">
      <CardHead eyebrow="Attendance page" title="Still to answer" />
      <p className="text-sm text-light">
        Who is on this season&rsquo;s roster and has not touched the sign-up for the round below, so you know who to
        chase. Someone who answered and then cleared their answer counts as silent again, and drivers you have
        deactivated are left out.
      </p>

      {racesError && <ErrorBox message={racesError} onRetry={onReloadRaces} />}

      {/* One dropdown rather than a button per round: a full season is twelve
          chips, which wrapped into three rows of decoration above the list you
          actually came for. It opens on the next race, which is the answer
          almost every time. */}
      {upcoming.length === 0 ? (
        <p className="text-sm text-light">No upcoming race on the attendance page in this series.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="missing-race" className="text-sm font-semibold text-medium">
            Race
          </label>
          {/* The flag stays, next to the picker instead of inside it — a native
              option list can only hold text. */}
          {selectedCircuit && <Flag code={selectedCircuit.country} w={20} h={15} />}
          <select
            id="missing-race"
            className="input max-w-sm"
            value={raceId}
            onChange={(e) => setRaceId(e.target.value)}
          >
            {upcoming.map((e) => (
              <option key={e.id} value={e.id}>
                {e.type === "TRAINING" ? "Training" : `R${e.number}`} {e.track} · {fmtDate(e.date)}
                {e.id === upcoming[0].id ? " (next)" : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && <ErrorBox message={error} onRetry={load} />}
      {copied && <Notice kind="success">{copied}</Notice>}

      {fallbackText && (
        <div className="space-y-1.5">
          <p className="text-sm text-light">
            This browser wouldn&rsquo;t let the page use the clipboard. Here is the text instead, ready to select and
            copy.
          </p>
          <textarea
            aria-label="Text to copy"
            className="input h-24 font-mono text-xs"
            readOnly
            value={fallbackText}
            onFocus={(e) => e.target.select()}
            // Remounted per text so the autoFocus fires again for a second copy;
            // an inline ref that selects on every render would fight the cursor.
            key={fallbackText}
            autoFocus
          />
        </div>
      )}

      {notOpenYet && (
        <Notice kind="info">
          Sign-up for this round hasn&rsquo;t opened yet, so nobody has had the chance to answer. The lists below are
          simply the whole roster until it opens.
        </Notice>
      )}

      {loading && !data && <p className="text-sm text-light">Loading…</p>}

      {data && (
        <>
          <p className="text-sm text-medium">
            <span className="font-semibold text-dark">
              {data.counts.fullTime - data.missing.fullTime.length} of {data.counts.fullTime}
            </span>{" "}
            full-time drivers have answered
            {data.counts.reserve > 0 && (
              <>
                {" "}
                · <span className="font-semibold text-dark">
                  {data.counts.reserve - data.missing.reserve.length} of {data.counts.reserve}
                </span>{" "}
                reserves
              </>
            )}
            .
          </p>

          <Group
            title="Full-time drivers"
            hint="The seats the grid is planned around. Tier 1 first, then Tier 2, teammates together."
            people={data.missing.fullTime}
            onCopy={copy}
          />
          <Group
            title="Reserves"
            hint="The reserve pool. Most of them will never answer a round they aren't needed for, so treat this as a list of who you could still ask."
            people={data.missing.reserve}
            collapsible
            onCopy={copy}
          />
        </>
      )}
    </div>
  );
}
