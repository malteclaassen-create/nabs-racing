import { useEffect, useRef, useState } from "react";

// Interactive 3D showcase of a season's car. Renders a <model-viewer> around
// the Draco-compressed GLB at /cars/s<n>.glb (converted from the real Assetto
// Corsa car with the team livery via tools/kn5-to-glb). The library chunk is
// imported lazily so seasons without a model never pay for it, and the Draco
// decoder is self-hosted under /draco/ (no CDN).
//
// Two camera setups: the showroom orbit around the car, and a driver view
// placed at the real cockpit eye point (computed from the model's seat and
// steering wheel during conversion). model-viewer tweens between them.
const CAMERA = {
  showroom: {
    orbit: "325deg 76deg 6.5m",
    target: "auto auto auto",
    fov: "30deg",
    minOrbit: "auto auto 3m",
    maxOrbit: "auto auto 9m",
  },
  driver: {
    orbit: "180deg 80deg 0.78m",
    target: "0m 0.6m 0.8m",
    fov: "70deg",
    minOrbit: "auto 45deg 0.6m",
    maxOrbit: "auto 100deg 1m",
  },
};

// Line-style SVG icons (site convention: no emoji glyphs).
const ICONS = {
  helmet: "M4 13a8 8 0 0116 0v3h-7M4 13v3a2 2 0 002 2h3M4 13h9v5",
  car: "M3 15l1.5-5.5A2 2 0 016.4 8h11.2a2 2 0 011.9 1.5L21 15M5 15h14a1 1 0 011 1v2h-3a2 2 0 01-4 0h-2a2 2 0 01-4 0H4v-2a1 1 0 011-1z",
};

function ViewButton({ icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/20 bg-black/55 px-3.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/85 backdrop-blur-sm transition-colors hover:border-white/40 hover:text-white"
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d={ICONS[icon]} />
      </svg>
      {label}
    </button>
  );
}

export default function Car3D({ src, poster, alt, onFail }) {
  const hostRef = useRef(null);
  const viewerRef = useRef(null);
  const [ready, setReady] = useState(false); // library loaded, element usable
  const [loaded, setLoaded] = useState(false); // model fully loaded
  const [view, setView] = useState("showroom");

  // Load the model-viewer chunk once, then build the element imperatively
  // (custom elements and JSX attributes don't mix well).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("@google/model-viewer");
        const ModelViewerElement = mod.ModelViewerElement || customElements.get("model-viewer");
        if (ModelViewerElement && !ModelViewerElement.dracoDecoderLocation?.includes("/draco/")) {
          ModelViewerElement.dracoDecoderLocation = "/draco/";
        }
        if (!cancelled) setReady(true);
      } catch {
        onFail?.();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onFail]);

  useEffect(() => {
    if (!ready || !hostRef.current) return;
    const cam = CAMERA.showroom;
    const el = document.createElement("model-viewer");
    el.src = src;
    if (poster) el.setAttribute("poster", poster);
    el.setAttribute("alt", alt || "3D model of the season's car");
    el.setAttribute("camera-controls", "");
    el.setAttribute("interaction-prompt", "none");
    el.setAttribute("disable-pan", "");
    el.setAttribute("shadow-intensity", "0.9");
    el.setAttribute("shadow-softness", "0.7");
    el.setAttribute("exposure", "1.45");
    el.setAttribute("camera-orbit", cam.orbit);
    el.setAttribute("field-of-view", cam.fov);
    el.setAttribute("min-camera-orbit", cam.minOrbit);
    el.setAttribute("max-camera-orbit", cam.maxOrbit);
    // let vertical page scroll keep working on touch devices
    el.setAttribute("touch-action", "pan-y");
    el.style.cssText = "width:100%;height:100%;--poster-color:transparent;background:transparent;";
    el.addEventListener("load", () => setLoaded(true));
    el.addEventListener("error", () => onFail?.());
    hostRef.current.appendChild(el);
    viewerRef.current = el;
    return () => {
      el.remove();
      viewerRef.current = null;
    };
  }, [ready, src, poster, alt, onFail]);

  const applyView = (next) => {
    const el = viewerRef.current;
    if (!el) return;
    const cam = CAMERA[next];
    // widen the clamps first so the tween isn't blocked, then retighten
    el.setAttribute("min-camera-orbit", "auto auto 0.4m");
    el.setAttribute("max-camera-orbit", "auto auto 10m");
    el.setAttribute("camera-target", cam.target);
    el.setAttribute("camera-orbit", cam.orbit);
    el.setAttribute("field-of-view", cam.fov);
    window.setTimeout(() => {
      el.setAttribute("min-camera-orbit", cam.minOrbit);
      el.setAttribute("max-camera-orbit", cam.maxOrbit);
    }, 1100);
    setView(next);
  };

  return (
    <div className="absolute inset-0">
      <div ref={hostRef} className="absolute inset-0" />
      {loaded && (
        <div className="pointer-events-none absolute right-3 top-3 flex justify-end">
          {view === "showroom" ? (
            <ViewButton icon="helmet" label="Driver view" onClick={() => applyView("driver")} />
          ) : (
            <ViewButton icon="car" label="Full car" onClick={() => applyView("showroom")} />
          )}
        </div>
      )}
    </div>
  );
}
