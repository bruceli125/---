# -*- coding: utf-8 -*-
"""用像素实测渲染图的左右留白与溢出情况（纯 ASCII 输出，避免控制台编码问题）"""
import sys
from PIL import Image

for path in sys.argv[1:]:
    im = Image.open(path).convert("L")
    w, h = im.size
    px = im.load()
    cm_per_px = 21.0 / w
    lefts, rights = [], []
    for y in range(0, h, 2):
        xs = [x for x in range(w) if px[x, y] < 200]
        if len(xs) > 3:
            lefts.append(min(xs))
            rights.append(max(xs))
    name = path.replace("\\", "/").split("/")[-1]
    if not lefts:
        print("%-16s blank page" % name)
        continue
    touch = sum(1 for r in rights if r >= w - 2)
    print("%-16s %dx%d  ink=[%d..%d]  Lblank=%.2fcm Rblank=%.2fcm  edge_rows=%d/%d %s" % (
        name, w, h, min(lefts), max(rights),
        min(lefts) * cm_per_px, (w - max(rights)) * cm_per_px,
        touch, len(rights), "OVERFLOW" if touch else "ok"))
