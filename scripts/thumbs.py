#!/usr/bin/env python3
"""Make the wall's small photos: public/photos/sm/NN.webp, 640 px on the long side.

The wall shows each photo at about 200 to 320 css px, so the 1200 px exports would load
5 times the bytes and decode 3.5 times the memory for no visible gain. The full export loads
when a photo is focused (main.ts). Run this again after you add or replace an export.
Needs Pillow (pip install pillow).
"""
from pathlib import Path
from PIL import Image

LONG = 640  # main.ts SMALL_PX must match
src = Path(__file__).resolve().parent.parent / "public" / "photos"
out = src / "sm"
out.mkdir(exist_ok=True)
for f in sorted(src.glob("*.jpg")):
    im = Image.open(f)
    icc = im.info.get("icc_profile")
    im.thumbnail((LONG, LONG), Image.LANCZOS)
    im.save(out / f"{f.stem}.webp", "WEBP", quality=75, method=6, icc_profile=icc)
print(f"{len(list(out.glob('*.webp')))} small photos in {out}")
