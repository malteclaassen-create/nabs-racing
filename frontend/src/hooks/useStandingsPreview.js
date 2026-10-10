import { useEffect, useState } from "react";
import { api, peekCached } from "../api/client.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { useSeriesPath } from "../context/SeriesContext.jsx";
import { isIdleReserve } from "../utils/standingsRow.js";
import { centreRows } from "../utils/transferRows.js";

// The little table inside the Standings menu: who leads, by how much, and which
// team is on top. It asks for nothing until somebody opens the menu, so the bar
// adds no request to an ordinary page load. The three reads are the very ones
// the Drivers and Constructors pages make (same addresses, same season, same
// series), so a visit to either fills the menu for free and the other way round.
//
// Positions come from the server's order, untouched. The only thing done here
// is what the Drivers page itself does before it numbers its rows: reserves who
// never got in a car are left out (utils/standingsRow.js). That way P2 in the
// menu is P2 on the page.

// How long an answer is good for before the next open asks again. A result
// being saved is the only thing that changes the table, and that happens a few
// times a week.
const FRESH_MS = 5 * 60_000;

// key -> { at, data }, and key -> the read in flight. Module level, so the
// desktop flyout and the phone menu share one answer.
const memo = new Map();
const inflight = new Map();

function shape(drivers, t1, t2) {
  const all = drivers?.standings || [];
  const rows = all.filter((r) => !isIdleReserve(r)).map((r, i) => ({ ...r, position: i + 1 }));
  const raceNumbers = drivers?.raceNumbers || [];
  const scored = raceNumbers.filter((n) => all.some((r) => r.perRace?.[n] != null));
  const t1Rows = t1?.standings || [];
  const t2Rows = t2?.standings || [];
  return {
    drivers: rows.slice(0, 3),
    driverLeaderTotal: rows[0]?.total ?? 0,
    t1: t1Rows.slice(0, 3),
    t2Leader: t2Rows[0] || null,
    multiTier: t2Rows.length > 0,
    lastRound: scored.length ? scored[scored.length - 1] : null,
    rounds: raceNumbers.length,
    allScored: raceNumbers.length > 0 && scored.length === raceNumbers.length,
    // Nothing to show yet: a new season before its first result.
    empty: !rows.some((r) => r.total > 0) && !t1Rows.some((r) => r.total > 0),
  };
}

const READS = [api.driverStandings, api.t1Standings, api.t2Standings];

function fetchPreview(key) {
  if (inflight.has(key)) return inflight.get(key);
  const p = Promise.all(READS.map((read) => read()))
    .then(([d, t1, t2]) => {
      const data = shape(d, t1, t2);
      memo.set(key, { at: Date.now(), data });
      return data;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// What the api client already remembers from a standings page, if all three.
function peek() {
  const hits = READS.map((read) => peekCached(() => read()));
  return hits.every(Boolean) ? shape(...hits.map((h) => h.data)) : null;
}

// `open`: the menu is on screen. Returns { data, loading, error }.
export function useStandingsPreview(open) {
  const { slug } = useSeriesPath();
  const { current, active } = useSeason();
  const key = `${slug || ""}:${current?.number ?? ""}`;
  const [state, setState] = useState({ key: null, data: null, error: false });

  useEffect(() => {
    if (!open) return;
    const kept = memo.get(key);
    if (kept && Date.now() - kept.at < FRESH_MS) {
      setState({ key, data: kept.data, error: false });
      return;
    }
    // Show what is already known at once, then the fresh answer.
    const known = kept?.data || peek();
    setState((s) => ({ key, data: known || (s.key === key ? s.data : null), error: false }));
    let alive = true;
    fetchPreview(key)
      .then((data) => alive && setState({ key, data, error: false }))
      // A decoration must not make noise: with something on screen it stays,
      // otherwise the menu says it could not load and the links still work.
      .catch(() => alive && setState((s) => (s.key === key && s.data ? s : { key, data: null, error: true })));
    return () => {
      alive = false;
    };
  }, [open, key]);

  const mine = state.key === key ? state : { data: null, error: false };
  // An archived season is settled; the live one is once every round is in.
  const archived = !!current && !!active && current.number < active.number;
  return {
    data: mine.data,
    error: mine.error,
    loading: !mine.data && !mine.error,
    season: current,
    decided: archived || !!mine.data?.allScored,
  };
}

// The Transfers and Hall of Fame rows preview their own pages: the latest team
// changes, and the reigning champion with the all-time wins. Same rules as the
// table above: nothing is asked until that row is first pointed at, the answer
// is the very one the page itself loads, and it is kept a few minutes for every
// later open of the menu.
const EXTRA = {
  transfers: {
    read: () => api.transferMarket(),
    shape: (d) => {
      const teams = new Map((d?.teams || []).map((t) => [t.id, t]));
      const drivers = new Map((d?.drivers || []).map((x) => [x.id, x]));
      const rows = centreRows(d);
      return {
        total: rows.length,
        latest: rows.slice(0, 4).map((r) => ({ ...r, driver: drivers.get(r.driverId), from: teams.get(r.fromTeamId), to: teams.get(r.toTeamId) })),
      };
    },
  },
  records: {
    read: () => api.seriesRecords(),
    shape: (d) => ({
      champion: d?.champions?.[0] || null,
      wins: (d?.lists || []).find((l) => l.key === "wins")?.rows.slice(0, 3) || [],
      totals: d?.totals || null,
      seasons: d?.seasons || 0,
    }),
  },
};

function fetchExtra(kind, key) {
  if (inflight.has(key)) return inflight.get(key);
  const p = EXTRA[kind]
    .read()
    .then((d) => {
      const data = EXTRA[kind].shape(d);
      memo.set(key, { at: Date.now(), data });
      return data;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// `kind`: "transfers" or "records", or anything else for nothing at all.
export function useMenuPagePreview(kind) {
  const { slug } = useSeriesPath();
  const { current } = useSeason();
  const wanted = EXTRA[kind] ? kind : null;
  // The records span every season of the series; the transfers are this one's.
  const key = wanted ? `${wanted}:${slug || ""}:${wanted === "transfers" ? current?.number ?? "" : ""}` : null;
  const [state, setState] = useState({ key: null, data: null, error: false });

  useEffect(() => {
    if (!key) return;
    const kept = memo.get(key);
    if (kept && Date.now() - kept.at < FRESH_MS) {
      setState({ key, data: kept.data, error: false });
      return;
    }
    let alive = true;
    fetchExtra(wanted, key)
      .then((data) => alive && setState({ key, data, error: false }))
      .catch(() => alive && setState({ key, data: null, error: true }));
    return () => {
      alive = false;
    };
  }, [key, wanted]);

  const mine = state.key === key ? state : { data: memo.get(key)?.data || null, error: false };
  return { data: mine.data, error: mine.error, loading: !!key && !mine.data && !mine.error };
}
