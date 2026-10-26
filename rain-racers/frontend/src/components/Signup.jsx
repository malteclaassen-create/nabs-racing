import { useState } from "react";
import { api } from "../api.js";
import { useSite } from "../site.jsx";
import DiscordButton from "./DiscordButton.jsx";

const OPTIONS = [
  { value: "in", label: "I'm in", on: "bg-emerald-500 text-black ring-emerald-500", icon: "M5 12.5l4.5 4.5L19 7.5" },
  { value: "maybe", label: "Maybe", on: "bg-amber-400 text-black ring-amber-400", icon: "M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01" },
  { value: "out", label: "Can't make it", on: "bg-red-500 text-white ring-red-500", icon: "M7 7l10 10M17 7L7 17" },
];

// The answer to "are you racing?" for one race. `status` is the member's
// current answer; picking it again takes it back.
export default function Signup({ raceId, status, onChange }) {
  const { me } = useSite();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!me.user) {
    return (
      <div>
        <DiscordButton>Sign in to sign up</DiscordButton>
      </div>
    );
  }

  async function pick(value) {
    setBusy(true);
    setError(null);
    try {
      const next = value === status ? "none" : value;
      const res = await api.put(`/races/${raceId}/signup`, { status: next });
      onChange?.(res.status);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="inline-flex flex-wrap gap-1 rounded-2xl border border-line bg-bg p-1" role="group" aria-label="Are you racing?">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            disabled={busy}
            onClick={() => pick(o.value)}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-bold transition ${status === o.value ? o.on : "text-muted hover:bg-white/5 hover:text-ink"}`}
            aria-pressed={status === o.value}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={o.icon} />
            </svg>
            {o.label}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
    </div>
  );
}
