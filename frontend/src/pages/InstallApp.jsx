import { useEffect, useMemo, useState } from "react";
import { PageHeader, SectionHeading, Notice } from "../components/ui.jsx";
import { useSpecificTitle } from "../utils/pageTitle.js";

// ---------------------------------------------------------------------------
// "Add NABS to your phone" — the install walkthrough.
//
// The site is already installable: index.html links /site.webmanifest, which
// carries the name, the icons and display:standalone. What was missing is that
// nobody knows, because the browsers hide it. Chrome buries "Add to Home
// screen" three taps into the ⋮ menu and iOS Safari puts it halfway down the
// share sheet, so the feature has existed the whole time and gone unused.
//
// The steps live in browser CHROME, not on the page, which is why this is a
// page and not one of the guided tours in Tour.jsx: that engine spotlights
// elements by `data-tour` selector, and nothing here is an element the site
// can point at. What it can do is name the button, draw its icon, and say
// where it sits.
//
// One-tap install is offered where the browser offers it (`beforeinstallprompt`
// — Chrome and the Chromium browsers) and the written steps stay underneath
// regardless, because that event never fires on iOS at all and doesn't fire in
// Firefox or in a browser that has already dismissed the prompt. The written
// path is the one that always works; the button is the shortcut.
// ---------------------------------------------------------------------------

// Which set of steps to open on. UA sniffing is the wrong tool for feature
// detection and the right one here: what we need to know is which physical
// menu the reader is looking at, and that IS the operating system.
//
// iPadOS 13+ reports itself as a Mac, so a touch-capable "Mac" is an iPad —
// without that check every iPad reader is shown the Android steps.
function detectPlatform() {
  if (typeof navigator === "undefined") return "android";
  const ua = navigator.userAgent || "";
  const iPadOS = /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPadOS) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

// Already running as an installed app? Then the whole page is moot and says so
// rather than teaching someone to do what they have done. `standalone` is the
// old iOS-only flag; the media query is the standard one everywhere else.
function detectInstalled() {
  if (typeof window === "undefined") return false;
  const mq = window.matchMedia?.("(display-mode: standalone)")?.matches;
  return !!(mq || window.navigator?.standalone);
}

/* --- the little icons the steps refer to --------------------------------- */
// Drawn rather than described, because "the share button" means nothing until
// you have seen the square-with-an-arrow — and the two menus these live in are
// the whole difficulty of the task.

const iconProps = {
  viewBox: "0 0 24 24",
  className: "h-full w-full",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

// iOS share sheet: a box with an arrow coming out of the top.
function ShareIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 3v13" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 13v6a1 1 0 001 1h12a1 1 0 001-1v-6" />
    </svg>
  );
}

// Chrome's overflow menu: three dots stacked.
function DotsIcon() {
  return (
    <svg {...iconProps} fill="currentColor" stroke="none">
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </svg>
  );
}

// "Add to Home Screen": a square with a plus in it.
function AddSquareIcon() {
  return (
    <svg {...iconProps}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <path d="M12 8.5v7M8.5 12h7" />
    </svg>
  );
}

// The home-screen icon itself, for the last step of each list.
function GridIcon() {
  return (
    <svg {...iconProps}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg {...iconProps}>
      <rect x="6" y="2.5" width="12" height="19" rx="3" />
      <path d="M10.5 5.5h3" />
    </svg>
  );
}

/* --- the steps ------------------------------------------------------------ */
//
// Deliberately written to the BUTTON the reader is hunting for, not to an
// abstract description of it: the label in quotes is the label on their screen.
// Android's wording moved with Chrome 12x ("Add to Home screen" became
// "Install app" on many builds and both are still out there), so the step names
// both rather than sending somebody looking for a menu row that isn't there.

