import { useEffect, useState } from "react";
import { Hash, Link2, Lock, Check, Paintbrush } from "lucide-react";
import { api } from "../api/client.js";
import { threeLetterMonths } from "../utils/format.js";

// A special event's car: the race number and the livery every driver brings
// (backend lib/eventCars.js). Two places use it: the sign-up card asks for it
// when somebody presses Accept, and the attendance page shows it in the column
// where a championship has its hotlap video, so it can still be changed until
// the liveries close.
//
// Three kinds of livery, picked from a menu:
//   new      a custom livery, sent as a link to the files
//   default  one of the car's own liveries; it carries the race number
//   old      a custom one the organiser already has from last time, by name

export const CAR_MIN = 1;
export const CAR_MAX = 99;

const KINDS = [
  ["new", "New custom livery"],
  ["default", "Default livery"],
  ["old", "Old custom livery"],
];

// Numbers already on a car, as number -> driver name. The driver's own rows are
// left out: their own number is not taken from them.
export function takenNumbers(ev, myIds) {
  const out = new Map();
  for (const s of ["ACCEPTED", "TENTATIVE", "WAITLIST"]) {
    for (const r of ev?.rsvps?.[s] || []) {
      if (r.carNumber != null && !myIds.has(r.driverId)) out.set(r.carNumber, r.name);
    }
  }
  return out;
}

// "Thu 05 Nov, 18:30 CET" in the viewer's own time zone.
export function deadlineLabel(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return threeLetterMonths(
    d.toLocaleString("en-GB", {
      weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short",
    })
  );
}

// What is wrong with the number typed so far, or null.
export function numberProblem(raw, taken) {
  const s = String(raw ?? "").trim();
  if (!s) return "Pick a car number";
  const n = Number(s);
  if (!Number.isInteger(n) || n < CAR_MIN || n > CAR_MAX) return `Car numbers go from ${CAR_MIN} to ${CAR_MAX}`;
  if (taken.has(n)) return `#${n} is taken by ${taken.get(n)}`;
  return null;
}

// The form's state, from a stored car (or none). Which kind it is follows from
// what is stored: a link is a new livery, a name an old one, neither a default.
export function draftFrom(car, defaults = []) {
  const kind = car?.liveryUrl ? "new" : car?.liveryOld ? "old" : defaults.length ? "default" : "new";
  return {
    kind,
    number: car?.carNumber != null ? String(car.carNumber) : "",
    link: car?.liveryUrl || "",
    old: car?.liveryOld || "",
  };
}

// What is wrong with the whole form, or null.
export function draftProblem(d, taken, defaults = []) {
  if (d.kind === "default") {
    const car = defaults.find((x) => String(x.number) === String(d.number).trim());
    if (!car) return "Pick one of the default cars";
    if (taken.has(car.number)) return `#${car.number} is taken by ${taken.get(car.number)}`;
    return null;
  }
  const p = numberProblem(d.number, taken);
  if (p) return p;
  if (d.kind === "old" && !d.old.trim()) return "Type which livery you ran last time";
  return null;
}

// The request body for a draft. The other kinds' fields are cleared, so
// switching from a link to a default car really drops the link.
export function draftBody(d) {
  return {
    carNumber: Number(String(d.number).trim()),
    liveryUrl: d.kind === "new" ? d.link.trim() : "",
    liveryOld: d.kind === "old" ? d.old.trim() : "",
  };
}

const LABEL = "mb-1.5 flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-light";

