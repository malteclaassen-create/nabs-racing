import { useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api/client.js";
import { useAuth } from "../hooks/useAuth.js";
import { Modal } from "./overlay.jsx";
import { Field } from "./ui.jsx";

// ---------------------------------------------------------------------------
// "Suggest a highlight": the small link beside the live map's Highlights
// button. The highlights are added by the admins, who were not in every car
// in every race; a driver who remembers a moment that belongs on the map
// writes it here, with the corner if they know it.
//
// It is sent as feedback of its own kind (HIGHLIGHT, backend lib/feedback.js),
// so it lands where the admins already read: the Feedback tab and their bell.
// A signed-in driver gets the answer in their own bell and can write back on
// /feedback, pictures included. The track and the corner go in as the first
// line of the message; the table has no columns for them and needs none.
// ---------------------------------------------------------------------------

const MIN_STORY = 5;
// The message is capped at 2000 on the server, first line included.
const MAX_STORY = 1800;

export default function SuggestHighlight({ trackName, corners, labelOf, className = "" }) {
  const location = useLocation();
  const { user, isLoggedIn } = useAuth();
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(""); // the picked corner's place in the lap, "" = not picked
  const [story, setStory] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);
  const textRef = useRef(null);

  const start = () => {
    setSent(false);
    setError(null);
    setOpen(true);
  };
  const close = () => setOpen(false);

  async function send() {
    const text = story.trim();
    if (text.length < MIN_STORY) {
      setError("Please write a little more so the admins know what you mean.");
      return;
    }
    const corner = corners.find((c) => String(c.at) === at);
    const where = [trackName, corner ? labelOf(corner) : ""].filter(Boolean).join(", ");
    setBusy(true);
    setError(null);
    try {
      await api.sendFeedback({
        kind: "HIGHLIGHT",
        message: `Highlight for ${where || "this track"}\n\n${text}`,
        contact: isLoggedIn ? null : contact,
        pageUrl: location.pathname + location.search,
      });
      setSent(true);
      setStory("");
      setAt("");
      setContact("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={start}
        title="Tell the admins about a moment from a past race that belongs on this map"
        className={`text-xs text-light underline decoration-border underline-offset-4 transition hover:text-dark hover:decoration-current ${className}`}
      >
        Suggest a highlight
      </button>
      <Modal
        open={open}
        onClose={close}
        variant="sheet"
        title={sent ? "Thanks" : "Suggest a highlight"}
        description={
          sent
            ? "Your suggestion is with the admins."
            : `Something happened${trackName ? ` at ${trackName}` : " here"} in a past race that should be on the map? Tell the admins and they can add it.`
        }
        initialFocus={sent ? undefined : textRef}
      >
        {sent ? (
          <div className="space-y-4">
            {isLoggedIn && (
              <p className="text-sm leading-relaxed text-medium">
                If they answer, you get a notification and can write back on{" "}
                <Link to="/feedback" onClick={close} className="font-semibold text-link transition hover:underline">
                  your messages page
                </Link>
                . You can send a picture there too.
              </p>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={() => setSent(false)} className="btn-secondary flex-1">
                Suggest another
              </button>
              <button type="button" onClick={close} className="btn-primary flex-1">
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {corners.length > 0 && (
              <Field label="Corner">
                <select className="input" value={at} onChange={(e) => setAt(e.target.value)}>
                  <option value="">Not sure, or somewhere else</option>
                  {corners.map((c) => (
                    <option key={c.at} value={String(c.at)}>
                      {labelOf(c) || `${c.at}% into the lap`}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="What happened">
              <textarea
                ref={textRef}
                className="input min-h-[7.5rem] resize-y leading-relaxed"
                rows={5}
                maxLength={MAX_STORY}
                placeholder="Who, what, and in which race or season? A link to a clip or a picture helps."
                value={story}
                onChange={(e) => setStory(e.target.value)}
              />
            </Field>
            {!isLoggedIn && (
              <input
                className="input"
                maxLength={200}
                aria-label="Discord name or email (optional)"
                placeholder="Discord name or email (optional)"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
              />
            )}
            <p className="text-xs leading-relaxed text-light">
              {isLoggedIn
                ? `Sent as ${user?.driverName || user?.discordName || "your account"}. Answers land in your bell.`
                : "Nobody needs an account for this. Leave a name above if you'd like an answer."}
            </p>
            {error && <p className="text-sm font-medium text-bad">{error}</p>}
            <button type="button" onClick={send} disabled={busy} className="btn-primary w-full">
              {busy ? "Sending..." : "Send"}
            </button>
          </div>
        )}
      </Modal>
    </>
  );
}
