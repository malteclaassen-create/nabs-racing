import { usePreviewMode, setPreview } from "../preview.js";
import SlidingTabs from "./SlidingTabs.jsx";

// Small floating control (owner-only) to flip the home page between the newcomer
// Welcome landing and the normal member home. Renders nothing unless preview
// mode is active (set via `/?preview=welcome`), so visitors never see it.
export default function PreviewToggle() {
  const mode = usePreviewMode();
  if (!mode) return null;

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
        value={mode}
        onChange={setPreview}
      />
      <button
        type="button"
        onClick={() => setPreview(null)}
        title="Exit preview mode"
        aria-label="Exit preview mode"
        className="ml-1 flex h-6 w-6 items-center justify-center rounded-full text-light transition hover:bg-surface2 hover:text-dark"
      >
        ×
      </button>
    </div>
  );
}
