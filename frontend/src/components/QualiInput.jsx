import { useState } from "react";
import { Field } from "./ui.jsx";

// Qualifying length for the admin's round forms, optionally split by tier.
// The league runs ONE qualifying session in which Tier 2 has the track first
// and Tier 1 the rest of it (say 12 + 8 of 20 minutes), so a split round
// stores both halves (qualiT2Minutes / qualiT1Minutes) and the total is their
// sum — every reader of the plain qualiMinutes keeps working. The backend
// (lib/raceFormat.js combineQualiSplit) enforces both-or-neither as well.
//
// `value` holds the three form strings { qualiMinutes, qualiT2Minutes,
// qualiT1Minutes }; `onChange` gets a patch of the ones that changed.

const blank = (v) => v === "" || v == null;

// What a form sends for these three fields. A complete split also sends its
// sum as the total; a half-filled one is passed on as it is so the backend
// can say what is missing rather than the form silently dropping a number.
export function qualiPayload(v) {
  const t2 = blank(v.qualiT2Minutes) ? null : Number(v.qualiT2Minutes);
  const t1 = blank(v.qualiT1Minutes) ? null : Number(v.qualiT1Minutes);
  return {
    qualiMinutes: t2 && t1 ? t2 + t1 : blank(v.qualiMinutes) ? null : v.qualiMinutes,
    qualiT2Minutes: t2,
    qualiT1Minutes: t1,
  };
}

export default function QualiInput({ value, onChange, className = "", placeholder = "" }) {
  const hasSplit = !blank(value.qualiT2Minutes) || !blank(value.qualiT1Minutes);
  // Open by hand, or because the round already carries a split. It stays open
  // when the Create form empties itself, so the next round of a tier-split
  // calendar starts in the same shape.
  const [open, setOpen] = useState(hasSplit);
  const split = open || hasSplit;

  const t2 = Number(value.qualiT2Minutes) || 0;
  const t1 = Number(value.qualiT1Minutes) || 0;
  const complete = t2 > 0 && t1 > 0;

  function toggle() {
    if (split) {
      // Back to one number: the split's total becomes the plain length.
      setOpen(false);
      onChange({ qualiT2Minutes: "", qualiT1Minutes: "", qualiMinutes: complete ? String(t2 + t1) : value.qualiMinutes });
    } else {
      setOpen(true);
    }
  }

  function setHalf(key, raw) {
    const next = { ...value, [key]: raw };
    const a = Number(next.qualiT2Minutes) || 0;
    const b = Number(next.qualiT1Minutes) || 0;
    onChange({ [key]: raw, ...(a > 0 && b > 0 ? { qualiMinutes: String(a + b) } : {}) });
  }

  const hint = split
    ? complete
      ? `T2 first, T1 last · ${t2 + t1} min in total`
      : "One session: T2 runs first, T1 last — enter both"
    : undefined;

  return (
    <Field
      className={className}
      label="Qualifying (min)"
      tone="plain"
      hint={hint}
      accessory={
        <button type="button" className="transition text-xs font-semibold text-link hover:underline" onClick={toggle}>
          {split ? "One time" : "Split T2 / T1"}
        </button>
      }
    >
      {(props) =>
        split ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs font-bold text-light">
                T2
              </span>
              <input
                {...props}
                aria-label="Tier 2 qualifying, first part (min)"
                className="input pl-9"
                type="number"
                min="1"
                placeholder="12"
                value={value.qualiT2Minutes}
                onChange={(e) => setHalf("qualiT2Minutes", e.target.value)}
              />
            </div>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs font-bold text-light">
                T1
              </span>
              <input
                aria-label="Tier 1 qualifying, last part (min)"
                aria-describedby={props["aria-describedby"]}
                className="input pl-9"
                type="number"
                min="1"
                placeholder="8"
                value={value.qualiT1Minutes}
                onChange={(e) => setHalf("qualiT1Minutes", e.target.value)}
              />
            </div>
          </div>
        ) : (
          <input
            {...props}
            aria-label="Qualifying (min)"
            className="input"
            type="number"
            min="1"
            placeholder={placeholder}
            value={value.qualiMinutes}
            onChange={(e) => onChange({ qualiMinutes: e.target.value })}
          />
        )
      }
    </Field>
  );
}