const STEPS = {
  android: [
    {
      icon: <DotsIcon />,
      title: "Open the browser menu",
      body: "In Chrome, tap the three dots at the top right of the screen (Samsung Internet: the three lines at the bottom right).",
    },
    {
      icon: <AddSquareIcon />,
      title: 'Tap "Install app" or "Add to Home screen"',
      body: "Both wordings are in the wild depending on your Chrome version, and they do the same thing. In Samsung Internet it's under \"Add page to\".",
    },
    {
      icon: <PhoneIcon />,
      title: "Confirm with Install",
      body: "You can rename it first if you like. Android may then ask whether to place the icon automatically. Either answer is fine.",
    },
    {
      icon: <GridIcon />,
      title: "It's on your home screen",
      body: "The pink NABS badge sits with your other apps and opens full screen, without the browser bar.",
    },
  ],
  ios: [
    {
      icon: <ShareIcon />,
      title: "Tap the Share button",
      body: "The square with the arrow pointing out of it. In Safari it sits at the bottom of the screen on an iPhone, and top right on an iPad.",
    },
    {
      icon: <AddSquareIcon />,
      title: 'Scroll down to "Add to Home Screen"',
      body: "It sits below the row of apps, a fair way down the list. If you can't find it, tap \"Edit Actions\" at the very bottom and switch it on.",
    },
    {
      icon: <PhoneIcon />,
      title: 'Tap "Add"',
      body: "Top right of the sheet. The name under the icon is yours to change first.",
    },
    {
      icon: <GridIcon />,
      title: "It's on your home screen",
      body: "It opens full screen with no address bar, and it remembers your login, so you stay signed in.",
    },
  ],
  desktop: [
    {
      icon: <AddSquareIcon />,
      title: "Look in the address bar",
      body: "In Chrome or Edge, an install icon (a screen with an arrow, or a ⊕) appears at the right-hand end of the address bar. Click it, then Install.",
    },
    {
      icon: <DotsIcon />,
      title: "Or use the browser menu",
      body: 'Chrome: ⋮ → Cast, save and share → Install page as app. Edge: ⋯ → Apps → Install this site as an app.',
    },
    {
      icon: <GridIcon />,
      title: "It opens in its own window",
      body: "No tabs, no address bar, and it gets its own icon in your dock or taskbar.",
    },
  ],
};

const TABS = [
  { key: "android", label: "Android" },
  { key: "ios", label: "iPhone & iPad" },
  { key: "desktop", label: "Computer" },
];

