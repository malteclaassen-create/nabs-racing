import { useEffect, useState, useCallback } from "react";
import { peekCached } from "../api/client.js";

// Generic data-fetching hook. `fn` MUST be wrapped in useCallback by the caller,
// with everything the request depends on in its dependency list — that identity
// is what tells this hook when to fetch again.
//
// It used to take its own `deps` array and memoise on that, defaulting to [].
// Callers passed their dependencies to useCallback but not a second time to the
// hook, so the very first `fn` was frozen in place and the request never ran
// again: switching season, track or race left the old answer on screen. Only
// one of 84 call sites worked around it. Depending on `fn` directly means the
// caller's useCallback list is the single source of truth and there is nothing
// left to forget.
//
// A read this tab has already made is answered at once from memory while the
// fresh one is on its way (stale-while-revalidate, see GET_CACHE in
// api/client.js). That is what makes a page you go back to — Home, Races, the
// standings, tab after tab on a phone — open with its content instead of an
// empty screen while the request is out. The fresh answer then replaces it,
// and if that one fails the remembered page stays up rather than turning into
// an error over content that was fine a moment ago.
export function useApi(fn) {
  const [initial] = useState(() => peekCached(fn));
  const [data, setData] = useState(initial ? initial.data : null);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState(null);

  const reload = useCallback(() => {
    let alive = true;
    const hit = peekCached(fn);
    if (hit) {
      setData(hit.data);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);
    fn()
      .then((d) => alive && setData(d))
      .catch((e) => alive && !hit && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => (alive = false);
  }, [fn]);

  useEffect(() => {
    const cancel = reload();
    return cancel;
  }, [reload]);

  return { data, loading, error, reload };
}
