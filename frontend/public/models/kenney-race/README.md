# Telemetry car

Source: [Kenney Car Kit 3.1](https://kenney.nl/assets/car-kit), `race.glb`.
Author: Kenney. License: CC0 1.0; original notice in `License.txt`.
Downloaded 2026-09-07 from the author's Car Kit archive.

`race.glb` and `Textures/colormap.png` are the original model and texture.
`top-base.png` and `top-paint.png` are orthographic Blender renders of that model.
Geometry is unchanged; neutral materials and a separate paint layer allow the
map to apply the driver's team colour. These are renders of an existing model,
not generated illustrations. The model is a generic formula car, not a replica
of any driver's particular mod or team livery.

Rebuild from `frontend/` with Blender:

    blender --background --factory-startup --python scripts/render-telemetry-car.py

The runtime displays the two small render layers. It does not load the original
model or require WebGL. The nose points right and rotation follows the recorded
heading. Marker size is adjusted for readability, not vehicle collision bounds.
