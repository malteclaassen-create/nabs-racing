import { usePreviewMode, setPreview, isDevHost } from "../preview.js";
import { useAuth } from "../hooks/useAuth.js";
import SlidingTabs from "./SlidingTabs.jsx";

// Small floating control to flip the home page between the newcomer Welcome
// landing and the normal member home.
//
// On the live site it stays hidden until someone deliberately turns preview
// mode on (`/?preview=welcome`), so visitors never see it. On localhost it is
// always there: running the site locally IS the act of checking both sides, and
// having to remember a URL trick to get the switch back is a nuisance.
export default function PreviewToggle() {
  const mode = usePreviewMode();
  const { isLoggedIn } = useAuth();
  if (!mode && !isDevHost()) return null;

  // With no override the page follows the login, so that's what the switch has
  // to show — otherwise it would sit on "Newcomer" while a signed-in member is
  // looking at the member home.
  const effective = mode || (isLoggedIn ? "home" : "welcome");

  return (
    <div className="fixed bottom-4 left-4 z-[60] flex items-center gap-1 rounded-full border border-border bg-card/95 p-1 shadow-lg backdrop-blur">
      <span className="px-2 font-mono text-[10px] font-bold uppercase tracking-wider text-light">
        Preview
      </span>
      <SlidingTabs
        wrapClassName="inline-flex"
        btnClassName="px-3 py-1 text-xs"
        pillClassName="rounded-full bg-brand shadow"
        items={[
          { key: "welcome", label: "Newcomer" },
          { key: "home", label: "Member" },
        ]}
        value={effective}
        onChange={setPreview}
      />
      {/* Only worth offering while an override is actually in force: it clears
          it and hands the page back to the login state. */}
      {mode && (
        <button
          type="button"
          onClick={() => setPreview(null)}
          title="Follow my login again"
          aria-label="Follow my login again"
          className="ml-1 flex h-6 w-6 items-center justify-center rounded-full text-light transition hover:bg-surface2 hover:text-dark"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}
