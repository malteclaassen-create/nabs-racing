import { useState, type ReactNode } from 'react';
import { useEditor } from '../store/store';

/** Small shared building blocks so every panel looks the same. */

export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="section">
      <h3 className="section-title">
        <span>{title}</span>
        {right}
      </h3>
      {children}
    </div>
  );
}

export function Row({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="row">
      {label !== undefined && <label>{label}</label>}
      <div className="rowbody">{children}</div>
    </div>
  );
}

export function Num({
  value,
  onChange,
  step = 1,
  min,
  max,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  /*
   * While the field has focus, it shows the user's DRAFT, not the store.
   *
   * A controlled number input that writes back on every keystroke cannot be
   * emptied, swallows a leading minus, and replaces "0." with the rounded
   * store value mid-word -- the field fights the typist. So typing edits a
   * local string and commits on Enter or on leaving the field; only the
   * spinner arrows (whose input events carry no inputType) commit at once,
   * because a click on them is already a finished thought.
   */
  const [draft, setDraft] = useState<string | null>(null);
  const canonical = String(Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0);

  const commit = (raw: string) => {
    const v = parseFloat(raw);
    if (Number.isFinite(v)) onChange(clamp(v, min, max));
  };

  return (
    <>
      <input
        type="number"
        value={draft ?? canonical}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const typed = !!(e.nativeEvent as InputEvent).inputType;
          if (typed) {
            setDraft(e.target.value);
          } else {
            setDraft(null);
            commit(e.target.value);
          }
        }}
        onBlur={() => {
          if (draft !== null) commit(draft);
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (draft !== null) commit(draft);
            setDraft(null);
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
      />
      {suffix && <span className="val" style={{ flex: '0 0 auto' }}>{suffix}</span>}
    </>
  );
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit = '',
  digits = 0,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  digits?: number;
}) {
  return (
    <>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        // Routed through tweakRun: a range input fires on every pixel of mouse
        // travel, and each one of those was a full rebuild plus an undo entry.
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          useEditor.getState().tweakRun(() => onChange(v));
        }}
      />
      <span className="val">
        {value.toFixed(digits)}
        {unit}
      </span>
    </>
  );
}

export function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Seg<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.value)} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Text({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  );
}

function clamp(v: number, min?: number, max?: number) {
  if (min !== undefined && v < min) return min;
  if (max !== undefined && v > max) return max;
  return v;
}
