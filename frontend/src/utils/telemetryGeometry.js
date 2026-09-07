// Recorded positions stay linear between samples. Heading interpolates along
// the shorter turn so replay does not jump at the -180°/180° boundary.
export function recordedPose(x, y, index) {
  const last = Math.min(x.length, y.length) - 1;
  const position = Math.max(0, Math.min(last, index));
  const lo = Math.floor(position), hi = Math.min(last, lo + 1), f = position - lo;
  const heading = (i) => {
    let a = Math.max(0, i - 1), b = Math.min(last, i + 1);
    while (b < last && x[a] === x[b] && y[a] === y[b]) b++;
    while (a > 0 && x[a] === x[b] && y[a] === y[b]) a--;
    return Math.atan2(y[b] - y[a], x[b] - x[a]) * 180 / Math.PI;
  };
  const h = heading(lo), turn = ((heading(hi) - h + 540) % 360) - 180;
  return {x:x[lo] + (x[hi] - x[lo]) * f, y:y[lo] + (y[hi] - y[lo]) * f, heading:h + turn * f};
}

export function sampleAtTime(times, ms, upper = 0) {
  let hi = Math.max(0, Math.min(times.length - 1, upper));
  while (hi < times.length - 1 && times[hi] < ms) hi++;
  while (hi > 0 && times[hi - 1] >= ms) hi--;
  if (hi === 0) return 0;
  const lo = hi - 1;
  return lo + Math.max(0, Math.min(1, (ms - times[lo]) / (times[hi] - times[lo] || 1)));
}
