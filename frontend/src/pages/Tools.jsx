import { useCallback, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { PageHeader } from "../components/ui.jsx";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import TelemetryCompare from "../components/TelemetryCompare.jsx";

// ---------------------------------------------------------------------------
// /tools — the telemetry page for members: laps recorded by the in-game
// nabsTelemetry app, compared against the field's. Deliberately NOT in the
// main nav: reachable from the upcoming-race panel (Races page), the private
// profile's member bar and the bell's "telemetry is open" announcement.
//
// This used to be the race-prep page as well, with a fuel calculator, a
// practice analysis in front of the telemetry
// card. The league asked for the telemetry alone; the calculators are in the
// history of this file should they ever be wanted back. The path stays /tools
// so every bookmark, bell link (/tools#telemetry) and ?tab=tools keeps landing.
// ---------------------------------------------------------------------------

// `embedded`: rendered as a section inside the /profile member bar — the page
// around it already has a header, so this skips its own.
export default function Tools({ embedded = false }) {
  // `null` until the answer arrives, so the card cannot flash into view on a
  // page load and then vanish for a member who is not meant to have it.
  const { data: tel } = useApi(useCallback(() => api.telemetryIsPublic().catch(() => ({ public: false })), []));
  const telemetryOpen = tel?.public === true;
  // "/tools#telemetry" (the bell's announcement) should land on the card, not
  // the top of the page. The browser cannot do this itself: the card is only
  // drawn once the visibility answer is in, so the anchor does not exist at
  // load time. Waits for exactly that, then scrolls once.
  const { hash } = useLocation();
  useEffect(() => {
    if (!telemetryOpen || hash !== "#telemetry") return;
    const t = requestAnimationFrame(() =>
      document.getElementById("telemetry")?.scrollIntoView({ behavior: "smooth", block: "start" })
    );
    return () => cancelAnimationFrame(t);
  }, [telemetryOpen, hash]);

  return (
    <div className={embedded ? "space-y-6" : "content-in space-y-6"}>
      {!embedded && (
        <PageHeader
          eyebrow="Members"
          title="Telemetry"
          subtitle="Your recorded laps against the field's, from the in-game NABS telemetry app."
        />
      )}
      {/* The lap comparison, once the league has opened it. Until then this
          asks one cheap question and says so, rather than drawing a card
          whose every request would come back 401. The switch is in
          Admin -> League -> Telemetry; the endpoints check for themselves. */}
      {telemetryOpen ? (
        <TelemetryCompare />
      ) : (
        tel && (
          <div className="card p-5 text-sm text-medium">
            The telemetry comparison is not open to members yet. It appears here as soon as the league switches it on.
          </div>
        )
      )}
      <div>
        <Link to="/races" className="transition text-sm font-semibold text-link hover:underline">Race calendar</Link>
      </div>
    </div>
  );
}
