import { useEffect, useState } from "react";
import { api, peekCached } from "../api/client.js";
import { useAuth } from "./useAuth.js";
import { useMyDivision } from "./useMyDivision.js";

// Which of a round's two races the signed-in member drove in: 2 (Division 2),
// 1 (Division 1) or null (neither, signed out, or a round with one field).
//
// The result itself decides first: whoever is in a race's classification
// raced there, which also gets a reserve right, who can drive in either field
// from one week to the next. Only someone in neither list falls back to the
// field they race in this season (useMyDivision), and only when the caller
// says that season is the one being raced (`seasonIsLive`).
//
// `feature` is the round's own results payload (Division 1), `div2RaceId` the
// hidden Division 2 race row. The Division 2 result is read here when it is
// needed; the api client keeps it, so the page's own Div 2 tab costs nothing
// more when it opens.

const norm = (v) => (v || "").trim().toLowerCase();

export function isMine(row, user) {
  if (!row || !user) return false;
  if (user.driverId && row.driverId === user.driverId) return true;
  return !!user.driverName && norm(row.name) === norm(user.driverName);
}

const drove = (payload, user) => (payload?.results || []).some((r) => isMine(r, user));

export function useRoundDivision({ feature, div2RaceId, seasonIsLive = false }) {
  const { user, isLoggedIn } = useAuth();
  const me = isLoggedIn ? user : null;
  const inFeature = !!me && !!div2RaceId && drove(feature, me);
  // Read Division 2 only for someone who is not already in Division 1's list.
  const wantDiv2 = !!me && !!div2RaceId && !!feature && !inFeature;
  const [div2, setDiv2] = useState({ raceId: null, data: null });
  useEffect(() => {
    if (!wantDiv2) return undefined;
    let alive = true;
    const hit = peekCached(() => api.raceResults(div2RaceId));
    if (hit) {
      setDiv2({ raceId: div2RaceId, data: hit.data });
      return undefined;
    }
    api
      .raceResults(div2RaceId)
      .then((d) => alive && setDiv2({ raceId: div2RaceId, data: d }))
      .catch(() => alive && setDiv2({ raceId: div2RaceId, data: null }));
    return () => {
      alive = false;
    };
  }, [wantDiv2, div2RaceId]);
  const div2Read = div2.raceId === div2RaceId;
  const inDiv2 = wantDiv2 && div2Read && drove(div2.data, me);
  const fallback = useMyDivision(wantDiv2 && div2Read && !inDiv2 && seasonIsLive);

  if (!me || !div2RaceId) return { division: null, ready: true, payload2: null };
  if (!feature) return { division: null, ready: false, payload2: null };
  if (inFeature) return { division: 1, ready: true, payload2: null };
  if (!div2Read) return { division: null, ready: false, payload2: null };
  if (inDiv2) return { division: 2, ready: true, payload2: div2.data };
  return { division: fallback.division, ready: fallback.ready, payload2: div2.data };
}
