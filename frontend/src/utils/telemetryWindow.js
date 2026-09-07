// Inclusive indices on lap A's grid. Keep at least eight intervals visible
// and cap magnification at 20× so the view cannot collapse to a single sample.
export function fitTelemetryWindow(from, to, lastIndex) {
  const last = Math.max(1, lastIndex);
  const minimum = Math.min(last, Math.max(8, Math.ceil(last / 20)));
  const span = Math.min(last, Math.max(minimum, Math.round(Math.abs(to - from))));
  const start = Math.max(0, Math.min(last - span, Math.round((from + to - span) / 2)));
  return [start, start + span];
}

export function telemetryIndexAt(fraction, range) {
  return Math.round(range[0] + Math.max(0, Math.min(1, fraction)) * (range[1] - range[0]));
}
