# 临时：量化分析背景亮度分布（用完即删）
import sys
from PIL import Image
import numpy as np

path = sys.argv[1]
rects = [tuple(int(v) for v in a.split(',')) for a in sys.argv[2:]]

im = Image.open(path).convert('RGB')
a = np.asarray(im).astype(np.int16)
print(f'image: {im.size[0]}x{im.size[1]}')
bright = a.max(axis=2)


def stats(name, x0, y0, x1, y1):
    sub = bright[y0:y1, x0:x1]
    if sub.size == 0:
        print(f'{name}: empty rect')
        return
    med = int(np.median(sub))
    print(
        f'{name:>16} median={med:3d} p99={int(np.percentile(sub, 99)):3d} '
        f'p99.9={int(np.percentile(sub, 99.9)):3d} max={int(sub.max()):3d} '
        f'px>=med+10: {int((sub >= med + 10).sum()):5d} '
        f'px>=med+20: {int((sub >= med + 20).sum()):5d}'
    )


stats('whole', 0, 0, im.size[0], im.size[1])
for r in rects:
    stats('rect', *r)

# 3x 最近邻放大裁切，便于肉眼看颗粒
x0, y0, x1, y1 = rects[0]
crop = im.crop((x0, y0, x1, y1))
crop = crop.resize((crop.width * 3, crop.height * 3), Image.NEAREST)
out = path.replace('.png', '_crop.png')
crop.save(out)
print('saved', out, crop.size)
