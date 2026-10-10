// Each team's championship total after every completed round, starting from 0
// before the first: Map<teamId, [0, afterR1, afterR2, …]>. A round adds what
// it counts toward the season total (scored minus the share the standings
// marked as dropped), so the last value lands on the team's real total, the
// same way the points chart builds its lines.
export function cumulativeTotals(rows, completed) {
  return new Map(
    rows.map((t) => {
      const pts = [0];
      let c = 0;
      for (const n of completed) {
        const scored = t.perRace?.[n] || 0;
        c += scored - Math.min(scored, t.droppedPerRace?.[n] || 0);
        pts.push(c);
      }
      return [t.teamId, pts];
    })
  );
}
