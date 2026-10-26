import { useEffect, useState } from "react";
import { useSite } from "../site.jsx";
import { SocialIcon } from "./ui.jsx";

// Sign in with Discord. Shown even before the server has its Discord app set
// up; then a click says so instead of opening a dead page. The note floats
// under the button in the header (`floating`) and sits below it everywhere
// else, where a card or the phone menu would cut it off.
export default function DiscordButton({ children, className = "", floating = false }) {
  const { me } = useSite();
  const [note, setNote] = useState(false);
  useEffect(() => {
    if (!note) return undefined;
    const t = setTimeout(() => setNote(false), 5000);
    return () => clearTimeout(t);
  }, [note]);

  const look = `btn whitespace-nowrap bg-[#5865F2] text-white hover:bg-[#4752c4] ${className}`;
  const body = (
    <>
      <SocialIcon name="discord" />
      {children}
    </>
  );
  if (me.discordEnabled) {
    return (
      <a href="/api/auth/discord" className={look}>
        {body}
      </a>
    );
  }
  return (
    <span className={floating ? "relative inline-block" : "inline-block"}>
      <button type="button" className={look} onClick={() => setNote((n) => !n)} aria-describedby={note ? "discord-note" : undefined}>
        {body}
      </button>
      {note && (
        <span
          id="discord-note"
          role="status"
          className={
            floating
              ? "rise absolute right-0 top-full z-40 mt-2 w-64 rounded-xl border border-line bg-card px-4 py-3 text-left text-sm text-muted shadow-2xl"
              : "rise mt-2 flex items-center gap-1.5 text-xs text-muted"
          }
        >
          {!floating && (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11v5M12 8h.01" strokeLinecap="round" />
            </svg>
          )}
          Discord login isn't set up on this server yet.
        </span>
      )}
    </span>
  );
}
