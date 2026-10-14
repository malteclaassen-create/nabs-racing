# Assetto Corsa car (.kn5 + a skin folder) -> one GLB, for rendering the
# Wrapped films offline (README.md). Never shipped: only the films leave this
# machine.
#
#   python3 kn5_to_glb.py <car.kn5> <skin dir or -> <out.glb> [--max-tex 2048]
#                         [--moving] [--textures <main car.kn5>]
import io, json, os, struct, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
import kn5

HIDE_NODES = {"CINTURE_OFF", "DRIVER_DETAILS"}

def material_kind(m):
    n = m["name"].lower()
    if "glass" in n or m["shader"] == "ksPerPixelReflection" and "mirror" not in n:
        return "glass"
    if "mirror" in n:
        return "mirror"
    if m["shader"] == "ksTyres":
        return "tyre"
    if n.startswith("2013_chassis_p") or n in ("2010_chassis_kv",):
        return "paint"
    if "chassis_m" in n or "hubs" in n or "rims" in n or "trans" in n or "metal" in n or "brake" in n:
        return "metal"
    if "_c2" in n or "_c4" in n or "carbon" in n:
        return "carbon"
    return "plastic"

PBR = {  # metalness, roughness
    "paint": (0.15, 0.32), "carbon": (0.1, 0.42), "metal": (0.85, 0.3), "tyre": (0.0, 0.88),
    "glass": (0.0, 0.05), "mirror": (1.0, 0.05), "plastic": (0.0, 0.6),
}

# DXT1/3/5 written with the newer DX10 header (DXGI formats 70-78), which
# older Pillow builds refuse ("Unimplemented DXGI format 77"): the same
# blocks under the old header, which every build reads.
LEGACY_FOURCC = {70: b"DXT1", 71: b"DXT1", 72: b"DXT1", 73: b"DXT3", 74: b"DXT3", 75: b"DXT3", 76: b"DXT5", 77: b"DXT5", 78: b"DXT5"}

def legacy_dds(data):
    if data[:4] != b"DDS " or data[84:88] != b"DX10" or len(data) < 148:
        return data
    fourcc = LEGACY_FOURCC.get(struct.unpack_from("<I", data, 128)[0])
    return data[:84] + fourcc + data[88:128] + data[148:] if fourcc else data

