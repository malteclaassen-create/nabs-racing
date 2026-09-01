import type { Project } from '../types';

export interface ReadmeStats {
  trackLength: number;
  pitLength: number;
  gridSlots: number;
  pitBoxes: number;
  gates: number;
  aiPoints: number;
  meshCount: number;
  triangles: number;
}

export function buildReadme(p: Project, s: ReadmeStats): string {
  const slug = p.meta.slug;
  return `AC TRACK EDITOR EXPORT
======================

Track      : ${p.meta.name}
Folder     : ${slug}
Length     : ${Math.round(s.trackLength)} m
Pit lane   : ${Math.round(s.pitLength)} m
Grid slots : ${s.gridSlots}   (AC_START_0 .. AC_START_${Math.max(0, s.gridSlots - 1)})
Pit boxes  : ${s.pitBoxes}   (AC_PIT_0 .. AC_PIT_${Math.max(0, s.pitBoxes - 1)})
Timing     : ${s.gates} gate(s), AC_TIME_0_L/R is the start finish line
AI line    : ${s.aiPoints} points
Geometry   : ${s.meshCount} meshes, about ${s.triangles.toLocaleString('en-US')} triangles


WHAT IS IN THIS ZIP
-------------------

  content/tracks/${slug}/
      ${slug}.kn5           the 3D model, ready to drive -- no conversion
                            needed. Textures, materials, markers and the
                            invisible collision meshes for the props are
                            already inside.
      data/surfaces.ini     grip and physical properties per surface
      data/map.ini          minimap scaling (the game reads it HERE, not
                            beside map.png)
      ai/fast_lane.ai       AI racing line
      ai/pit_lane.ai        AI pit lane
      ui/ui_track.json      the entry Content Manager shows
      ui/preview.png        preview image
      ui/outline.png        track outline
      map.png               in game minimap

${
    p.exportCfg.sourceFiles
      ? `  source/                   only needed for the ksEditor fallback route or
                            for editing the model in other tools:
      ${slug}.fbx           3D model, AC naming already applied
      ${slug}.glb           same scene as glTF, for Blender or any other tool
      textures/*.png        the textures the FBX references
      blender_to_fbx.py     GLB -> FBX converter for ksEditor
      fix_kn5.py            post-processor for a ksEditor-saved kn5`
      : `  (no source/ folder: the FBX and glTF fallbacks were left out. The kn5
   above is written by the editor itself and needs none of them. Switch
   "Also write FBX + glTF" on in the Export tab if you want to open the
   track in Blender or go the ksEditor route -- but note that building
   them holds two more complete copies of the track in memory, which is
   what runs a browser tab out of it on a large circuit.)`
  }


NOTES
-----

The kn5 is written directly by the editor. The format was reverse engineered
byte for byte against ksEditor output and Kunos' own track files, and the
result is validated in game. ksEditorAT is NOT needed -- the fallback section
at the end exists only in case a particular AC install refuses the file.

Two things to know:
  - cameras.ini    written only when replay cameras were placed in the editor
                   (Race tab). Without it AC uses its own default cameras,
                   which is fine to start with.
  - a polished AI line   the included fast_lane.ai is built from the geometry.
                   The AI will drive it. Braking points and speeds are
                   estimated from curvature, not from real physics, so for
                   proper racing you will want to record or optimise the line
                   later (Content Manager and the AI Line Helper app both do
                   this).


STEP BY STEP
------------

1. Extract this ZIP somewhere, for example to your Desktop.

2. Copy the folder
       content/tracks/${slug}
   into your Assetto Corsa installation so you end up with
       ...\\assettocorsa\\content\\tracks\\${slug}\\${slug}.kn5

3. Start Content Manager. The track appears under Single Player > Practice.
   Drive it.


FALLBACK: THE KSEDITOR ROUTE
----------------------------

Only needed if the included kn5 will not load on your install, or if you want
to modify the model in other tools first.

   1. Install Blender (free, any recent version), open a terminal in the
      source/ folder (in Windows Explorer, type powershell into the address
      bar and press Enter) and run, with the path adjusted to the Blender
      version you installed (PowerShell needs the leading &, plain cmd
      does not):

      & "C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe" --background --python blender_to_fbx.py -- ${slug}.glb ${slug}_blender.fbx

   2. Open ksEditorAT:
       <your AC folder>\\sdk\\editor\\ksEditorAT.exe
      File > Open, pick   source/${slug}_blender.fbx
      Keep the textures folder next to the FBX. Object names, the AC_*
      empties, material values and the texture assignments carry over, so
      ksEditor fills txDiffuse in by itself.

   3. Check the object tree: meshes named 1ROAD_..., 1KERB_..., 1GRASS_...,
      1WALL_..., 1PIT_..., 1PROP_<SURFACE>_..., empties AC_START_x, AC_PIT_x,
      AC_TIME_x_L / _R, AC_HOTLAP_START_0. The shader defaults to
      ksPerPixel, which is right.

   4. File > Save, rename the result to exactly   ${slug}.kn5

   5. Run the post-processor (any Python 3 works, and Blender ships one):

       python fix_kn5.py ${slug}.kn5
       or:  blender.exe --background --python fix_kn5.py -- ${slug}.kn5

      It adds invisible collision copies for the 1PROP_ objects, normalises
      the material lighting, and warns if scale or markers survived the
      conversion badly. Safe to run more than once.

   6. Replace the kn5 in content/tracks/${slug}/ with yours.


THINGS TO CHECK ON THE FIRST DRIVE
----------------------------------

- Cars spawn facing the wrong way
      Re-export with Export panel > "Marker forward axis" set to -Z.
      AC reads the local +Z of AC_START / AC_PIT as the driving direction, and
      some FBX round trips flip it.

- No lap times / sectors never trigger
      AC_TIME_0_L and AC_TIME_0_R have to sit on opposite sides of the road and
      span it completely. Widen the road or move the start finish line.

- Car falls through the road
      The road mesh lost its 1ROAD_ prefix, or surfaces.ini did not get copied
      into data/. Both are checked in ksEditor's object tree.

- Grandstands or buildings pop in and out depending on where you look
      The props ended up inside AC's physics-surface namespace (1WALL_...).
      AC's culling mishandles renderable surface-named meshes. Re-export
      with a current editor build (props come out as 1PROP_) and run
      fix_kn5.py, which restores their collision the safe way.

- Cars drive straight through the grandstands
      Only possible with a ksEditor-made kn5: fix_kn5.py was skipped. Run it
      on the kn5 and copy the file again. The included kn5 already carries
      the collision meshes.

- AI drives into the scenery
      Delete ai/fast_lane.ai and let Content Manager or AI Line Helper build a
      fresh one from a recorded lap.

- Track is 100x too big or too small in ksEditor
      The FBX declares 1 unit = 1 metre. If your ksEditor build assumes
      centimetres, scale the root by 100 there, or go the Blender route above.


Track built with AC Track Editor. Project file: keep the .actrack.json so you
can carry on editing later.
`;
}

export const BLENDER_SCRIPT = `"""
Convert the exported GLB into an FBX that ksEditor is guaranteed to accept.

Usage (Windows):
    blender.exe --background --python blender_to_fbx.py -- input.glb output.fbx

Everything relevant survives: object names (1ROAD_..., AC_START_0, ...),
material names, UVs and the transforms of the AC_* markers. Materials are
wired to the PNGs in textures/ so ksEditor assigns txDiffuse automatically.
"""
import math
import os
import sys

import bpy
from mathutils import Matrix


def main():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    if len(argv) < 2:
        print("usage: blender --background --python blender_to_fbx.py -- input.glb output.fbx")
        return 1

    src = os.path.abspath(argv[0])
    dst = os.path.abspath(argv[1])

    # Empty the default scene.
    bpy.ops.wm.read_factory_settings(use_empty=True)

    ext = os.path.splitext(src)[1].lower()
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=src)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=src)
    else:
        raise SystemExit("expected a .glb, .gltf or .obj input")

    # glTF has no null objects, so the editor writes the markers as tiny
    # meshes. Turn anything called AC_* back into a proper empty, which is
    # what ksEditor wants to see.
    for obj in list(bpy.data.objects):
        if not obj.name.startswith("AC_"):
            continue
        empty = bpy.data.objects.new(obj.name + "__tmp", None)
        empty.empty_display_type = "ARROWS"
        empty.empty_display_size = 2.0
        # The FBX exporter converts the world axes (Z-up back to Y-up) but
        # keeps each object's local frame, which bakes a -90 degree X turn
        # into every empty. Meshes are immune because their vertex data is
        # converted instead. Pre-rotating by +90 degrees cancels that out, so
        # markers keep exactly the orientation the editor authored. Without
        # this, cars spawn pitched 90 degrees nose-up.
        empty.matrix_world = obj.matrix_world.copy() @ Matrix.Rotation(math.radians(90.0), 4, "X")
        bpy.context.scene.collection.objects.link(empty)
        name = obj.name
        bpy.data.objects.remove(obj, do_unlink=True)
        empty.name = name

    # Wire every material to its texture (textures/<material>.png next to the
    # input file) so ksEditor fills txDiffuse in by itself, and neutralise the
    # base colour: ksEditor derives its ks* lighting constants from the
    # material colours, and the near-black texture-average colours the GLB
    # carries would leave the track almost unlit.
    tex_dir = os.path.join(os.path.dirname(src), "textures")
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None:
            continue
        base = bsdf.inputs["Base Color"]
        base.default_value = (0.5, 0.5, 0.5, 1.0)
        png = os.path.join(tex_dir, mat.name + ".png")
        if os.path.isfile(png) and not base.links:
            img = mat.node_tree.nodes.new("ShaderNodeTexImage")
            img.image = bpy.data.images.load(png)
            mat.node_tree.links.new(img.outputs["Color"], base)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.fbx(
        filepath=dst,
        use_selection=False,
        apply_unit_scale=True,
        global_scale=1.0,
        # FBX_SCALE_UNITS keeps every transform at scale 1 and declares the
        # unit in the file header instead. FBX_SCALE_NONE bakes a x100 scale
        # into each object node; Blender undoes that on import, but ksEditor
        # reads the numbers literally and the track comes out 100 times too
        # big in AC.
        apply_scale_options="FBX_SCALE_UNITS",
        axis_forward="-Z",
        axis_up="Y",
        object_types={"EMPTY", "MESH"},
        use_mesh_modifiers=True,
        mesh_smooth_type="FACE",
        path_mode="COPY",
        embed_textures=False,
        bake_space_transform=False,
        add_leaf_bones=False,
    )
    print("written", dst)
    return 0


if __name__ == "__main__":
    sys.exit(main())
`;
