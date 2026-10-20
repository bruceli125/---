"""
生成 tabBar 封面图标（81×81 PNG，带 alpha）· v2
修正：1) 图形内缩留出柔光空间，避免边缘被切；2) 选中态渐变加深，白底更可读。
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = r"D:/2026大挑京师家教/miniprogram/assets/tab"
os.makedirs(OUT, exist_ok=True)

S = 324
W = 25
INK = (142, 146, 158)
STOPS = [
    (255, 178, 122),
    (255, 209, 102),
    (111, 227, 225),
    (167, 139, 250),
    (255, 158, 196),
]
# 选中态本体：整体压暗 ~14%，保证白底可读
BODY_SCALE = 0.86


def gradient(size, scale=1.0):
    w, h = size
    xs = np.linspace(0, 1, w)[None, :]
    ys = np.linspace(0, 1, h)[:, None]
    t = np.clip(0.58 * xs + 0.42 * ys, 0, 1)
    n = len(STOPS) - 1
    pos = t * n
    idx = np.clip(np.floor(pos).astype(int), 0, n - 1)
    frac = (pos - idx)[..., None]
    c0 = np.array(STOPS, dtype=float)[idx]
    c1 = np.array(STOPS, dtype=float)[idx + 1]
    rgb = (c0 * (1 - frac) + c1 * frac) * scale
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def glyph_home(d):
    d.line([(70, 156), (162, 66), (254, 156)], fill=255, width=W, joint="curve")
    d.rounded_rectangle([94, 142, 230, 252], radius=20, outline=255, width=W)
    d.line([(162, 252), (162, 202)], fill=255, width=W)


def glyph_pool(d):
    d.rounded_rectangle([122, 76, 240, 194], radius=22, outline=255, width=W)
    d.rounded_rectangle([88, 128, 206, 246], radius=22, outline=255, width=W)
    d.line([(112, 178), (182, 178)], fill=255, width=17)
    d.line([(112, 206), (160, 206)], fill=255, width=17)


def glyph_me(d):
    d.ellipse([124, 70, 204, 150], outline=255, width=W)
    d.arc([98, 176, 230, 296], start=180, end=360, fill=255, width=W)


GLYPHS = {"home": glyph_home, "pool": glyph_pool, "me": glyph_me}


def make(name, draw_fn, selected):
    mask = Image.new("L", (S, S), 0)
    draw_fn(ImageDraw.Draw(mask))
    base = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    if selected:
        glow_mask = mask.filter(ImageFilter.GaussianBlur(15))
        glow = gradient((S, S)).convert("RGBA")
        glow.putalpha(glow_mask.point(lambda v: int(v * 0.42)))
        base = Image.alpha_composite(base, glow)

        body = gradient((S, S), BODY_SCALE).convert("RGBA")
        body.putalpha(mask)
        base = Image.alpha_composite(base, body)
    else:
        flat = Image.new("RGBA", (S, S), INK + (255,))
        flat.putalpha(mask.point(lambda v: int(v * 0.9)))
        base = Image.alpha_composite(base, flat)

    out = base.resize((81, 81), Image.LANCZOS)
    path = os.path.join(OUT, ("%s-on.png" if selected else "%s.png") % name)
    out.save(path, "PNG", optimize=True)
    return os.path.basename(path), os.path.getsize(path)


for key, fn in GLYPHS.items():
    for sel in (False, True):
        n, s = make(key, fn, sel)
        print("  %-14s %5d bytes" % (n, s))
print("done")
