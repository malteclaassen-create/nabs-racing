import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useAuth } from "./useAuth.js";
import { MARKET_CHANGED_EVENT } from "./useAdminAttention.js";

// "A seat is going begging, and you are a reserve" — for the site chrome and
// for the attendance page.
//
// The bell already tells reserves when a seat is offered. What it cannot do is
// point: the market block is the very last thing on the attendance page, a
// screenful or more below the fold, under the whole entry list. Somebody who
// arrives to answer "am I available on Friday" answers it and leaves without
// ever scrolling to the one part of the page they could act on.
//
// So this is a nudge, and a nudge has to know when to stop. It goes quiet for
// good once the person has either put their hand up for a seat, or simply
// scrolled down and looked at the offers. A signal that fires on every visit
// stops being a signal after the second time.

// Which offers this person has already been shown. Keyed by their driver row,
// so two people sharing a browser do not inherit each other's state (the same
// reasoning as the card editor's `nabs.cardSeen.<driverId>`).
//
// What is stored is the set of offers that were open when they last looked, NOT
// a running history. So it prunes itself as seats get filled, and a seat offered
// tomorrow is an id that is not in the set, which is exactly when the nudge
// should come back.
const seenKey = (driverId) => `nabs_seats_seen_${driverId}`;

// Two copies of this hook are alive at once on the attendance page: the nav
// bar's and the page's. Marking the offers as seen in one has to reach the
// other, or the number in the bar keeps glowing at somebody who is looking
// straight at the offers.
const SEATS_SEEN_EVENT = "nabs-seats-seen";

function readSeen(driverId) {
  if (!driverId) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(seenKey(driverId)) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return []; // private mode, or somebody edited it by hand
  }
}

function writeSeen(driverId, ids) {
  if (!driverId) return;
  try {
    localStorage.setItem(seenKey(driverId), JSON.stringify(ids));
  } catch {
    // Storage refused. The nudge shows again next visit, which is a worse
    // outcome than remembering but a much better one than a crash.
  }
}

export function useReserveSeats() {
  const { user, isLoggedIn } = useAuth();
  const [data, setData] = useState(null);
  const [seen, setSeen] = useState([]);

  const load = useCallback(() => {
    if (!isLoggedIn) {
      setData(null);
      return;
    }
    api
      .marketAlert()
      .then((d) => setData(d || null))
      .catch(() => {});
  }, [isLoggedIn]);

  // Once per visit, and again whenever a seat is offered, taken or withdrawn.
  // No polling: a seat is not a live timing feed, and this would otherwise ride
  // on every page of the site for every signed-in member.
  useEffect(() => {
    load();
    window.addEventListener(MARKET_CHANGED_EVENT, load);
    return () => window.removeEventListener(MARKET_CHANGED_EVENT, load);
  }, [load]);

  const driverId = user?.driverId || null;
  useEffect(() => {
    const sync = () => setSeen(readSeen(driverId));
    sync();
    window.addEventListener(SEATS_SEEN_EVENT, sync);
    return () => window.removeEventListener(SEATS_SEEN_EVENT, sync);
  }, [driverId]);

  const open = data?.open || [];
  const mine = data?.mine || [];
  // Applying for one seat settles the whole round. Someone who has said "I want
  // that car" does not need to be chased about the other one.
  const applied = mine.length > 0;
  const fresh = open.filter((id) => !seen.includes(id));

  const markSeen = useCallback(() => {
    if (!driverId || !open.length) return;
    writeSeen(driverId, open);
    setSeen(open);
    window.dispatchEvent(new Event(SEATS_SEEN_EVENT));
  }, [driverId, open]);

  return {
    isReserve: !!data?.isReserve,
    raceId: data?.raceId || null,
    openCount: open.length,
    applied,
    // The nudge itself: only when there is something they have not seen and
    // have not already acted on.
    show: !!data?.isReserve && !applied && fresh.length > 0,
    markSeen,
    reload: load,
  };
}
