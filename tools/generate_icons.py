"""Generates toolbar icons (16/48/128px) with no dependencies beyond the
standard library. A rounded-square indigo background (matching the popup's
own accent color) with a simple bookmark ribbon -- kept deliberately plain
since a clock-hands accent tried here didn't read cleanly at small sizes
(looked like a stray mark rather than a clock once shrunk to 16px).
"""
import os
import struct
import zlib

BG = (79, 70, 229)      # indigo-600, matches the popup's own accent color
FG = (248, 250, 252)    # near-white ribbon

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "icons")


def in_rounded_rect(px, py, w, h, radius):
    corners = [
        (radius, radius, px < radius, py < radius),
        (w - radius, radius, px > w - radius, py < radius),
        (radius, h - radius, px < radius, py > h - radius),
        (w - radius, h - radius, px > w - radius, py > h - radius),
    ]
    for cx, cy, in_x, in_y in corners:
        if in_x and in_y:
            return (px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2
    return True


def ribbon(x, y, w, h):
    rx0, rx1 = w * 0.26, w * 0.68
    ry0, ry1 = h * 0.14, h * 0.84
    if not (rx0 <= x < rx1 and ry0 <= y < ry1):
        return False

    notch_h = (ry1 - ry0) * 0.45
    notch_start = ry1 - notch_h
    if y < notch_start:
        return True

    t = (y - notch_start) / notch_h
    half_w = (rx1 - rx0) / 2
    cx = (rx0 + rx1) / 2
    excluded_half = half_w * t
    return abs((x + 0.5) - cx) > excluded_half


def pixel(x, y, w, h):
    px, py = x + 0.5, y + 0.5
    if not in_rounded_rect(px, py, w, h, w * 0.22):
        return (*BG, 0)  # transparent outside the rounded square

    return (*(FG if ribbon(x, y, w, h) else BG), 255)


def make_png(path, size):
    w = h = size
    rows = []
    for y in range(h):
        row = bytearray([0])  # filter byte: none
        for x in range(w):
            r, g, b, a = pixel(x, y, w, h)
            row += bytes([r, g, b, a])
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
