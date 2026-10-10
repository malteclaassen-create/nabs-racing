import { useEffect } from "react";
import { DESIGN_ENABLED, listenForScrollRequests, setDesignOff, useDesignPicks } from "./designPicks.js";

// Floating pill on the site while variants are picked: how many are live, a
// switch to compare with the original, and the way back to the picker.
// Hidden inside the picker's own preview frame, which has its own controls.
export default function DesignBar() {
  if (!DESIGN_ENABLED) return null;
  return <Bar />;
}

function Bar() {
  const { picks, off } = useDesignPicks();
  useEffect(() => listenForScrollRequests(), []);
  const count = Object.keys(picks).length;
  if (window.self !== window.top) return null;
  return (
    <div className="fixed bottom-[calc(1rem+var(--bnav))] left-1/2 z-chrome flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card/95 p-1 shadow-lg backdrop-blur">
      <span className="px-2 font-mono text-[10px] font-bold uppercase tracking-wider text-light">
        Design · {count}
      </span>
      {count > 0 && (
        <button
          type="button"
          onClick={() => setDesignOff(!off)}
          className={`rounded-full px-3 py-1 text-xs font-semibold ${off ? "text-medium" : "bg-brand text-onbrand shadow"}`}
        >
          {off ? "Original" : "Varianten"}
        </button>
      )}
      <a href="/_design/index.html" className="rounded-full px-3 py-1 text-xs font-semibold text-medium hover:text-dark">
        Picker
      </a>
    </div>
  );
}
