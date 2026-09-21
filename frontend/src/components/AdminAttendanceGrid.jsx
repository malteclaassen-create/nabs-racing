import { useEffect, useMemo, useState } from "react";
import { Hourglass, Check, X, ArrowLeftRight } from "lucide-react";
import { api } from "../api/client.js";
import { CardHead, ErrorBox, HelpNote, Notice, TeamDot } from "./ui.jsx";
import { useAsk } from "./overlay.jsx";
import { fmtDateShort } from "../utils/format.js";

// Admin → Attendance → "Grid & waiting list": who is in the round, who is
// queuing for it, and every way of moving somebody between the two.
//
// These controls started life on the sign-up card itself, behind the Steam IDs
// button — three icon buttons per row, no confirmation, on a page the whole
// league reads, 43 rows of them on a phone. The button on that card shows Steam
// ids now and nothing else. Everything that WRITES is here, where the admin
// already comes to set the grid size, with room for the names, the sign-up
// times and a sentence saying what each button will do.
//
// The three ways down from here, in the order they get used:
//
//   Trim      — the grid is over its number and the last answers in are why.
//   Swap      — this one out, that one in, as ONE click.
//   Row moves — everything else, one person at a time.

const WAITLIST = "WAITLIST";

const fmtDate = (d) => (d ? fmtDateShort(d) : "date TBA");

// When somebody answered, to the minute. The date is in there because a sign-up
// that opened five days ago is five days of "19:42" otherwise — and the minute
// is the entire point of this panel, since it is what says who was last in.
function answerTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// One driver, one row, with whatever moves apply to the list they are in.
// Words on the buttons rather than the bare icons the sign-up card had: there
// is room for them here, and "Wait" is a thing an admin can read before
// pressing rather than after.
function Row({ r, lead, actions, busy, onAct }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
      {lead}
      <TeamDot color={r.team?.color || "var(--c-border)"} />
      <span className="min-w-0 flex-1 truncate font-semibold text-dark">{r.name}</span>
      <span className="hidden truncate text-xs text-light sm:inline">{r.team?.name}</span>
      <span className="font-mono text-[11px] tabular-nums text-medium">{answerTime(r.answeredAt)}</span>
      <span className="flex shrink-0 items-center gap-1">
        {actions.map((a) => (
          <button
            key={a.key || "clear"}
            type="button"
            title={a.title}
            disabled={busy}
            onClick={() => onAct(r, a.key)}
            className={`inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-semibold transition disabled:opacity-40 ${a.className}`}
          >
            <a.Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {a.label}
          </button>
        ))}
      </span>
    </li>
  );
}