export default function InstallApp() {
  useSpecificTitle("Add NABS to your phone · NABS Racing League");

  const detected = useMemo(detectPlatform, []);
  const [tab, setTab] = useState(detected);
  const [installed, setInstalled] = useState(detectInstalled);
  // The deferred `beforeinstallprompt` event, when the browser gave us one.
  const [prompt, setPrompt] = useState(null);
  const [prompting, setPrompting] = useState(false);

  // Chrome fires this instead of showing its own mini-infobar, and hands over
  // an event we can replay later from a click of our own. It can arrive before
  // this page is ever opened, so App.jsx catches it at startup and parks it on
  // window.__nabsInstallPrompt; the listener here is for the case where it
  // fires while the page is already up.
  useEffect(() => {
    if (window.__nabsInstallPrompt) setPrompt(window.__nabsInstallPrompt);
    const onPrompt = (e) => {
      e.preventDefault();
      window.__nabsInstallPrompt = e;
      setPrompt(e);
    };
    // Fires the moment the install completes, so the page can switch to its
    // "you're done" state without a reload.
    const onInstalled = () => {
      window.__nabsInstallPrompt = null;
      setPrompt(null);
      setInstalled(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!prompt) return;
    setPrompting(true);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      // A prompt is single-use: whatever the answer, Chrome will not accept the
      // same event twice, so the button has to go and the written steps below
      // become the way back in.
      window.__nabsInstallPrompt = null;
      setPrompt(null);
      if (choice?.outcome === "accepted") setInstalled(true);
    } catch {
      window.__nabsInstallPrompt = null;
      setPrompt(null);
    } finally {
      setPrompting(false);
    }
  }

  const steps = STEPS[tab] || STEPS.android;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="On your phone"
        title="Add NABS as an app"
        subtitle="Put the league on your home screen and it opens like any other app: full screen, no address bar, still signed in. It takes about ten seconds and installs nothing from an app store."
      />

      {installed ? (
        <div className="mb-6">
          <Notice kind="success">
            You're already running NABS as an app. This page is the instructions for a device that isn't.
          </Notice>
        </div>
      ) : null}

      {/* The shortcut, where the browser hands us one. Above the steps because
          when it IS there it replaces all four of them. */}
      {prompt && !installed && (
        <div className="card mb-6 flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-lg font-bold uppercase tracking-tight text-dark">
              Your browser can do this in one tap
            </h2>
            <p className="mt-1 text-sm text-light">
              No menu-hunting needed. Install it straight from here.
            </p>
          </div>
          <button
            type="button"
            onClick={install}
            disabled={prompting}
            className="shrink-0 rounded-lg bg-brand px-5 py-2.5 font-display text-sm font-bold uppercase tracking-wide text-ink transition hover:brightness-105 disabled:opacity-60"
          >
            {prompting ? "Installing…" : "Install NABS"}
          </button>
        </div>
      )}

      {/* Platform switch. It opens on the device you're holding, but stays a
          switch: half the time somebody is reading this on a laptop in order to
          tell a team-mate what to press on their phone. */}
      <div
        role="tablist"
        aria-label="Choose your device"
        className="mb-6 flex gap-1 rounded-xl border border-border bg-card p-1"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-lg px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-wider transition sm:text-xs ${
              tab === t.key ? "bg-brand text-ink" : "text-light hover:bg-surface2 hover:text-dark"
            }`}
          >
            {t.label}
            {t.key === detected && (
              <span className="ml-1.5 hidden font-sans text-[10px] font-semibold normal-case tracking-normal opacity-70 sm:inline">
                yours
              </span>
            )}
          </button>
        ))}
      </div>

      <SectionHeading
        eyebrow="Step by step"
        title={tab === "ios" ? "On an iPhone or iPad" : tab === "android" ? "On Android" : "On a computer"}
      />

      <ol className="card divide-y divide-border overflow-hidden">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-4 p-5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 font-display text-base font-black tabular-nums text-eyebrow">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-base font-bold uppercase tracking-tight text-dark">
                {s.title}
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-light">{s.body}</p>
            </div>
            {/* The icon is the point on a phone — "the share button" is a
                shape people recognise long before they recognise the words —
                so it shows at every width and merely grows on a big screen. */}
            <span className="mt-0.5 h-5 w-5 shrink-0 text-light sm:h-6 sm:w-6">{s.icon}</span>
          </li>
        ))}
      </ol>

      {tab === "ios" && (
        <p className="mt-4 text-sm leading-relaxed text-light">
          It has to be <span className="font-semibold text-medium">Safari</span> on iPhone and iPad. Chrome
          and Firefox on iOS can add a bookmark, but only Safari's share sheet creates the real app icon.
        </p>
      )}

      <div className="mt-10">
        <SectionHeading eyebrow="Why bother" title="What you get" />
      </div>
      <ul className="card space-y-3 p-5 text-sm leading-relaxed text-light">
        <li className="flex gap-3">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
          <span>
            <span className="font-semibold text-medium">Race night in one tap.</span> Live timing straight
            from the home screen instead of a bookmark three menus deep.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
          <span>
            <span className="font-semibold text-medium">The whole screen.</span> No address bar and no
            browser tabs, which on a phone is most of a standings table's worth of room.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
          <span>
            <span className="font-semibold text-medium">You stay signed in.</span> Your Discord login
            carries over, so sign-ups and your Personal Area are there without logging in again.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
          <span>
            <span className="font-semibold text-medium">Nothing to uninstall.</span> It's the website with
            an icon, not a download. No store account, and removing it is a long-press away.
          </span>
        </li>
      </ul>

      <p className="mt-6 text-sm leading-relaxed text-light">
        Notifications about results, race days and sign-ups keep arriving in the bell at the top of the
        page. The app icon doesn't change where they land.
      </p>
    </div>
  );
}
