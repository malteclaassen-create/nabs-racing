# kn5-to-glb

Turns a real Assetto Corsa car into the interactive 3D model the site shows in
the coming-soon hero (rotatable, with the driver-view button).

## Making the model for a new season

1. Find the season's car and team skin under
   `steamapps/common/assettocorsa/content/cars/<car>/` (the main `<car>.kn5`
   is the full-detail model incl. cockpit; skins live in `skins/<skin>/`).

2. Convert (from this folder, needs Python with numpy + Pillow):

   ```
   python convert.py "<path>/<car>.kn5" out_raw.glb --skin "<path>/skins/<skin>"
   ```

3. Compress for the web (Draco, via npm):

   ```
   npx -y gltf-pipeline -i out_raw.glb -o out_draco.glb -d \
     --draco.compressionLevel 7 --draco.quantizePositionBits 13 \
     --draco.quantizeNormalBits 9 --draco.quantizeTexcoordBits 11
   ```

4. Drop it into the site as `frontend/public/cars/s<season>.glb` and delete
   the intermediates. That's it — the CarReveal panel on Home probes for the
   GLB and mounts the 3D viewer automatically (falls back to `s<n>.jpg`, then
   the coming-soon placeholder).

## Files

- `kn5.py` — minimal kn5 v5/v6 reader (textures, materials, node tree with
  world-space mesh geometry). Validates texture entries instead of trusting
  the header count, since Content-Manager-touched kn5s have an extra pad
  dword and an off-by-one count.
- `convert.py` — filtering (drops low-res cockpit, blur rims, belts-on),
  skin texture override, DDS→JPEG/PNG at tiered sizes (livery/cockpit 1024,
  rest 512), PBR heuristics from AC shader names, GLB assembly.

## Camera notes (formula_2010)

The driver-view camera in `frontend/src/components/Car3D.jsx` was tuned for
this car: eye at ~(0, 0.72, 0.05), looking at (0, 0.6, 0.8) — derived from
the seat/steering-wheel bounding boxes (`GEO_INT_Seat_LODA` center y≈0.30,
wheel center ≈(0, 0.56, 0.47)). A future car with a different cockpit may
need those numbers re-tuned the same way (parse, print bboxes, adjust).

The viewer needs the Draco decoder at `frontend/public/draco/` (self-hosted,
already committed).
