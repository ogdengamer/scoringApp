"""Generate the PWA icons (a dial with ticks and a green arc) using only the standard library.

Usage: python3 tools/make_icons.py
"""
import math
import struct
import zlib
from pathlib import Path

BG = (20, 23, 31)
FACE = (30, 34, 44)
TRACK = (52, 58, 72)
TICK = (139, 145, 158)
ARC = (76, 197, 107)
GRIP = (46, 134, 222)

SS = 3  # supersampling per axis


def sample(x, y, scale):
    """Colour at normalised point (x, y) in [-1, 1]; scale shrinks the dial for maskable icons."""
    r = math.hypot(x, y) / scale
    a = math.atan2(y, x)  # 0 = right, clockwise positive (screen coords)
    if r > 0.96:
        return BG
    if r > 0.86:
        # arc from 12 o'clock clockwise through 220 degrees
        from_top = (a + math.pi / 2) % (2 * math.pi)
        return ARC if from_top < math.radians(220) else TRACK
    if 0.64 < r < 0.80:
        step = 2 * math.pi / 12
        nearest = round(a / step) * step
        if abs(a - nearest) * r < 0.022:
            return TICK
    if math.hypot(x, y + 0.52 * scale) < 0.06 * scale:
        return GRIP
    ux, uy = abs(x) / scale, abs(y) / scale
    if (ux < 0.24 and uy < 0.065) or (ux < 0.065 and uy < 0.24):
        return ARC
    return FACE


def render(size, scale):
    rows = []
    for py in range(size):
        row = bytearray([0])  # filter type: none
        for px in range(size):
            acc = [0, 0, 0]
            for sy in range(SS):
                for sx in range(SS):
                    x = ((px + (sx + 0.5) / SS) / size) * 2 - 1
                    y = ((py + (sy + 0.5) / SS) / size) * 2 - 1
                    c = sample(x, y, scale)
                    acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]
            n = SS * SS
            row += bytes((acc[0] // n, acc[1] // n, acc[2] // n))
        rows.append(bytes(row))
    return b"".join(rows)


def png(size, raw):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def main():
    out = Path(__file__).resolve().parent.parent / "icons"
    out.mkdir(exist_ok=True)
    for name, size, scale in [("icon-192.png", 192, 1.0), ("icon-512.png", 512, 1.0), ("maskable-512.png", 512, 0.78)]:
        (out / name).write_bytes(png(size, render(size, scale)))
        print("wrote", out / name)


if __name__ == "__main__":
    main()
