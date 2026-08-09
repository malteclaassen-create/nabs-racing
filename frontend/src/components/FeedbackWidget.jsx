import { useCallback, useEffect, useRef, useState } from "react";
import { useDismiss, useFocusTrap, useScrollLock } from "./overlay.jsx";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api/client.js";
import { useAuth } from "../hooks/useAuth.js";
import SlidingTabs from "./SlidingTabs.jsx";

// ---------------------------------------------------------------------------
// "Something broken? Something missing?" — the site's own way back to the
// admins. A small floating button in the bottom right corner on DESKTOP only;
// on a phone the corner belongs to the page (and to the thumb), so the same
// panel is opened from the "Feedback" row in the burger menu instead, which
// fires the `nabs-feedback-open` event this component listens for.
//
// Everyone may write, signed in or not: whoever runs into a broken page is
// exactly the person worth hearing from. A signed-in member's report carries
// their name automatically; a visitor can leave a contact line if they want an
// answer. Everything lands in the admin's Feedback tab, nothing is public.
// ---------------------------------------------------------------------------

// Other components ask for the panel by firing this on `window` (see NavBar).
export const FEEDBACK_OPEN_EVENT = "nabs-feedback-open";

export function openFeedback() {
  window.dispatchEvent(new Event(FEEDBACK_OPEN_EVENT));
}

const KINDS = [
  { key: "BUG", label: "Bug" },
  { key: "IDEA", label: "Idea" },
  { key: "OTHER", label: "Other" },
];

const PROMPTS = {
  BUG: "What went wrong, and where? The more precise, the easier to fix.",
  IDEA: "What would you like the site to do?",
  OTHER: "Anything else you want the admins to know?",
};

