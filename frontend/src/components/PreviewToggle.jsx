import { usePreviewMode, setPreview } from "../preview.js";

// Small floating control (owner-only) to flip the home page between the newcomer
// Welcome landing and the normal member home. Renders nothing unless preview
// mode is active (set via `/?preview=welcome`), so visitors never see it.
export default function PreviewToggle() {
  const mode = usePreviewMode();
  if (!mode) return null;

  const seg = (value, label) => (
    <button
      type="button"
      onClick={() => setPreview(value)}
      className={`rounded-full px-3 py-1 text-xs font-bold transition ${
        mode === value ? "bg-brand text-ink shadow" : "text-light hover:text-dark"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed bottom-4 left-4 z-[60] flex items-center gap-1 rounded-full border border-border bg-card/95 p-1 shadow-lg backdrop-blur">
      <span className="px-2 font-mono text-[10px] font-bold uppercase tracking-wider text-light">
        Preview
      </span>
      {seg("welcome", "Newcomer")}
      {seg("home", "Member")}
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
