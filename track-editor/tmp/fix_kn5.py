"""
Post-process the kn5 written by ksEditor:

  1. add an invisible 1WALL_ collision copy for every visible 1PROP_ mesh
     (the Kunos pattern: physics meshes are never rendered -- rendering
     surface-named meshes triggers a view-dependent culling bug in AC)
  2. normalise material lighting (ksAmbient 0.5, ksDiffuse 0.5,
     ksSpecular 0.06, ksSpecularEXP 20)
  3. sanity-check scale and marker orientation, warning loudly if the FBX
     conversion mangled them

Usage (either works):
    python fix_kn5.py my_track.kn5
    blender.exe --background --python fix_kn5.py -- my_track.kn5

The original file is kept next to the result as my_track.kn5.bak.
Safe to run twice: existing collision copies are detected and skipped.
"""
import os
import struct
import sys

MATERIAL_VALUES = {
    "ksAmbient": 0.5,
    "ksDiffuse": 0.5,
    "ksSpecular": 0.06,
    "ksSpecularEXP": 20.0,
}

# Physics surfaces declared in data/surfaces.ini.
SURFACES = ("ROAD", "KERB", "GRASS", "SAND", "CONCRETE", "WALL", "PIT")


def physics_name(name):
    """1PROP_WALL_shed_0 -> 1WALL_shed_0, i.e. the invisible collision twin.

    The exporter puts the surface into the visible name so this mapping needs
    no extra bookkeeping. Anything that is not a known surface is skipped.
    """
    rest = name[len("1PROP_"):]
    for surface in SURFACES:
        if rest.startswith(surface + "_"):
            return "1" + surface + "_" + rest[len(surface) + 1:]
    return None


class Reader(object):
    def __init__(self, data):
        self.data = data
        self.pos = 0

    def i32(self):
        v = struct.unpack_from("<i", self.data, self.pos)[0]
        self.pos += 4
        return v

    def u8(self):
        v = self.data[self.pos]
        self.pos += 1
        return v

    def f32(self):
        v = struct.unpack_from("<f", self.data, self.pos)[0]
        self.pos += 4
        return v

    def string(self):
        n = self.i32()
        s = self.data[self.pos:self.pos + n].decode("ascii", "replace")
        self.pos += n
        return s, self.pos - n

    def skip(self, n):
        self.pos += n


def parse(data):
    """Walk the whole file; return everything the patches need."""
    r = Reader(data)
    if data[0:6] != b"sc6969":
        raise SystemExit("not a kn5 file")
    r.skip(6)
    version = r.i32()
    if version > 5:
        r.i32()

    for _ in range(r.i32()):                     # textures
        r.i32()
        r.string()
        r.skip(r.i32())

    material_patches = []                        # (offset, value)
    for _ in range(r.i32()):                     # materials
        r.string()                               # name
        r.string()                               # shader
        r.u8(); r.u8(); r.i32()
        for _ in range(r.i32()):                 # properties
            pname, _ = r.string()
            if pname in MATERIAL_VALUES:
                material_patches.append((r.pos, MATERIAL_VALUES[pname]))
            r.skip(40)                           # valueA + vec2 + vec3 + vec4
        for _ in range(r.i32()):                 # texture slots
            r.string(); r.i32(); r.string()

    info = {
        "version": version,
        "material_patches": material_patches,
        "root_child_count_at": None,
        "props": [],                             # visible 1PROP_ mesh spans
        "existing": set(),                       # names already in the file
        "max_coord": 0.0,
        "bad_markers": [],
        "mesh_count": 0,
    }

    def node(depth):
        start = r.pos
        ntype = r.i32()
        name, name_at = r.string()
        cc_at = r.pos
        child_count = r.i32()
        r.u8()                                   # active
        if depth == 0:
            info["root_child_count_at"] = cc_at

        if ntype == 1:                           # dummy with a 4x4 matrix
            if name.startswith("AC_"):
                m = struct.unpack_from("<16f", r.data, r.pos)
                # Row 1 is the local Y axis; markers must stand upright.
                if abs(m[5] - 1.0) > 0.01:
                    info["bad_markers"].append(name)
            r.skip(64)
        else:                                    # mesh
            info["mesh_count"] += 1
            flags_at = r.pos
            r.u8(); r.u8(); r.u8()               # castShadows, visible, transparent
            vc = r.i32()
            for i in range(vc):
                b = r.pos + i * 44
                for k in range(3):
                    c = abs(struct.unpack_from("<f", r.data, b + k * 4)[0])
                    if c > info["max_coord"]:
                        info["max_coord"] = c
            r.skip(vc * 44)
            r.skip(r.i32() * 2)                  # uint16 indices
            r.i32()                              # material id
            r.skip(4)                            # layer
            r.f32(); r.f32()                     # lod in / out
            r.skip(16)                           # bounding sphere
            renderable_at = r.pos
            r.u8()
            if name.startswith("1PROP_"):
                twin = physics_name(name)
                if twin:
                    info["props"].append({
                        "name": name,
                        "twin": twin,
                        "start": start,
                        "end": r.pos,
                        "name_at": name_at,
                        "flags_at": flags_at,
                        "renderable_at": renderable_at,
                    })
            else:
                info["existing"].add(name)

        for _ in range(child_count):
            node(depth + 1)

    node(0)
    if r.pos != len(data):
        raise SystemExit(
            "parser stopped at %d of %d bytes -- unknown kn5 layout, "
            "refusing to touch the file" % (r.pos, len(data)))
    return info


