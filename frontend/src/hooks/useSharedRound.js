import { useCallback, useEffect, useRef, useState } from "react";
import { useSeason } from "../context/SeasonContext.jsx";
import { initialRound, recallRound, rememberRound } from "../utils/sharedRound.js";

// A round picker's state, opening on the round shared by the race-weekend tabs
// (utils/sharedRound.js). `ids` are the values the picker offers, null while
// its list is still loading; `fallbackId` is the tab's own default for when
// nothing (usable) is remembered.
//
// The opening pick is made once, when the list first arrives. After that the
// value belongs to the admin: a reload of the list (after a save) must not
// yank the picker back to a remembered round.
//
// Returns [value, pick, setValue]: `pick` is for the admin's own choice and
// remembers it for the other tabs (`rememberAs` when the round to share is not
// the picker's value itself, e.g. the event a sprint row belongs to);
// `setValue` changes the picker without touching the memory.
export function useSharedRound(ids, fallbackId) {
  const { current } = useSeason();
  const seasonKey = current?.id || null;
  const [value, setValue] = useState("");
  const settled = useRef(false);
  const ready = Array.isArray(ids);
  const idsKey = ready ? ids.join("|") : null;

  useEffect(() => {
    if (settled.current || !ready) return;
    settled.current = true;
    const first = initialRound({ ids, remembered: recallRound(seasonKey), fallbackId });
    if (first) setValue((v) => v || first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, fallbackId, seasonKey]);

  const pick = useCallback(
    (id, rememberAs = id) => {
      settled.current = true;
      setValue(id);
      rememberRound(seasonKey, rememberAs);
    },
    [seasonKey]
  );

  return [value, pick, setValue];
}
