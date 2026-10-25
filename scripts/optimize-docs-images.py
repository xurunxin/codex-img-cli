"""Downscale and optimise the README images.

The API returns 1536x1024 PNGs around 1.3-1.6 MB each. GitHub renders the
README at roughly half that width, so the extra pixels cost repository size
for nothing.
"""

import sys
from pathlib import Path

from PIL import Image

TARGET_WIDTH = 1280

for name in ("hero.png", "hero-sunset.png"):
    path = Path(__file__).resolve().parent.parent / "docs" / name
    before = path.stat().st_size
    with Image.open(path) as img:
        if img.width > TARGET_WIDTH:
            height = round(img.height * TARGET_WIDTH / img.width)
            img = img.resize((TARGET_WIDTH, height), Image.LANCZOS)
        img.save(path, optimize=True)
    after = path.stat().st_size
    print(f"{name}: {before/1024:.0f} KB -> {after/1024:.0f} KB")

sys.exit(0)
