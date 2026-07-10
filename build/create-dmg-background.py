#!/usr/bin/env python3
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT.parent / "background2.jpg"
if not SOURCE.exists():
    SOURCE = ROOT / "background2.jpg"
if not SOURCE.exists():
    SOURCE = ROOT.parent / "background.jpg"
if not SOURCE.exists():
    SOURCE = ROOT / "background.jpg"
OUTPUT = ROOT / "build" / "dmg-background.png"
WIDTH = 720
HEIGHT = 480


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    image = Image.open(SOURCE).convert("RGB")
    source_ratio = image.width / image.height
    target_ratio = WIDTH / HEIGHT

    if source_ratio > target_ratio:
        scaled_height = HEIGHT
        scaled_width = int(round(scaled_height * source_ratio))
    else:
        scaled_width = WIDTH
        scaled_height = int(round(scaled_width / source_ratio))

    resized = image.resize((scaled_width, scaled_height), Image.Resampling.LANCZOS)
    left = max((scaled_width - WIDTH) // 2, 0)
    top = max((scaled_height - HEIGHT) // 2, 0)
    cropped = resized.crop((left, top, left + WIDTH, top + HEIGHT))
    cropped.save(OUTPUT, format="PNG")
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
