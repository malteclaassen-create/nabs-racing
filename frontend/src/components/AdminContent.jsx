import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox } from "./ui.jsx";
import { fmtDateShort } from "../utils/format.js";
import SlidingTabs from "./SlidingTabs.jsx";
import AdminResultGraphic from "./AdminResultGraphic.jsx";
import AdminDiscordPost from "./AdminDiscordPost.jsx";

// ---------------------------------------------------------------------------
// Admin → Content: everything a finished round gets published AS.
//
// The poster and the Discord message are one job done in one sitting: you look
// at the picture, you read the text that goes with it, you post. They used to
// be a tab apart, with the message tucked under the results editor, which meant
// posting a round involved saving a table you had not come here to touch.
//
// One round picker at the top drives both, because they are always about the
// same round, and two pickers that can disagree is a way of sending last week's
// picture with this week's text.
// ---------------------------------------------------------------------------

const VIEWS = [
  { key: "graphic", label: "Graphic" },
  { key: "post", label: "Discord post" },
];

const fmtDate = (d) => (d ? fmtDateShort(d) : "no date");

export default function AdminContent() {
  const { data: races, error, reload } = useApi(useCallback(() => api.races(), []));
  const [raceId, setRaceId] = useState("");
  const [view, setView] = useState("graphic");

  // Only rounds that HAVE a classification: there is nothing to draw or announce
  // about a round that has not run.
  const finished = useMemo(
    () =>
      [...(races || [])]
        .filter((r) => r.isCompleted && !r.isSpecialEvent)
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)),
    [races]
  );

  useEffect(() => {
    if (!raceId && finished.length) setRaceId(finished[0].id);
  }, [finished, raceId]);

  return (
    <div className="space-y-5">
      {error && <ErrorBox message={error} onRetry={reload} />}

      {finished.length === 0 ? (
        <p className="card p-5 text-sm text-light">No finished round in this season yet.</p>
      ) : (
        <>
          {/* The round, then what you are making of it. Both live in the same
              bar so it always reads as one sentence. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <select
              aria-label="Round"
              className="input w-auto max-w-[18rem] py-2 text-sm font-semibold"
              value={raceId}
              onChange={(e) => setRaceId(e.target.value)}
            >
              {finished.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.number != null ? `R${r.number}` : "Session"} {r.track} · {fmtDate(r.date)}
                </option>
              ))}
            </select>
            <SlidingTabs items={VIEWS} value={view} onChange={setView} btnClassName="px-4 py-1.5 text-xs" />
          </div>

          {/* Both stay mounted: switching back to the poster should not redraw
              it, and switching away must not throw away a message you have
              spent five minutes editing. */}
          <div className={view === "graphic" ? "" : "hidden"}>
            <AdminResultGraphic raceId={raceId} />
          </div>
          <div className={view === "post" ? "" : "hidden"}>
            {raceId && <AdminDiscordPost raceId={raceId} />}
          </div>
        </>
      )}
    </div>
  );
}
