# Generates the seamless carbon tile used by the "carbon" card edition
# (frontend/public/textures/carbon.png). Run:
#   python frontend/tools/make-carbon-texture.py
#
# What actually makes carbon look like carbon, in the order it matters:
#
#   1. TWILL, not a basket. Real carbon cloth is a 2/2 twill: each tow floats
#      over two and under two, which offsets the pattern by one cell per row and
#      produces the diagonal ribs everyone recognises. A plain checkerboard is
#      the tell-tale of a fake — it reads as woven fabric, not carbon.
#   2. ANISOTROPIC SHEEN. A tow is thousands of parallel filaments, so it
#      reflects along its length: at any one viewing angle the tows running one
#      way flash silver while the ones crossing them stay dark. Painting both
#      directions equally bright is what made the first two attempts look like
#      cloth.
#   3. FLAT tows with soft edges, not rounded pills, separated by near-black
#      resin.
#   4. Fine filament striping along each tow, low contrast, plus grain.
#
# The tile is a 4x4 cell block (the twill repeat) and every pixel is derived
# from its cell coordinates, so it tiles seamlessly in both directions.
import numpy as np
from PIL import Image, ImageFilter

C = 32                       # one tow crossing, in texture pixels
G = 4                        # 2/2 twill repeats over 4x4 cells
N = C * G                    # 128px tile
FILAMENT = 6.0               # filament spacing across a tow, in pixels

y, x = np.mgrid[0:N, 0:N].astype(np.float64)
i, j = (x // C), (y // C)                     # cell coordinates
xl, yl = x % C, y % C                         # position inside the cell

# 2/2 twill: the warp floats over two cells, then under two, shifting by one
# cell each row — that shift is the diagonal.
warp_on_top = ((i - j) % G) < 2

# Across-the-tow coordinate (-1..1) for whichever tow is on top here: the warp
# runs down the tile, the weft runs across it.
a = np.where(warp_on_top, (xl - C / 2), (yl - C / 2)) / (C / 2)
across_px = np.where(warp_on_top, xl, yl)

# Along-the-FLOAT coordinate (0..1 across BOTH cells of the float, not each one
# separately). This is the difference between a twill and a checkerboard: the
# tow must run on unbroken over its two cells and only dive under at the ends of
# the float, otherwise every cell reads as its own little tile.
k = ((i - j) % G)
f_warp = ((1 - k) * C + yl) / (2 * C)          # k is 1 then 0 as y grows
f_weft = ((k - 2) * C + xl) / (2 * C)          # k is 2 then 3 as x grows
f = np.where(warp_on_top, f_warp, f_weft)
b = (f - 0.5) * 2                              # -1..1 along the float

# Flat tow with soft shoulders, and a gentle crown across its width: a tow is
# not a flat brick, it swells a little toward its spine, which is what catches
# the light along its length.
edge = np.clip((1.0 - np.abs(a)) / 0.34, 0, 1)
top = np.clip((1.0 - np.abs(b)) / 0.07, 0, 1)   # only the float's ENDS dive under
crown = 0.70 + 0.30 * np.cos(np.clip(a, -1, 1) * (np.pi / 2)) ** 0.55
tow = (edge ** 0.75) * crown

# Filaments: fine lines along the tow, only where the tow is lit.
fil = 0.5 + 0.5 * np.cos(2 * np.pi * across_px / FILAMENT)

# The anisotropic part: one direction catches the light, the other does not.
# A slight tilt across the tile keeps it from looking printed.
tilt = 0.88 + 0.24 * (x + y) / (2 * N)
# Each tow is woven by hand-width bundles, never perfectly even: a fixed wobble
# per cell (so the tile still repeats) keeps the surface from looking printed.
wob = np.array([[0.97, 1.04, 0.99, 1.02], [1.03, 0.98, 1.05, 0.96],
                [0.99, 1.02, 0.96, 1.04], [1.04, 0.97, 1.03, 0.98]])
wobble = wob[(j % G).astype(int), (i % G).astype(int)]
warp_lit = (18 + 118 * tow * tilt + 26 * tow * fil)
weft_lit = (10 + 34 * tow * tilt + 10 * tow * fil)
lum = np.where(warp_on_top, warp_lit, weft_lit) * wobble

# Resin between the tows, and the shadow each float casts on the one below it.
lum = lum * (0.30 + 0.70 * top) + 7 * (1 - top)
shadow = np.clip((np.abs(b) - 0.82) / 0.18, 0, 1)
lum *= 1.0 - 0.35 * shadow

rng = np.random.default_rng(11)
lum = lum + rng.normal(0, 1.6, lum.shape)
lum = np.clip(lum, 0, 255)

# Carbon under clear coat is not neutral grey: cool where it is lit, slightly
# warm in the resin. That tiny split does a lot of the convincing.
t = lum / 255.0
r = lum * (0.93 + 0.07 * t)
g = lum * (0.96 + 0.04 * t)
bch = lum * (1.00 + 0.12 * (1 - t))

img = np.dstack([r, g, bch]).clip(0, 255).astype(np.uint8)
# A whisker of blur: woven cloth photographed under clear coat has no razor
# edges, and without it the tows read as bricks.
out = Image.fromarray(img, "RGB").filter(ImageFilter.GaussianBlur(0.7))
out.save("frontend/public/textures/carbon.png", optimize=True)
print("wrote frontend/public/textures/carbon.png", img.shape)
