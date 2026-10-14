import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// The 3D layer of the Season Wrapped story: one canvas behind the slides,
// showing the active slide's scene (utils/wrappedScenes.js, loaded here on
// first use, three.js with it). The story's clock (`clock`) says how far into
// its slide the story is, so the scene pauses and replays with it.
//
// `onUnavailable` is called when there is no 3D to be had (no WebGL, the GPU
// taken back mid-story, the module failing to load); the story then draws its
// flat pictures instead. `stageRef` hands the stage to the story for the
// summary card's picture.
// ---------------------------------------------------------------------------
export default function WrappedStage({ spec, clock, still, onUnavailable, stageRef }) {
  const canvasRef = useRef(null);
  const [stage, setStage] = useState(null);
  const [shown, setShown] = useState(false);
  const lost = useRef(onUnavailable);
  lost.current = onUnavailable;

  // Make the stage once.
  useEffect(() => {
    let gone = false;
    let made = null;
    import("../utils/wrappedScenes.js")
      .then(({ createWrappedStage }) => {
        if (gone || !canvasRef.current) return;
        made = createWrappedStage(canvasRef.current, { still });
        if (!made) {
          lost.current?.();
          return;
        }
        made.onLost(() => lost.current?.());
        if (stageRef) stageRef.current = made;
        setStage(made);
      })
      .catch(() => !gone && lost.current?.());
    return () => {
      gone = true;
      if (stageRef && stageRef.current === made) stageRef.current = null;
      made?.dispose();
    };
  }, [still, stageRef]);

  // Its size follows the frame.
  useEffect(() => {
    const el = canvasRef.current;
    if (!stage || !el) return undefined;
    const fit = () => {
      const r = el.getBoundingClientRect();
      stage.resize(Math.round(r.width), Math.round(r.height));
    };
    fit();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [stage]);

  // A new slide: fade out, build its scene, fade back in.
  useEffect(() => {
    if (!stage) return undefined;
    let gone = false;
    setShown(false);
    stage.setScene(spec || null).then(() => {
      if (gone) return;
      stage.render(clock.t);
      setShown(!!spec);
    });
    return () => {
      gone = true;
    };
  }, [stage, spec, clock]);

  // Every tick of the story's clock is a frame.
  useEffect(() => {
    if (!stage) return undefined;
    return clock.subscribe((t) => stage.render(t));
  }, [stage, clock]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="story-canvas pointer-events-none absolute inset-0 h-full w-full"
      style={{ opacity: shown ? 1 : 0 }}
    />
  );
}
