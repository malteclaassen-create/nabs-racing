import { useEffect, useState } from "react";
import { Hash, Link2, Lock, Check } from "lucide-react";
import { api } from "../api/client.js";
import { threeLetterMonths } from "../utils/format.js";

// A special event's car: the race number and the livery link every driver
// brings (backend lib/eventCars.js). Two places use it: the sign-up card asks
// for it when somebody presses Accept, and the attendance page shows it in the
// column where a championship has its hotlap video, so it can still be changed
// until the links close.

export const CAR_MIN = 1;
export const CAR_MAX = 99;

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

// The two inputs. Controlled from outside, so the sign-up card and the panel
// each decide what pressing the button does.
export function EventCarFields({
  number, setNumber, livery, setLivery, taken, deadline, numberLocked, liveryLocked, defaults = [],
}) {
  const problem = String(number ?? "").trim() ? numberProblem(number, taken) : null;
  const closes = deadlineLabel(deadline);
  const n = Number(String(number ?? "").trim());
  const custom = !!String(livery ?? "").trim();
  const asDefault = !custom ? defaults.find((d) => d.number === n) : null;
  // What the number means for the car, under the field.
  let numberHint = "Not taken yet, it's yours.";
  if (numberLocked) numberHint = "Fixed now. Ask an admin to change it.";
  else if (problem) numberHint = problem;
  else if (!String(number ?? "").trim()) numberHint = defaults.length ? "Type one, or pick a default car below." : "Pick a number from 1 to 99.";
  else if (asDefault) numberHint = `The default #${asDefault.number} car.`;
  else if (!custom && defaults.length) numberHint = "No default car has this number: paste your livery or pick a car below.";
  return (
    <div className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
      <label className="block">
        <span className="mb-1.5 flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-light">
          <Hash className="h-3.5 w-3.5" aria-hidden="true" />
          Car number
        </span>
        <input
          className="input font-mono text-lg font-bold tabular-nums"
          inputMode="numeric"
          maxLength={2}
          placeholder="1-99"
          value={number}
          disabled={numberLocked}
          onChange={(e) => setNumber(e.target.value.replace(/\D/g, ""))}
          aria-invalid={!!problem}
        />
        <span className={`mt-1 block text-xs ${problem && !numberLocked ? "text-bad" : "text-light"}`}>{numberHint}</span>
      </label>
      <label className="block min-w-0">
        <span className="mb-1.5 flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-light">
          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
          Livery link <span className="normal-case tracking-normal text-faint">(optional)</span>
        </span>
        <input
          className="input"
          type="url"
          placeholder="Paste link here"
          value={livery}
          disabled={liveryLocked}
          onChange={(e) => setLivery(e.target.value)}
        />
        <span className="mt-1 block text-xs leading-relaxed text-light">
          {liveryLocked
            ? `Links closed${closes ? ` ${closes}` : ""}. The car pack is being built.`
            : `Upload your skin folder (Google Drive, Dropbox, ...) and paste the link.${closes ? ` Due ${closes}.` : ""}`}
        </span>
      </label>
    </div>
    {/* No livery of their own: one of the car's default ones. The number comes
        with the car, so picking one sets it, and a default car whose number
        somebody else already races is off the list. */}
    {defaults.length > 0 && !numberLocked && (
      <div>
        <p className="mb-2 font-mono text-[11px] font-bold uppercase tracking-wider text-light">
          No custom livery? Use a default livery:
        </p>
        <ul className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto pr-1 scrollbar-slim sm:grid-cols-4 lg:grid-cols-5">
          {defaults
            .filter((d) => !taken.has(d.number))
            .map((d) => {
              const on = asDefault?.number === d.number;
              return (
                <li key={d.skin}>
                  <button
                    type="button"
                    onClick={() => {
                      setNumber(String(d.number));
                      if (!liveryLocked) setLivery("");
                    }}
                    disabled={liveryLocked && custom}
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
      </div>
    )}
    </div>
  );
}

// Is this answer one that holds a car? (my-car's `status`)
export const holdsCar = (status) => status === "ACCEPTED" || status === "TENTATIVE" || status === "WAITLIST";

// The attendance page's car panel, for somebody who has signed up. `initial` is
// the member's own car from /my-car (the livery link is not in the public entry
// list); changes are saved until the deadline.
export function EventCarPanel({ ev, initial, myIds, onSaved, defaults = [] }) {
  const [mine, setMine] = useState(initial);
  const [number, setNumber] = useState("");
  const [livery, setLivery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setMine(initial);
    setNumber(initial?.carNumber != null ? String(initial.carNumber) : "");
    setLivery(initial?.liveryUrl || "");
  }, [initial]);

  const taken = takenNumbers(ev, myIds);
  const locked = !!mine?.locked;
  const numberLocked = locked && mine?.carNumber != null;
  const changed =
    mine &&
    (String(mine.carNumber ?? "") !== String(number).trim() || (mine.liveryUrl || "") !== livery.trim());

  async function save() {
    setError(null);
    setSaved(false);
    const p = numberProblem(number, taken);
    if (p) return setError(p);
    setBusy(true);
    try {
      const body = {};
      if (!numberLocked) body.carNumber = Number(number);
      if (!locked) body.liveryUrl = livery.trim();
      const r = await api.updateMyCar(ev.id, body);
      setMine((m) => ({ ...m, carNumber: r.carNumber, liveryUrl: r.liveryUrl }));
      setNumber(r.carNumber != null ? String(r.carNumber) : "");
      setLivery(r.liveryUrl || "");
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
          {mine?.liveryUrl
            ? "Custom livery"
            : defaults.some((d) => d.number === mine?.carNumber)
              ? "Default livery"
              : "No livery yet"}
        </span>
      </div>
      <div className="space-y-4 p-5">
        {!mine && !error ? (
          <div className="h-20 animate-pulse rounded-lg bg-surface2" />
        ) : (
          <>
            <EventCarFields
              number={number}
              setNumber={setNumber}
              livery={livery}
              setLivery={setLivery}
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
          </>
        )}
      </div>
    </div>
  );
}
