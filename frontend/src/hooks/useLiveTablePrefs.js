import { useCallback, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// What the Session Best Times table on the Live page shows, and in what order.
// Remembered per browser (localStorage), like the theme and the graphics mode:
// someone who only cares about top speed should not have to say so every race.
//
//   columns  null      -> AUTOMATIC: the column set the layout picks per screen
//                         width (the `bp` on each column definition).
//            [keys]    -> exactly these, at every width.
//   sort     null      -> the session's own order, as the server ranked it.
//            {key,dir} -> that column, that way round.
// ---------------------------------------------------------------------------

const COLS_KEY = "nabs_live_cols";
const SORT_KEY = "nabs_live_sort";

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // private mode, or a value written by an older version
  }
}

function write(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* a preference that can't be stored still works for this visit */
  }
}

function readColumns() {
  const arr = read(COLS_KEY);
  return Array.isArray(arr) ? arr.filter((k) => typeof k === "string") : null;
}

function readSort() {
  const o = read(SORT_KEY);
  if (!o || typeof o.key !== "string") return { key: null, dir: "asc" };
  return { key: o.key, dir: o.dir === "desc" ? "desc" : "asc" };
}

// `columns` is the full column list (see TIMING_COLUMNS in pages/Live.jsx). Only
// the keys and the locked/bp/sortDir flags are read here.
export function useLiveTablePrefs(columns) {
  const [chosen, setChosen] = useState(readColumns);
  const [sort, setSortState] = useState(readSort);

  // The set that automatic mode implies: everything a wide screen shows, i.e.
  // every column except the ones that are off until asked for.
  const autoKeys = useMemo(
    () => columns.filter((c) => !c.optIn).map((c) => c.key),
    [columns]
  );

  const enabled = useMemo(() => new Set(chosen || autoKeys), [chosen, autoKeys]);

  const toggle = useCallback(
    (key) => {
      const col = columns.find((c) => c.key === key);
      if (!col || col.locked) return; // Pos, Driver and the best lap always stay
      setChosen((prev) => {
        const base = prev || autoKeys;
        const next = base.includes(key) ? base.filter((k) => k !== key) : [...base, key];
        // Keep the canonical left-to-right order however they were ticked, so the
        // table never reshuffles itself around the choice.
        const ordered = columns.filter((c) => next.includes(c.key)).map((c) => c.key);
        write(COLS_KEY, ordered);
        return ordered;
      });
    },
    [columns, autoKeys]
  );

  // Picking the column that is already active flips the direction; a new one
  // starts in the direction that reads naturally for it (lap times ascending,
  // laps and speeds descending).
  const setSort = useCallback(
    (key) => {
      setSortState((prev) => {
        if (!key) {
          write(SORT_KEY, null);
          return { key: null, dir: "asc" };
        }
        const col = columns.find((c) => c.key === key);
        const next =
          prev.key === key
            ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
            : { key, dir: col?.sortDir === "desc" ? "desc" : "asc" };
        write(SORT_KEY, next);
        return next;
      });
    },
    [columns]
  );

  // Only the columns: the two menus own one setting each, so clearing one must
  // not quietly undo the other. Clearing the sort is setSort(null).
  const resetColumns = useCallback(() => {
    write(COLS_KEY, null);
    setChosen(null);
  }, []);

  return {
    enabled,
    custom: chosen != null,
    toggle,
    sort,
    setSort,
    resetColumns,
    // The columns to render, in table order. In automatic mode the responsive
    // classes on each column still decide what a narrow screen actually shows.
    visible: useMemo(() => columns.filter((c) => enabled.has(c.key)), [columns, enabled]),
  };
}
