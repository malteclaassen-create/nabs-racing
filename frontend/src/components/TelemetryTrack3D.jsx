import { useEffect, useRef, useState } from "react";
import { Box, FileArchive, FolderOpen, LoaderCircle, TriangleAlert } from "lucide-react";
import { canPickFolder, pickAcFolder, readerFromDrop, readerFromFileList, rememberAcFolder, rememberedAcFolder } from "../utils/acFolder.js";
import { loadTrackScene, TrackNotFoundError } from "../utils/acTrackScene.js";
import { getLapViewer } from "../utils/lapViewer3d.js";
import { readerFromZip } from "../utils/zipReader.js";

// ---------------------------------------------------------------------------
// The lap comparison in 3D, in the same box as the 2D map. The track comes
// from the driver's own Assetto Corsa folder: the site has no copy of any
// track and could not hand one out if it did, since most mods may not be
// passed on. So the first time, the box asks for the folder; after that the
// browser remembers it, and a track read once stays loaded until the page is
// closed. A phone has no AC folder, so there the mod's ZIP can be opened
// instead (utils/zipReader.js), at the driver's own risk: it is read on the
// phone, never uploaded, and a big one can be too much for a phone's browser.
//
// Loaded only when someone presses 3D (TelemetryCompare lazy-imports it), so
// three.js is never part of the page for anyone who does not.
// ---------------------------------------------------------------------------

// The one track kept in memory: the last one read. Switching to 2D and back,
// or to another pair of laps on the same track, does not read it again.
let kept = null; // { key, scene }
const keyOf = (track, layout) => `${String(track).toLowerCase()}|${String(layout || "").toLowerCase()}`;

const CAMERAS = [
  { key: "orbit", label: "Orbit", hint: "Drag to turn, right-drag to pan, scroll to zoom" },
  { key: "chase", label: "Chase", hint: "Behind the car" },
  { key: "tv", label: "TV", hint: "The track's own trackside cameras" },
];

