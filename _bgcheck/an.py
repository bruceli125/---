# 临时：量化背景亮度分布（用完即删）
import sys
from PIL import Image
import numpy as np

path = sys.argv[1]
rects = [tuple(int(v) for v in a.split(',')) for a in sys.argv[2:]]
im = Image.open(path).convert('RGB')
b = np.asarray(im).astype(np.int16).max(axis=2)
print(f'image: {im.size[0]}x{im.size[1]}')
for r in rects:
    x0, y0, x1, y1 = r
    s = b[y0:y1, x0:x1]
    med = int(np.median(s))
    print(f'rect {r}: median={med} p99={int(np.percentile(s,99))} p99.9={int(np.percentile(s,99.9))} '
          f'max={int(s.max())} n(>med+10)={int((s>=med+10).sum())} n(>med+15)={int((s>=med+15).sum())} '
          f'n(>med+25)={int((s>=med+25).sum())}')
