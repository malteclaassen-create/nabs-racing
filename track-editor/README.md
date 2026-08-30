# AC Track Editor

A browser based 3D track editor that exports a ready to drop Assetto Corsa track
folder. Draw a circuit from scratch, shape the elevation, place objects, set the
grid, the pit boxes, the timing gates and the AI line, then export a ZIP that
contains everything except the one file only Kunos' own tool can make.

Everything runs locally in your browser. Nothing is uploaded anywhere.

---

## Where it lives

Two places, same code.

**On the league site**, built by `npm run build` at the repo root and served by
the backend at `/track-editor` (`backend/src/index.js`). That is the copy the
admin card on `/tools` links to. It has no bridge to Assetto Corsa — a web page
cannot read files off the visitor's machine — so the "Import track" dialog says
so and the rest of the editor works as normal.

**Locally**, where it does have the bridge, and can therefore open a track out
of your own installation and write one back into it.

The two are the same build with one difference: `base` in `vite.config.ts` puts
the editor under `/track-editor/` at both addresses, so nothing has to know
which one it is running at.

## Running it

```bash
npm install
```

```bash
npm run dev
```

Open <http://localhost:5199/track-editor/> — or just double-click `start.cmd`,
which starts the server if it is not up yet and opens the right address.

Mind the path: with `base` set, the dev server serves the editor **only** under
`/track-editor/`. A bare <http://localhost:5199/> gets Vite's own "not found"
page, which looks like a broken build and is not one.

Other commands:

```bash
npm run build
```

```bash
npm run verify
```

`verify` is the important one. Three suites:

- **`verify-export`** writes a real FBX and a real `fast_lane.ai` and reads both
  back with independent parsers, including three.js' own FBX reader.
- **`verify-scene`** checks the geometry pipeline headlessly: mesh naming, the
  terrain meeting the tarmac, grid and pit markers facing the driving direction,
  timing gates spanning the road, banking applied to the exact degree.
- **`verify-perf`** drives the real store and asserts both the frame budget and,
  more importantly, that edits which have nothing to do with the ground do not
  rebuild the terrain. Object identity is the test: if the cache worked, the
  height field comes back as the same object.

Run it after any change to `core/` or `export/`.

### Performance notes

The editor rebuilds derived geometry from the project on every change, so the
caching in `store/derived.ts` is what keeps it usable. Each stage is memoised on
a content signature of the values it actually depends on, never on object
identity, because an edit clones the project.

**The one that mattered most was not the rebuild at all.** The terrain carries
the pointer handlers, because it is the surface you draw and sculpt on. That put
it in the pointer test on every single mouse move, and three.js' default test
walks every triangle: 165000 triangle tests per mouse move on a 289 grid, at
mouse polling rate, whether you were dragging or just moving the cursor.
`makeTerrainRaycast` replaces it with a march along the ray over the height
field, 0.003 ms instead of 4 ms. Anything else you give pointer handlers to
wants the same treatment, or `raycast={() => null}` if it does not need picking.

**The second one that mattered was the sliders.** A range input fires on every
pixel of mouse travel, and each of those was a full rebuild *and* a fresh undo
entry. Nudging the pit lane along its slider meant a hundred rebuilds and a
hundred history snapshots. Every slider now goes through `tweakRun`: one rebuild
per frame, one undo step per drag. Any new control that fires continuously wants
the same treatment.

**And while a control is being dragged, the heavy work waits.** `interacting` is
true during a gizmo or slider drag; the corridor mask and the AI line are reused
as they are and catch up when you let go. That is what stops the cost of a drag
from growing with the length of the track. Sculpting is unaffected, because the
mask does not depend on the sculpted heights.

Beyond that, these carry the weight and are easy to break by accident:

- **`terrain.heights` and `assets` are shared by reference** between project
  copies (`clone()` in `store.ts`). Anything that changes the height field must
  replace the array, never write into it. `sculpt` is the only place that does.
- **The corridor mask is cached separately from the sculpt.** Finding the nearest
  point on the centre line for 84000 grid vertices depends only on the splines,
  not on the brush, so a stroke never pays for it.
- **Sculpting and gizmo dragging are coalesced to one update per animation
  frame.** A high polling rate mouse fires several pointer events per frame, and
  each one used to queue a full terrain rebuild.
