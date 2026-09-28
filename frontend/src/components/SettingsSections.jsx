import { Link } from "react-router-dom";
import SlidingTabs from "./SlidingTabs.jsx";
import { useTheme } from "../hooks/useTheme.js";
import { useGraphics } from "../hooks/useGraphics.js";
import { useDesign, DESIGNS } from "../hooks/useDesign.js";
import { useAuth } from "../hooks/useAuth.js";
import { useProfileHome } from "../hooks/useProfileHome.js";
import { useChangelogUnseen } from "../hooks/useChangelogSeen.js";
import { PROFILE_HOME_PERSONAL, PROFILE_HOME_PUBLIC } from "../hooks/profileHome.mjs";

// ---------------------------------------------------------------------------
// The settings themselves: theme, design, performance, where your own name in the bar
// leads, and the way out of the account.
//
// They live in TWO places, which is why they are a component rather than a
// page:
//
//   /profile?tab=settings  for a member — a panel of the personal area beside
//                          Edit Profile, My Rating and Telemetry, because that
//                          is where everything else about you already is.
//   /settings              for a visitor, who has no personal area to put a
//                          panel in but still wants the light theme or the
//                          Lite mode. The bell is where they find it.
//
// Everything here is stored in this browser (localStorage), not on the
// account: the theme and the performance mode always were, and "where your
// picture takes you" belongs to the device you are reading on for the same
// reason — a phone and a desktop are used differently. The panel says so,
// so nobody wonders why their laptop did not follow.
// ---------------------------------------------------------------------------

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
function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" />
    </svg>
  );
}

// A small two-option segmented control (sliding active pill).
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

