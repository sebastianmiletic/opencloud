#!/usr/bin/env python3
"""Build the framed macOS icon and its multi-resolution ICNS bundle."""

from pathlib import Path
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "icon.png"
PREVIEW = ROOT / "icon-macos.png"
ICNS = ROOT / "icon.icns"
CANVAS_SIZE = 1024
ICON_SIZES = (16, 32, 128, 256, 512)


def rounded_layer(box, radius, fill, outline=None, width=1):
    layer = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)
    return layer


def build_master():
    canvas = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))

    shadow = rounded_layer((106, 112, 918, 924), 184, (0, 0, 0, 185))
    shadow = shadow.filter(ImageFilter.GaussianBlur(26))
    canvas.alpha_composite(shadow)

    tile = rounded_layer(
        (96, 88, 928, 920),
        190,
        (18, 19, 23, 255),
        outline=(111, 115, 126, 255),
        width=9,
    )
    canvas.alpha_composite(tile)
    canvas.alpha_composite(rounded_layer(
        (110, 102, 914, 906),
        178,
        (0, 0, 0, 0),
        outline=(242, 243, 247, 35),
        width=3,
    ))

    source = Image.open(SOURCE).convert("RGBA")
    alpha_box = source.getchannel("A").getbbox()
    if not alpha_box:
        raise RuntimeError(f"{SOURCE} has no visible artwork")
    cloud = source.crop(alpha_box)
    cloud_alpha = cloud.getchannel("A")
    cloud = Image.new("RGBA", cloud.size, (246, 247, 249, 255))
    cloud.putalpha(cloud_alpha)
    # Keep the cloud comfortably inside the tile and optically centered. This
    # same ICNS is embedded in both Intel and Apple Silicon slices.
    target_width = 470
    target_height = round(cloud.height * target_width / cloud.width)
    cloud = cloud.resize((target_width, target_height), Image.Resampling.LANCZOS)

    cloud_shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    cloud_x = (CANVAS_SIZE - target_width) // 2
    cloud_y = (CANVAS_SIZE - target_height) // 2
    shadow_mask = cloud.getchannel("A").filter(ImageFilter.GaussianBlur(14))
    shadow_art = Image.new("RGBA", cloud.size, (0, 0, 0, 120))
    shadow_art.putalpha(shadow_mask.point(lambda value: round(value * 0.47)))
    cloud_shadow.alpha_composite(shadow_art, (cloud_x, cloud_y + 14))
    canvas.alpha_composite(cloud_shadow)
    canvas.alpha_composite(cloud, (cloud_x, cloud_y))
    return canvas


def main():
    master = build_master()
    master.save(PREVIEW, format="PNG", optimize=True)

    with tempfile.TemporaryDirectory(prefix="opencloud-icon-") as temp_dir:
        iconset = Path(temp_dir) / "OpenCloud.iconset"
        iconset.mkdir()
        for size in ICON_SIZES:
            regular = master.resize((size, size), Image.Resampling.LANCZOS)
            regular.save(iconset / f"icon_{size}x{size}.png", format="PNG")
            retina = master.resize((size * 2, size * 2), Image.Resampling.LANCZOS)
            retina.save(iconset / f"icon_{size}x{size}@2x.png", format="PNG")
        generated = Path(temp_dir) / "OpenCloud.icns"
        subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(generated)], check=True)
        shutil.copyfile(generated, ICNS)

    print(f"Wrote {PREVIEW}")
    print(f"Wrote {ICNS}")


if __name__ == "__main__":
    main()
