#!/usr/bin/env python3

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from ds_store import DSStore

WINDOW_BOUNDS = "{{400, 480}, {520, 260}}"
ICON_POSITIONS = {
    "OpenCloud.app": (132, 118),
    "Applications": (388, 118),
}
BACKGROUND_IMAGE = Path(__file__).resolve().parent / "dmg-background.png"


def run(*args):
    subprocess.run(args, check=True)


def patch_ds_store(ds_store_path: Path):
    with DSStore.open(str(ds_store_path), "r+") as ds:
        bwsp = ds["."]["bwsp"]
        bwsp["WindowBounds"] = WINDOW_BOUNDS
        ds["."]["bwsp"] = bwsp
        for name, position in ICON_POSITIONS.items():
            ds[name]["Iloc"] = position


def patch_background(mountpoint: Path):
    if not BACKGROUND_IMAGE.exists():
        raise FileNotFoundError(f"Background image not found: {BACKGROUND_IMAGE}")
    shutil.copyfile(BACKGROUND_IMAGE, mountpoint / ".background.png")


def main():
    dmg_path = Path(sys.argv[1] if len(sys.argv) > 1 else "dist/OpenCloud-1.0.0-mac.dmg").resolve()
    if not dmg_path.exists():
        raise SystemExit(f"DMG not found: {dmg_path}")

    with tempfile.TemporaryDirectory(prefix="opencloud-dmg-fix-") as tmpdir:
        tmpdir_path = Path(tmpdir)
        rw_dmg = tmpdir_path / "OpenCloud-rw.dmg"
        mountpoint = tmpdir_path / "mnt"
        mountpoint.mkdir()

        run("hdiutil", "convert", str(dmg_path), "-format", "UDRW", "-o", str(rw_dmg))
        run("hdiutil", "attach", str(rw_dmg), "-mountpoint", str(mountpoint), "-nobrowse", "-readwrite")

        try:
            patch_background(mountpoint)
            patch_ds_store(mountpoint / ".DS_Store")
        finally:
            run("hdiutil", "detach", str(mountpoint))

        final_dmg = tmpdir_path / "OpenCloud-fixed.dmg"
        run("hdiutil", "convert", str(rw_dmg), "-format", "UDZO", "-imagekey", "zlib-level=9", "-o", str(final_dmg))
        shutil.copyfile(final_dmg, dmg_path)


if __name__ == "__main__":
    main()
