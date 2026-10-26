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

export function dateLong(iso) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

export function dateTime(iso) {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
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

// "Wed 28 Oct", "20:15" and "CET" of a start, in the visitor's own time zone.
export function dayShort(iso) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}
export function clock(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function fileSize(bytes) {
  if (!bytes) return "";
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}
