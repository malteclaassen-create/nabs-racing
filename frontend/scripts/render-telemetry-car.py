"""Render Kenney's CC0 race.glb for the telemetry map.

Run: blender --background --factory-startup --python scripts/render-telemetry-car.py
Geometry is unchanged. A neutral base and shaded paint layer allow any team
colour without a WebGL renderer or a separate texture download for each team.
"""
import math
from pathlib import Path

import bpy
from mathutils import Vector

assets = Path(__file__).resolve().parents[1] / 'public/models/kenney-race'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(assets / 'race.glb'))
scene = bpy.context.scene
meshes = [o for o in scene.objects if o.type == 'MESH']
texture = next(i for i in bpy.data.images if i.source == 'FILE')
pixels = list(texture.pixels)
w, h = texture.size

paint = bpy.data.materials.new('Team paint')
paint.use_nodes = True
paint_bsdf = paint.node_tree.nodes.get('Principled BSDF')
paint_bsdf.inputs['Base Color'].default_value = (0.72, 0.72, 0.72, 1)
paint_bsdf.inputs['Roughness'].default_value = 0.38

holdout = bpy.data.materials.new('Occluding details')
holdout.use_nodes = True
hn = holdout.node_tree.nodes
hn.clear()
holdout.node_tree.links.new(hn.new('ShaderNodeHoldout').outputs[0], hn.new('ShaderNodeOutputMaterial').inputs['Surface'])

# The source uses a colour atlas. Select its red paint faces, leaving cockpit,
# wings, tyres and rims as separate, neutral details in both render passes.
for obj in meshes:
    original = obj.data.materials[0]
    if not original.get('desaturated'):
        nodes = original.node_tree.nodes
        tex_node = next(n for n in nodes if n.type == 'TEX_IMAGE')
        bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
        grey = nodes.new('ShaderNodeHueSaturation')
        grey.inputs['Saturation'].default_value = 0
        original.node_tree.links.new(tex_node.outputs['Color'], grey.inputs['Color'])
        original.node_tree.links.new(grey.outputs['Color'], bsdf.inputs['Base Color'])
        original['desaturated'] = True
    obj.data.materials.append(paint)
    if obj.name == 'body':
        uv = obj.data.uv_layers.active.data
        for face in obj.data.polygons:
            u, v = uv[face.loop_indices[0]].uv
            offset = (min(h-1, max(0, int(v*h)))*w + min(w-1, max(0, int(u*w))))*4
            r, g, b = pixels[offset:offset+3]
            if r > g*1.4 and r > b*1.4:
                face.material_index = 1

# +Z in the source becomes -Y on import; rotate the nose to image right.
root = bpy.data.objects.new('Car orientation', None)
scene.collection.objects.link(root)
for obj in meshes:
    obj.parent = root
root.rotation_euler.z = math.pi/2
bpy.context.view_layer.update()
corners = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
center = Vector(((min(p.x for p in corners)+max(p.x for p in corners))/2,
                 (min(p.y for p in corners)+max(p.y for p in corners))/2, 0))
width = max(p.x for p in corners)-min(p.x for p in corners)

camera_data = bpy.data.cameras.new('Top view')
camera = bpy.data.objects.new('Top view', camera_data)
scene.collection.objects.link(camera)
camera.location = center + Vector((0, 0, 10))
camera.rotation_euler = (0, 0, 0)
camera_data.type = 'ORTHO'
camera_data.ortho_scale = width*1.06
scene.camera = camera

world = bpy.data.worlds.new('Studio')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.65, 0.65, 0.65, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = 0.65
scene.world = world
light_data = bpy.data.lights.new('Softbox', 'AREA')
light_data.energy = 180
light_data.shape = 'DISK'
light_data.size = 4
light = bpy.data.objects.new('Softbox', light_data)
scene.collection.objects.link(light)
light.location = center + Vector((-1, 2, 5))
light.rotation_euler = (center-light.location).to_track_quat('-Z', 'Y').to_euler()

scene.render.engine = 'CYCLES'
scene.cycles.samples = 48
scene.cycles.use_denoising = True
scene.render.resolution_x = 1024
scene.render.resolution_y = 512
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'Standard'

scene.render.filepath = str(assets / 'top-base.png')
bpy.ops.render.render(write_still=True)
for obj in meshes:
    obj.data.materials[0] = holdout
scene.render.filepath = str(assets / 'top-paint.png')
bpy.ops.render.render(write_still=True)
