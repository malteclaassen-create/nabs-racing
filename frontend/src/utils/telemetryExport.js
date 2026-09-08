// ---------------------------------------------------------------------------
// Taking a comparison out of the page: a CSV of every slice for a spreadsheet
// or MoTeC, a text summary that pastes cleanly into Discord, and the track map
// as a PNG. The two text builders are pure and tested; the two downloads need
// a document.
// ---------------------------------------------------------------------------
import { formatLapTime } from "./telemetryAnalysis.js";

const num = (v, digits = 0) => (v == null || !Number.isFinite(v) ? "" : Number(v).toFixed(digits));

// One row per slice, lap A's columns first. Units are in the header so the
// file explains itself; g-forces are the derived ones the page shows.
export function comparisonCsv({ lapA, lapB, dist, n, gA, gB }) {
  const head = ["pct_of_lap", "metres_A", "time_A_ms", "speed_A_kmh", "throttle_A_pct", "brake_A_pct", "steer_A_deg", "gear_A", "long_g_A", "lat_g_A"];
  if (lapB) head.push("time_B_ms", "delta_B_minus_A_ms", "speed_B_kmh", "throttle_B_pct", "brake_B_pct", "steer_B_deg", "gear_B", "long_g_B", "lat_g_B");
  const lines = [head.join(",")];
  for (let i = 0; i < n; i++) {
    const row = [
      num((i / (n - 1)) * 100, 2), num(dist ? dist[i] : null, 1), num(lapA.t[i]), num(lapA.speed[i]), num(lapA.gas[i]), num(lapA.brake[i]),
      num(lapA.steer[i] / 10, 1), num(lapA.gear[i]), num(gA?.long?.[i], 2), num(gA?.lat?.[i], 2),
    ];
    if (lapB) {
      row.push(
        num(lapB.t[i]), num(lapB.t[i] - lapA.t[i]), num(lapB.speed[i]), num(lapB.gas[i]), num(lapB.brake[i]),
        num(lapB.steer[i] / 10, 1), num(lapB.gear[i]), num(gB?.long?.[i], 2), num(gB?.lat?.[i], 2)
      );
    }
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

// The comparison as plain text, the way it would be typed into a chat.
export function comparisonSummary({ trackName, season, lapA, lapB, gapMs, sectors, insights, idealMs, link }) {
  const who = (ms) => (ms > 0 ? "A" : "B");
  const s = (ms) => (Math.abs(ms) / 1000).toFixed(3);
  const car = (lap) => (lap.car ? ` · ${String(lap.car).replaceAll("_", " ")}` : "");
  const team = (lap) => (lap.team?.name ? ` (${lap.team.name})` : "");
  const lines = [`Lap comparison · ${trackName}${season ? ` · Season ${season}` : ""}`];
  lines.push(`A  ${lapA.name}${team(lapA)} · ${formatLapTime(lapA.lapTimeMs)}${car(lapA)}`);
  if (lapB) {
    lines.push(`B  ${lapB.name}${team(lapB)} · ${formatLapTime(lapB.lapTimeMs)}${car(lapB)}`);
    const sectorText = sectors?.length ? " · " + sectors.map((x) => `S${x.n} ${Math.abs(x.deltaMs) < 5 ? "even" : `${who(x.deltaMs)} +${s(x.deltaMs)}`}`).join(" · ") : "";
    lines.push(`Gap: ${gapMs === 0 ? "level" : `${who(gapMs)} +${s(gapMs)} s`}${sectorText}`);
    if (idealMs) lines.push(`Best of both sectors: ${formatLapTime(idealMs)}`);
  }
  if (insights?.length) {
    lines.push("Where the time goes:");
    for (const c of insights) {
      const facts = [];
      if (c.brakeDeltaM != null && Math.abs(c.brakeDeltaM) >= 3) facts.push(`${c.brakeDeltaM > 0 ? "B" : "A"} brakes ${Math.abs(c.brakeDeltaM)} m later`);
      if (Math.abs(c.midDelta) >= 2) facts.push(`${c.midDelta > 0 ? "B" : "A"} +${Math.abs(c.midDelta).toFixed(0)} km/h min`);
      if (Math.abs(c.exitDelta) >= 2) facts.push(`${c.exitDelta > 0 ? "B" : "A"} +${Math.abs(c.exitDelta).toFixed(0)} km/h exit`);
      const at = `${c.atPct}%${c.atM != null ? ` · ${c.atM} m` : ""}`;
      lines.push(`${String(c.n).padStart(2, " ")}. ${at} · ${Math.abs(c.gainMs) < 10 ? "even" : `${who(c.gainMs)} +${s(c.gainMs)} s`}${facts.length ? ` — ${facts.join(", ")}` : ""}`);
    }
  }
  if (link) lines.push(link);
  return lines.join("\n");
}

export function downloadBlob(blob, fileName) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function downloadText(text, fileName, type = "text/plain") {
  downloadBlob(new Blob([text], { type: `${type};charset=utf-8` }), fileName);
}

// The on-page map as a PNG. Two things make the page's SVG unusable as it
// stands: its colours are theme variables, which do not exist outside the
// document, and its images are blob URLs, which an SVG rasterised through an
// <img> is not allowed to fetch. Both are inlined first.
export async function exportSvgPng(svgEl, { width = 1800, background = "#ffffff", fileName = "map.png" } = {}) {
  if (!svgEl) return;
  const clone = svgEl.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const vb = (svgEl.getAttribute("viewBox") || "0 0 100 100").split(/\s+/).map(Number);
  const height = Math.round((width * (vb[3] || 100)) / (vb[2] || 100));
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  for (const img of clone.querySelectorAll("image")) {
    const href = img.getAttribute("href") || img.getAttribute("xlink:href");
    if (!href || href.startsWith("data:")) continue;
    try {
      const blob = await (await fetch(href)).blob();
      const data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
      img.setAttribute("href", data);
    } catch {
      img.remove();
    }
  }
  const styles = getComputedStyle(document.documentElement);
  let text = new XMLSerializer().serializeToString(clone);
  text = text.replace(/var\(--([\w-]+)\)/g, (m, name) => styles.getPropertyValue(`--${name}`).trim() || "#888888");
  // rgb(r g b / a) is fine on the page; the older syntax is the one every
  // rasteriser understands.
  text = text.replace(/rgb\(([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/g, (m, r, g, b, a) => `rgba(${r},${g},${b},${a ?? 1})`);
  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("Could not render the map image"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (blob) downloadBlob(blob, fileName);
  } finally {
    URL.revokeObjectURL(url);
  }
}
