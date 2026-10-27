// 1:58.076
export function lapTime(ms) {
  if (ms == null) return "—";
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(3).padStart(6, "0");
  return m ? `${m}:${s}` : s;
}

// 39:21.512 or 1:02:03.400
export function raceTime(ms) {
  if (ms == null) return "—";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = ((ms % 60000) / 1000).toFixed(3).padStart(6, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function gapText(ms) {
  if (ms == null) return "";
  return `+${(ms / 1000).toFixed(3)}`;
}

// Dates and times as the league writes them ("Wed 28 Oct 2026", "19:15"), in
// the visitor's own time zone. Written out here rather than by the browser,
// whose words follow the phone's language: a phone set to German would mix
// "Mi., 28. Okt." into the English pages.
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dateLong(iso) {
  const d = new Date(iso);
  return `${dayShort(iso)} ${d.getFullYear()}`;
}

export function dateTime(iso) {
  return `${dayShort(iso)}, ${clock(iso)}`;
}

export function points(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// "DE" -> 🇩🇪
export function flag(code) {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

// "#38bdf8" -> "56 189 248" for the CSS variable
export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
  return m ? `${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)}` : null;
}

// Black or white text on a colour, whichever reads.
export function inkOn(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#000";
  const [r, g, b] = rgb.split(" ").map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? "#000" : "#fff";
}

export function dayShort(iso) {
  const d = new Date(iso);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
export function clock(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
export function monthYear(iso) {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function fileSize(bytes) {
  if (!bytes) return "";
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}
