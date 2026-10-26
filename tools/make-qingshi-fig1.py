# -*- coding: utf-8 -*-
"""重画图 1：修正层标题与卡片重叠、收敛点遮挡模块"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = r"D:/2026大挑京师家教/docs/.figs"
os.makedirs(OUT, exist_ok=True)
INK = (26, 28, 33)
GREY = (120, 126, 138)
LINE = (206, 210, 220)
BG = (255, 255, 255)
SOFT = (246, 247, 250)
VIOLET = (109, 74, 255)
VIOLET_SOFT = (238, 234, 255)
GREEN = (14, 159, 110)
GREEN_SOFT = (230, 247, 241)
AMBER = (178, 106, 0)
AMBER_SOFT = (255, 246, 229)


def f(size, bold=False):
    p = r"C:/Windows/Fonts/msyhbd.ttc" if bold else r"C:/Windows/Fonts/msyh.ttc"
    try:
        return ImageFont.truetype(p, size)
    except Exception:
        return ImageFont.truetype(r"C:/Windows/Fonts/msyh.ttc", size)


def ct(d, xy, t, s=22, b=False, c=INK, a="mm"):
    d.text(xy, t, font=f(s, b), fill=c, anchor=a)


def box(d, xy, fill=SOFT, outline=LINE, r=12, w=2):
    d.rounded_rectangle(xy, radius=r, fill=fill, outline=outline, width=w)


W, H = 1680, 1300
img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

ct(d, (W // 2, 44), "青拾对接　底层设计框架", 34, True)

# ---------------- 表现层 ----------------
box(d, [70, 96, W - 70, 320], fill=(250, 250, 252), w=2)
ct(d, (100, 126), "表现层", 26, True, a="lm")
ct(d, (100, 158), "13 个页面　·　8 个自研组件", 19, False, GREY, a="lm")
pages = ["首页", "需求发布", "接单池", "需求详情", "聊天室", "履约打卡", "双向评价", "我的"]
x = 108
for p in pages:
    box(d, [x, 196, x + 160, 254], fill=BG, r=10, w=2)
    ct(d, (x + 80, 225), p, 19)
    x += 176
ct(d, (108, 288), "页面禁止直连 Storage / 云开发，只能经由服务编排层取数", 18, False, AMBER, a="lm")

# ---------------- 服务编排层 ----------------
box(d, [70, 350, W - 70, 700], fill=(247, 246, 253), w=2)
ct(d, (100, 380), "服务编排层", 26, True, a="lm")
ct(d, (100, 412), "统一数据网关 + 4 个服务模块", 19, False, GREY, a="lm")

mods = [
    ("api.js", ["唯一数据网关", "统一 code 契约"]),
    ("match.js", ["七维加权打分", "逐维产出可读理由"]),
    ("risk.js", ["双减规则 + 词库", "三级分层处置"]),
    ("phase2.js", ["撮合/履约/评价", "四套状态机"]),
]
x = 108
for name, lines in mods:
    box(d, [x, 452, x + 262, 620], fill=BG, r=14, w=2)
    ct(d, (x + 131, 486), name, 23, True)
    for i, ln in enumerate(lines):
        ct(d, (x + 131, 534 + i * 32), ln, 17, False, GREY)
    x += 286

# 收敛点②：放在模块右侧独立区域
box(d, [1268, 452, W - 100, 620], fill=GREEN_SOFT, outline=(180, 225, 205), r=14, w=2)
ct(d, (1384, 484), "收敛点②", 20, True, GREEN)
ct(d, (1384, 516), "角色事实源", 19, True, INK)
ct(d, (1384, 552), "currentRole 唯一", 16, False, GREY)
ct(d, (1384, 580), "setRole 唯一写入口", 16, False, GREY)
ct(d, (1384, 606), "guardRole 统一拦截", 15, False, GREY)

# 收敛点①：放在层间箭头上方
box(d, [760, 322, 1090, 356], fill=AMBER_SOFT, outline=(232, 200, 140), r=17, w=2)
ct(d, (925, 339), "收敛点①　数据网关（页面不得直连数据）", 16, True, AMBER)

# 层间箭头
for y1, y2 in [(620, 700), (700, 730), (960, 1000)]:
    pass
d.line([(W // 2, 660), (W // 2, 706)], fill=LINE, width=3)
d.polygon([(W // 2 - 9, 697), (W // 2 + 9, 697), (W // 2, 712)], fill=LINE)

# ---------------- 云函数层 ----------------
box(d, [70, 716, W - 70, 950], fill=(245, 250, 248), w=2)
ct(d, (100, 746), "云函数层", 26, True, a="lm")
ct(d, (100, 778), "8 个云函数：权威判定 · 持久化 · 跨用户一致性", 19, False, GREY, a="lm")
fns = ["login", "riskCheck", "submitDemand", "matchTutors",
       "submitCertification", "submitCheckin", "submitReview", "generateReport"]
x, row = 108, 0
for i, fn in enumerate(fns):
    w = 340
    if i == 4:
        x, row = 108, 1
    y = 812 + row * 62
    box(d, [x, y, x + w, y + 48], fill=BG, r=8, w=2)
    ct(d, (x + w // 2, y + 24), fn, 17)
    x += w + 16

d.line([(W // 2, 950), (W // 2, 986)], fill=LINE, width=3)
d.polygon([(W // 2 - 9, 977), (W // 2 + 9, 977), (W // 2, 992)], fill=LINE)

# ---------------- 数据层 ----------------
box(d, [70, 996, W - 70, 1200], fill=(250, 249, 245), w=2)
ct(d, (100, 1026), "数据层", 26, True, a="lm")
ct(d, (100, 1058), "9 个集合（JSON Lines 种子数据 · 云数据库同构）", 19, False, GREY, a="lm")
cols = ["users", "tutors", "certifications", "demands", "matches",
        "reports", "checkins", "reviews", "risk_words"]
x, row = 108, 0
for i, c in enumerate(cols):
    w = 262
    if i == 5:
        x, row = 108, 1
    y = 1092 + row * 56
    box(d, [x, y, x + w, y + 44], fill=BG, r=8, w=2)
    ct(d, (x + w // 2, y + 22), c, 17)
    x += w + 16

ct(d, (W // 2, 1246), "图 1　三层收敛的单一数据网关（页面 → 网关 → 云函数 → 集合）", 21, True, GREY)

p = os.path.join(OUT, "fig1_arch.png")
img.save(p, "PNG")
print("已重画 -> %s  %.1f KB" % (p, os.path.getsize(p) / 1024))