def main():
    src, skin, out = sys.argv[1], sys.argv[2], sys.argv[3]
    max_tex = int(sys.argv[sys.argv.index("--max-tex") + 1]) if "--max-tex" in sys.argv else 2048
    # --moving: the blurred rims the game shows at speed instead of the still ones.
    moving = "--moving" in sys.argv
    M = kn5.read(src)
    # --textures <main.kn5>: a LOD file carries no textures of its own.
    if "--textures" in sys.argv:
        M["textures"] = {**kn5.read(sys.argv[sys.argv.index("--textures") + 1])["textures"], **M["textures"]}
    skin_files = {}
    if skin != "-" and os.path.isdir(skin):
        for f in os.listdir(skin):
            skin_files[f.lower()] = os.path.join(skin, f)

    def texture_bytes(name):
        p = skin_files.get(name.lower())
        if p:
            return open(p, "rb").read()
        return M["textures"].get(name)

    meshes = []  # (name, material index, positions, normals, uvs, indices)

    def walk(n, parent):
        name = n["name"].upper()
        blur_rim = name.startswith("RIM_BLUR")
        if moving and name.startswith("RIM_") and not blur_rim:
            return
        if (not n["active"] and not (moving and blur_rim)) or n["name"] in HIDE_NODES:
            return
        world = parent
        if n["cls"] == 1:
            local = np.array(n["matrix"], dtype=np.float64).reshape(4, 4).T
            world = parent @ local
        elif n["visible"] and n["renderable"]:
            v = np.frombuffer(n["verts"], dtype="<f4").reshape(n["nv"], n["stride"]).astype(np.float64)
            pos = np.c_[v[:, 0:3], np.ones(n["nv"])] @ world.T
            nrm = v[:, 3:6] @ np.linalg.inv(world[:3, :3]).T.T
            nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-9)
            uv = v[:, 6:8]
            idx = np.frombuffer(n["indices"], dtype="<u2").astype(np.uint32)
            meshes.append((n["name"], n["material"], pos[:, :3].astype(np.float32), nrm.astype(np.float32), uv.astype(np.float32), idx))
        for c in n["children"]:
            walk(c, world)

    walk(M["root"], np.eye(4))

    # --- glTF ---
    bin_parts, views, accessors = [], [], []
    def add_view(data, target=None):
        off = sum(len(b) for b in bin_parts)
        pad = (-off) % 4
        if pad:
            bin_parts.append(b"\0" * pad)
            off += pad
        bin_parts.append(data)
        view = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
        if target:
            view["target"] = target
        views.append(view)
        return len(views) - 1
    def add_accessor(arr, ctype, typ, target, minmax=False):
        a = {"bufferView": add_view(arr.tobytes(), target), "componentType": ctype, "count": len(arr), "type": typ}
        if minmax:
            a["min"] = arr.min(0).tolist(); a["max"] = arr.max(0).tolist()
        accessors.append(a)
        return len(accessors) - 1

    images, textures, tex_index = [], [], {}
    def open_image(name):
        data = texture_bytes(name) if name else None
        if not data:
            return None
        data = legacy_dds(data)
        try:
            im = Image.open(io.BytesIO(data)); im.load()
            return im
        except Exception as e:
            print("texture", name, "unreadable:", e)
            return None
    detail_means = {}
    def detail_mean(name):
        if name not in detail_means:
            im = open_image(name)
            detail_means[name] = None if im is None else np.asarray(im.convert("RGB").resize((64, 64)), dtype=np.float32).reshape(-1, 3).mean(0)
        return detail_means[name]
    def texture_for(name, alpha, detail=None):
        # A detail texture (carbon, metal flake) shows where the diffuse's
        # alpha is low: baked in as its average colour.
        key = (name, alpha, detail)
        if key in tex_index:
            return tex_index[key]
        im = open_image(name)
        if im is None:
            tex_index[key] = None
            return None
        dm = detail_mean(detail) if detail and not alpha else None
        if dm is not None:
            a = np.asarray(im.convert("RGBA"), dtype=np.float32)
            k = a[..., 3:4] / 255.0
            rgb = a[..., :3] * k + dm * (1 - k)
            im = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")
        im = im.convert("RGBA" if alpha else "RGB")
        scale = min(1.0, max_tex / max(im.size))
        if scale < 1:
            im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
        buf = io.BytesIO()
        if alpha:
            im.save(buf, "PNG", optimize=False); mime = "image/png"
        else:
            im.save(buf, "JPEG", quality=92); mime = "image/jpeg"
        images.append({"bufferView": add_view(buf.getvalue()), "mimeType": mime, "name": name})
        textures.append({"source": len(images) - 1, "sampler": 0})
        tex_index[key] = len(textures) - 1
        return tex_index[key]

    materials, mat_index = [], {}
    def material_for(i):
        if i in mat_index:
            return mat_index[i]
        m = M["materials"][i]
        kind = material_kind(m)
        blend = m["blend"] == 1 or kind == "glass"
        metal, rough = PBR[kind]
        g = {"name": m["name"], "extras": {"kind": kind, "shader": m["shader"]},
             "pbrMetallicRoughness": {"metallicFactor": metal, "roughnessFactor": rough}}
        diff = m["maps"].get("txDiffuse")
        detail = m["maps"].get("txDetail") if "MultiMap" in m["shader"] or "Skinned" in m["shader"] else None
        t = texture_for(diff, blend or m["alphaTested"], detail) if diff else None
        if t is not None:
            g["pbrMetallicRoughness"]["baseColorTexture"] = {"index": t}
        if kind == "glass":
            g["alphaMode"] = "BLEND"
            g["pbrMetallicRoughness"]["baseColorFactor"] = [1, 1, 1, 0.35]
            g["doubleSided"] = True
        elif blend:
            g["alphaMode"] = "BLEND"
        elif m["alphaTested"]:
            g["alphaMode"] = "MASK"
        materials.append(g)
        mat_index[i] = len(materials) - 1
        return mat_index[i]

    nodes, gl_meshes = [], []
    for name, mi, pos, nrm, uv, idx in meshes:
        prim = {
            "attributes": {
                "POSITION": add_accessor(pos, 5126, "VEC3", 34962, True),
                "NORMAL": add_accessor(nrm, 5126, "VEC3", 34962),
                "TEXCOORD_0": add_accessor(uv, 5126, "VEC2", 34962),
            },
            "indices": add_accessor(idx, 5125, "SCALAR", 34963),
            "material": material_for(mi),
        }
        gl_meshes.append({"name": name, "primitives": [prim]})
        nodes.append({"name": name, "mesh": len(gl_meshes) - 1})

    blob = b"".join(bin_parts)
    blob += b"\0" * ((-len(blob)) % 4)
    gltf = {
        "asset": {"version": "2.0", "generator": "kn5_to_glb"},
        "scene": 0, "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes, "meshes": gl_meshes, "materials": materials,
        "textures": textures, "images": images,
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}],
        "accessors": accessors, "bufferViews": views, "buffers": [{"byteLength": len(blob)}],
    }
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * ((-len(js)) % 4)
    with open(out, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob)))
        f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack("<II", len(blob), 0x004E4942)); f.write(blob)
    print(f"{out}: {len(meshes)} meshes, {sum(len(m[2]) for m in meshes)} verts, {len(materials)} materials, {len(images)} images, {os.path.getsize(out) >> 20} MB")

main()
