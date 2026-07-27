import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
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

// The standard speech bubble: a rounded rectangle with a tail dropping from its
// bottom left corner. One closed path, drawn on the same 24px grid as every
// other icon on the site — the hand-drawn bubble it replaces had a lopsided
// tail and two text lines of different lengths inside it.
//
// The 1.5px nudge is optical, not a fix for a wrong box: the icon's box IS
// centred on the label already, but the bubble's body only fills the top 14 of
// its 24 units and the tail below it is a thin line, so the weight of the shape
// sits high and it read as floating above the word. Pushed down, the body sits
// on the same band as the capital F.
function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 translate-y-[1.5px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
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

// Scrolling DOWN pulls the button in to a bare circle, scrolling back up lets
// it grow into the full pill again — out of the way while you're reading, named
// again the moment you look up. A plain passive listener rather than the
// rAF-throttled kind the nav's progress line uses: that one writes a transform
// every frame, this one only compares two numbers and flips a boolean React
// bails out of when it hasn't changed.
function useShrinkOnScrollDown() {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      // Back at the top it is always the full pill, whichever way you got there.
      if (y <= 80) {
        setCompact(false);
        last = y;
        return;
      }
      const delta = y - last;
      // A few pixels of slack, so trackpad jitter and the bounce at the end of
      // a page don't make it flicker between the two shapes.
      if (Math.abs(delta) <= 6) return;
      setCompact(delta > 0);
      last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return compact;
}

export default function FeedbackWidget() {
  const location = useLocation();
  const { user, isLoggedIn } = useAuth();
  const shrunk = useShrinkOnScrollDown();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("BUG");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);
  const textRef = useRef(null);

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

  // Escape closes, like every other overlay on the site.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Straight into the box — the panel exists to be typed in.
  useEffect(() => {
    if (open && !sent) textRef.current?.focus();
  }, [open, sent]);

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

  // While the panel is open the button stays a full pill — it is the panel's
  // header row, and a circle sitting under it would read as a different control.
  const collapsed = shrunk && !open;

  function toggle() {
    setSent(false);
    setError(null);
    setOpen((o) => !o);
  }

  return (
    <>
      {/* The floating button. Desktop only, on purpose: on a phone a permanent
          corner button covers content and sits where the thumb scrolls.
          It carries its label as a pill and pulls it back in while you scroll
          down the page (see useShrinkOnScrollDown) — an open panel or a hover
          always shows the word again. */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        title="Report a bug or suggest a feature"
        className={`fab-morph group fixed bottom-6 right-6 z-[60] hidden h-12 items-center justify-center overflow-hidden rounded-full border border-border bg-card text-sm font-bold text-medium shadow-lg shadow-ink/10 transition-[width,padding,color,border-color] duration-300 ease-out hover:border-brand/50 hover:text-dark lg:flex ${
          collapsed ? "w-12 px-0 hover:w-[9.25rem] hover:pl-4 hover:pr-5" : "w-[9.25rem] pl-4 pr-5"
        } ${open ? "border-brand/50 text-dark" : ""}`}
      >
        <span className="shrink-0 text-brand">{open ? <CloseIcon /> : <ChatIcon />}</span>
        <span
          className={`fab-morph overflow-hidden whitespace-nowrap transition-[max-width,opacity,margin] duration-300 ease-out ${
            collapsed
              ? "ml-0 max-w-0 opacity-0 group-hover:ml-2 group-hover:max-w-[6rem] group-hover:opacity-100"
              : "ml-2 max-w-[6rem] opacity-100"
          }`}
        >
          Feedback
        </span>
      </button>

      {open && (
        <>
          {/* Click-catcher. On a phone the panel is a sheet over the page, so it
              gets a real scrim; on desktop the catcher stays invisible and only
              closes the panel on the next click outside it. */}
          <button
            type="button"
            aria-label="Close feedback"
            onClick={close}
            className="fixed inset-0 z-[65] cursor-default bg-ink/40 backdrop-blur-sm lg:bg-transparent lg:backdrop-blur-none"
          />
          {/* Bottom sheet on phones, a card above the button on desktop. */}
          <div
            role="dialog"
            aria-label="Feedback"
            className="notif-pop fixed inset-x-0 bottom-0 z-[70] max-h-[88dvh] overflow-y-auto rounded-t-2xl border border-border bg-card p-5 shadow-2xl shadow-ink/30 lg:inset-x-auto lg:bottom-20 lg:right-6 lg:w-[23rem] lg:rounded-2xl"
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
                  {isLoggedIn
                    ? `Sent as ${user?.driverName || user?.discordName || "your account"}, along with the page you're on.`
                    : "Nobody needs an account for this. Leave a name above if you'd like an answer."}
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