// The design picker: one tile per design, each showing its own page, card and
// inset colours in the theme you are on, so you can see what you pick before
// you pick it. A radio group underneath, because only one can be on.
function DesignPicker({ value, theme, onChange }) {
  return (
    <div role="radiogroup" aria-label="Design" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {DESIGNS.map((d) => {
        const [page, card, inset] = theme === "dark" ? d.dark : d.light;
        const on = d.value === value;
        return (
          <button
            key={d.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(d.value)}
            title={d.hint}
            className={`group rounded-xl border p-2 text-left transition ${
              on ? "border-accent bg-accent/5 ring-1 ring-accent" : "border-border hover:border-accent/40"
            }`}
          >
            {/* A tiny page: the background, a card on it, and an inset row
                with the series colour in it, as the real pages are built. */}
            <span className="block overflow-hidden rounded-lg border border-black/10" style={{ background: page }}>
              <span className="m-2 block rounded-md p-1.5 shadow-sm" style={{ background: card }}>
                <span className="block h-1.5 w-2/3 rounded-full bg-brand" />
                <span className="mt-1.5 block h-2.5 rounded" style={{ background: inset }} />
              </span>
            </span>
            <span className="mt-2 flex items-center justify-between gap-2 px-0.5">
              <span className={`text-sm font-semibold ${on ? "text-dark" : "text-medium"}`}>{d.label}</span>
              {on && (
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// One setting: its name, the control, and — where it earns one — a line saying
// what the choice actually does.
function Setting({ title, hint, children }) {
  return (
    <section className="border-t border-border px-5 py-5 first:border-t-0 sm:px-6">
      <h3 className="mb-2 font-mono text-[11px] font-bold uppercase tracking-wider text-light">{title}</h3>
      {children}
      {hint && <p className="mt-2 text-xs leading-relaxed text-light">{hint}</p>}
    </section>
  );
}

function Card({ eyebrow, children }) {
  return (
    <div className="card overflow-hidden">
      {eyebrow && (
        <div className="border-b border-border bg-surface2/40 px-5 py-3 font-display text-sm font-extrabold uppercase tracking-wide text-dark sm:px-6">
          {eyebrow}
        </div>
      )}
      {children}
    </div>
  );
}

export default function SettingsSections() {
  const { theme, toggle } = useTheme();
  const { mode: fx, setMode: setFx } = useGraphics();
  const { design, setDesign } = useDesign();
  const { user, isLoggedIn, logout } = useAuth();
  const { mode: profileHome, setMode: setProfileHome } = useProfileHome();
  const changelogUnseen = useChangelogUnseen();

  return (
    // Capped: beside the profile editor the panel has the full column to fill,
    // and a segmented control stretched over a thousand pixels reads as a
    // banner rather than a switch. The standalone page is this wide anyway.
    <div className="max-w-2xl space-y-6">
      <Card eyebrow="The site">
        <Setting
          title="Appearance"
          hint="Kept in this browser — a phone and a desktop each keep their own."
        >
          <Segmented
            value={theme}
            onChange={(v) => v !== theme && toggle()}
            options={[
              { value: "light", label: "Light", icon: <SunIcon /> },
              { value: "dark", label: "Dark", icon: <MoonIcon /> },
            ]}
          />
        </Setting>

        <Setting
          title="Design"
          hint={`${DESIGNS.find((d) => d.value === design)?.hint || ""} Works with both Light and Dark.`}
        >
          <DesignPicker value={design} theme={theme} onChange={setDesign} />
        </Setting>

        <Setting
          title="Performance"
          hint="Lite turns off blur and animations for smoother performance on slower machines or when your browser’s hardware acceleration is off."
        >
          <Segmented
            value={fx}
            onChange={setFx}
            options={[
              { value: "full", label: "Full", icon: <BoltIcon /> },
              { value: "lite", label: "Lite", icon: <FeatherIcon /> },
            ]}
          />
        </Setting>
        <Setting title="What's new">
          <Link
            to="/changelog"
            className="flex w-full items-center justify-between rounded-xl border border-border bg-surface2 px-4 py-3 text-sm font-semibold text-dark transition hover:border-accent/40"
          >
            <span className="flex items-center gap-2">
              Changelog
              {changelogUnseen && (
                <span className="rounded-md bg-brand px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-onbrand">
                  New
                </span>
              )}
            </span>
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-light" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </Link>
        </Setting>
      </Card>

      {/* Only a signed-in member has a picture in the bar to press, so this
          setting is only a question for one. */}
      {isLoggedIn && (
        <Card eyebrow="Your profile">
          <Setting
            title="Tapping your name opens"
            hint={
              profileHome === PROFILE_HOME_PUBLIC
                ? "Your picture in the bar opens the page everyone else sees. My Profile is a button on it."
                : "Your picture in the bar opens your own area — editing, rating, points and the rest. Your public page is a button on it."
            }
          >
            <Segmented
              value={profileHome}
              onChange={setProfileHome}
              options={[
                { value: PROFILE_HOME_PERSONAL, label: "My Profile", icon: <UserIcon /> },
                { value: PROFILE_HOME_PUBLIC, label: "Public page", icon: <GlobeIcon /> },
              ]}
            />
          </Setting>
        </Card>
      )}

      {/* Account: the sign-out that used to live in the settings drawer. */}
      {isLoggedIn && (
        <Card eyebrow="Account">
          <Setting title="Signed in">
            <button
              type="button"
              onClick={logout}
              className="flex w-full items-center justify-between rounded-xl border border-border bg-surface2 px-4 py-3 text-sm font-semibold text-dark transition hover:border-red-400/60 hover:text-bad"
            >
              <span>Sign out{user?.driverName ? ` (${user.driverName})` : ""}</span>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
            </button>
            {/* Leaving for good. Quiet, underneath, and a link rather than a
                button: it opens a page that explains what goes and what stays
                before anything happens. Members must be able to find this
                without asking an admin (and an app store looks for it). */}
            <Link
              to="/delete-account"
              className="mt-2 inline-block text-xs font-semibold text-light transition hover:text-bad hover:underline"
            >
              Delete my account
            </Link>
          </Setting>
        </Card>
      )}
    </div>
  );
}
