import { useEffect, useState } from "react";
import { SocialIcon } from "./SocialLinks.jsx";

// A platform id (Discord or Steam) shown as a small chip in the admin.
//
// Both ids used to sit in the member list as a bare 18-digit run labelled just
// "ID", which said nothing about which platform it belonged to. A chip carries
// the platform's own glyph instead, keeps the number short until it is wanted,
// and copies it on click, because the reason to look at one of these is almost
// always to paste it somewhere else.
//
// `value` null renders the chip greyed out, so the admin can see at a glance
// which of the two identities a person is missing. `state` is a short word that
// stays VISIBLE next to the value (where it came from, whether it reached the
// driver row): a tooltip would be invisible on the phone, and this tab gets
// used on one.
const LABELS = { discord: "Discord ID", steam: "Steam ID" };

export default function IdChip({ platform, value, state, title, tone = "muted", className = "" }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  // Reset when the list refetches into a different value.
  useEffect(() => {
    setShown(false);
    setCopied(false);
  }, [value]);

  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const label = LABELS[platform] || "ID";

  if (!value) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-faint ${className}`}
        title={title || `No ${label} on file`}
      >
        <SocialIcon name={platform} className="h-3 w-3" />
        <span>{state || "not set"}</span>
        <span className="sr-only">{`No ${label} on file`}</span>
      </span>
    );
  }

  async function reveal() {
    if (!shown) {
      setShown(true);
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      window.prompt(`Copy the ${label}:`, value);
    }
  }

  // Masked form: the last six digits. Four was not enough to tell two accounts
  // apart in a list, and Steam ids all share the same 7656119… head, so the
  // tail is the only part that distinguishes them.
  const masked = `…${String(value).slice(-6)}`;
  const toneClass =
    tone === "warn"
      ? "border-amber-500/40 text-amber-600"
      : "border-border text-medium hover:border-brand/50 hover:text-dark";

  return (
    <button
      type="button"
      onClick={reveal}
      title={title || undefined}
      aria-label={shown ? `Copy the ${label} ${value}` : `Show the ${label}, ending ${String(value).slice(-6)}`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition ${toneClass} ${className}`}
    >
      <SocialIcon name={platform} className="h-3 w-3" />
      <span className="normal-case tracking-normal">{shown ? value : masked}</span>
      {state && <span className="text-faint">· {state}</span>}
      <span role="status" aria-live="polite" className={copied ? "font-bold text-emerald-600" : "sr-only"}>
        {copied ? "copied" : ""}
      </span>
    </button>
  );
}