- **`PointIndex.nearest` must never be sized from the radius.** Callers pass an
  unbounded radius to mean "just find the closest one". Deriving a ring count
  from that scans millions of empty cells. The search expands outwards from the
  occupied region and stops as soon as nothing further out can win.

- **Only the patch that moved gets rewritten.** `updateTerrainGeometry` finds the
  bounding box of the heights that actually changed and rewrites only that, plus
  a one cell ring for the normals. Rewriting the whole grid cost ten times as
  much for no reason.
- **`resampleByDistance` walks the frames with a cursor.** Calling
  `frameAtDistance` per point restarts its search from the beginning every time,
  which is quadratic, and was the most expensive part of rebuilding the AI line.

- **The road signature is split in two: shape and paint.** The side profile is
  the most expensive step of a rebuild, and the terrain corridor hangs off it,
  but a kerb's style, its colour, the texture scale and the painted edge line
  change none of the widths — they change what is drawn on ground the profile
  has already settled. Keyed on the whole road, switching one kerb from plain to
  rippled cost a profile, a corridor and a terrain rebuild: 12.7 ms on a 2.5 km
  circuit, for a change of pattern. Now 3.2 ms, and `verify-perf` asserts that
  the profile object comes back identical.

- **Nothing asks the spatial index a question it will not read.** The pit lane
  search used one worst case radius for the whole track — widest road plus twice
  the run off setting — which on a wide circuit is seventy metres, four times
  the area that can actually matter, at every one of a couple of thousand cross
  sections. It is now worked out per cross section, behind a bounding box test
  that answers most of them in four comparisons. The corridor sweep skips the
  track's own neighbourhood by comparing the way round to the way across: two
  points that face each other have turned at least half a circle, and half a
  circle is π/2 times as long as the line across it. Together: 9.3 ms → 3.7 ms.

- **Road meshes reuse their buffers.** A rebuild overwrites the numbers in the
  existing geometry when the shape is unchanged, rather than allocating a fresh
  set of GPU buffers and freeing last frame's. React never sees a changed prop
  either, so the meshes are not torn down and re-attached.

- **The merged strips keep a constant buffer size and vary only their draw
  range.** This is the one that actually bit. Kerbs, run off and barriers come
  in stretches, and the pit lane clearance changes how many stretches there are
  as you drag. Buffers sized to fit therefore changed their vertex count on
  almost every frame, the recycling above failed every time, and the editor
  created and destroyed a GPU buffer per mesh per frame. Live geometries climbed
  from 22 into the hundreds and the browser eventually stopped for seconds.
  `verify-perf` now drags a pit lane point forty times and asserts that no new
  geometry appears, having first checked that the shape really is changing.
- **Kerbs, run off and barriers are one mesh per side.** They come in stretches,
  and anything that chops them up (the pit lane clearance, or switching them off
  section by section) used to add a mesh, a draw call and a geometry per
  stretch, all rebuilt every frame while dragging. A couple of edits could
  multiply the size of the scene. The stretches are merged into one geometry per
  side now, so the mesh count no longer depends on the layout.
- **Materials are shared.** Declaring one as a JSX child gives every mesh its own
  instance.
- **The mask's working buffers are reused between calls.** They are four arrays
  the size of the height grid, about two megabytes, and allocating them per
  frame was a quarter of a gigabyte a second of garbage on a 120 Hz display: the
  browser then stops everything for a few hundred milliseconds every several
  seconds to clean up.

### If the viewport still feels heavy

### The flight recorder

When one line is not enough, the status bar has **Record** and **Self test**.

- **Record** captures every frame while you work: frame time, how much of it was
  our own code, whether the main thread kept ticking, draw calls, live
  geometries, textures, shaders, what the editor rebuilt, pointer activity and
  whether a drag was in progress. Reproduce the problem, press **Stop & save**,
  and you get a `.json` file with the whole timeline.
- **Self test** drags a control point back and forth by itself for twelve
  seconds and saves the recording automatically. The same movement at the same
  rate every time, which is the only way two runs can be compared.

Read it back with:

```bash
node tools/analyse-trace.mjs track-editor-trace-1234.json
```

It prints frame time percentiles, every stall with what happened inside it,
whether the stalls are evenly spaced (a timer) or not (load), whether the
geometry count grows (a leak), and a verdict naming one of four causes: our own
code, the terrain rebuild, the browser pausing everything, or the frame never
arriving despite a free main thread. The analyser is checked against synthetic
traces of all four, so its verdicts are not guesses.

