// Line-style SVG icon set for the Race Info page (rule cards, rulebook groups,
// download cards) and the admin Race Info editor. One shared module so the
// public page and the admin's icon picker always agree on the available names.
// All paths are stroke = currentColor, drawn on a 24x24 grid.
export const ICON_PATHS = {
  download: "M12 3v12m0 0l-4-4m4 4l4-4M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4",
  lock: "M6 10V8a6 6 0 1112 0v2M5 10h14a1 1 0 011 1v9a1 1 0 01-1 1H5a1 1 0 01-1-1v-9a1 1 0 011-1z",
  info: "M12 8h.01M11 12h1v4h1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  box: "M21 8l-9-5-9 5m18 0l-9 5m9-5v8l-9 5m0-13L3 8m9 5v8m0-8L3 8m0 0v8l9 5",
  external: "M14 5h5v5M19 5l-8 8M12 5H7a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-5",
  folder: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z",
  calendar: "M4 6a2 2 0 012-2h12a2 2 0 012 2v13a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM4 9h16M8 3v4M16 3v4",
  tiers: "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M22 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8",
  shield: "M12 3l7 3v5c0 4.6-3.1 7.3-7 9-3.9-1.7-7-4.4-7-9V6z",
  flag: "M5 21V4M5 4c3-1.5 6 1.5 9 0s4-1 4-1v9s-1 .5-4 1-6-1.5-9 0",
  clock: "M12 8v4l3 3M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  scale: "M12 3v18M8 21h8M6 7l-3 6a3.5 3.5 0 006 0zM18 7l-3 6a3.5 3.5 0 006 0zM4 7h16",
  tyre: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM12 3v5M12 16v5M3.3 9.2l4.8 1.6M15.9 13.2l4.8 1.6M5.6 18.4l3.9-3.1M14.5 8.7l3.9-3.1",
  limits: "M4 20L20 4M7 4h13v13M4 12l8 8",
  wind: "M3 8h11a3 3 0 10-3-3M3 12h15a3 3 0 11-3 3M3 16h8a2.5 2.5 0 11-2.5 2.5",
  wheel: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 14.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM12 3.5V9.5M4.5 17l5.2-3.5M19.5 17l-5.2-3.5",
  blueflag: "M5 21V4M5 4c3-1.5 6 1.5 9 0s4-1 4-1v9s-1 .5-4 1-6-1.5-9 0M8 6.5h4M10 9h4",
  align: "M4 4v16M20 4v16M8 12h8M8 12l3-3M8 12l3 3M16 12l-3-3M16 12l-3 3",
  safety: "M12 3l8 4v5c0 4.4-3.2 7.6-8 9-4.8-1.4-8-4.6-8-9V7zM9 12.5l2 2 4-4.5",
};

// The names offered in the admin's icon picker (everything except the purely
// functional UI glyphs like download/lock/external).
export const PICKABLE_ICONS = [
  "calendar", "tiers", "shield", "flag", "clock", "scale", "tyre", "limits",
  "wind", "wheel", "blueflag", "align", "safety", "info", "box", "folder",
];

export default function InfoIcon({ name, className = "h-4 w-4" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={ICON_PATHS[name] || ICON_PATHS.info} />
    </svg>
  );
}
