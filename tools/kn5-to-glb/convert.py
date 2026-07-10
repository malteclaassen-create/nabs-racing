"""
kn5 -> GLB converter for the site's 3D car showcase.

Usage:
  python convert.py <car.kn5> <out.glb> [--skin <skin_dir>] [--tex-size 1024]

What it does:
  - parses the kn5 (kn5.py), keeps showroom-relevant meshes and drops the
    low-res cockpit, spinning-blur rims and the belts-on variant
  - textures come from the kn5, but any file in --skin with the same name
    wins (that's how AC liveries work), so the GLB carries the team's paint
  - DDS is decoded with Pillow, downscaled, and embedded as JPEG (opaque)
    or PNG (glass and other alpha materials)
  - materials get simple PBR values from the kn5 shader names (tyres rough,
    rims metallic, glass transparent, ...)

The output is a valid uncompressed GLB; run gltf-pipeline with Draco on it
afterwards for the web build (see README.md).
"""
import argparse
import io
import json
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image

import kn5

# Subtrees that never belong in the showroom model.
DROP_PATH_PARTS = (
    "COCKPIT_LR",      # low-res cockpit (we keep the HR one)
    "RIM_BLUR",        # spinning-wheel blur variants
    "CINTURE_ON",      # belts-on variant; the empty cockpit shows belts off
)

# Alpha-blended materials by name fragment (lowercase).
GLASS_FRAGMENTS = ("glass",)


def wants_drop(path):
    return any(part in path for part in DROP_PATH_PARTS)


def material_pbr(mat):
    """Rough PBR guess from AC shader + material name."""
    name = mat.name.lower()
    shader = mat.shader
    if any(f in name for f in GLASS_FRAGMENTS):
        return dict(metallic=0.0, roughness=0.08, alpha="BLEND", opacity=0.28)
    if "mirror" in name:
        # In-game this is a render target; a dark metal reads fine.
        return dict(metallic=0.9, roughness=0.15, alpha="OPAQUE", tint=(0.08, 0.08, 0.09))
    if shader == "ksTyres":
        return dict(metallic=0.0, roughness=0.92, alpha="OPAQUE")
    if shader == "ksBrakeDisc":
        return dict(metallic=0.75, roughness=0.5, alpha="OPAQUE")
    if "rim" in name or "hub" in name:
        return dict(metallic=0.85, roughness=0.35, alpha="OPAQUE")
    if name.startswith("int_") or name.startswith("st_") or "steer" in name or "seat" in name:
        # cockpit trim: matte
        return dict(metallic=0.05, roughness=0.7, alpha="OPAQUE")
    # body work / default: light metallic sheen so the env map gives paint depth
    return dict(metallic=0.25, roughness=0.45, alpha="OPAQUE")


def build_images(model, used_material_ids, skin_dir, tex_size):
    """name -> (bytes, mime, has_alpha) for every texture used by kept materials."""
    used_tex = {}
    for mid in used_material_ids:
        mat = model.materials[mid]
        if mat.tx_diffuse:
            used_tex[mat.tx_diffuse] = None

    skin_files = {}
    if skin_dir:
        for f in Path(skin_dir).iterdir():
            skin_files[f.name.lower()] = f

    # Textures the camera gets close to (livery + cockpit) keep full size;
    # everything else (brakes, suspension, underbody, ...) is fine at half.
    CLOSE_UP_FRAGMENTS = ("generic_main", "chassis", "int_main", "int_steer", "rims")

    out = {}
    for name in used_tex:
        blob = model.textures.get(name)
        override = skin_files.get(name.lower())
        if override is not None:
            blob = override.read_bytes()
            print(f"  skin override: {name} <- {override.name}")
        if blob is None:
            print(f"  WARNING: texture {name} not found, skipping")
            continue
        close_up = override is not None or any(f in name.lower() for f in CLOSE_UP_FRAGMENTS)
        max_size = tex_size if close_up else tex_size // 2
        img = Image.open(io.BytesIO(blob))
        img.load()
        if max(img.size) > max_size:
            ratio = max_size / max(img.size)
            img = img.resize((max(1, round(img.width * ratio)),
                              max(1, round(img.height * ratio))),
                             Image.LANCZOS)
        has_alpha = img.mode == "RGBA" and img.getextrema()[3][0] < 250
        buf = io.BytesIO()
        if has_alpha:
            img.save(buf, "PNG", optimize=True)
            out[name] = (buf.getvalue(), "image/png", True)
        else:
            img.convert("RGB").save(buf, "JPEG", quality=85)
            out[name] = (buf.getvalue(), "image/jpeg", False)
    return out