There is also a **Diagnose** button in the status bar for the live one-liner. Turn it on, wait for a stall,
and it prints one line naming the culprit. It measures four things that between
them settle the question:

| It says | Meaning |
|---|---|
| `ours 370` | our own frame callbacks and draw submission took that long. Our bug |
| `ours 2 · main thread froze 370` | the whole main thread stopped. Garbage collection or another synchronous browser task |
| `ours 2 · main thread free` | the main thread kept running and timers kept firing: the frame was held up by the compositor, the GPU process or the driver. Nothing in this code can cause that |
| `GC` | a **major** collection ran, proven with a `FinalizationRegistry` sentinel that is held long enough to be tenured first |
| `geo +N` / `tex +N` / `shader +N` | a leak, a texture upload or a shader compile in that frame |
| `no mouse` | no pointer events in the window, so the r3f event path is not involved |

Click the line to copy the whole log. It is off by default because it keeps a
10 ms timer ticking and brackets every frame.

The status bar also shows **fps**, a red **stall** figure when a single frame ran
long, and **draws / geo**. Those three separate the three causes:

| symptom | cause |
|---|---|
| fps low, steady, no stall | pixel count. Use the **Fast** switch |
| fps high but stall spikes | memory being collected. Something allocates per frame |
| draws or geo climbing after an edit | the scene itself grew, not the maths |

Frame rate on a big monitor is usually decided by **pixel count**. There is a
**High / Balanced / Fast / Draft** switch in the top bar; watch the readout while
you change it. Draft also drops the grid and the AI line.

The biggest lever of all for a long track is **switching the terrain off** in the
Sculpt panel. No ground to rebuild at all, and you draw on a flat plane instead.
Good for laying out a long circuit, switch it back on to shape the landscape.

- `dpr` is the biggest lever: at device pixel ratio 2, a full screen viewport is
  four times the pixels of ratio 1, and every one of them is shaded. Balanced
  caps it at 1.5, Fast at 1.
- The ground covers more pixels than anything else, so below High it is shaded
  with a Lambert material instead of the full PBR one.
- `preserveDrawingBuffer` is deliberately **off**. It makes the browser keep a
  copy of every frame, a permanent cost, and it was only there so the export
  could grab one screenshot. The export now reads the frame synchronously right
  after drawing it instead.

Measured on a 289 x 289 terrain with a 4.7 km, 60 node track:

| | before | after |
|---|---|---|
| unrelated edit (typing a name, moving a prop) | 27.9 ms | 0.33 ms |
| one sculpt frame | 27.9 ms | 1.0 ms |
| dragging a track node | 33.6 ms | 10.0 ms |

On the default sized project those are 0.2 / 0.6 / 4.5 ms.

### Tight corners

Everything beside the centre line is an offset curve, and offsetting a curve of
radius R inwards by more than R turns it inside out: the offset line crosses
itself and the strip built from it folds back over the track. That is what puts
a barrier through the middle of a hairpin and ties a kerb in a knot.

Every frame carries a signed `curvature`, and nothing on the inside of a bend is
allowed past `INNER_LIMIT` of the radius:

- the **road half width** is clamped in `computeFrames`, so the mesh, the
  terrain, the AI line and the minimap all agree on the same width,
- the **kerb** narrows and loses height with it, rather than leaving a thin
  vertical lip,
- the **run off** and the **barrier** that rides on its outer edge follow.

A corner drawn tighter than the road is wide therefore pinches at the apex,
which is honest feedback that the corner is impossible, instead of producing
geometry that crosses itself. `verify-scene` builds a deliberate hairpin and
asserts that nothing reaches the centre of the turn and that no edge ends up on
the wrong side of the road.

### The ground under the road

The road, the kerbs and the run off are separate meshes lying on top of the
terrain, over exactly the same ground. Blend the terrain to precisely the road
height and the two are coplanar: the depth buffer cannot tell which is in front
and the grass flickers through the tarmac, in the game as much as in the editor.

Three things keep that from happening, and all three are covered by
`verify-scene`:

- The ground is **sunk 20 cm under the tarmac**, easing back to 4 cm by the
  outer edge of the corridor where it becomes the visible surface again.
