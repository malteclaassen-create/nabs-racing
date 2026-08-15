import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useAsk } from "./overlay.jsx";
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
// the members' side gets it — and it holds the switch that makes that decision,
// which is the only thing here that writes anything.
// ---------------------------------------------------------------------------
export default function AdminTelemetry() {
  const ask = useAsk();
  const [busy, setBusy] = useState(false);
  const { data: vis, reload } = useApi(useCallback(() => api.telemetryVisibility(), []));
  const isPublic = vis?.public === true;

  // Both directions ask first, and for opposite reasons. Opening it up is the
  // decision this whole feature was held back for, and it is not one to make by
  // mis-clicking a switch. Closing it again is the awkward one: the laps were
  // visible, drivers have seen each other's, and taking that away is a thing
  // people notice — so it says so rather than quietly reverting.
  async function flip() {
    const next = !isPublic;
    const ok = await ask(
      next
        ? {
            title: "Show recorded laps to everyone?",
            body:
              "Every member will be able to open any driver's fastest lap at any track and compare it with their own — throttle, brake, steering and where the time goes. This is the decision the feature has been waiting on. It can be switched back, but the drivers will have seen it.",
            confirmLabel: "Show everyone",
          }
        : {
            title: "Back to admins only?",
            body:
              "The comparison disappears from the members' side. Nothing is deleted and recording carries on — but drivers who have been using it will find it gone.",
            confirmLabel: "Admins only",
          }
    );
    if (!ok) return;
    setBusy(true);
    try {
      await api.setTelemetryVisibility(next);
      reload();
    } finally {
      setBusy(false);
    }
  }

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