def align4(b, pad=b"\x00"):
    while len(b) % 4:
        b += pad
    return b


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("kn5_path")
    ap.add_argument("out_glb")
    ap.add_argument("--skin", default=None)
    ap.add_argument("--tex-size", type=int, default=1024)
    args = ap.parse_args()

    print(f"parsing {args.kn5_path} ...")
    model = kn5.parse(args.kn5_path)

    meshes = [x for x in model.meshes if not wants_drop(x.path)]
    dropped = len(model.meshes) - len(meshes)
    tris = sum(len(x.indices) for x in meshes) // 3
    print(f"meshes: {len(meshes)} kept, {dropped} dropped, {tris} tris")

    # AC is +Z-forward / +X-right; glTF wants -Z-forward. Mirror X so the car
    # isn't left-right flipped (winding flips with it, fixed below).
    for x in meshes:
        x.positions[:, 0] *= -1
        x.normals[:, 0] *= -1
        x.indices = x.indices.reshape(-1, 3)[:, ::-1].reshape(-1)

    used_material_ids = sorted({x.material_id for x in meshes})
    images = build_images(model, used_material_ids, args.skin, args.tex_size)

    # --- assemble binary buffer ---
    bin_chunks = []
    buffer_views = []
    accessors = []

    def add_view(data, target=None):
        offset = sum(len(c) for c in bin_chunks)
        bin_chunks.append(align4(bytearray(data)))
        view = {"buffer": 0, "byteOffset": offset, "byteLength": len(data)}
        if target:
            view["target"] = target
        buffer_views.append(view)
        return len(buffer_views) - 1

    def add_accessor(view, comp_type, count, acc_type, vmin=None, vmax=None):
        acc = {"bufferView": view, "componentType": comp_type,
               "count": count, "type": acc_type}
        if vmin is not None:
            acc["min"] = vmin
            acc["max"] = vmax
        accessors.append(acc)
        return len(accessors) - 1

    # images -> texture index per texture name
    gltf_images = []
    gltf_textures = []
    tex_index = {}
    for name, (data, mime, _alpha) in images.items():
        view = add_view(data)
        gltf_images.append({"bufferView": view, "mimeType": mime, "name": name})
        gltf_textures.append({"source": len(gltf_images) - 1, "sampler": 0})
        tex_index[name] = len(gltf_textures) - 1

    # materials
    gltf_materials = []
    mat_index = {}
    for mid in used_material_ids:
        mat = model.materials[mid]
        pbr = material_pbr(mat)
        base = {"metallicFactor": pbr["metallic"], "roughnessFactor": pbr["roughness"]}
        if mat.tx_diffuse in tex_index:
            base["baseColorTexture"] = {"index": tex_index[mat.tx_diffuse]}
        color = list(pbr.get("tint", (1, 1, 1)))
        opacity = pbr.get("opacity", 1.0)
        base["baseColorFactor"] = [*color, opacity]
        g = {"name": mat.name, "pbrMetallicRoughness": base, "doubleSided": True}
        if pbr["alpha"] == "BLEND":
            g["alphaMode"] = "BLEND"
        gltf_materials.append(g)
        mat_index[mid] = len(gltf_materials) - 1

    # merge kept meshes by material into one primitive each
    primitives = []
    by_mat = {}
    for x in meshes:
        by_mat.setdefault(x.material_id, []).append(x)

    for mid, group in by_mat.items():
        pos = np.vstack([g.positions for g in group])
        nrm = np.vstack([g.normals for g in group])
        uv = np.vstack([g.uvs for g in group])
        idx_parts = []
        base = 0
        for g in group:
            idx_parts.append(g.indices.astype(np.uint32) + base)
            base += len(g.positions)
        idx = np.concatenate(idx_parts)

        v_pos = add_view(pos.astype("<f4").tobytes(), target=34962)
        v_nrm = add_view(nrm.astype("<f4").tobytes(), target=34962)
        v_uv = add_view(uv.astype("<f4").tobytes(), target=34962)
        v_idx = add_view(idx.astype("<u4").tobytes(), target=34963)

        a_pos = add_accessor(v_pos, 5126, len(pos), "VEC3",
                             vmin=[float(v) for v in pos.min(0)],
                             vmax=[float(v) for v in pos.max(0)])
        a_nrm = add_accessor(v_nrm, 5126, len(nrm), "VEC3")
        a_uv = add_accessor(v_uv, 5126, len(uv), "VEC2")
        a_idx = add_accessor(v_idx, 5125, len(idx), "SCALAR")

        primitives.append({
            "attributes": {"POSITION": a_pos, "NORMAL": a_nrm, "TEXCOORD_0": a_uv},
            "indices": a_idx,
            "material": mat_index[mid],
        })

    gltf = {
        "asset": {"version": "2.0", "generator": "nabs kn5-to-glb"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "car"}],
        "meshes": [{"primitives": primitives, "name": "car"}],
        "materials": gltf_materials,
        "textures": gltf_textures,
        "images": gltf_images,
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}],
        "accessors": accessors,
        "bufferViews": buffer_views,
    }

    bin_blob = b"".join(bytes(c) for c in bin_chunks)
    gltf["buffers"] = [{"byteLength": len(bin_blob)}]

    json_blob = align4(bytearray(json.dumps(gltf, separators=(",", ":")).encode()), b" ")
    total = 12 + 8 + len(json_blob) + 8 + len(bin_blob)
    out = bytearray()
    out += struct.pack("<4sII", b"glTF", 2, total)
    out += struct.pack("<I4s", len(json_blob), b"JSON") + json_blob
    out += struct.pack("<I4s", len(bin_blob), b"BIN\x00") + bin_blob

    Path(args.out_glb).write_bytes(out)
    print(f"wrote {args.out_glb}: {len(out)/1e6:.1f} MB "
          f"({len(primitives)} primitives, {len(gltf_images)} textures)")


if __name__ == "__main__":
    main()