- The corridor target follows the road's **tangent plane**, not just its cross
  section. A grid cell is usually a few metres up or down the track from the
  nearest cross section, and on a 10% climb that alone lifted the ground clean
  through the road.
- Where two ribbons overlap, the pit lane next to the track for instance, they
  are blended by **squared weight** and capped by a **ceiling**: never higher
  than the lowest ribbon directly above would have put it. Plain sequential
  blending let the pit lane drag the ground up through the tarmac wherever the
  track dipped below it.

---

## What the browser can and cannot do

### It generates completely

| | |
|---|---|
| Road, kerbs, run off, barriers, terrain, objects | full 3D geometry with correct UVs |
| Ground patches | asphalt, concrete, gravel, grass slabs placed and sized in metres |
| AC mesh naming | `1ROAD_…`, `1KERB_…`, `1GRASS_…`, `1WALL_…`, `1PIT_…`; props as `1PROP_…` |
| Race markers | `AC_START_x`, `AC_PIT_x`, `AC_TIME_x_L/R`, `AC_HOTLAP_START_0` |
| `data/surfaces.ini` | grip, dirt, black flag, pit lane flag per surface |
| `ai/fast_lane.ai`, `ai/pit_lane.ai` | binary, geometry exact, speeds estimated |
| `ui/ui_track.json`, `preview.png`, `outline.png` | Content Manager entry |
| `map.png` + `map.ini` | in game minimap, correctly scaled |
| `.kn5` | **written directly** — the ZIP is ready to drive, no ksEditor pass |
| `.fbx` (binary 7.4) and `.glb` | both written from scratch, for the fallback route |
| Textures | procedural PNG, the same ones you see in the viewport, embedded in the kn5 |

### The kn5 writer

`.kn5` is Kunos' closed binary model format with no public writer. The format
was reverse engineered byte for byte (July 2026): independent parsers walk
both ksEditor output and Kunos' own `magione.kn5` to the exact last byte, and
binary-patched files produced with that knowledge were validated in game.
`export/kn5.ts` replicates the ksEditor conventions — version 6 header,
embedded textures (PNG works in AC, proven in game), ksPerPixel materials
with Kunos-range lighting constants, dummy nodes for the `AC_*` markers,
bounding spheres, uint16 index chunking for oversized meshes.

The ksEditor route (`source/` + `blender_to_fbx.py` + `fix_kn5.py` in the
ZIP) remains as a fallback and for users who want to edit the model.

**Why props are `1PROP_<SURFACE>_` and not `1WALL_`.** AC treats every
renderable mesh whose name (after the leading digit) starts with a
`surfaces.ini` KEY as a physics surface — and its culling then drops small
objects depending on the view direction (grandstands popping in and out of
existence). Kunos tracks never render surface-named meshes; their physics
meshes are invisible duplicates. The editor therefore exports a prop as a
purely visual `1PROP_WALL_shed_0` and writes an invisible `1WALL_shed_0`
(`renderable=0`) next to it. Carrying the surface in the visible name means
the ground pads work the same way: an asphalt patch exports as
`1PROP_ROAD_pad_0` with a drivable `1ROAD_pad_0` twin.

### It cannot do

Two things are left out on purpose:

- **`cameras.ini`** — a malformed one can stop a track from loading, and AC falls
  back to perfectly usable default cameras.
- **A race quality AI line.** The generated `fast_lane.ai` is geometrically
  correct and the AI will drive it, but braking points and speeds are estimated
  from curvature rather than from physics. For serious racing, record or optimise
  the line afterwards.

### The known risk

The kn5 and the FBX are both hand written binary formats. Each is verified by
independent readers (`npm run verify`), and the kn5 conventions were validated
in game — but only against one AC install. That is why the ZIP keeps the full
fallback route: `.glb` + `blender_to_fbx.py` + ksEditorAT + `fix_kn5.py`
reproduce an equivalent kn5 without the editor's own writer.

---

## Architecture

