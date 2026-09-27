// is it briefing time? `times` is what the site sends:
// { beforeMin, afterMin, kickoffs: [iso, ...], openUntil: iso | null }
// openUntil is "Start now" from the admin
export function briefingOpen(times, now = Date.now()) {
  const until = Date.parse(times?.openUntil);
  if (Number.isFinite(until) && now <= until) return true;
  const before = (Number(times?.beforeMin) || 0) * 60_000;
  const after = (Number(times?.afterMin) || 0) * 60_000;
  return (times?.kickoffs || []).some((k) => {
    const t = Date.parse(k);
    return Number.isFinite(t) && now >= t - before && now <= t + after;
  });
}
