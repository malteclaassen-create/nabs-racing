"""
Minimal Assetto Corsa .kn5 (v5/v6) reader.

Reverse-engineered layout, cross-checked against the canonical community tool
(RaduMC / Chipicao "kn5conv"). We only read what a web GLB needs: embedded
textures, materials (their diffuse sampler), and the node tree with mesh
geometry (position / normal / uv) transformed into world space via the node
hierarchy. Tangents, bone weights, shadow/visibility flags and most material
props are skipped by seeking past them.

This is a library: parse(path) -> Kn5. No side effects, no writes.
"""
import struct
import numpy as np


class Reader:
    __slots__ = ("d", "p")

    def __init__(self, data):
        self.d = data
        self.p = 0

    def skip(self, n):
        self.p += n

    def u8(self):
        v = self.d[self.p]
        self.p += 1
        return v

    def i16(self):
        v = struct.unpack_from("<h", self.d, self.p)[0]
        self.p += 2
        return v

    def i32(self):
        v = struct.unpack_from("<i", self.d, self.p)[0]
        self.p += 4
        return v

    def u16(self):
        v = struct.unpack_from("<H", self.d, self.p)[0]
        self.p += 2
        return v

    def f32(self):
        v = struct.unpack_from("<f", self.d, self.p)[0]
        self.p += 4
        return v

    def string(self):
        n = self.i32()
        s = self.d[self.p:self.p + n].decode("utf-8", "ignore")
        self.p += n
        return s

    def raw(self, n):
        b = self.d[self.p:self.p + n]
        self.p += n
        return b


class Material:
    def __init__(self, name, shader):
        self.name = name
        self.shader = shader
        self.tx_diffuse = None


class Mesh:
    def __init__(self, name, positions, normals, uvs, indices, material_id, path):
        self.name = name
        self.positions = positions      # (N,3) float32, world space
        self.normals = normals          # (N,3) float32, world space
        self.uvs = uvs                  # (N,2) float32
        self.indices = indices          # (M,) uint32
        self.material_id = material_id
        self.path = path                # /Node/Sub/... hierarchy path for filtering


class Kn5:
    def __init__(self):
        self.version = 0
        self.textures = {}   # name -> bytes (DDS/PNG as embedded)
        self.materials = []  # list[Material]
        self.meshes = []     # list[Mesh]


def _mat_mult(a, b):
    return a @ b


_IMAGE_MAGICS = (b"DDS ", b"\x89PNG", b"\xff\xd8\xff")


def _looks_like_texture(r):
    """Peek: does the stream at r.p start a plausible texture entry?"""
    d, p = r.d, r.p
    if p + 12 > len(d):
        return False
    tex_type = struct.unpack_from("<i", d, p)[0]
    name_len = struct.unpack_from("<i", d, p + 4)[0]
    if not (0 <= tex_type <= 8) or not (1 <= name_len <= 255):
        return False
    name = d[p + 8:p + 8 + name_len]
    if len(name) < name_len or not all(32 <= b < 127 for b in name):
        return False
    size_off = p + 8 + name_len
    if size_off + 4 > len(d):
        return False
    size = struct.unpack_from("<i", d, size_off)[0]
    if size < 16 or size_off + 4 + size > len(d):
        return False
    blob_start = d[size_off + 4:size_off + 8]
    return any(blob_start.startswith(mg[:len(blob_start)]) for mg in _IMAGE_MAGICS)


def _read_matrix(r):
    # 16 floats, row-major as stored. Row 3 holds the translation.
    vals = [r.f32() for _ in range(16)]
    return np.array(vals, dtype=np.float64).reshape(4, 4)


