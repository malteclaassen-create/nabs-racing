import { useEffect, useState, useCallback } from "react";

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
export function useApi(fn) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fn()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => (alive = false);
  }, [fn]);

  useEffect(() => {
    const cancel = reload();
    return cancel;
  }, [reload]);

  return { data, loading, error, reload };
}