def main():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else argv[1:]
    if len(argv) < 1:
        print(__doc__)
        return 1

    path = os.path.abspath(argv[0])
    data = bytearray(open(path, "rb").read())
    info = parse(bytes(data))

    if info["max_coord"] > 2000.0:
        print("WARNING: largest vertex coordinate is %.0f -- the track is"
              % info["max_coord"])
        print("  probably 100x too big. Re-run blender_to_fbx.py from a fresh")
        print("  export (it must use FBX_SCALE_UNITS) and save the kn5 again.")
    if info["bad_markers"]:
        print("WARNING: %d AC_* markers are not upright (first: %s)."
              % (len(info["bad_markers"]), info["bad_markers"][0]))
        print("  Cars will spawn tilted. Re-run blender_to_fbx.py from a")
        print("  fresh export so the marker rotation fix is applied.")

    for off, value in info["material_patches"]:
        struct.pack_into("<f", data, off, value)

    duplicates = []
    skipped = 0
    for prop in info["props"]:
        if prop["twin"] in info["existing"]:
            skipped += 1                         # already processed earlier
            continue
        # The twin name is shorter than the visible one (1PROP_WALL_x is
        # 1WALL_x plus five characters), so patch the length prefix too.
        copy = bytearray(data[prop["start"]:prop["end"]])
        rel = prop["name_at"] - prop["start"]
        twin = prop["twin"].encode("ascii")
        copy[rel - 4:rel + len(prop["name"])] = struct.pack("<i", len(twin)) + twin
        shift = len(prop["name"]) - len(twin)
        copy[prop["flags_at"] - prop["start"] - shift] = 0       # castShadows
        copy[prop["renderable_at"] - prop["start"] - shift] = 0  # isRenderable
        duplicates.append(bytes(copy))

    if duplicates:
        cc_at = info["root_child_count_at"]
        cc = struct.unpack_from("<i", data, cc_at)[0]
        struct.pack_into("<i", data, cc_at, cc + len(duplicates))

    result = bytes(data) + b"".join(duplicates)
    parse(result)                                # must still walk to exact EOF

    backup = path + ".bak"
    if not os.path.exists(backup):
        os.replace(path, backup)
    with open(path, "wb") as f:
        f.write(result)

    print("materials normalised : %d values" % len(info["material_patches"]))
    print("collision copies     : %d added, %d already present"
          % (len(duplicates), skipped))
    print("meshes total         : %d -> %d"
          % (info["mesh_count"], info["mesh_count"] + len(duplicates)))
    print("written %s (original kept as %s)"
          % (os.path.basename(path), os.path.basename(backup)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
