import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "../hooks/useTheme.js";
import { useGraphics } from "../hooks/useGraphics.js";

function GearIcon() {
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

// A small two/three-option segmented control.
function Segmented({ value, options, onChange }) {
  return (
    <div className="flex rounded-xl border border-border bg-surface2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition ${
            value === o.value ? "bg-card text-dark shadow-sm ring-1 ring-border" : "text-light hover:text-medium"
          }`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Gear button that opens a right-hand settings drawer (theme + graphics).
// Replaces the old standalone theme toggle in the nav.
export default function SettingsButton({ className = "" }) {
  const [render, setRender] = useState(false); // mounted in the DOM
  const [show, setShow] = useState(false); // animated into place
  const { theme, toggle } = useTheme();
  const { mode, setMode } = useGraphics();

  function openPanel() {
    setRender(true);
    // Next frame: flip to the visible state so the CSS transition plays in.
    requestAnimationFrame(() => setShow(true));
  }
  function closePanel() {
    setShow(false); // animate out…
    setTimeout(() => setRender(false), 220); // …then unmount after the transition
  }

  useEffect(() => {
    if (!render) return;
    const onKey = (e) => e.key === "Escape" && closePanel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [render]);

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        aria-label="Settings"
        title="Settings"
        className={`flex items-center justify-center rounded-lg text-light transition hover:bg-surface2 ${className}`}
      >
        <GearIcon />
      </button>

      {render &&
        createPortal(
          <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Settings">
            <div
              className={`settings-anim absolute inset-0 bg-ink/40 transition-opacity duration-200 ${show ? "opacity-100" : "opacity-0"}`}
              onClick={closePanel}
            />
            <aside
              className={`settings-anim absolute right-0 top-0 flex h-full w-80 max-w-[85vw] flex-col border-l border-border bg-card shadow-2xl transition-transform duration-200 ${show ? "translate-x-0" : "translate-x-full"}`}
            >
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <h2 className="font-display text-lg font-extrabold uppercase tracking-tight text-dark">Settings</h2>
                <button
                  type="button"
                  onClick={closePanel}
                  aria-label="Close settings"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-light transition hover:bg-surface2"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>

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
              </div>
            </aside>
          </div>,
          document.body
        )}
    </>
  );
}
