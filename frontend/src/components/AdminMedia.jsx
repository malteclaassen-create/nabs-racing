import { useEffect, useState } from "react";
import SlidingTabs from "./SlidingTabs.jsx";
import AdminRacePhotos from "./AdminRacePhotos.jsx";
import AdminRaceHighlights from "./AdminRaceHighlights.jsx";
import AdminHotlapVideos from "./AdminHotlapVideos.jsx";

// Admin "Photos & Videos": everything the league SHOWS of a race night, in one
// tab and three views.
//
// The three used to be in three different places — the gallery here, the
// highlights link among the race details in Edit Results, the hotlaps in the
// Attendance tab — because each had been built next to the page it appears on.
// That is the builder's map, not the admin's: somebody who has just finished
// editing the night's video does not think "which page does this show up on",
// they think "I have media for round 7". So the media is together and the
// pages they feed are named on each panel instead.
//
// `jumpView` is a view named by the admin search ("Hotlap videos" rather than
// just "Photos & Videos"); `jumpKey` counts the jumps so searching the same
// entry twice lands again instead of being ignored as an unchanged prop.
export default function AdminMedia({ jumpView = null, jumpKey = null }) {
  const [view, setView] = useState(jumpView || "photos");
  useEffect(() => {
    if (jumpView) setView(jumpView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpView, jumpKey]);

  return (
    <div className="space-y-5">
      <SlidingTabs
        items={[
          { key: "photos", label: "Race photos" },
          { key: "highlights", label: "Race highlights" },
          { key: "hotlaps", label: "Hotlap videos" },
        ]}
        value={view}
        onChange={setView}
      />

      {view === "photos" && <AdminRacePhotos />}
      {view === "highlights" && <AdminRaceHighlights />}
      {view === "hotlaps" && <AdminHotlapVideos />}
    </div>
  );
}
