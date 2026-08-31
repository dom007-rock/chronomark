"""Generates placeholder toolbar icons (16/48/128px) with no dependencies
beyond the standard library. Swap these for real branding whenever -- this
just draws a flat-color square with a simple bookmark-ribbon notch so the
extension has *something* to show in chrome://extensions.
"""
import os
import struct
import zlib

BG = (51, 65, 85)       # slate-700ish placeholder background
FG = (248, 250, 252)    # near-white ribbon

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "icons")


def pixel(x, y, w, h):
    rx0, rx1 = int(w * 0.28), int(w * 0.72)
    ry0, ry1 = int(h * 0.16), int(h * 0.86)
    if not (rx0 <= x < rx1 and ry0 <= y < ry1):
        return BG

    notch_h = (ry1 - ry0) * 0.45
    notch_start = ry1 - notch_h
    if y < notch_start:
        return FG

    t = (y - notch_start) / notch_h
    half_w = (rx1 - rx0) / 2
    cx = (rx0 + rx1) / 2
    excluded_half = half_w * t
    if abs((x + 0.5) - cx) <= excluded_half:
        return BG
    return FG


def make_png(path, size):
    w = h = size
    rows = []
    for y in range(h):
        row = bytearray([0])  # filter byte: none
        for x in range(w):
            r, g, b = pixel(x, y, w, h)
            row += bytes([r, g, b, 255])
        rows.append(bytes(row))
    raw = b"".join(rows)
    compressed = zlib.compress(raw, 9)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(
            ">I", zlib.crc32(tag + data)
        )

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)  # color type 6 = RGBA
    png = sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", compressed) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (16, 48, 128):
        out_path = os.path.join(OUT_DIR, f"icon{size}.png")
        make_png(out_path, size)
        print(f"wrote {out_path}")
