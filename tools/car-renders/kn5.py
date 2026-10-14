# Reader for Assetto Corsa .kn5 models (format as read by AcTools' Kn5Reader).
import struct

class R:
    def __init__(self, b):
        self.b, self.p = b, 0
    def take(self, n):
        v = self.b[self.p:self.p + n]; self.p += n; return v
    def i32(self): return struct.unpack_from("<i", self.take(4))[0]
    def u8(self): return self.take(1)[0]
    def f32(self): return struct.unpack_from("<f", self.take(4))[0]
    def fs(self, n): return struct.unpack_from("<%df" % n, self.take(4 * n))
    def s(self):
        n = self.i32(); return self.take(n).decode("utf-8", "replace")

def read(path, with_textures=True):
    r = R(open(path, "rb").read())
    assert r.take(6) == b"sc6969"
    version = r.i32()
    if version > 5:
        r.i32()
    textures = {}
    for _ in range(r.i32()):
        # An entry flagged 0 carries nothing (seen in CSP-saved LODs).
        if r.i32() == 0:
            continue
        name = r.s()
        size = r.i32()
        data = r.take(size)
        if with_textures:
            textures[name] = data
    materials = []
    for _ in range(r.i32()):
        m = {"name": r.s(), "shader": r.s(), "blend": r.u8(), "alphaTested": bool(r.u8()), "depth": r.i32(), "props": {}, "maps": {}}
        for _ in range(r.i32()):
            name = r.s(); a = r.f32(); b = r.fs(2); c = r.fs(3); d = r.fs(4)
            m["props"][name] = {"a": a, "b": b, "c": c, "d": d}
        for _ in range(r.i32()):
            name = r.s(); slot = r.i32(); tex = r.s()
            m["maps"][name] = tex
        materials.append(m)

    def node():
        cls = r.i32(); name = r.s(); kids = r.i32(); active = bool(r.u8())
        n = {"cls": cls, "name": name, "active": active, "children": []}
        if cls == 1:
            n["matrix"] = r.fs(16)
        elif cls in (2, 3):
            n["castShadows"] = bool(r.u8()); n["visible"] = bool(r.u8()); n["transparent"] = bool(r.u8())
            if cls == 3:
                bones = []
                for _ in range(r.i32()):
                    bones.append((r.s(), r.fs(16)))
                n["bones"] = bones
            nv = r.i32()
            stride = 11 if cls == 2 else 19
            n["verts"] = r.take(4 * stride * nv); n["stride"] = stride; n["nv"] = nv
            ni = r.i32()
            n["indices"] = r.take(2 * ni); n["ni"] = ni
            n["material"] = r.i32()
            n["layer"] = r.i32()
            if cls == 2:
                n["lodIn"] = r.f32(); n["lodOut"] = r.f32()
                n["sphere"] = r.fs(4)
                n["renderable"] = bool(r.u8())
            else:
                r.take(8)
                n["renderable"] = True
        for _ in range(kids):
            n["children"].append(node())
        return n

    root = node()
    return {"version": version, "textures": textures, "materials": materials, "root": root}

def walk(n, depth=0):
    yield n, depth
    for c in n["children"]:
        yield from walk(c, depth + 1)
