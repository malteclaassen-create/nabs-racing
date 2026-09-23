import { useEffect } from "react";
import { Notice } from "./ui.jsx";

// What the last action on an admin tab did, pinned to the top of the screen.
//
// Seasons and Drivers used to print this inside their "create" form, whatever
// had actually been clicked: a season row, a roster line, the transfer dialog.
// On a computer that was merely the wrong place; on a phone the form is a few
// screens away from the roster, so the answer to a click was nowhere to be seen
// and a refused change read as a button that did nothing.
//
// So the tab keeps its one message and this shows it where the admin is
// looking. It sits at the very top of the tab and sticks under the nav bar (84px
// tall, hence the offset) while the tab scrolls, so it is on screen from any
// row. It takes no height of its own and floats over the content instead: a
// notice pushing the page down would move the row the admin just clicked out
// from under the pointer.
//
// A success goes away by itself, after a time that grows with its length (the
// roster copy can name half a dozen drivers who could not be placed). An error
// stays until it is closed or the next action replaces it, because it is the
// one that has to be read.
export default function TabNotice({ msg, error, onClose }) {
  const text = error || msg;
  const kind = error ? "error" : "success";
  useEffect(() => {
    if (!msg || error) return undefined;
    const t = setTimeout(onClose, Math.min(15000, Math.max(5000, msg.length * 60)));
    return () => clearTimeout(t);
    // onClose is a fresh arrow on every render; the timer belongs to the
    // message, not to the render that happened to show it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msg, error]);
  return (
    <div className="pointer-events-none sticky top-[92px] z-20 h-0" role="status" aria-live="polite">
      {text && (
        <div key={text} className="pop-in pointer-events-auto flex justify-center">
          {/* The card colour under the notice: its tint is see-through, and
              floating over a roster it would otherwise be unreadable. */}
          <div className="relative w-full max-w-2xl rounded-lg bg-card shadow-lg shadow-ink/10">
            <Notice kind={kind}>
              <span className="block pr-7">{text}</span>
            </Notice>
            <button
              type="button"
              onClick={onClose}
              aria-label="Dismiss message"
              className="absolute right-2 top-2.5 rounded-md p-1 opacity-70 transition hover:opacity-100"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