def parse(path):
    with open(path, "rb") as f:
        data = f.read()
    r = Reader(data)

    magic = r.raw(6)
    if magic != b"sc6969":
        raise ValueError(f"not a kn5 file: {magic!r}")

    m = Kn5()
    m.version = r.i32()
    if m.version > 5:
        r.i32()  # unknown extra dword in v6

    # --- textures ---
    # Some kn5s (e.g. Content-Manager-touched cars) have an extra zero dword
    # before the first entry and a count that's off by one, so instead of
    # trusting the header blindly we validate each entry (small texType, sane
    # printable name, blob that starts with a known image magic) and stop at
    # the first thing that doesn't look like a texture — that's the material
    # count.
    tex_count = r.i32()
    if not _looks_like_texture(r):
        r.skip(4)               # extra pad dword seen in the wild
    for _ in range(tex_count):
        if not _looks_like_texture(r):
            break
        r.i32()                 # texType
        name = r.string()
        size = r.i32()
        blob = r.raw(size)
        m.textures[name] = blob

    # --- materials ---
    mat_count = r.i32()
    for _ in range(mat_count):
        name = r.string()
        shader = r.string()
        mat = Material(name, shader)
        r.i16()                 # blend/flags short
        if m.version > 4:
            r.i32()             # zero dword (v5+)
        prop_count = r.i32()
        for _ in range(prop_count):
            r.string()          # prop name
            r.f32()             # prop value
            r.skip(36)          # padded vec4 slots we don't use
        sampler_count = r.i32()
        for _ in range(sampler_count):
            sname = r.string()
            r.i32()             # slot
            tex = r.string()
            if sname == "txDiffuse":
                mat.tx_diffuse = tex
        m.materials.append(mat)

    # --- node tree (recursive, pre-order) ---
    identity = np.identity(4, dtype=np.float64)
    _read_node(r, m, identity)
    if r.p != len(r.d):
        raise ValueError(f"parse incomplete: stopped at {r.p} of {len(r.d)} bytes")
    return m


def _read_node(r, m, parent_world, path=""):
    ntype = r.i32()
    name = r.string()
    child_count = r.i32()
    r.u8()                      # active flag
    path = path + "/" + name

    world = parent_world
    if ntype == 1:              # dummy / transform
        tmat = _read_matrix(r)
        world = _mat_mult(tmat, parent_world)
    elif ntype == 2:            # mesh
        _read_mesh(r, m, name, parent_world, path, skinned=False)
    elif ntype == 3:            # animated / skinned mesh
        _read_mesh(r, m, name, parent_world, path, skinned=True)

    for _ in range(child_count):
        _read_node(r, m, world, path)


def _read_mesh(r, m, name, world, path, skinned):
    r.skip(3)                   # castShadows, visible, transparent bytes

    if skinned:
        bone_count = r.i32()
        for _ in range(bone_count):
            r.string()
            r.skip(64)          # bone inverse-bind matrix
        stride_tail = 44        # tangents + bone weights/indices
    else:
        stride_tail = 12        # tangents

    vcount = r.i32()
    # Read the whole vertex block at once, then slice columns.
    per = 8 + stride_tail // 4  # floats before the tail we keep (pos3+nrm3+uv2) + tail floats
    block = np.frombuffer(r.raw(vcount * per * 4), dtype="<f4").reshape(vcount, per)
    pos = block[:, 0:3].astype(np.float64)
    nrm = block[:, 3:6].astype(np.float64)
    uv = block[:, 6:8].astype(np.float32).copy()
    uv[:, 1] = 1.0 - uv[:, 1]   # AC stores V flipped

    icount = r.i32()
    indices = np.frombuffer(r.raw(icount * 2), dtype="<u2").astype(np.uint32)

    material_id = r.i32()
    r.skip(29 if not skinned else 12)

    # Transform to world space. Row-vector convention: p_world = [x,y,z,1] · world
    ones = np.ones((pos.shape[0], 1))
    p_h = np.hstack([pos, ones]) @ world
    p_world = p_h[:, 0:3].astype(np.float32)
    rot = world[0:3, 0:3]
    n_world = (nrm @ rot)
    ln = np.linalg.norm(n_world, axis=1, keepdims=True)
    ln[ln == 0] = 1.0
    n_world = (n_world / ln).astype(np.float32)

    m.meshes.append(Mesh(name, p_world, n_world, uv, indices, material_id, path))


if __name__ == "__main__":
    import sys
    mdl = parse(sys.argv[1])
    tris = sum(len(x.indices) for x in mdl.meshes) // 3
    verts = sum(len(x.positions) for x in mdl.meshes)
    print(f"version={mdl.version} textures={len(mdl.textures)} "
          f"materials={len(mdl.materials)} meshes={len(mdl.meshes)} "
          f"verts={verts} tris={tris}")
    # texture inventory
    for nm, blob in sorted(mdl.textures.items(), key=lambda kv: -len(kv[1]))[:12]:
        kind = "DDS" if blob[:4] == b"DDS " else ("PNG" if blob[:4] == b"\x89PNG" else blob[:4].hex())
        print(f"  {len(blob)//1024:6d} KB  {kind}  {nm}")
    print("--- mesh names (first 40) ---")
    for x in mdl.meshes[:40]:
        print(f"  {len(x.indices)//3:7d} tris  mat={x.material_id:3d}  {x.name}")