// The form. Controlled from outside (`draft`, `setDraft`), so the sign-up card
// and the panel each decide what pressing the button does.
export function EventCarFields({ draft, setDraft, taken, deadline, numberLocked, liveryLocked, defaults = [] }) {
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const closes = deadlineLabel(deadline);
  const typed = String(draft.number ?? "").trim();
  const problem = typed ? numberProblem(draft.number, taken) : null;
  const kinds = defaults.length ? KINDS : KINDS.filter(([k]) => k !== "default");
  const locked = liveryLocked || numberLocked;

  const numberField = (
    <label className="block">
      <span className={LABEL}>
        <Hash className="h-3.5 w-3.5" aria-hidden="true" />
        Car number
      </span>
      <input
        className="input font-mono text-lg font-bold tabular-nums"
        inputMode="numeric"
        maxLength={2}
        placeholder="1-99"
        value={draft.number}
        disabled={numberLocked}
        onChange={(e) => set("number", e.target.value.replace(/\D/g, ""))}
        aria-invalid={!!problem}
      />
      <span className={`mt-1 block text-xs ${problem && !numberLocked ? "text-bad" : "text-light"}`}>
        {numberLocked
          ? "Fixed now. Ask an admin to change it."
          : problem || (typed ? "Not taken yet, it's yours." : "Pick a number from 1 to 99.")}
      </span>
    </label>
  );

  return (
    <div className="space-y-4">
      <label className="block">
        <span className={LABEL}>
          <Paintbrush className="h-3.5 w-3.5" aria-hidden="true" />
          Livery
        </span>
        <select
          className="input"
          value={draft.kind}
          disabled={locked}
          onChange={(e) => {
            const kind = e.target.value;
            // A default car brings its own number, so a number typed for a
            // custom livery that no default car has would only be in the way.
            setDraft((d) => ({
              ...d,
              kind,
              number: kind === "default" && !defaults.some((x) => String(x.number) === String(d.number).trim()) ? "" : d.number,
            }));
          }}
        >
          {kinds.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs leading-relaxed text-light">
          {liveryLocked
            ? `Liveries closed${closes ? ` ${closes}` : ""}. The car pack is being built.`
            : closes
              ? `Due ${closes}. You can change it until then.`
              : "You can change it until the day before the race."}
        </span>
      </label>

      {draft.kind === "new" && (
        <div className="grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
          {numberField}
          <label className="block min-w-0">
            <span className={LABEL}>
              <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
              Livery link
            </span>
            <input
              className="input"
              type="url"
              placeholder="Paste link here"
              value={draft.link}
              disabled={liveryLocked}
              onChange={(e) => set("link", e.target.value)}
            />
            <span className="mt-1 block text-xs leading-relaxed text-light">
              Upload your skin folder (Google Drive, Dropbox, ...) and paste the link. Not ready yet? Add it later.
            </span>
          </label>
        </div>
      )}

      {draft.kind === "old" && (
        <div className="grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
          {numberField}
          <label className="block min-w-0">
            <span className={LABEL}>
              <Paintbrush className="h-3.5 w-3.5" aria-hidden="true" />
              Your old livery
            </span>
            <input
              className="input"
              placeholder="Which livery was it?"
              maxLength={120}
              value={draft.old}
              disabled={liveryLocked}
              onChange={(e) => set("old", e.target.value)}
            />
            <span className="mt-1 block text-xs leading-relaxed text-light">
              The one you ran last time. We still have it, so no link needed: just say which one.
            </span>
          </label>
        </div>
      )}

      {/* One of the car's own liveries. The number comes with the car, so
          picking one sets it, and a default car whose number somebody else
          already races is off the list. */}
      {draft.kind === "default" && (
        <ul className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto pr-1 scrollbar-slim sm:grid-cols-4 lg:grid-cols-5">
          {defaults
            .filter((d) => !taken.has(d.number))
            .map((d) => {
              const on = typed === String(d.number);
              return (
                <li key={d.skin}>
                  <button
                    type="button"
                    onClick={() => set("number", String(d.number))}
                    disabled={locked}
                    aria-pressed={on}
                    title={`${d.name} #${d.number}`}
                    className={`group relative block w-full overflow-hidden rounded-lg border-2 bg-surface2 text-left transition ${
                      on ? "border-brand" : "border-transparent hover:border-border"
                    } disabled:opacity-40`}
                  >
                    <img src={d.image} alt="" loading="lazy" className="aspect-[16/10] w-full object-cover" />
                    <span className="flex items-center justify-between gap-1 px-1.5 py-1">
                      <span className="truncate text-[11px] font-semibold text-medium">{d.name}</span>
                      <span className="font-mono text-xs font-bold text-dark">#{d.number}</span>
                    </span>
                    {on && (
                      <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-onbrand">
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}

// Is this answer one that holds a car? (my-car's `status`)
export const holdsCar = (status) => status === "ACCEPTED" || status === "TENTATIVE" || status === "WAITLIST";

// The line that says what a stored car is, for badges and lists.
export function liveryKindLabel(car, defaults = []) {
  if (car?.liveryUrl) return "Custom livery";
  if (car?.liveryOld) return "Old custom livery";
  if (defaults.some((d) => d.number === car?.carNumber)) return "Default livery";
  return "No livery yet";
}

// The attendance page's car panel, for somebody who has signed up. `initial` is
// the member's own car from /my-car (the livery is not in the public entry
// list); changes are saved until the deadline.
export function EventCarPanel({ ev, initial, myIds, onSaved, defaults = [] }) {
  const [mine, setMine] = useState(initial);
  const [draft, setDraft] = useState(() => draftFrom(initial, defaults));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setMine(initial);
    setDraft(draftFrom(initial, defaults));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const taken = takenNumbers(ev, myIds);
  const locked = !!mine?.locked;
  const numberLocked = locked && mine?.carNumber != null;
  const changed = mine && JSON.stringify(draft) !== JSON.stringify(draftFrom(mine, defaults));

  async function save() {
    setError(null);
    setSaved(false);
    const p = draftProblem(draft, taken, defaults);
    if (p) return setError(p);
    setBusy(true);
    try {
      const r = await api.updateMyCar(ev.id, draftBody(draft));
      const next = { ...mine, carNumber: r.carNumber, liveryUrl: r.liveryUrl, liveryOld: r.liveryOld };
      setMine(next);
      setDraft(draftFrom(next, defaults));
      setSaved(true);
      onSaved?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card reveal overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h3 className="font-mono text-[11px] font-bold uppercase tracking-widest text-light">Your car</h3>
          <p className="mt-0.5 font-display text-lg font-extrabold uppercase tracking-tight text-dark">
            {mine?.carNumber != null ? `#${mine.carNumber}` : "Number and livery"}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-wider text-light">
          {locked ? <Lock className="h-3 w-3" aria-hidden="true" /> : null}
          {liveryKindLabel(mine, defaults)}
        </span>
      </div>
      <div className="space-y-4 p-5">
        <EventCarFields
          draft={draft}
          setDraft={setDraft}
          taken={taken}
          deadline={mine?.deadline || ev.liveryDeadline}
          numberLocked={numberLocked}
          liveryLocked={locked}
          defaults={defaults}
        />
        {error && <p className="text-sm font-semibold text-bad">{error}</p>}
        {!(numberLocked && locked) && (
          <div className="flex items-center gap-3">
            <button onClick={save} disabled={busy || !changed} className="btn-primary">
              {busy ? "Saving..." : "Save"}
            </button>
            {saved && !changed && (
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-ok">
                <Check className="h-4 w-4" aria-hidden="true" />
                Saved
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
