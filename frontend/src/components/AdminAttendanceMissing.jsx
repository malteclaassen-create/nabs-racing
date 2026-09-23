import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, X, CircleHelp } from "lucide-react";
import { api } from "../api/client.js";
import { CardHead, ErrorBox, HelpNote, Notice, TeamDot } from "./ui.jsx";
import { useAsk } from "./overlay.jsx";
import Flag from "./Flag.jsx";
import { flagFor } from "../data/circuits.js";
import { fmtDateShort } from "../utils/format.js";
import { useAttendanceReminder, LastReminder } from "./AdminAttendanceReminder.jsx";

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
//
// Chasing usually ends in a Discord DM that says "can't make it" or "I'm in".
// Until now the admin then had to find that person on the Grid view, which only
// lists people who HAVE answered — so the answer could not be written down at
// all. The In / Out / Maybe buttons on each row close that loop where the name
// already is, and the row leaves the list once it has an answer.

const fmtDate = (d) => (d ? fmtDateShort(d) : "date TBA");
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The three answers a member can give, in the order the sign-up page shows
// them. Only the ones the league currently offers are shown (the race carries
// that list): an answer switched off in the Notifications tab is gone for
// members, and an admin filing it anyway would put somebody in a column the
// page no longer draws.
const ANSWERS = [
  { key: "ACCEPTED", Icon: Check, label: "In", className: "text-ok hover:border-green-600/60" },
  { key: "DECLINED", Icon: X, label: "Out", className: "text-bad hover:border-red-600/60" },
  { key: "TENTATIVE", Icon: CircleHelp, label: "Maybe", className: "text-warn hover:border-amber-500/60" },
];

// A single chased driver. The Discord handle is what an admin types into the
// search box to open a DM, so it sits right next to the name rather than behind
// a hover. The team colour makes the grouping visible without reading: a run of
// the same dot is a car with nobody in it.
function DriverRow({ d, answers, selected, onSelect, onAnswer, busy, error }) {
  return (
    <li className="py-1.5 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <input
          type="checkbox"
          aria-label={`Select ${d.name}`}
          className="h-4 w-4 shrink-0 accent-[var(--c-primary)] disabled:opacity-50"
          checked={selected}
          disabled={busy}
          onChange={() => onSelect(d.driverId)}
        />
        <TeamDot color={d.teamColor || "var(--c-border)"} />
        <span className="min-w-0 flex-1 truncate font-semibold text-dark">{d.name}</span>
        <span className="hidden truncate text-xs text-light sm:inline">{d.team}</span>
        <span className="font-mono text-xs text-medium">@{d.discordName}</span>
        {!d.discordUserId ? (
          <span
            className="pill bg-surface2 text-faint"
            title="No Discord login is linked to this driver, so a paste-in mention would not reach them and neither does the reminder. Link their account in the Drivers tab."
          >
            no login
          </span>
        ) : (
          d.canNotify === false && (
            <span
              className="pill bg-surface2 text-faint"
              title="Their Discord account is known, so an @mention works, but they have never signed in on the site: the reminder has no bell to ring."
            >
              never signed in
            </span>
          )
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {answers.map((a) => (
            <button
              key={a.key}
              type="button"
              aria-label={`Mark ${d.name} as ${a.label.toLowerCase()}`}
              title={`Answer "${a.label}" for ${d.name}`}
              disabled={busy}
              onClick={() => onAnswer(d, a.key)}
              className={`inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-semibold transition disabled:opacity-40 ${a.className}`}
            >
              <a.Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {a.label}
            </button>
          ))}
        </span>
      </div>
      {error && (
        <p role="alert" className="mt-1 pl-7 text-xs font-semibold text-bad">
          {error}
        </p>
      )}
    </li>
  );
}

// One group (full-timers or reserves) with its two copy buttons. `collapsible`
// folds the reserves away — sixty-odd names above the ten that matter would
// bury them.
function Group({ title, hint, people, collapsible = false, onCopy, rowProps, selected, onSelectAll }) {
  const [open, setOpen] = useState(!collapsible);
  const pingable = people.filter((d) => d.discordUserId);
  const allOn = people.length > 0 && people.every((d) => selected.has(d.driverId));

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
            {/* Selecting a folded list would pick names the admin cannot see,
                so "select all" only exists while the list is open. */}
            {open && (
              <button
                className="btn-secondary py-1.5 text-xs"
                aria-pressed={allOn}
                onClick={() => onSelectAll(people.map((d) => d.driverId), !allOn)}
              >
                {allOn ? "Deselect all" : "Select all"}
              </button>
            )}
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
              <DriverRow key={d.driverId} d={d} {...rowProps(d)} />
            ))}
          </ul>
        )
      )}
    </div>
  );
}

