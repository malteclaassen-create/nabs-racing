import { useEffect, useState } from "react";
import { CountUp } from "./ui.jsx";
import { useInView, motionOff } from "../hooks/motion.js";
import { decideGain, markGainPlayed } from "../utils/pointsSeen.js";

// ---------------------------------------------------------------------------
// A championship total that ANNOUNCES what it gained.
//
// The first time a driver opens their own page after a result has gone in, the
// points box doesn't just hold a new number. It plays the change:
//
//   1. +25 arrives IN THE TOTAL'S PLACE, counting up from zero. The gain is
//      what is new, so the gain is what is shown first.
//   2. It lifts away and fades.
//   3. The total counts up underneath it, from what they last saw to what they
//      have now — so the number they remember is where the climb starts.
//
// Every other visit, and every other driver's page, renders exactly what it
// rendered before: an ordinary CountUp. Whether there is anything to announce
// at all is decided in utils/pointsSeen.js, which is also what remembers the
// number this browser was last shown.
// ---------------------------------------------------------------------------

// The gain holds the stage on its own, then overlaps the climbing total as it
// leaves — the two never feel like separate animations that way.
const GAIN_MS = 1150; // +25 in the total's place
const OUT_MS = 620;   // it lifts away (matches .gain-out in index.css)
const RISE_MS = 1500; // old total → new total

export default function PointsGain({
  id,
  points,
  enabled = true,
  prefix = "",
  suffix = "",
  duration = 1200,
  className = "",
  // Set for a caption-sized number (the Home tile's "123 pts"), which cannot
  // carry the overlap a scoreboard figure can — see `showTotal` below.
  compact = false,
}) {
  // What this browser last saw for this row, and whether that is worth saying.
  // Null on a first visit, on a total that has not moved, on someone else's
  // page, and whenever the visitor has asked the site to hold still (reduced
  // motion, or Settings → Performance → Lite).
  const [gain, setGain] = useState(null);
  useEffect(() => {
    if (!enabled || !id || !Number.isFinite(points)) return;
    const d = decideGain(id, points);
    if (!d.gain || d.played || motionOff()) return;
    setGain({ from: d.from, gain: d.gain });
  }, [id, points, enabled]);
  // Hold still until the number is actually on screen: a gain that plays out
  // three screens above the fold has told nobody anything, and would still
  // count as shown.
  const [ref, inView] = useInView({ rootMargin: "0px 0px 20% 0px" });
  const [phase, setPhase] = useState("idle"); // idle → gain → rise → done

  useEffect(() => {
    if (!gain || !inView) return;
    setPhase("gain");
    const toRise = setTimeout(() => setPhase("rise"), GAIN_MS);
    const toDone = setTimeout(() => {
      setPhase("done");
      markGainPlayed(id);
    }, GAIN_MS + OUT_MS);
    return () => {
      clearTimeout(toRise);
      clearTimeout(toDone);
    };
  }, [gain, inView, id]);

  const plain = <CountUp end={points} prefix={prefix} suffix={suffix} duration={duration} className={className} />;
  if (!gain || phase === "idle") return <span ref={ref}>{plain}</span>;

  // A scoreboard figure is big enough for the gain to lift clear of it while it
  // climbs, and the overlap is half the effect. A caption-sized one is not: at
  // 11px the two numbers are the same size and simply sit on top of each other,
  // unreadable. So the small one waits its turn — the gain leaves first, then
  // the total counts.
  const showTotal = compact ? phase === "done" : phase !== "gain";
  const total = Math.round(Number(points)).toLocaleString("en-US");
  return (
    <span ref={ref} className="relative inline-block">
      {/* Whatever is standing in, the slot keeps the FINAL value's width, so
          nothing on the line moves as the two swap over. */}
      <span className={showTotal ? undefined : "invisible"}>
        {showTotal ? (
          <CountUp end={points} from={gain.from} prefix={prefix} suffix={suffix} duration={RISE_MS} className={className} />
        ) : (
          <span className={`tabular-nums ${className}`}>
            {prefix}
            {total}
            {suffix}
          </span>
        )}
      </span>
      {phase !== "done" && (
        <span
          className={`pointer-events-none absolute inset-0 flex items-center justify-center whitespace-nowrap font-black text-ok ${
            phase === "gain" ? "gain-in" : "gain-out"
          }`}
          style={compact ? { "--gain-rise": "1.9em" } : undefined}
        >
          <CountUp end={gain.gain} prefix="+" duration={GAIN_MS - 250} />
        </span>
      )}
    </span>
  );
}
