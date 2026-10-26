import { useEffect, useState } from "react";
import { useSite } from "../site.jsx";

// Sign in with Discord. Shown even before the server has its Discord app set
// up; then a click explains that instead of opening a dead page. The note
// floats under the button in the header (`floating`) and sits below it
// everywhere else, where a card or the phone menu would cut it off.
export default function DiscordButton({ children, className = "", floating = false }) {
  const { me } = useSite();
  const [note, setNote] = useState(false);
  useEffect(() => {
    if (!note) return undefined;
    const t = setTimeout(() => setNote(false), 4000);
    return () => clearTimeout(t);
  }, [note]);

  const look = `btn bg-[#5865F2] text-white hover:bg-[#4752c4] ${className}`;
  if (me.discordEnabled) {
    return (
      <a href="/api/auth/discord" className={look}>
        {children}
      </a>
    );
  }
  return (
    <span className={floating ? "relative inline-block" : "block"}>
      <button type="button" className={look} onClick={() => setNote((n) => !n)} aria-describedby={note ? "discord-note" : undefined}>
        {children}
      </button>
      {note && (
        <span
          id="discord-note"
          role="status"
          className={`rise mt-2 rounded-xl border border-line bg-card px-4 py-3 text-left text-sm text-muted ${floating ? "absolute right-0 top-full z-40 w-64 shadow-2xl" : "block max-w-xs"}`}
        >
          Discord login isn't set up on this server yet.
        </span>
      )}
    </span>
  );
}
