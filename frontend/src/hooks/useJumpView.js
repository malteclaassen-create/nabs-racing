import { useEffect, useState } from "react";

// The view state of an admin tab that is split into views, following the admin
// search and the tab links: `jumpView` names the view to land on, `jumpKey`
// counts the jumps, so asking for the SAME view twice still lands (a plain
// string prop would be unchanged the second time and the tab would stay
// wherever the admin had left it).
export function useJumpView(jumpView, jumpKey, fallback) {
  const [view, setView] = useState(jumpView || fallback);
  useEffect(() => {
    if (jumpView) setView(jumpView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpView, jumpKey]);
  return [view, setView];
}
