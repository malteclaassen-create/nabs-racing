import { Link } from "react-router-dom";

// ---------------------------------------------------------------------------
// The way IN to the settings — the gear, and nothing else.
//
// The settings themselves used to live here, in a drawer that slid in from the
// right. They are a page now (pages/Settings.jsx, at /settings): an address you
// can link to, bookmark and share, with room for a setting that needs a
// sentence of explanation. What is left here is the mark that opens it, kept in
// one place so the bell, the profile navigation and anything added later all
// wear the same gear.
// ---------------------------------------------------------------------------

export function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// Standalone gear. A real link now rather than a button opening an overlay, so
// it can be middle-clicked and opened in a new tab like any other navigation.
export default function SettingsButton({ className = "", onClick }) {
  return (
    <Link
      to="/settings"
      onClick={onClick}
      aria-label="Settings"
      title="Settings"
      className={`flex items-center justify-center rounded-lg text-light transition hover:bg-surface2 ${className}`}
    >
      <GearIcon />
    </Link>
  );
}
