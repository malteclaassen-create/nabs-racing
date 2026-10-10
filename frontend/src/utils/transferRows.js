// The moves of a season off the /teams/history payload, shared by the Transfers
// page and the preview in the Standings menu.

// Every row of the centre off the history payload: the recorded / detected
// moves, plus one row per substitute drive found in the grid.
export function centreRows(data) {
  if (!data) return [];
  const rows = [];
  for (const m of data.moves || []) {
    rows.push({ key: `t-${m.driverId}-${m.round}`, kind: "transfer", driverId: m.driverId, fromTeamId: m.fromTeamId, toTeamId: m.toTeamId, round: m.round, pending: m.pending });
  }
  for (const d of data.drivers || []) {
    for (const [n, c] of Object.entries(d.cells || {})) {
      if (c.status !== "sub") continue;
      rows.push({ key: `s-${d.id}-${n}`, kind: "sub", driverId: d.id, fromTeamId: c.fromTeamId || null, toTeamId: c.teamId, round: Number(n), pending: false });
    }
  }
  // Newest round first; within a round the transfers before the fill-ins.
  return rows.sort((a, b) => b.round - a.round || a.kind.localeCompare(b.kind));
}

// Where a football page prints the fee: what kind of move this is.
export function kindLabel(r) {
  if (r.kind === "sub") return "Substitute";
  if (r.pending) return "Announced";
  return "Transfer";
}