```
src/
  types.ts          the whole data model, one JSON = one project
  store/
    store.ts        Zustand store, snapshot based undo/redo
    derived.ts      everything computed from the project, cached on identity
  core/             pure TypeScript, no React, no scene graph
    spline.ts       Catmull-Rom centre line + road frames
    road.ts         road / kerb / run off / wall mesh builder
    terrain.ts      height grid, sculpt brush, road corridor blending
    markers.ts      grid slots, pit boxes, timing gates, AI line
    library.ts      procedural object library
    textures.ts     procedural textures, shared by viewport and export
    props.ts        prop placement maths
  scene/            react-three-fiber viewport
  ui/               dark panel UI
  export/
    fbx.ts          binary FBX 7.4 writer
    aiLine.ts       fast_lane.ai / pit_lane.ai writer
    ini.ts          surfaces.ini, ui_track.json, map.ini
    mapImage.ts     map.png, outline.png, preview.png
    kn5.ts          direct .kn5 writer, no ksEditor needed
    buildExport.ts  assembles and zips the whole track folder
    readme.ts       README.txt template + blender_to_fbx.py
    fixKn5Script.ts fix_kn5.py, the kn5 post-processor for the fallback route
  io/               project save/load, model import, screenshot hook
tools/
  verify-export.mjs  round trip test of the binary writers
  verify-scene.mjs   headless test of the geometry pipeline
  ts-resolve.mjs     lets Node import the TS sources directly
```

The important design decision: `core/` is pure and React free. The viewport and
the exporter both build from it, so what you see in the editor is literally the
geometry that ships.

### Coordinates

three.js and Assetto Corsa use the same system: **+X right, +Y up, +Z towards the
viewer, right handed, metres**. No axis conversion happens anywhere. Markers are
built with local **+Z as the driving direction** and local **+Y up**, which is
what AC reads. If a converter ever flips it, the export panel has a forward axis
switch.

---

## Shaping the track

### Where a project starts

The editor opens on bare ground and asks what to put on it (`ui/StartDialog.tsx`):

| | |
|---|---|
| **Generate a circuit** | a full circuit at 4, 5.5 or 7 km — the range real ones occupy — with elevation, a start/finish straight and an attached pit lane. |
| **Empty field** | 2 km of flat ground. The Track tool draws the first line. |
| **Demo oval** | the old opening project, kept as a sample. |

#### What the generator builds

`core/generate.ts` does four things, and the fourth is the one that makes it a
race track rather than a shape:

- **The plan** is a closed polar curve — a base radius with harmonics 2 to 7 laid
  over it, stretched along one axis the way real circuits are longer than they
  are wide. One radius per angle means the lap always closes and can never cross
  itself. Corners are then *sharpened*: every control point is pushed off the
  line between its neighbours where the road is already turning and pulled onto
  it where it is nearly straight, so the lap comes out as straights joined by
  corners instead of one continuous wobble. Each pass is backed out if it made
  the lap cross itself or pushed a corner past what a car can take.
- **The length** is set by scaling the finished plan, which leaves every heading
  change exactly as it was. That is why a 7 km lap has open corners rather than
  the same hairpins further apart.
- **The ground comes first.** Four long wavelengths (400 m to 1.4 km) make a
  landscape; the circuit is laid *on* it, smoothed along its length, levelled
  across the start/finish straight and held to a 6% gradient. The corridor blend
  turns what is left into cuttings and embankments. The straight is chosen over
  flat country as well as straight country, so it is not levelled out of a
  hillside.
- **Start/finish and pits.** The timing line sits in the middle of the straight,
  and the pit lane runs alongside it with the entry *before* the line and the
  exit *after* it, both put onto the tarmac edge by `attachPitLane` — the same
  code the Attach button uses.

The terrain comes with the circuit rather than being the default field: the grid
follows the size of the lap at roughly a 10 m cell, capped at 321 a side.

A project autosaved in this browser is offered in the same dialog. The dialog is
also what the **New project** button opens, and the checkbox on it starts the
guided walk through the editor (`ui/Tutorial.tsx`), which can be reopened at any
time with **?** in the toolbar.

A fresh project is 14 m wide between the white lines, carries **no kerbs** — they
are drawn where the drivers actually cut — and its run off is **level with the
tarmac**: a shoulder that falls away puts the barrier standing on its outer edge
below the surrounding ground, so the road reads as a causeway with a trench round
it. `road.runoffDrop` still exists for anyone who wants the camber back.

Replacing the project frames the camera on whatever came with it
(`FrameOnLoad` in `scene/Viewport.tsx`).

### Drawing modes

A click says *where*; the mode on the left says *what*, the same split a city
builder makes between its straight, curve and freehand road tools:

