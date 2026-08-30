/*
 * The icon set: Tabler Icons (MIT), outline style, 24px grid, stroke 2.
 *
 * The paths below are copied verbatim from the published SVGs rather than
 * drawn here, so the rail reads as one designed family instead of twenty
 * separate sketches. No icon font, no runtime dependency, no network.
 *
 * To change one: npm i -D @tabler/icons, look the glyph up at tabler.io/icons,
 * and copy the <path d> lines out of
 * node_modules/@tabler/icons/icons/outline/<name>.svg. The name each icon came
 * from is in the comment above it. Tabler Icons v3.46.0.
 */

// The size belongs on the element, not in a stylesheet rule: an inline SVG
// with only a viewBox has no intrinsic size, and in a flex button it collapses
// to 0x0 -- which is exactly what happened to the whole top bar while the
// left hand toolbar looked fine, because only `.tool svg` had a CSS size.
const base = {
  viewBox: '0 0 24 24',
  width: 18,
  height: 18,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** One glyph from its path data. Tabler draws everything with strokes only. */
const icon = (...d: string[]) => () => (
  <svg {...base}>
    {d.map((p, i) => (
      <path key={i} d={p} />
    ))}
  </svg>
);

/** tabler: pointer -- Select */
export const IconCursor = icon(
  'M7.904 17.563a1.2 1.2 0 0 0 2.228 .308l2.09 -3.093l4.907 4.907a1.067 1.067 0 0 0 1.509 0l1.047 -1.047a1.067 1.067 0 0 0 0 -1.509l-4.907 -4.907l3.113 -2.09a1.2 1.2 0 0 0 -.309 -2.228l-13.582 -3.904l3.904 13.563',
);

/** tabler: road -- Draw the track */
export const IconTrack = icon(
  'M4 19l4 -14',
  'M16 5l4 14',
  'M12 8v-2',
  'M12 13v-2',
  'M12 18v-2',
);

/** tabler: arrow-ramp-right-3 -- Draw the pit lane: a lane branching off the main line */
export const IconPit = icon(
  'M6 3v6',
  'M16 16l4 -4l-4 -4',
  'M6 21v-6a3 3 0 0 1 3 -3h11',
);

/** tabler: mountain -- Sculpt the ground */
export const IconTerrain = icon(
  'M3 20h18l-6.921 -14.612a2.3 2.3 0 0 0 -4.158 0l-6.921 14.612',
  'M7.5 11l2 2.5l2.5 -2.5l2 3l2.5 -2',
);

/** tabler: texture -- Paint a surface into the ground (hatching = material) */
export const IconGround = icon(
  'M6 3l-3 3',
  'M21 18l-3 3',
  'M11 3l-8 8',
  'M16 3l-13 13',
  'M21 3l-18 18',
  'M21 8l-13 13',
  'M21 13l-8 8',
);

/** tabler: stairs -- Kerbs: the step up from the tarmac, seen in section */
export const IconKerb = icon(
  'M22 5h-5v5h-5v5h-5v5h-5',
);

/** tabler: fence -- Barriers */
export const IconBarrier = icon(
  'M4 12v4h16v-4l-16 0',
  'M6 16v4h4v-4m0 -4v-6l-2 -2l-2 2v6',
  'M14 16v4h4v-4m0 -4v-6l-2 -2l-2 2v6',
);

/** tabler: box -- Place a single object */
export const IconPlace = icon(
  'M12 3l8 4.5l0 9l-8 4.5l-8 -4.5l0 -9l8 -4.5',
  'M12 12l8 -4.5',
  'M12 12l0 9',
  'M12 12l-8 -4.5',
);

/** tabler: trees -- Scatter vegetation */
export const IconScatter = icon(
  'M16 5l3 3l-2 1l4 4l-3 1l4 4h-9',
  'M15 21l0 -3',
  'M8 13l-2 -2',
  'M8 12l2 -2',
  'M8 21v-13',
  'M5.824 16a3 3 0 0 1 -2.743 -3.69a3 3 0 0 1 .304 -4.833a3 3 0 0 1 4.615 -3.707a3 3 0 0 1 4.614 3.707a3 3 0 0 1 .305 4.833a3 3 0 0 1 -2.919 3.695h-4l-.176 -.005',
);

/** tabler: eraser -- Erase objects */
export const IconErase = icon(
  'M19 20h-10.5l-4.21 -4.3a1 1 0 0 1 0 -1.41l10 -10a1 1 0 0 1 1.41 0l5 5a1 1 0 0 1 0 1.41l-9.2 9.3',
  'M18 13.3l-6.3 -6.3',
);

/** tabler: flag-3 -- Race setup: grid, pits, sectors, AI line */
export const IconFlag = icon(
  'M5 14h14l-4.5 -4.5l4.5 -4.5h-14v16',
);

/** tabler: arrow-back-up */
export const IconUndo = icon(
  'M9 14l-4 -4l4 -4',
  'M5 10h11a4 4 0 1 1 0 8h-1',
);

/** tabler: arrow-forward-up */
export const IconRedo = icon(
  'M15 14l4 -4l-4 -4',
  'M19 10h-11a4 4 0 1 0 0 8h1',
);

/** tabler: device-floppy */
export const IconSave = icon(
  'M6 4h10l4 4v10a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2',
  'M10 14a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
  'M14 4l0 4l-6 0l0 -4',
);

/** tabler: folder-open */
export const IconOpen = icon(
  'M5 19l2.757 -7.351a1 1 0 0 1 .936 -.649h12.307a1 1 0 0 1 .986 1.164l-.996 5.211a2 2 0 0 1 -1.964 1.625h-14.026a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v2',
);

/** tabler: file-plus */
export const IconNew = icon(
  'M14 3v4a1 1 0 0 0 1 1h4',
  'M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2',
  'M12 11l0 6',
  'M9 14l6 0',
);

/** tabler: package-export */
export const IconExport = icon(
  'M12 21l-8 -4.5v-9l8 -4.5l8 4.5v4.5',
  'M12 12l8 -4.5',
  'M12 12v9',
  'M12 12l-8 -4.5',
  'M15 18h7',
  'M19 15l3 3l-3 3',
);

/** tabler: trash */
export const IconTrash = icon(
  'M4 7l16 0',
  'M10 11l0 6',
  'M14 11l0 6',
  'M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12',
  'M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3',
);

/** tabler: copy */
export const IconCopy = icon(
  'M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666',
  'M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1',
);

/** tabler: arrows-move */
export const IconMove = icon(
  'M18 9l3 3l-3 3',
  'M15 12h6',
  'M6 9l-3 3l3 3',
  'M3 12h6',
  'M9 18l3 3l3 -3',
  'M12 15v6',
  'M15 6l-3 -3l-3 3',
  'M12 3v6',
);

/** tabler: rotate-clockwise */
export const IconRotate = icon(
  'M4.05 11a8 8 0 1 1 .5 4m-.5 5v-5h5',
);

/** tabler: resize */
export const IconScale = icon(
  'M4 11v8a1 1 0 0 0 1 1h8m-9 -14v-1a1 1 0 0 1 1 -1h1m5 0h2m5 0h1a1 1 0 0 1 1 1v1m0 5v2m0 5v1a1 1 0 0 1 -1 1h-1',
  'M4 12h7a1 1 0 0 1 1 1v7',
);
