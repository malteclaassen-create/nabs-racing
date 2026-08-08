import { useState } from "react";
import { useTheme } from "../hooks/useTheme.js";
import { useGraphics } from "../hooks/useGraphics.js";
import { useAuth } from "../hooks/useAuth.js";
import SlidingTabs from "./SlidingTabs.jsx";
import { Modal } from "./overlay.jsx";

export function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
    </svg>
  );
}
function FeatherIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5zM16 8 2 22M17.5 15H9" />
    </svg>
  );
}

// A small two/three-option segmented control (sliding active pill).
function Segmented({ value, options, onChange }) {
  return (
    <SlidingTabs
      wrapClassName="flex rounded-xl border border-border bg-surface2 p-1"
      btnClassName="flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-sm font-semibold"
      pillClassName="rounded-lg bg-card shadow-sm ring-1 ring-border"
      activeClassName="text-dark"
      idleClassName="text-light hover:text-medium"
      items={options.map((o) => ({
        key: o.value,
        label: (
          <span className="inline-flex items-center gap-1.5">
            {o.icon}
            {o.label}
          </span>
        ),
      }))}
      value={value}
      onChange={onChange}
    />
  );
}

// The right-hand settings drawer (theme + graphics), controlled from outside
// via `open`/`onClose` so it can sit behind any trigger — the notification
// bell's "Settings" row today, the standalone gear button below as a fallback.
export function SettingsDrawer({ open, onClose }) {
  const { theme, toggle } = useTheme();
  const { mode, setMode } = useGraphics();
  const { user, isLoggedIn, logout } = useAuth();
  const closePanel = onClose;

  // Everything this used to do by hand — mount/unmount around the transition,
  // the Escape listener, the portal, the scrim — now comes from <Modal>, plus
  // the three things it never did: focus goes into the drawer, Tab stays
  // inside it, and closing hands focus back to whatever opened it.
  return (
    <Modal open={open} onClose={closePanel} title="Settings" variant="drawer" closeLabel="Close settings">
      <div className="space-y-6 p-5">
        <section>
          <h3 className="mb-2 font-mono text-[11px] font-bold uppercase tracking-wider text-light">Appearance</h3>
          <Segmented
            value={theme}
            onChange={(v) => v !== theme && toggle()}
            options={[
              { value: "light", label: "Light", icon: <SunIcon /> },
              { value: "dark", label: "Dark", icon: <MoonIcon /> },
            ]}
          />
        </section>

        <section>
          <h3 className="mb-2 font-mono text-[11px] font-bold uppercase tracking-wider text-light">Performance</h3>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "full", label: "Full", icon: <BoltIcon /> },
              { value: "lite", label: "Lite", icon: <FeatherIcon /> },
            ]}
          />
          <p className="mt-2 text-xs leading-relaxed text-light">
            Lite turns off blur and animations for smoother performance on slower
            machines or when your browser&rsquo;s hardware acceleration is off.
          </p>
        </section>

        {/* Account: the sign-out moved here from the profile header. */}
        {isLoggedIn && (
          <section>
            <h3 className="mb-2 font-mono text-[11px] font-bold uppercase tracking-wider text-light">Account</h3>
            <button
              type="button"
              onClick={() => {
                logout();
                closePanel();
              }}
              className="flex w-full items-center justify-between rounded-xl border border-border bg-surface2 px-4 py-3 text-sm font-semibold text-dark transition hover:border-red-400/60 hover:text-bad"
            >
              <span>Sign out{user?.driverName ? ` (${user.driverName})` : ""}</span>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
            </button>
          </section>
        )}
      </div>
    </Modal>
  );
}

// Standalone gear button owning its drawer. No longer in the nav bar (the
// notification bell took its slot and opens the drawer from its menu), kept
// for any place that wants a direct settings trigger.
export default function SettingsButton({ className = "" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Settings"
        title="Settings"
        className={`flex items-center justify-center rounded-lg text-light transition hover:bg-surface2 ${className}`}
      >
        <GearIcon />
      </button>
      <SettingsDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
