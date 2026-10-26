import { useState } from "react";
import { api } from "../api.js";
import { useSite } from "../site.jsx";
import DiscordButton from "./DiscordButton.jsx";

const OPTIONS = [
  { value: "in", label: "I'm in", on: "bg-emerald-500 text-bg border-emerald-500" },
  { value: "maybe", label: "Maybe", on: "bg-amber-400 text-bg border-amber-400" },
  { value: "out", label: "Can't make it", on: "bg-red-500/80 text-white border-red-500/80" },
];

// The three buttons for one race. `status` is the member's current answer.
export default function Signup({ raceId, status, onChange }) {
  const { me } = useSite();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!me.user) return <DiscordButton>Sign in with Discord to sign up</DiscordButton>;

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
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            disabled={busy}
            onClick={() => pick(o.value)}
            className={`btn border ${status === o.value ? o.on : "border-line text-ink hover:border-accent/60"}`}
            aria-pressed={status === o.value}
          >
            {o.label}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
    </div>
  );
}
