import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { getUserToken } from "./useAuth.js";

// Which field the signed-in member races in this season: 1, 2, or null when
// nobody is signed in, the season has one field, or they race in none.
//
// The Live page has sent a Division 2 driver to their own race's board for a
// while; the standings and the results of a round follow the same answer, so
// nobody in Division 2 has to find a switch before they see their own table.
// It is the Live page's question too (/api/live/me), asked once per page load
// and login, whichever page asks first.
let asked = null; // { token, promise }

function ask() {
  const token = getUserToken();
  if (!token) return Promise.resolve(null);
  if (asked?.token !== token) {
    asked = {
      token,
      promise: api
        .liveMe()
        .then((me) => (me?.division === 2 ? 2 : me?.division === 1 ? 1 : null))
        .catch(() => null),
    };
  }
  return asked.promise;
}

// `enabled` false asks nothing and reports ready at once, for a page that
// already knows the answer does not matter (a season with one field, or a
// table the viewer picked by hand).
export function useMyDivision(enabled = true) {
  const wanted = enabled && !!getUserToken();
  // undefined = not answered yet; null = answered, no division.
  const [answer, setAnswer] = useState(undefined);
  useEffect(() => {
    if (!wanted) return undefined;
    let alive = true;
    ask().then((division) => alive && setAnswer(division));
    return () => {
      alive = false;
    };
  }, [wanted]);
  // Not ready only while an answer is actually on its way, so the page can
  // hold its skeleton instead of showing the wrong table for a moment.
  return { division: wanted ? answer ?? null : null, ready: !wanted || answer !== undefined };
}