// A message on its way: the paper dart, with the fold line that turns it from a
// flat arrowhead into a thing being sent. Same 24px grid and 2px round-capped
// stroke as every other icon on the site.
//
// It replaces a speech bubble, which said the wrong thing. A bubble in the
// bottom right corner of a website is the universal mark of a support chat —
// and, since every assistant on the internet took that same corner and that
// same shape, of a bot waiting to talk. Nobody is waiting here: what you write
// is sent to the league's admins and answered when one of them reads it.
//
// NO optical nudge, and it took a measurement to see why not. The dart is drawn
// as an outline, not a solid, so it has no lopsided mass to correct for: its ink
// spans 2.45→21.5 across and 2.5→21.55 down, which is the middle of the 24 grid
// to within a twentieth of a unit. A 1px lift "for the weight of the shape" was
// tried, and 1px is precisely how far off-centre it then sat in the button.
function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* The dart, then the crease from its nose down to the notch. */}
      <path d="M21.5 2.5 2.8 10.1a.6.6 0 0 0 .05 1.11l7.3 2.64 2.64 7.3a.6.6 0 0 0 1.11.05z" />
      <path d="M21.5 2.5 10.15 13.85" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export default function FeedbackWidget() {
  const location = useLocation();
  const { user, isLoggedIn } = useAuth();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("BUG");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);
  const textRef = useRef(null);
  const panelRef = useRef(null);
  const fabRef = useRef(null);

  const close = useCallback(() => setOpen(false), []);

  // The mobile menu (and anything else that wants to) opens the panel by event.
  useEffect(() => {
    const onOpen = () => {
      setSent(false);
      setError(null);
      setOpen(true);
    };
    window.addEventListener(FEEDBACK_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(FEEDBACK_OPEN_EVENT, onOpen);
  }, []);

  // Escape, the click outside, the focus trap and the scroll lock all come from
  // the shared overlay layer. The panel keeps its own markup because it is
  // anchored to its floating button on desktop rather than centred, which none
  // of the Modal shells describe — but it should still behave like a dialog,
  // and on a phone it IS one: a full-height sheet that used to let the page
  // scroll away underneath it.
  useDismiss(open, close, { ref: panelRef, anchorRef: fabRef });
  useFocusTrap(open, panelRef, { initialFocus: sent ? undefined : textRef });
  useScrollLock(open);

  // Walking off to another page closes it: the report names the page it was
  // written on, so a panel left open across a navigation would report the
  // wrong one.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // The admin has the whole Feedback tab; a button pointing back at itself
  // would only be in the way.
  if (location.pathname.startsWith("/admin")) return null;

  async function send() {
    if (message.trim().length < 5) {
      setError("Please write a little more so we know what you mean.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.sendFeedback({
        kind,
        message,
        contact: isLoggedIn ? null : contact,
        // Where they were when they wrote it — half a bug report on its own.
        pageUrl: location.pathname + location.search,
      });
      setSent(true);
      setMessage("");
      setContact("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // A circle by default, at rest, whatever the page is doing. It used to widen
  // into the labelled pill on its own whenever you scrolled back up, which put
  // the button through a shape change nobody had asked for — and it happened
  // exactly when you were heading back up the page to read something. The word
  // is one hover away, which is when you are actually looking at it.
  //
  // The open panel is the exception: the button is that panel's header row, and
  // a circle sitting under it would read as a different control.
  const collapsed = !open;

  function toggle() {
    setSent(false);
    setError(null);
    setOpen((o) => !o);
  }

  return (
    <>
      {/* The floating button. Desktop only, on purpose: on a phone a permanent
          corner button covers content and sits where the thumb scrolls.
          A circle that unrolls into the labelled pill when you point at it (or
          tab to it — the word is the only thing that names this control, so it
          has to appear for the keyboard too), and stays a pill while the panel
          below it is open.

          The icon does not move while it unrolls, and that takes two things.
          The content is packed to the LEFT rather than centred: a centred row
          inside a fixed-width pill is positioned by how wide the word happens
          to render, and the icon slid 10.6px to the right as the pill opened —
          the one part of this that was supposed to stand still. And the pill is
          only as wide as it needs to be (13 + 20 icon + 8 + 67 for the word +
          16 + 2 border = 126, so 128), instead of the 148 it had, which is
          where those spare pixels came from.

          13px, not the 14 the scale would offer, because the 1px border counts:
          the circle is 48 across with 46 inside it, and a 20px icon sits in the
          middle of THAT with 13 either side. So packing left and centring are
          the same thing in the circle, and the icon does not have to move when
          the pill grows out to the right of it. */}
      <button
        type="button"
        ref={fabRef}
        onClick={toggle}
        aria-expanded={open}
        data-tour="feedback-fab"
        title="Report a bug or suggest a feature"
        className={`fab-morph group fixed bottom-6 right-6 z-chrome hidden h-12 items-center justify-start overflow-hidden rounded-full border border-border bg-card pl-[13px] text-sm font-bold text-medium shadow-lg shadow-ink/10 transition-[width,padding,color,border-color] duration-base ease-out-soft hover:border-brand/50 hover:text-dark lg:flex ${
          collapsed
            ? "w-12 pr-0 hover:w-32 hover:pr-4 focus-visible:w-32 focus-visible:pr-4"
            : "w-32 pr-4"
        } ${open ? "border-brand/50 text-dark" : ""}`}
      >
        <span className="shrink-0 text-brand">{open ? <CloseIcon /> : <SendIcon />}</span>
        <span
          className={`fab-morph overflow-hidden whitespace-nowrap transition-[max-width,opacity,margin] duration-base ease-out-soft ${
            collapsed
              ? "ml-0 max-w-0 opacity-0 group-hover:ml-2 group-hover:max-w-[6rem] group-hover:opacity-100 group-focus-visible:ml-2 group-focus-visible:max-w-[6rem] group-focus-visible:opacity-100"
              : "ml-2 max-w-[6rem] opacity-100"
          }`}
        >
          Feedback
        </span>
      </button>

      {open && (
        <>
          {/* The scrim. On a phone the panel is a sheet over the page and this
              dims what it covers; on desktop it stays invisible. It used to be
              a real <button> doing the closing as well, which put a second
              "Close feedback" control in the tab order for no visual reason —
              useDismiss above closes on any click outside the panel now, so
              this is nothing but the dimming. */}
          <div
            aria-hidden="true"
            className="fixed inset-0 z-scrim bg-ink/40 backdrop-blur-sm lg:bg-transparent lg:backdrop-blur-none"
          />
          {/* Bottom sheet on phones, a card above the button on desktop. */}
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Feedback"
            className="notif-pop fixed inset-x-0 bottom-0 z-overlay max-h-[88dvh] overflow-y-auto rounded-t-2xl border border-border bg-card p-5 shadow-2xl shadow-ink/30 lg:inset-x-auto lg:bottom-20 lg:right-6 lg:w-[23rem] lg:rounded-2xl"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">
                  {sent ? "Thanks" : "Feedback"}
                </h2>
                <p className="mt-0.5 font-mono text-[11px] font-bold uppercase tracking-wider text-eyebrow">
                  {sent ? "Sent to the league admins" : "Bugs & ideas"}
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-light transition hover:bg-surface2 hover:text-dark"
              >
                <CloseIcon />
              </button>
            </div>

            {sent ? (
              <div className="space-y-4">
                <p className="text-sm leading-relaxed text-medium">
                  Your message is with the admins. If it was a bug, it helps to know they can see which page
                  you were on and what browser you use.
                </p>
                {isLoggedIn && (
                  <p className="text-sm leading-relaxed text-medium">
                    If they answer, you get a notification and can write back on{" "}
                    <Link to="/feedback" onClick={close} className="transition font-semibold text-link hover:underline">
                      your messages page
                    </Link>
                    .
                  </p>
                )}
                <div className="flex gap-2">
                  <button type="button" onClick={() => setSent(false)} className="btn-secondary flex-1">
                    Write another
                  </button>
                  <button type="button" onClick={close} className="btn-primary flex-1">
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <SlidingTabs
                  items={KINDS}
                  value={kind}
                  onChange={setKind}
                  wrapClassName="flex w-full rounded-xl border border-border bg-surface2/50 p-1"
                  btnClassName="flex-1 px-2 py-1.5 text-xs"
                />

                <textarea
                  ref={textRef}
                  className="input min-h-[7.5rem] resize-y leading-relaxed"
                  rows={5}
                  maxLength={2000}
                  placeholder={PROMPTS[kind]}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />

                {!isLoggedIn && (
                  <input
                    className="input"
                    maxLength={200}
                    placeholder="Discord name or email (optional)"
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                  />
                )}

                <p className="text-xs leading-relaxed text-light">
                  {isLoggedIn ? (
                    <>
                      Sent as {user?.driverName || user?.discordName || "your account"}, along with the page
                      you&rsquo;re on. Answers land in your bell and on{" "}
                      <Link to="/feedback" onClick={close} className="transition font-semibold text-link hover:underline">
                        your messages page
                      </Link>
                      .
                    </>
                  ) : (
                    "Nobody needs an account for this. Leave a name above if you'd like an answer."
                  )}
                </p>

                {error && <p className="text-sm font-medium text-bad">{error}</p>}

                <button type="button" onClick={send} disabled={busy} className="btn-primary w-full">
                  {busy ? "Sending..." : "Send"}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