| Mode | |
|---|---|
| **Free** | a point wherever you click. For sketching a shape. |
| **Straight** | the heading locks to 15° steps, so a straight really is straight. On a snap grid the length rounds too, and a start straight comes out 400 m rather than 412.7. |
| **Curve** | one constant radius bend that leaves the last point in the direction the track was already going. Several control points go down as a single undo step. |
| **Freehand** | hold the button and steer; a point every 30 m, one undo for the stroke. |

`Alt` overrides both the angle step and the snap grid — exactly where you point.
A yellow line previews what the next click will add, because straight and curve
both put the point somewhere other than under the cursor, and a tool that does
that silently is a tool you cannot aim.

The curve is tangent continuous by construction: the circle through the click
that leaves the last point along its existing direction. A corner built as five
free clicks is five different radii with a kink at each one, and no amount of
dragging afterwards takes those out. `verify-scene` checks the tangent, the
constant radius and that the bend still ends exactly where it was clicked.

### Kerbs

A kerb is a **span** of its own: a side, a start, an end, a style and a size,
held in `road.kerbs` and drawn with the **Kerb tool (K)**. Press on the roadside
and drag as far as it should run. Click one that is already there to select it
and type its numbers in. Alt+drag rubs kerbs out.

They used to be a boolean on each control point, which meant a kerb could only
start and stop where somebody had happened to click a point while drawing, only
came in one shape, and began at full width and height like a step in the road.
Spans are why all three are gone.

A kerb stays **selected** after it is drawn, and the tool's own panel on the
left then edits *that* kerb — style, width, height, ramp, strip, where it starts
and how long it is — while remembering the same numbers for the next one you
draw. So a style is tried on the thing in front of you rather than chosen blind
and redrawn when it was wrong. A selected kerb can also be picked back up in the
viewport: drag it along the road to move it, or drag either white end grip to
make it longer or shorter. Both go through the same `moveKerbSpan`, so a kerb
pushed into its neighbour trims the neighbour instead of growing a second
surface through the same space.

| Style | |
|---|---|
| **Kerb** | chamfer up off the tarmac, flat top. What most of a circuit has. |
| **Wave** | rippled top, sampled in metres so it stays a ripple at any detail setting. |
| **Sausage** | separate bumps on a low base, the ones that stop a chicane being straightlined. |
| **Flat** | low tilted strip. Forgiving, for fast corner exits. |
| **Strip only** | no kerb, just the coloured tarmac. |

Both ends run out over a **ramp** of a few metres, the wedge a real kerb is
built with. That wedge gets vertex rings of its own: the road is sampled every
several metres and a three metre ramp would otherwise fall between two cross
sections and come out as the step it is there to avoid.

Two more things live at the edge of the road:

- the **white edge line**, which is *cut out of* the road surface rather than
  laid on top of it. A strip floating above the road z-fights at distance, and
  one at the same height needs a second physics surface over the first — which
  is exactly the bug that once put a pit lane speed limiter across 108 m of
  racing line. Taking the outer 14 cm of the road mesh and painting it white
  cannot come apart.
- a **coloured tarmac strip** outside the kerb, per span, in grey, green, blue
  or red. It is drivable `ROAD` surface, the terrain comes up flush to it, and
  the tree brush keeps off it.

Where space runs short — a hairpin's apex, the pit lane alongside — the kerb
keeps what room there is first, then the strip, then the grass, and the kerb's
height comes down in step with its width so it runs out instead of leaving a
lip.

Opening a project saved before July 2026 turns the old per point flags back into
the spans that mean the same thing.

### Sections: editing between two points

Click one control point, then **shift+click** another. Everything from the first
forwards along the track to the second is now selected, and the Properties tab
turns into a section editor: width, banking, kerbs, barriers, run off, raise and
lower, ramp, smooth, straighten, add points in between, delete the points in
between. Works in the outliner too.

On a closed circuit the run goes *forwards* from the first point to the second,
so picking them the other way round selects the other side of the lap. That is
how you choose which of the two arcs you meant.

### Pit lane

Two things keep the pit lane and the track from fighting each other:

- **Auto clearance** (on by default, Race tab). The run off stops short of the
  pit lane and the barrier steps aside wherever the two run close together.
  Nothing in your project changes, it is worked out from the geometry every
  time. Where the layout leaves no room at all the run off simply goes to zero,
  because the editor cannot invent space that is not there.
