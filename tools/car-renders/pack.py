# Packs the rendered films of one car into the site:
#   <out>/<model>/<key>/intro.mp4, climb.mp4, podium.mp4, grid.mp4, still.png
#   <out>/index.json   (merged: this season -> this car, its liveries)
#
#   python3 tools/car-renders/pack.py <liveries.json> <work dir> frontend/public/cars
import json, os, shutil, sys

FILES = ["intro.mp4", "climb.mp4", "podium.mp4", "grid.mp4", "still.png"]

spec_path, work, out = sys.argv[1:4]
spec = json.load(open(spec_path))
model = spec["model"]
liveries = []
for l in spec["liveries"]:
    entry = {"key": l["key"], "teams": l.get("teams", []), "drivers": l.get("drivers", [])}
    if "of" in l:
        entry["films"] = l["of"]
    else:
        src = os.path.join(work, l["key"])
        missing = [f for f in FILES if not os.path.exists(os.path.join(src, f))]
        if missing:
            print("skipped", l["key"], "- not rendered:", ", ".join(missing))
            continue
        dst = os.path.join(out, model, l["key"])
        os.makedirs(dst, exist_ok=True)
        for f in FILES:
            shutil.copyfile(os.path.join(src, f), os.path.join(dst, f))
    liveries.append(entry)
# A driver's own livery only where its team's films are there.
have = {e["key"] for e in liveries if "films" not in e}
liveries = [e for e in liveries if e.get("films", e["key"]) in have]

index_path = os.path.join(out, "index.json")
index = json.load(open(index_path)) if os.path.exists(index_path) else {"seasons": {}, "cars": {}}
index["seasons"][str(spec["season"])] = model
index["cars"][model] = {"dir": f"{model}/", "liveries": liveries}
json.dump(index, open(index_path, "w"), indent=1)
print("packed", model, len(liveries), "liveries")
