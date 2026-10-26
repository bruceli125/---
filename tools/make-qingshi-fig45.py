# -*- coding: utf-8 -*-
"""修正 fig4 / fig5 内容超出手机框的问题"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = r"D:/2026大挑京师家教/docs/.figs"
INK = (26, 28, 33)
GREY = (120, 126, 138)
LINE = (206, 210, 220)
BG = (255, 255, 255)
SOFT = (246, 247, 250)
VIOLET = (109, 74, 255)
VIOLET_SOFT = (238, 234, 255)
GREEN = (14, 159, 110)
GREEN_SOFT = (230, 247, 241)


def f(s, b=False):
    p = r"C:/Windows/Fonts/msyhbd.ttc" if b else r"C:/Windows/Fonts/msyh.ttc"
    try:
        return ImageFont.truetype(p, s)
    except Exception:
        return ImageFont.truetype(r"C:/Windows/Fonts/msyh.ttc", s)


def ct(d, xy, t, s=22, b=False, c=INK, a="mm"):
    d.text(xy, t, font=f(s, b), fill=c, anchor=a)


def box(d, xy, fill=SOFT, outline=LINE, r=12, w=2):
    d.rounded_rectangle(xy, radius=r, fill=fill, outline=outline, width=w)


def phone(title, sub=""):
    W, H = 620, 1080
    img = Image.new("RGB", (W, H), (238, 240, 245))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([30, 20, W - 30, H - 20], radius=36, fill=BG, outline=(214, 218, 228), width=3)
    ct(d, (70, 58), "9:41", 18, True, INK, "lm")
    d.line([(30, 96), (W - 30, 96)], fill=(232, 234, 240), width=2)
    ct(d, (W // 2, 130), title, 24, True)
    if sub:
        ct(d, (W // 2, 164), sub, 16, False, GREY)
    d.line([(30, 186), (W - 30, 186)], fill=(232, 234, 240), width=2)
    return img, d, W, H


# ---------------- 图 4 接单池 ----------------
img, d, W, H = phone("接单池", "共 6 条 · 点击卡片查看详情与报名")
y = 200
d.rectangle([30, y, W - 30, y + 72], fill=BG)
for i, t in enumerate(["学科", "年级", "价格", "时间"]):
    cx = 30 + (W - 60) * (i + 0.5) / 4
    on = i == 0
    ct(d, (cx, y + 36), t + " ▾", 18, on, VIOLET if on else INK)
d.line([(30, y + 72), (W - 30, y + 72)], fill=(232, 234, 240), width=2)
y += 86

# 卡片 1
box(d, [54, y, W - 54, y + 350], fill=BG, outline=(230, 232, 240), r=16)
box(d, [W - 224, y, W - 54, y + 42], fill=VIOLET, outline=VIOLET, r=0, w=0)
ct(d, (W - 139, y + 21), "招募中", 17, True, (255, 255, 255))
ct(d, (80, y + 40), "初二·数学", 29, True, INK, "lm")
box(d, [80, y + 66, 176, y + 96], fill=(238, 241, 255), outline=(220, 225, 250), r=6, w=1)
ct(d, (128, y + 81), "学科类", 15, False, (75, 63, 191))
for i, t in enumerate(["线下上门", "工作日晚上", "长期稳定"]):
    w = 30 + len(t) * 16
    x = 80 + sum(30 + len(["线下上门", "工作日晚上", "长期稳定"][j]) * 16 + 10 for j in range(i))
    box(d, [x, y + 110, x + w, y + 146], fill=SOFT, outline=(232, 234, 240), r=18, w=1)
    ct(d, (x + w // 2, y + 128), t, 14, False, (74, 78, 89))
box(d, [80, y + 168, W - 80, y + 262], fill=SOFT, outline=(236, 238, 244), r=10, w=1)
ct(d, (100, y + 194), "匹配度 88.4 分", 21, True, INK, "lm")
ct(d, (100, y + 226), "需求 88.4 分 · 3.2km · 130 元/小时", 15, False, GREY, "lm")
d.line([(80, y + 284), (W - 80, y + 284)], fill=(240, 241, 246), width=2)
ct(d, (80, y + 306), "昨天 16:47", 15, False, GREY, "lm")
ct(d, (80, y + 332), "1人已申请 · 37次浏览", 14, False, (176, 180, 190), "lm")
ct(d, (W - 80, y + 320), "查看详情 ›", 15, False, (176, 180, 190), "rm")

# 卡片 2（截断显示）
y2 = y + 374
box(d, [54, y2, W - 54, H - 40], fill=BG, outline=(230, 232, 240), r=16)
box(d, [W - 224, y2, W - 54, y2 + 42], fill=VIOLET, outline=VIOLET, r=0, w=0)
ct(d, (W - 139, y2 + 21), "沟通中", 17, True, (255, 255, 255))
ct(d, (80, y2 + 40), "初三·数学", 26, True, INK, "lm")
box(d, [80, y2 + 66, 320, y2 + 102], fill=(246, 247, 250), outline=(236, 238, 244), r=6, w=1)
ct(d, (98, y2 + 84), "已报名，等待家长确认", 14, False, (107, 111, 122), "lm")
ct(d, (80, y2 + 134), "匹配度 81.2 分 · 6.8km", 16, False, GREY, "lm")
ct(d, (80, y2 + 170), "要求：孩子函数薄弱，需专项突破", 14, False, (140, 144, 154), "lm")
img.save(os.path.join(OUT, "fig4_pool.png"), "PNG")

# ---------------- 图 5 需求详情 ----------------
img, d, W, H = phone("需求详情", "初二·数学　140 元/小时")
y = 206
box(d, [54, y, W - 54, y + 150], fill=SOFT, outline=(232, 234, 240), r=12)
for i, (k, v) in enumerate([("辅导科目", "数学（学科类）"), ("年级", "初二"),
                            ("时段", "工作日晚上 19:00-21:00"), ("地址", "海淀区西三环北路")]):
    ct(d, (78, y + 26 + i * 32), k, 15, False, GREY, "lm")
    ct(d, (176, y + 26 + i * 32), v, 15, True, INK, "lm")
y += 176

ct(d, (54, y), "申请接单的学生（3）", 20, True, INK, "lm")
y += 26
people = [("林", "林嘉怡", "XX大学 · 数学与应用数学", "三重认证", "已确认，等待您确认", True),
          ("陈", "陈知远", "XX大学 · 汉语言文学", "双重认证", "", False),
          ("苏", "苏雨萌", "XX大学 · 学前教育", "双重认证", "", False)]
for i, (av, name, school, cert, hint, conf) in enumerate(people):
    yy = y + i * 152
    box(d, [54, yy, W - 54, yy + 138], fill=BG, outline=(232, 234, 240), r=12)
    d.ellipse([74, yy + 18, 138, yy + 82], fill=(255, 178, 122) if i == 0 else (167, 139, 250))
    ct(d, (106, yy + 50), av, 22, True, (255, 255, 255))
    ct(d, (152, yy + 38), name, 19, True, INK, "lm")
    nx = 152 + len(name) * 20 + 8
    box(d, [nx, yy + 24, nx + 88, yy + 52], fill=GREEN_SOFT, outline=(190, 228, 210), r=12, w=1)
    ct(d, (nx + 44, yy + 38), cert, 12, False, GREEN)
    ct(d, (152, yy + 68), school, 14, False, GREY, "lm")
    if hint:
        box(d, [74, yy + 86, W - 200, yy + 114], fill=VIOLET_SOFT, outline=(212, 202, 255), r=8, w=1)
        ct(d, (86, yy + 100), hint, 12, True, VIOLET, "lm")
    box(d, [W - 186, yy + 92, W - 74, yy + 128], fill=INK, outline=INK, r=18, w=0)
    ct(d, (W - 130, yy + 110), "发消息", 15, True, (255, 255, 255))

d.rectangle([30, H - 120, W - 30, H - 20], fill=BG)
d.line([(30, H - 120), (W - 30, H - 120)], fill=(232, 234, 240), width=2)
box(d, [54, H - 102, W - 230, H - 38], fill=SOFT, outline=(214, 218, 228), r=32)
ct(d, (54 + (W - 284) // 2, H - 70), "长按报名", 19, True, INK)
ct(d, (W - 142, H - 70), "生成报告", 16, False, GREY)
img.save(os.path.join(OUT, "fig5_detail.png"), "PNG")

for n in ["fig4_pool.png", "fig5_detail.png"]:
    print("  %s  %.1f KB" % (n, os.path.getsize(os.path.join(OUT, n)) / 1024))