// `races` are the upcoming rounds the parent already loaded for its other
// views, and `onReloadRaces` is how this panel sees its own writes — asking for
// the list again here would only mean the two could disagree.
export default function AdminAttendanceGrid({ races = [], racesError = null, onReloadRaces }) {
  const ask = useAsk();
  // The picker's own choice, empty until something is picked. The race this
  // panel is ON is derived from it below rather than filled in by an effect:
  // the effect version rendered the header with no grid under it on the first
  // pass, which is the one pass an admin opening the tab actually sees.
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  // The two sides of a swap, picked before it happens.
  const [outId, setOutId] = useState("");
  const [inId, setInId] = useState("");

  // A hidden race is off the attendance page entirely, so there is no grid on
  // it to manage.
  const upcoming = useMemo(() => races.filter((r) => !r.hidden), [races]);
  // Falls back to the next round — the one the attendance page is showing, and
  // the one an over-full grid is almost always about. A pick that no longer
  // matches anything (the race was hidden, the series changed) falls back the
  // same way rather than leaving the panel blank.
  const race = upcoming.find((r) => r.id === picked) || upcoming[0] || null;
  const raceId = race?.id || "";

  // The grid, oldest answer first: the order people came in, which is the order
  // this panel is read in. The queue is the same sort and also its running
  // order — first in, first onto the grid.
  const accepted = useMemo(
    () => [...(race?.rsvps?.ACCEPTED || [])].sort((a, b) => new Date(a.answeredAt || 0) - new Date(b.answeredAt || 0)),
    [race]
  );
  const waiting = useMemo(
    () => [...(race?.rsvps?.[WAITLIST] || [])].sort((a, b) => new Date(a.answeredAt || 0) - new Date(b.answeredAt || 0)),
    [race]
  );
  const others = useMemo(
    () => [...(race?.rsvps?.DECLINED || []), ...(race?.rsvps?.TENTATIVE || [])],
    [race]
  );

  const capacity = race?.capacity ?? 40;
  // Counted the way the server counts it, open Driver Market offers included,
  // so the number here and the trim it offers never disagree.
  const reserved = race?.reserved || 0;
  const over = Math.max(0, accepted.length + reserved - capacity);
  // Who the trim would move, so the admin reads the names before pressing it
  // rather than after. Same rule as the server: newest answer first.
  const tail = useMemo(() => (over ? accepted.slice(-over).reverse() : []), [accepted, over]);

  // Both pickers reset when the race does — a driver id from another round's
  // lists is only ever a refused request.
  useEffect(() => {
    setOutId("");
    setInId("");
    setMsg(null);
    setError(null);
  }, [raceId]);

  async function run(fn, done) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await fn();
      await onReloadRaces?.();
      setMsg(done);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // One row's move. Taking an answer away is the one that gets a confirmation:
  // the other two are reversible with the button next to them, and this one
  // leaves nothing behind to press.
  async function act(r, next) {
    if (next === null) {
      const yes = await ask({
        title: `Remove ${r.name}'s answer?`,
        body: `${r.name} drops out of the sign-up entirely — not declined, not waiting, back to never having answered. They can answer again themselves, and the seat stays open until you give it to somebody.`,
        confirmLabel: "Yes, remove it",
        danger: true,
      });
      if (!yes) return;
    }
    const what =
      next === WAITLIST
        ? `${r.name} is on the waiting list.`
        : next === "ACCEPTED"
          ? `${r.name} is on the grid.`
          : `${r.name}'s answer is gone.`;
    await run(() => api.adminSetAnswer(raceId, r.driverId, next), what);
  }

  async function swap() {
    const out = accepted.find((r) => r.driverId === outId);
    const inc = waiting.find((r) => r.driverId === inId);
    if (!out || !inc) return;
    const yes = await ask({
      title: "Swap these two?",
      body: `${out.name} goes to the waiting list and ${inc.name} takes the seat. Both are told. ${out.name} keeps their sign-up time, so they queue ahead of anybody who joined the waiting list after them.`,
      confirmLabel: "Yes, swap",
    });
    if (!yes) return;
    await run(
      () => api.adminSwapAnswers(raceId, outId, inId),
      `${inc.name} is on the grid, ${out.name} is on the waiting list.`
    );
    setOutId("");
    setInId("");
  }

  async function trim() {
    const names = tail.map((r) => r.name).join(", ");
    const yes = await ask({
      title: over === 1 ? "Move the last one in to the waiting list?" : `Move the last ${over} in to the waiting list?`,
      body: `${names} answered last, which is what put the grid at ${accepted.length + reserved} for ${capacity} seats. They go to the waiting list keeping their own sign-up time, so they sit ahead of everybody already queuing, and they are told. Nobody is moved up behind them.`,
      confirmLabel: over === 1 ? "Yes, move them" : `Yes, move all ${over}`,
    });
    if (!yes) return;
    await run(() => api.adminTrimGrid(raceId), `${names} moved to the waiting list. The grid is on ${capacity}.`);
  }

  const gridActions = [
    { key: WAITLIST, Icon: Hourglass, label: "Wait", title: "Move to the waiting list, keeping their sign-up time", className: "text-link hover:border-sky-500/60" },
    { key: null, Icon: X, label: "Remove", title: "Take their answer away entirely", className: "text-bad hover:border-red-600/60" },
  ];
  const queueActions = [
    { key: "ACCEPTED", Icon: Check, label: "Grid", title: "Put them on the grid now", className: "text-ok hover:border-green-600/60" },
    { key: null, Icon: X, label: "Remove", title: "Take their answer away entirely", className: "text-bad hover:border-red-600/60" },
  ];
  const otherActions = [
    { key: "ACCEPTED", Icon: Check, label: "Grid", title: "Put them on the grid now", className: "text-ok hover:border-green-600/60" },
    { key: WAITLIST, Icon: Hourglass, label: "Wait", title: "Put them on the waiting list", className: "text-link hover:border-sky-500/60" },
    { key: null, Icon: X, label: "Remove", title: "Take their answer away entirely", className: "text-bad hover:border-red-600/60" },
  ];

  return (
    <div className="card space-y-4 p-5">
      <CardHead eyebrow="Attendance page" title="Grid & waiting list" />
      <p className="text-sm text-light">
        Who is in the round below and who is queuing for it. The only place answers can be moved by hand — the Steam IDs
        button on the sign-up card just shows ids.
      </p>

      <HelpNote label="What these buttons do">
        <ul className="space-y-1">
          <li>
            The grid size does <strong className="font-semibold text-medium">not</strong> apply here. You can put a 43rd
            car on a 42-seat grid; the count above just says so.
          </li>
          <li>
            Nothing moves up on its own behind you. A seat you free here stays open until you give it to somebody —
            which is usually the next click. (A member who declines for themselves <em>does</em> hand their seat to the
            front of the queue.)
          </li>
          <li>
            Somebody you move between the grid and the waiting list keeps their own sign-up time, so they queue ahead of
            anybody who joined the list after them — and they get a bell notification saying where they stand.
          </li>
          <li>
            <strong className="font-semibold text-medium">Remove</strong> is silent on purpose: it is for a duplicate or
            a name that should never have been in the list, not for telling somebody they are out.
          </li>
          <li>A round that has been saved as a result can&rsquo;t be edited — its entry list is the record.</li>
        </ul>
      </HelpNote>

      {racesError && <ErrorBox message={racesError} onRetry={onReloadRaces} />}

      {upcoming.length === 0 ? (
        <p className="text-sm text-light">No upcoming race on the attendance page in this series.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="grid-race" className="text-sm font-semibold text-medium">
            Race
          </label>
          <select id="grid-race" className="input max-w-sm" value={raceId} onChange={(e) => setPicked(e.target.value)}>
            {upcoming.map((e) => (
              <option key={e.id} value={e.id}>
                {e.type === "TRAINING" ? "Training" : `R${e.number}`} {e.track} · {fmtDate(e.date)}
                {e.id === upcoming[0].id ? " (next)" : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && <ErrorBox message={error} title="That didn't save" />}
      {msg && <Notice>{msg}</Notice>}

      {race && (
        <>
          {/* The count, in the same words the sign-up card uses. */}
          <div className="rounded-xl border border-border bg-surface2/40 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 font-mono text-[11px] font-bold uppercase tracking-wider">
              <span className="text-light">Grid</span>
              <span className={`tabular-nums ${over ? "text-warn" : "text-medium"}`}>
                {accepted.length + reserved}/{capacity} seats taken
                {reserved > 0 && ` (${reserved} mid-handover)`} · {waiting.length} waiting
              </span>
            </div>
          </div>

          {/* Over its number, and the way back onto it. The names are in the
              line so the admin does not have to scroll the list below to find
              out who the button means. */}
          {over > 0 && (
            <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
              <p className="text-sm font-semibold text-warn">
                {over === 1
                  ? "One car too many on this grid."
                  : `${over} cars too many on this grid.`}{" "}
                <span className="font-normal">
                  The last {over === 1 ? "answer" : `${over} answers`} in:{" "}
                  {tail.map((r) => `${r.name} (${answerTime(r.answeredAt)})`).join(", ")}.
                </span>
              </p>
              <button type="button" className="btn-primary px-4 py-2 text-sm disabled:opacity-50" disabled={busy} onClick={trim}>
                {over === 1 ? "Move the last one in to the waiting list" : `Move the last ${over} in to the waiting list`}
              </button>
            </div>
          )}

          {/* The swap. Two pickers rather than a drag: the lists are forty-odd
              names long and the pair being swapped is rarely next to each other
              in either of them. */}
          <div className="space-y-2 rounded-xl border border-border bg-surface2/40 px-4 py-3">
            <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">Swap a seat</h3>
            <p className="text-xs text-light">
              One click for both halves. Doing it as two leaves the round a seat short in between — and short for good
              if the second click never lands.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-0 flex-1 basis-56">
                <span className="mb-1 block text-xs font-semibold text-medium">Off the grid</span>
                <select className="input w-full" value={outId} disabled={busy || !accepted.length} onChange={(e) => setOutId(e.target.value)}>
                  <option value="">Pick a driver…</option>
                  {accepted.map((r) => (
                    <option key={r.driverId} value={r.driverId}>
                      {r.name} · {answerTime(r.answeredAt)}
                    </option>
                  ))}
                </select>
              </label>
              <ArrowLeftRight className="mb-2.5 hidden h-4 w-4 shrink-0 text-light sm:block" aria-hidden="true" />
              <label className="min-w-0 flex-1 basis-56">
                <span className="mb-1 block text-xs font-semibold text-medium">Onto it, from the queue</span>
                <select className="input w-full" value={inId} disabled={busy || !waiting.length} onChange={(e) => setInId(e.target.value)}>
                  <option value="">Pick a driver…</option>
                  {waiting.map((r, i) => (
                    <option key={r.driverId} value={r.driverId}>
                      {i + 1}. {r.name} · {answerTime(r.answeredAt)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
                disabled={busy || !outId || !inId}
                onClick={swap}
              >
                Swap
              </button>
            </div>
            {!waiting.length && <p className="text-xs text-light">Nobody is on the waiting list for this round.</p>}
          </div>

          <div className="border-t border-border pt-4">
            <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">
              On the grid <span className="text-light">({accepted.length})</span>
            </h3>
            <p className="mt-0.5 text-xs text-light">Oldest answer first, so the bottom of this list is the last one in.</p>
            {accepted.length === 0 ? (
              <p className="mt-2 text-sm text-light">Nobody has accepted yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-border border-y border-border">
                {accepted.map((r, i) => (
                  <Row
                    key={r.driverId}
                    r={r}
                    lead={
                      <span className="w-6 shrink-0 text-right font-mono text-[11px] tabular-nums text-faint">{i + 1}.</span>
                    }
                    actions={gridActions}
                    busy={busy}
                    onAct={act}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-border pt-4">
            <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">
              Waiting list <span className="text-light">({waiting.length})</span>
            </h3>
            <p className="mt-0.5 text-xs text-light">
              In the order they move up. No. 1 is next onto the grid when a seat comes free by itself.
            </p>
            {waiting.length === 0 ? (
              <p className="mt-2 text-sm text-light">Nobody is queuing for this round.</p>
            ) : (
              <ul className="mt-2 divide-y divide-border border-y border-border">
                {waiting.map((r, i) => (
                  <Row
                    key={r.driverId}
                    r={r}
                    lead={
                      <span className="w-6 shrink-0 text-right font-mono text-[11px] tabular-nums text-faint">{i + 1}.</span>
                    }
                    actions={queueActions}
                    busy={busy}
                    onAct={act}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* Declined and tentative, folded away. Rarely what this panel is
              open for, but a driver who declined and then asked in Discord to
              be put back has to be reachable from somewhere. */}
          {others.length > 0 && (
            <details className="border-t border-border pt-4">
              <summary className="cursor-pointer font-display text-base font-extrabold uppercase tracking-tight text-dark">
                Declined &amp; tentative <span className="text-light">({others.length})</span>
              </summary>
              <ul className="mt-2 divide-y divide-border border-y border-border">
                {others.map((r) => (
                  <Row key={r.driverId} r={r} lead={null} actions={otherActions} busy={busy} onAct={act} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
