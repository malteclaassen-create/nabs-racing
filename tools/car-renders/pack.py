# Pack the rendered liveries for one car into public/cars/:
#   <out>/<model>/<key>.hero.webp   (copied as rendered)
#   <out>/<model>/field.webp        (every team livery's field strip, a row each)
#   <out>/index.json                (merged: this season -> this car, its liveries)
#
#   python3 tools/car-renders/pack.py <liveries.json> <rendered dir> frontend/public/cars
import json, os, shutil, sys
from PIL import Image

import math
# As render.mjs draws them.
HERO = {"cellW": 640, "cellH": 275, "boxW": 5.6, "boxH": 2.4, "cy": 0.55, "yawFrom": round(-24 * math.pi / 180, 6), "yawStep": round(3 * math.pi / 180, 6), "yaws": 79, "pitches": [0.21]}
FIELD = {"cellW": 128, "cellH": 128, "boxW": 5.6, "boxH": 5.6, "cy": 0.55, "yaws": 16, "pitches": [0.26, 0.96]}

spec_path, rendered, out = sys.argv[1:4]
spec = json.load(open(spec_path))
model = spec["model"]
os.makedirs(os.path.join(out, model), exist_ok=True)

own_rows = [l for l in spec["liveries"] if "of" not in l]
strips = [Image.open(os.path.join(rendered, f"{l['key']}.field.webp")).convert("RGBA") for l in own_rows]
w, h = strips[0].size
atlas = Image.new("RGBA", (w, h * len(strips)), (0, 0, 0, 0))
for i, s in enumerate(strips):
    atlas.paste(s, (0, i * h))
atlas.save(os.path.join(out, model, "field.webp"), "WEBP", quality=88, method=6)
row_of = {l["key"]: i for i, l in enumerate(own_rows)}

liveries = []
for l in spec["liveries"]:
    shutil.copyfile(os.path.join(rendered, f"{l['key']}.hero.webp"), os.path.join(out, model, f"{l['key']}.hero.webp"))
    liveries.append({"key": l["key"], "teams": l.get("teams", []), "drivers": l.get("drivers", []), "row": row_of[l.get("of", l["key"])]})

hero_cols = 4096 // HERO["cellW"]
index_path = os.path.join(out, "index.json")
index = json.load(open(index_path)) if os.path.exists(index_path) else {"seasons": {}, "cars": {}}
index["seasons"][str(spec["season"])] = model
index["cars"][model] = {
    "dir": f"{model}/",
    "scale": 0.94,
    "hero": {**HERO, "cols": hero_cols, "rows": -(-HERO["yaws"] * len(HERO["pitches"]) // hero_cols)},
    "field": {**FIELD, "file": "field.webp", "cols": w // FIELD["cellW"], "rows": len(strips) * (h // FIELD["cellH"])},
    "liveries": liveries,
}
json.dump(index, open(index_path, "w"), indent=1)
print("packed", model, len(liveries), "liveries,", len(strips), "field rows:", atlas.size)
