# Generates the seamless brushed-metal tile used by the "titanium" card edition
# (frontend/public/textures/brushed.png). Run:
#   python frontend/tools/make-brushed-texture.py
#
# Brushed metal is anisotropic: the grinding wheel leaves scratches that all run
# the same way, so the surface is noisy ACROSS the grain and smooth ALONG it.
# That is the whole trick — a row of noise, smeared sideways, repeated per row.
# The smear wraps around the tile edge (np.roll), so the result tiles seamlessly
# left to right, and rows are independent, which makes it seamless top to bottom.
import numpy as np
from PIL import Image

N = 128
SMEAR = 9          # how far a scratch is drawn out along the grain
rng = np.random.default_rng(23)

fine = rng.normal(0, 1, (N, N))
# Smear along x with wrap-around, so scratches run the length of the tile.
smeared = np.zeros_like(fine)
for k in range(-SMEAR, SMEAR + 1):
    smeared += np.roll(fine, k, axis=1) * (1 - abs(k) / (SMEAR + 1))
smeared /= np.abs(smeared).max()

# A few deeper scratches on top of the general grain.
coarse = rng.normal(0, 1, (N, 1)) * (rng.random((N, 1)) > 0.86)
coarse = np.repeat(coarse, N, axis=1)
for k in range(-SMEAR * 2, SMEAR * 2 + 1):
    coarse = coarse + np.roll(coarse, k, axis=1) * 0.02

lum = 132 + 34 * smeared + 10 * coarse
lum = np.clip(lum, 0, 255)

img = np.dstack([lum, lum, lum]).clip(0, 255).astype(np.uint8)
Image.fromarray(img, "RGB").save("frontend/public/textures/brushed.png", optimize=True)
print("wrote frontend/public/textures/brushed.png", img.shape)