- **Attach entry and exit to the track** puts the first and last pit lane point
  on the edge of the tarmac, lines the join up with the driving direction so the
  spline leaves the track tangentially rather than kinking away from it, and
  levels the whole lane with the track next to it.

If you would rather have it permanent than automatic, **Open the barrier along
the pit lane** writes the same result into the control points, which you can
then fine tune by hand or with the section editor.

Barriers and run off exist per control point and per side, and the stretches are
merged into `1WALL_left` / `1WALL_right` with real gaps in the geometry, rather
than one wall running through the pit lane or one mesh per stretch.

### What the ground is made of

The **Ground tool (`M`)** paints asphalt, concrete or gravel into the terrain
itself; `Alt` puts grass back. There is only one ground, so this is not a slab
laid on top of the grass — it decides what the ground's own triangles are made
of. Three things follow from that, and all three are what a patch placed *on*
the ground could never do:

- Nothing is underneath it. Where there is gravel there is no grass triangle at
  all, so nothing shows through and nothing fights the depth buffer.
- Sculpting moves it. Raise a hill or dig a dip under a gravel bed and the
  gravel goes with it, because it is the same vertices.
- It has no height, no position and no handles, because it is not an object.

Three ways to put it down, because the shapes on a circuit are not all the same
kind of shape:

- **Brush** — sweep a circle. Verges, the mouth of a gravel trap, anything with
  no straight line in it.
- **Rectangle** — pull one out corner to corner. A paddock, an apron, a service
  road. With the snap on, two of them meet exactly.
- **Outline** — click the corners and close it with the first corner again or
  `Enter`; `Esc` drops it. For everything that is neither round nor square.

`Fill the field` and `All back to grass` do the whole terrain at once.

**How the edge is cut.** The paint is sampled at POINTS on a lattice four times
finer than the height grid (about 2 m on a default field), not as little
squares, and the mesh is cut where the material changes *between* two samples —
so a boundary runs diagonally across a cell instead of stepping round its sides.
That is the whole difference between an edge that reads as a shape and one that
reads as tiles: `verify-scene` measures it by the length of the boundary, which
for a circle comes out about 5% longer than the circle itself, where a
square-only cut is stuck at 27% (4/π) no matter how fine the squares get. Only
the cells an edge actually crosses are cut up; the rest of the terrain stays the
two triangles per cell it always was.

In the export each material becomes its own mesh (`1GRASS_terrain`,
`1ROAD_terrain_asphalt`, `1CONCRETE_terrain_concrete`, `1SAND_terrain_gravel`),
which is how Assetto Corsa is told what the car is driving on.

The ground *patches* in the Place tool are still there and are still objects:
use them for a paddock slab that stands above the ground, and the Ground tool
for ground that is simply made of something else.

## Keyboard

| Key | |
|---|---|
| `V` `T` `P` `G` `B` | Select, Track, Pit lane, Sculpt, Place |
| `K` `C` `N` `M` | Kerbs, Barrier, Plant, Ground |
| `Alt` with the Ground tool | paint grass back |
| `Enter` / `Esc` drawing an outline | close it and fill it in / drop it |
| `Alt` while drawing | ignore the snap grid and the angle step |
| `Alt` with the Kerb tool | rub kerbs out instead of drawing them |
| `W` `A` `S` `D` or arrows | move the camera across the ground |
| `1` `2` `3` | move / rotate / scale gizmo |
| shift+click a point | select the whole stretch between two points |
| alt+click the centre line | insert a control point there |
| drag the yellow line | move a whole section, shift for up and down |
| `[` `]` while placing | turn the next object in 15° steps |
| `Alt` while placing | drop it exactly under the cursor, no snapping |
| `Ctrl+D` | duplicate the selected object in a row |
| `Del` | delete selection, or the points inside a section |
| `Esc` | deselect |
| `Ctrl+Z` / `Ctrl+Y` | undo / redo |
| `Ctrl+S` | save project file |
| `Shift` while sculpting | invert raise and lower |

Left drag orbits, right drag pans, wheel zooms. Camera speed scales with how far
out you are, so it feels the same on a whole circuit as it does on one kerb.

---

## Projects

Saved as a single `.actrack.json` containing the splines, the terrain height
field and any imported models, so a project is fully self contained. The editor
also autosaves to `localStorage` and offers to restore on the next visit.