function Pill({ on, onClick, children, label }) {
  return (
    <button type="button" aria-pressed={on} aria-label={label} onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${on ? "bg-card text-dark shadow-sm" : "text-medium hover:text-dark"}`}>
      {children}
    </button>
  );
}

// `hud` is the heads-up display drawn over the view and `hudMenu` the button
// that sets it up (TelemetryHud.jsx); the caller only passes them in full
// screen. With a HUD on the view, the hint line at the bottom gives way to it.
export default function TelemetryTrack3D({ track, layout, trackName, backdrop, lapA, lapB, n, at, motionA, bIdx, colorA, colorB, nameA, nameB, hud = null, hudMenu = null }) {
  const key = keyOf(track, layout);
  const [status, setStatus] = useState(kept?.key === key ? "ready" : "pick");
  const [progress, setProgress] = useState({ message: "", fraction: 0 });
  const [problem, setProblem] = useState(null);
  const [remembered, setRemembered] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [camera, setCamera] = useState("orbit");
  const [target, setTarget] = useState("A");
  const [follow, setFollow] = useState(true);
  const [lines, setLines] = useState(true);
  const [viewer, setViewer] = useState(null);
  const hostRef = useRef(null);
  const zipInput = useRef(null);
  const dirInput = useRef(null);
  const loading = useRef(false);

  // WebGL is made on first sight of the box, not on import: a browser without
  // it gets a sentence instead of a broken page.
  useEffect(() => {
    try {
      setViewer(getLapViewer());
    } catch {
      setStatus("error");
      setProblem("This browser cannot draw 3D (WebGL is off or not supported).");
    }
    rememberedAcFolder().then(setRemembered);
  }, []);

  // Another track picked in the comparison: the kept one may not be it.
  const lastKey = useRef(key);
  useEffect(() => {
    if (lastKey.current === key) return;
    lastKey.current = key;
    if (loading.current || !viewer) return;
    setStatus(kept?.key === key ? "ready" : "pick");
    setProblem(null);
  }, [key]);

  async function load(reader, fromZip = false) {
    if (!reader || !viewer || loading.current) return;
    loading.current = true;
    setStatus("loading");
    setProblem(null);
    setProgress({ message: fromZip ? "Opening the ZIP" : "Opening the folder", fraction: 0 });
    try {
      const scene = await loadTrackScene(reader, {
        track, layout, gpu: viewer.gpu,
        onProgress: (message, fraction) => setProgress({ message, fraction }),
      });
      if (kept) { viewer.setTrack(null); kept.scene.dispose(); }
      kept = { key, scene };
      viewer.setTrack(scene);
      setStatus("ready");
      rememberAcFolder(reader);
      rememberedAcFolder().then(setRemembered);
    } catch (e) {
      setStatus("pick");
      setProblem(e instanceof TrackNotFoundError
        ? fromZip
          ? `That ZIP has no ${track} track in it. Pick the mod for this track.`
          : canPickFolder()
            ? `That folder has no content/tracks/${track}. Pick your assettocorsa folder, and check the track is installed.`
            : `That is not the ${track} folder. Pick assettocorsa/content/tracks/${track}.`
        : `The track could not be read: ${e?.message || e}`);
    } finally {
      loading.current = false;
    }
  }

  const pick = async () => {
    try {
      await load(await pickAcFolder());
    } catch (e) {
      if (e?.name !== "AbortError") setProblem("The folder could not be opened.");
    }
  };
  // The folder from last time, still allowed: load the track straight away
  // instead of showing buttons. Once per track, so a failed try (track not
  // installed) leaves the buttons and its message up rather than looping.
  const autoTried = useRef(null);
  useEffect(() => {
    if (!viewer || !remembered || status !== "pick" || autoTried.current === key) return;
    autoTried.current = key;
    remembered.granted().then((ok) => { if (ok) reopen(); });
  }, [viewer, remembered, status, key]);

  const reopen = async () => {
    try {
      const reader = await remembered?.open();
      if (reader) await load(reader);
      else setProblem("The browser did not allow reading that folder. Pick it again.");
    } catch {
      setProblem("That folder is not there any more. Pick it again.");
    }
  };
  const openZip = async (file) => {
    if (!file) return;
    let reader;
    try {
      reader = await readerFromZip(file);
    } catch (e) {
      setProblem(e?.message || "That file could not be opened.");
      return;
    }
    await load(reader, true);
  };
  const onZip = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // the same file again is a new pick
    openZip(file);
  };
  // Browsers without the folder dialog: the track's own folder through a
  // plain file input (readerFromFileList).
  const onDir = async (e) => {
    const reader = readerFromFileList(e.target.files);
    e.target.value = "";
    if (reader) await load(reader);
  };
  const onDrop = async (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file && /\.zip$/i.test(file.name)) { await openZip(file); return; }
    const reader = await readerFromDrop(e.dataTransfer);
    if (reader) await load(reader);
    else setProblem("That was not a folder or a ZIP. Drag the assettocorsa folder, or the track mod's ZIP.");
  };

  // The canvas lives in the box while the track is up.
  const ready = status === "ready" && viewer && kept?.key === key;
  useEffect(() => {
    if (!ready || !hostRef.current) return undefined;
    if (viewer.track !== kept.scene) viewer.setTrack(kept.scene);
    viewer.attach(hostRef.current);
    return () => viewer.detach();
  }, [ready]);

  useEffect(() => { if (ready) viewer.setLaps(lapA, lapB, n, colorA, colorB); }, [ready, lapA, lapB, n, colorA, colorB]);
  useEffect(() => { viewer?.setMode(camera); }, [viewer, camera]);
  useEffect(() => { viewer?.setTarget(lapB ? target : "A"); }, [viewer, target, lapB]);
  useEffect(() => { viewer?.setFollow(follow); }, [viewer, follow]);
  useEffect(() => { viewer?.setLines(lines); }, [viewer, lines]);
  // Every render: the cursor moves sixty times a second during playback, and
  // the viewer only reads the latest pose when it draws.
  if (ready) viewer.setPose(motionA ?? at, lapB ? (bIdx ?? motionA ?? at) : null);

  if (ready) {
    const warnings = kept.scene.warnings;
    const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    return (
      <div className="absolute inset-0">
        <div ref={hostRef} className="absolute inset-0" style={{ background: "#c9dbea" }} />
        {hud}
        <div className="absolute left-2 top-2 flex flex-wrap items-center gap-1.5">
          <div role="group" aria-label="Camera" className="inline-flex rounded-lg border border-border bg-surface2 p-0.5 shadow-md">
            {CAMERAS.map((c) => <Pill key={c.key} on={camera === c.key} onClick={() => setCamera(c.key)} label={`${c.label} camera`}>{c.label}</Pill>)}
          </div>
          {lapB && (
            <div role="group" aria-label="Which car the camera watches" className="inline-flex rounded-lg border border-border bg-surface2 p-0.5 shadow-md">
              <Pill on={target === "A"} onClick={() => setTarget("A")} label={`Watch ${nameA}`}><span style={{ color: colorA }}>●</span> A</Pill>
              <Pill on={target === "B"} onClick={() => setTarget("B")} label={`Watch ${nameB}`}><span style={{ color: colorB }}>●</span> B</Pill>
            </div>
          )}
          <div className="inline-flex rounded-lg border border-border bg-surface2 p-0.5 shadow-md">
            {camera === "orbit" && <Pill on={follow} onClick={() => setFollow((v) => !v)} label="Camera follows the car">Follow</Pill>}
            <Pill on={lines} onClick={() => setLines((v) => !v)} label="Racing lines on the road">Lines</Pill>
          </div>
          {hudMenu}
          {hud && warnings.length > 0 && (
            <span className="flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2 text-[10px] text-warn shadow-md" title={warnings.join("\n")}>
              <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />{warnings.length}
            </span>
          )}
        </div>
        {!hud && <div className="pointer-events-none absolute bottom-2 left-2 right-2 flex flex-wrap items-end justify-between gap-2">
          <span className="rounded bg-card px-2 py-1 text-[10px] text-medium shadow-sm">{camera === "orbit" && touch ? "One finger to turn, two to zoom and move" : CAMERAS.find((c) => c.key === camera)?.hint}</span>
          {warnings.length > 0 && (
            <span className="pointer-events-auto flex max-w-full items-center gap-1 rounded bg-card px-2 py-1 text-[10px] text-warn shadow-sm" title={warnings.join("\n")}>
              <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />{warnings.length === 1 ? warnings[0] : `${warnings.length} notes on this track`}
            </span>
          )}
        </div>}
      </div>
    );
  }

  const pct = Math.round(progress.fraction * 100);
  // A phone has no AC install to read and no folder to pick or drop.
  const phone = !canPickFolder() && typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const openZipPicker = () => zipInput.current?.click();
  return (
    <div className="absolute inset-0 overflow-hidden"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      {/* The 2D map of the same laps, still moving with the player, so the box
          shows the track it is about to load instead of standing empty. */}
      {backdrop && <div className="pointer-events-none absolute inset-0 opacity-70" aria-hidden="true">{backdrop}</div>}
      <div className={`absolute inset-0 transition ${dragging ? "bg-primary/15 ring-2 ring-inset ring-primary" : "bg-card/20"}`} />
      <input ref={zipInput} type="file" accept=".zip,application/zip,application/x-zip-compressed" className="hidden" onChange={onZip} />
      <input ref={dirInput} type="file" webkitdirectory="" directory="" multiple className="hidden" onChange={onDir} />
      <div className="absolute inset-0 flex items-end justify-center overflow-auto p-3 sm:p-4">
        <div className="flex w-full max-w-md flex-col gap-2.5 rounded-xl border border-border bg-card/95 p-3.5 shadow-lg backdrop-blur-sm">
          {status === "loading" ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <LoaderCircle className="h-7 w-7 animate-spin text-light" aria-hidden="true" />
              <p className="text-sm font-semibold text-dark">Loading {trackName} in 3D</p>
              <div className="h-1.5 w-56 max-w-full overflow-hidden rounded-full bg-border" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
              </div>
              <p className="font-mono text-[11px] text-light">{progress.message}</p>
            </div>
          ) : status === "error" ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <TriangleAlert className="h-7 w-7 text-warn" aria-hidden="true" />
              <p className="text-sm text-dark">{problem}</p>
            </div>
          ) : dragging ? (
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <FolderOpen className="h-7 w-7 text-primary" aria-hidden="true" />
              <p className="text-sm font-semibold text-dark">Drop it here</p>
            </div>
          ) : phone ? (
            <>
              <Title trackName={trackName} />
              <p className="text-xs text-light">
                Choose the track mod's ZIP file from your phone. It is read on the phone itself: nothing is uploaded, and it uses no mobile data.
              </p>
              <p className="rounded-lg bg-warn/10 px-3 py-2 text-[11px] text-warn">
                At your own risk: a big track can take a minute, and on some phones the browser closes the page.
              </p>
              <button type="button" className="btn-primary h-10 w-full gap-2 py-0 text-sm" onClick={openZipPicker}>
                <FileArchive className="h-4 w-4" aria-hidden="true" />Choose track ZIP
              </button>
              {problem && <p role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-xs text-bad">{problem}</p>}
            </>
          ) : (
            <>
              <Title trackName={trackName} />
              {remembered ? (
                <p className="text-xs text-light">
                  Your Assetto Corsa folder <span className="font-mono text-medium">{remembered.name}</span> is remembered. One click and the track loads.
                </p>
              ) : (
                <ol className="grid grid-cols-1 gap-1.5 text-[11px] leading-snug text-medium sm:grid-cols-3 sm:gap-2">
                  {canPickFolder() ? <>
                    <Step n={1}>Press Choose AC folder</Step>
                    <Step n={2}>Open <span className="font-mono text-dark">steamapps/ common/ assettocorsa</span></Step>
                    <Step n={3}>Allow it. Next time it loads by itself</Step>
                  </> : <>
                    <Step n={1}>Press Choose track folder</Step>
                    <Step n={2}>Open <span className="font-mono text-dark">assettocorsa/ content/ tracks/ {track}</span></Step>
                    <Step n={3}>Confirm. The browser says upload, but nothing leaves your computer</Step>
                  </>}
                </ol>
              )}
              <div className="flex flex-col gap-2 sm:flex-row">
                {remembered && (
                  <button type="button" className="btn-primary h-10 flex-1 gap-2 py-0 text-sm" onClick={reopen}>
                    <FolderOpen className="h-4 w-4" aria-hidden="true" />Load {trackName}
                  </button>
                )}
                {!canPickFolder() && (
                  <button type="button" className="btn-primary h-10 flex-1 gap-2 py-0 text-sm" onClick={() => dirInput.current?.click()}>
                    <FolderOpen className="h-4 w-4" aria-hidden="true" />Choose track folder
                  </button>
                )}
                {canPickFolder() && (
                  <button type="button" className={`${remembered ? "btn-secondary h-10 text-xs sm:flex-none sm:px-3" : "btn-primary h-10 flex-1 text-sm"} gap-2 py-0`} onClick={pick}>
                    <FolderOpen className="h-4 w-4" aria-hidden="true" />{remembered ? "Other folder" : "Choose AC folder"}
                  </button>
                )}
              </div>
              {problem && <p role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-xs text-bad">{problem}</p>}
              <p className="text-center text-[11px] text-light">
                {canPickFolder() ? "Read on your computer, nothing is uploaded." : "Or drag the assettocorsa folder onto the map."}{" "}
                <button type="button" className="font-semibold text-link underline-offset-2 hover:underline" onClick={openZipPicker}>
                  Track not installed? Open its ZIP
                </button>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Title({ trackName }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface2 text-medium"><Box className="h-4 w-4" aria-hidden="true" /></span>
      <p className="text-sm font-semibold leading-tight text-dark">See these laps on {trackName} in 3D</p>
    </div>
  );
}

function Step({ n, children }) {
  return (
    <li className="flex items-start gap-1.5">
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-surface2 font-mono text-[9px] font-bold text-dark">{n}</span>
      <span className="min-w-0 break-words">{children}</span>
    </li>
  );
}
