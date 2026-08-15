import { Link } from "react-router-dom";
import TelemetryCompare from "./TelemetryCompare.jsx";

// ---------------------------------------------------------------------------
// Admin → League → Telemetry.
//
// The lap comparison, and the two sentences somebody needs before they can
// read it. The RECORDING half — minting the key, the ini snippet for the race
// server — stays where it was built, on the Reports tab beside the in-race
// reporting key, because the two are the same contract and moving one of them
// away from the other is how they drift.
//
// This tab is where the feature is tried out before anybody decides whether
// the members' side gets it. Nothing here is a switch: everything is a read.
// ---------------------------------------------------------------------------
export default function AdminTelemetry() {
  return (
    <div className="space-y-6">
      <div className="card p-5">
        <h2 className="font-display text-lg font-extrabold uppercase tracking-tight text-dark">
          Laps from inside the car
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-light">
          Throttle, brake, steering and speed over a lap, sampled by position on the track rather than by
          time — so two laps line up slice for slice and the difference between them is a subtraction
          rather than a guess. The site keeps one lap per driver per track: their fastest clean one.
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-light">
          Nothing is recorded until the key is minted, and no driver appears here who has not sent a lap.
          The switch, the URL and the race-server snippet are on the{" "}
          <span className="font-semibold text-dark">Reports</span> tab, under &ldquo;Telemetry from inside
          the car&rdquo;.
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-light">
          Only admins can read this. A lap says where a driver lifts and how they trail the brake, and
          whether that is something the whole league gets to study about each other is a decision the
          league has not made yet — so it is here first, and nowhere else.
        </p>
        <p className="mt-3 text-sm text-light">
          <Link to="/admin?tab=reports" className="font-semibold text-link hover:underline">
            Go to the switch →
          </Link>
        </p>
      </div>

      <TelemetryCompare />
    </div>
  );
}