// `races` are the upcoming rounds the parent already loaded for its other
// views — asking for them a second time here would only mean the two lists
// could disagree. `onReloadRaces` is how an answer given here reaches the
// grid count the "In" button checks against.
export default function AdminAttendanceMissing({ races = [], racesError = null, onReloadRaces }) {
  const ask = useAsk();
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
  // What the row buttons and the bulk bar are doing: which rows are ticked,
  // which are being saved, and what went wrong on which row. An error stays on
  // the row it belongs to — one refused answer in a bulk of twelve must not
  // read as the whole batch failing.
  const [selected, setSelected] = useState(() => new Set());
  const [saving, setSaving] = useState(() => new Set());
  const [rowErrors, setRowErrors] = useState({});
  const [progress, setProgress] = useState(null);
  const [done, setDone] = useState(null);
  const { remind, busyId: reminding } = useAttendanceReminder();
  const [pings, setPings] = useState({});
  useEffect(() => {
    api.adminAttendancePings().then(setPings).catch(() => {});
  }, []);

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
  // Ticks and row errors belong to one race's list.
  useEffect(() => {
    setSelected(new Set());
    setRowErrors({});
    setDone(null);
  }, [raceId]);

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
  const raceName = race ? `${race.type === "TRAINING" ? "the training session" : `Round ${race.number}`} at ${race.track}` : "";
  const answers = ANSWERS.filter(
    (a) => !Array.isArray(race?.visibleStatuses) || race.visibleStatuses.includes(a.key)
  );
  const everyone = useMemo(
    () => (data ? [...data.missing.fullTime, ...data.missing.reserve] : []),
    [data]
  );
  const picked = everyone.filter((d) => selected.has(d.driverId));

  // "In" on a full grid. The server lets an admin past the grid size on
  // purpose (see the Grid view), so it will not refuse — which is exactly why
  // the question is asked here: an extra car, or the waiting list, where the
  // driver moves up by themselves when a seat comes free. Counted the way the
  // server counts it, open Driver Market offers included.
  async function seatFor(list) {
    const capacity = race?.capacity ?? 40;
    const taken = (race?.counts?.ACCEPTED ?? 0) + (race?.reserved ?? 0);
    const free = Math.max(0, capacity - taken);
    if (list.length <= free) return "ACCEPTED";
    const one = list.length === 1;
    const choice = await ask({
      title: free === 0 ? "The grid is full" : `Only ${plural(free, "seat")} left`,
      body: one
        ? `${taken} of ${capacity} seats are taken for ${raceName}. You can put ${list[0].name} on the grid anyway, as car ${taken + 1}, or on the waiting list, where they move up by themselves when a seat comes free.`
        : `${taken} of ${capacity} seats are taken for ${raceName}. Putting all ${list.length} on the grid makes it ${taken + list.length}. The waiting list lets them move up by themselves as seats come free.`,
      confirmLabel: one ? "On the grid anyway" : `All ${list.length} on the grid`,
      thirdLabel: one ? "Waiting list" : "All to the waiting list",
    });
    if (choice === true) return "ACCEPTED";
    if (choice === "third") return "WAITLIST";
    return null;
  }

  // One answer, written. The row leaves the list on success; a refusal stays
  // on the row, in the server's own words (a completed race, a driver from
  // another season's roster).
  async function save(d, status) {
    setSaving((s) => new Set(s).add(d.driverId));
    setRowErrors((e) => ({ ...e, [d.driverId]: null }));
    try {
      await api.adminSetAnswer(raceId, d.driverId, status);
      setData((prev) =>
        prev && {
          ...prev,
          missing: {
            fullTime: prev.missing.fullTime.filter((x) => x.driverId !== d.driverId),
            reserve: prev.missing.reserve.filter((x) => x.driverId !== d.driverId),
          },
        }
      );
      setSelected((s) => {
        const next = new Set(s);
        next.delete(d.driverId);
        return next;
      });
      return true;
    } catch (e) {
      setRowErrors((errs) => ({ ...errs, [d.driverId]: e.message }));
      return false;
    } finally {
      setSaving((s) => {
        const next = new Set(s);
        next.delete(d.driverId);
        return next;
      });
    }
  }

  const answerWord = { ACCEPTED: "in", DECLINED: "out", TENTATIVE: "a maybe", WAITLIST: "on the waiting list" };

  async function answerOne(d, status) {
    setDone(null);
    const want = status === "ACCEPTED" ? await seatFor([d]) : status;
    if (!want) return;
    if (await save(d, want)) {
      setDone(`${d.name} is down as ${answerWord[want]}.`);
      onReloadRaces?.();
    }
  }

  async function answerMany(status) {
    const list = picked;
    if (!list.length) return;
    setDone(null);
    let want = status;
    if (status === "ACCEPTED") {
      want = await seatFor(list);
      if (!want) return;
    } else if (list.length > 1) {
      const yes = await ask({
        title: `Mark ${plural(list.length, "driver")} as out?`,
        body: `They are down as declined for ${raceName}. Each of them can still change it on the attendance page while the sign-up is open.`,
        confirmLabel: `Mark ${list.length} as out`,
      });
      if (!yes) return;
    }
    let ok = 0;
    // One at a time, in list order: every answer syncs the Discord post, and a
    // burst of twelve at once is what gets a webhook rate-limited.
    for (let i = 0; i < list.length; i++) {
      setProgress(`Saving ${i + 1} of ${list.length}…`);
      if (await save(list[i], want)) ok += 1;
    }
    setProgress(null);
    onReloadRaces?.();
    const failed = list.length - ok;
    setDone(
      `${plural(ok, "driver")} down as ${answerWord[want]}.` +
        (failed ? ` ${failed} could not be saved; the reason is on ${failed === 1 ? "its row" : "each row"}.` : "")
    );
  }

  function toggle(id) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAll(ids, on) {
    setSelected((s) => {
      const next = new Set(s);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function sendReminder() {
    setDone(null);
    setError(null);
    const res = await remind(race);
    if (!res) return;
    if (!res.ok) return setError(res.text);
    setDone(res.text);
    if (res.lastSentAt) setPings((p) => ({ ...p, [race.id]: { ...p[race.id], at: res.lastSentAt } }));
  }

  const bulkBusy = progress !== null;
  const rowProps = (d) => ({
    answers,
    selected: selected.has(d.driverId),
    onSelect: toggle,
    onAnswer: answerOne,
    busy: bulkBusy || saving.has(d.driverId),
    error: rowErrors[d.driverId] || null,
  });
  const silentCount = everyone.length;
  const signupShut = !!race?.attendanceClosed || notOpenYet;

  return (
    <div className="card space-y-4 p-5">
      <CardHead eyebrow="Attendance page" title="Still to answer" />
      <p className="text-sm text-light">Who has not touched the sign-up for the round below, so you know who to chase.</p>
      <HelpNote label="What counts as silent, and what the buttons do">
        <ul className="space-y-1">
          <li>Somebody who answered and then cleared their answer is silent again.</li>
          <li>Deactivated drivers are left out.</li>
          <li>
            <strong className="font-semibold text-medium">In / Out / Maybe</strong> write the answer for them, as if they
            had pressed it themselves. The row leaves this list; the Grid view is where it can be moved again.
          </li>
          <li>
            The grid size doesn&rsquo;t bind you, so &ldquo;In&rdquo; on a full grid asks first: an extra car, or the
            waiting list.
          </li>
          <li>
            <strong className="font-semibold text-medium">Remind</strong> sends a personal bell note to the people on
            this list who have logged in on the site. Nobody who answered hears anything.
          </li>
        </ul>
      </HelpNote>

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
            disabled={bulkBusy}
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
      {done && <Notice kind="success">{done}</Notice>}

      {fallbackText && (
        <div className="space-y-1.5">
          <p className="text-sm text-light">
            This browser blocked the clipboard. Here is the text to copy by hand.
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
          Sign-up for this round hasn&rsquo;t opened yet, so the lists below are simply the whole roster.
        </Notice>
      )}

      {loading && !data && <p className="text-sm text-light">Loading…</p>}

      {data && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
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
            {silentCount > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <LastReminder at={pings[raceId]?.at} className="text-xs text-light" />
                <button
                  type="button"
                  className="btn-secondary py-1.5 text-xs"
                  disabled={!!reminding || bulkBusy || signupShut}
                  title={
                    signupShut
                      ? "Sign-up for this round isn't taking answers, so there is nothing to remind them of."
                      : "A personal bell note to everyone on this list who has logged in. You'll see how many before it goes."
                  }
                  onClick={sendReminder}
                >
                  {reminding === raceId ? "Checking…" : `Remind the ${silentCount}`}
                </button>
              </div>
            )}
          </div>

          {/* The bulk bar only exists while something is ticked: it is the
              second thing an admin reaches for, never the first. */}
          {picked.length > 0 && (
            <div
              role="region"
              aria-label="Selected drivers"
              className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface2/40 px-4 py-2.5"
            >
              {/* Its own line on a phone, so the buttons stay together below it
                  instead of one of them wrapping away from the other. */}
              <span className="w-full text-sm font-semibold text-dark sm:mr-auto sm:w-auto">
                {progress || `${plural(picked.length, "driver")} selected`}
              </span>
              {answers.some((a) => a.key === "ACCEPTED") && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold text-ok transition hover:border-green-600/60 disabled:opacity-40"
                  disabled={bulkBusy}
                  onClick={() => answerMany("ACCEPTED")}
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Mark as in
                </button>
              )}
              {answers.some((a) => a.key === "DECLINED") && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold text-bad transition hover:border-red-600/60 disabled:opacity-40"
                  disabled={bulkBusy}
                  onClick={() => answerMany("DECLINED")}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  Mark as out
                </button>
              )}
              <button
                type="button"
                className="text-xs font-semibold text-link hover:underline disabled:opacity-40"
                disabled={bulkBusy}
                onClick={() => setSelected(new Set())}
              >
                Clear
              </button>
            </div>
          )}

          <Group
            title="Full-time drivers"
            hint="Tier 1 first, then Tier 2, teammates together."
            people={data.missing.fullTime}
            onCopy={copy}
            rowProps={rowProps}
            selected={selected}
            onSelectAll={selectAll}
          />
          <Group
            title="Reserves"
            hint="Most never answer a round they aren't needed for. This is who you could still ask."
            people={data.missing.reserve}
            collapsible
            onCopy={copy}
            rowProps={rowProps}
            selected={selected}
            onSelectAll={selectAll}
          />
        </>
      )}
    </div>
  );
}
