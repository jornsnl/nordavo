"""Generate the iOS launch screens (apple-touch-startup-image) in public/splash.

iOS shows these while the home screen app starts. Each device needs an image
of its exact screen size, matched with a media query in src/lib/pwa/splash.ts.
Run after changing the icon or the list:  python3 scripts/generate-splash.py
"""
from pathlib import Path
import json
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
DEVICES = json.loads((ROOT / "src/lib/pwa/splash-devices.json").read_text())
BACKGROUND = (246, 248, 251)  # background_color in the manifest (#f6f8fb)
icon = Image.open(ROOT / "public/icons/icon-512.png").convert("RGBA")
out = ROOT / "public/splash"
out.mkdir(parents=True, exist_ok=True)

for d in DEVICES:
    w, h = d["width"] * d["ratio"], d["height"] * d["ratio"]
    img = Image.new("RGB", (w, h), BACKGROUND)
    size = round(min(w, h) * 0.26)
    logo = icon.resize((size, size), Image.LANCZOS)
    # Rounded corners like the app icon (src/app/icon.svg: rx 8 of 32).
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), radius=size, fill=255)
    logo.putalpha(mask.resize((size, size), Image.LANCZOS))
    img.paste(logo, ((w - size) // 2, (h - size) // 2), logo)
    img.save(out / f"splash-{w}x{h}.png", optimize=True)
    print(f"splash-{w}x{h}.png")
