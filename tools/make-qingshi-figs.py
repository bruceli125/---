# -*- coding: utf-8 -*-
"""生成配图：架构图 + 5 个界面示意图（PIL 手绘，无外部依赖）"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = r"D:/2026大挑京师家教/docs/.figs"
os.makedirs(OUT, exist_ok=True)

FONT = r"C:/Windows/Fonts/msyh.ttc"
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
    path = r"C:/Windows/Fonts/msyhbd.ttc" if bold else FONT
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.truetype(FONT, size)


def ctext(d, xy, text, size=22, bold=False, fill=INK, anchor="mm"):
    d.text(xy, text, font=f(size, bold), fill=fill, anchor=anchor)


def box(d, xy, fill=SOFT, outline=LINE, radius=12, width=2):
    d.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def arrow_v(d, x, y1, y2, color=LINE, width=3, head=9):
    d.line([(x, y1), (x, y2)], fill=color, width=width)
    d.polygon([(x - head, y2 - head), (x + head, y2 - head), (x, y2)], fill=color)


# ============================================================================
# 图 1　底层设计框架图
# ============================================================================
def fig_arch():
    W, H = 1680, 1120
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    ctext(d, (W // 2, 46), "青拾对接　底层设计框架", 34, True, INK)

    # 四个层次
    layers = [
        ("表现层", "13 个页面　·　8 个自研组件", 120, 200, (250, 250, 252)),
        ("服务编排层", "统一数据网关 + 4 个服务模块", 340, 320, (247, 246, 253)),
        ("云函数层", "8 个云函数（权威判定 / 持久化 / 跨用户一致性）", 700, 140, (245, 250, 248)),
        ("数据层", "9 个集合（users / tutors / demands / matches / reports / checkins / reviews / …）", 880, 140, (250, 249, 245)),
    ]

    for name, sub, y, h, fill in layers:
        d.rectangle([70, y, W - 70, y + h], fill=fill, outline=LINE, width=2)
        ctext(d, (110, y + 32), name, 26, True, INK, anchor="lm")
        ctext(d, (110, y + 66), sub, 19, False, GREY, anchor="lm")

    # 表现层内页签
    pages = ["首页", "需求发布", "接单池", "需求详情", "聊天室", "履约打卡", "双向评价", "我的"]
    x = 300
    for p in pages:
        w = 150
        box(d, [x, 232, x + w, 288], fill=BG, outline=LINE, radius=10, width=2)
        ctext(d, (x + w // 2, 260), p, 19)
        x += w + 14
        if x > W - 200:
            break
    ctext(d, (110, 296), "页面禁止直连存储 / 云", 18, False, AMBER, anchor="lm")

    # 服务编排层模块
    mods = [
        ("api.js", "唯一数据网关\n统一 code 契约", VIOLET_SOFT),
        ("match.js", "七维加权打分\n逐维产出可读理由", SOFT),
        ("risk.js", "双减规则 + 词库\n分级处置", SOFT),
        ("phase2.js", "状态机\n履约 / 评价 / 沟通", SOFT),
    ]
    x = 150
    for name, desc, fill in mods:
        w = 330
        box(d, [x, 396, x + w, 560], fill=fill, outline=LINE, radius=14, width=2)
        ctext(d, (x + w // 2, 430), name, 24, True, INK)
        for i, ln in enumerate(desc.split("\n")):
            ctext(d, (x + w // 2, 478 + i * 30), ln, 18, False, GREY)
        x += w + 22

    # 收敛点标记
    def marker(x, y, text):
        box(d, [x, y, x + 250, y + 40], fill=AMBER_SOFT, outline=(232, 200, 140), radius=20, width=2)
        ctext(d, (x + 125, y + 20), text, 18, True, AMBER)

    marker(1030, 372, "收敛点①　数据网关")
    ctext(d, (1180, 660), "云函数层不信任前端声明，独立重算", 17, False, GREY)

    # 云函数
    fns = ["login", "riskCheck", "submitDemand", "matchTutors", "submitCertification", "submitCheckin", "submitReview", "generateReport"]
    x = 150
    row = 0
    for i, fn in enumerate(fns):
        w = 178
        if x + w > W - 120:
            x = 150
            row += 1
        y = 744 + row * 56
        box(d, [x, y, x + w, y + 44], fill=BG, outline=LINE, radius=8, width=2)
        ctext(d, (x + w // 2, y + 22), fn, 16)
        x += w + 14

    # 数据层集合
    cols = ["users", "tutors", "certifications", "demands", "matches", "reports", "checkins", "reviews", "risk_words"]
    x = 150
    for c in cols:
        w = 148
        box(d, [x, 928, x + w, 980], fill=BG, outline=LINE, radius=8, width=2)
        ctext(d, (x + w // 2, 954), c, 16)
        x += w + 12

    # 层间箭头
    for y1, y2 in [(300, 340), (640, 700), (864, 880)]:
        arrow_v(d, W // 2, y1, y2)

    # 右侧两个收敛点
    box(d, [1300, 380, 1600, 560], fill=GREEN_SOFT, outline=(180, 225, 205), radius=14, width=2)
    ctext(d, (1450, 412), "收敛点②", 20, True, GREEN)
    ctext(d, (1450, 444), "角色事实源", 19, True, INK)
    ctext(d, (1450, 478), "currentRole 唯一", 17, False, GREY)
    ctext(d, (1450, 510), "setRole 唯一写入口", 17, False, GREY)

    ctext(d, (W // 2, 1058), "图 1　三层收敛的单一数据网关（页面 → 网关 → 云函数 → 集合）", 20, True, GREY)
    img.save(os.path.join(OUT, "fig1_arch.png"), "PNG")
    return "fig1_arch.png"


# ============================================================================
# 界面示意通用画法
# ============================================================================
def phone(title, subtitle=""):
    W, H = 620, 1080
    img = Image.new("RGB", (W, H), (238, 240, 245))
    d = ImageDraw.Draw(img)
    # 机身
    d.rounded_rectangle([30, 20, W - 30, H - 20], radius=36, fill=BG, outline=(214, 218, 228), width=3)
    # 状态栏
    d.rectangle([30, 20, W - 30, 96], fill=BG)
    ctext(d, (70, 58), "9:41", 18, True, INK, anchor="lm")
    ctext(d, (W - 80, 58), "●●●", 14, False, GREY, anchor="rm")
    # 标题栏
    d.line([(30, 96), (W - 30, 96)], fill=(232, 234, 240), width=2)
    ctext(d, (W // 2, 130), title, 24, True, INK)
    if subtitle:
        ctext(d, (W // 2, 164), subtitle, 16, False, GREY)
    d.line([(30, 186), (W - 30, 186)], fill=(232, 234, 240), width=2)
    return img, d, W, H


def save(img, name):
    img.save(os.path.join(OUT, name), "PNG")
    return name


# ---- 图 2 首页（角色分流） ----
def fig_home():
    img, d, W, H = phone("青拾对接", "高校学生家教 · 可信对接")
    y = 210
    # 品牌卡
    box(d, [54, y, W - 54, y + 150], fill=(250, 250, 253), outline=(230, 232, 240), radius=16, width=2)
    ctext(d, (78, y + 40), "青拾对接", 30, True, INK, anchor="lm")
    ctext(d, (78, y + 84), "认证可查 · 试课可换 · 学生零押金", 17, False, GREY, anchor="lm")
    for i, t in enumerate(["认证可查", "试课可换", "零押金"]):
        box(d, [78 + i * 118, y + 104, 78 + i * 118 + 106, y + 136], fill=VIOLET_SOFT, outline=(214, 206, 255), radius=16, width=2)
        ctext(d, (78 + i * 118 + 53, y + 120), t, 15, False, VIOLET)

    # 角色选择
    ctext(d, (W // 2, y + 196), "选择身份", 20, True, INK)
    for i, (name, desc, on) in enumerate([("我是家长 / 机构", "发布需求 · 挑选老师", True), ("我是学生", "认证接单 · 赚取课时费", False)]):
        yy = y + 220 + i * 118
        fill = VIOLET_SOFT if on else SOFT
        outline = VIOLET if on else LINE
        box(d, [54, yy, W - 54, yy + 100], fill=fill, outline=outline, radius=14, width=3 if on else 2)
        ctext(d, (86, yy + 36), name, 22, True, INK, anchor="lm")
        ctext(d, (86, yy + 70), desc, 16, False, GREY, anchor="lm")
        if on:
            ctext(d, (W - 92, yy + 50), "✓", 26, True, VIOLET)

    # 底部说明
    box(d, [54, 780, W - 54, 900], fill=SOFT, outline=LINE, radius=12, width=2)
    for i, ln in enumerate(["本平台仅为个人零星家教信息撮合，", "非培训机构，不提供固定办学场所。"]):
        ctext(d, (78, 818 + i * 30), ln, 16, False, GREY, anchor="lm")

    # 底部 Tab
    d.rectangle([30, H - 118, W - 30, H - 20], fill=BG)
    d.line([(30, H - 118), (W - 30, H - 118)], fill=(232, 234, 240), width=2)
    for i, (t, on) in enumerate([("首页", True), ("接单池", False), ("沟通", False), ("我的", False)]):
        cx = 30 + (W - 60) * (i + 0.5) / 4
        ctext(d, (cx, H - 84), t, 17, True if on else False, INK if on else GREY)
    return save(img, "fig2_home.png")


# ---- 图 3 需求发布（双减拦截） ----
def fig_publish():
    img, d, W, H = phone("发布家教需求")
    y = 206
    rows = [
        ("是否学科类", ["学科类", "非学科类"], 0),
        ("辅导科目", ["数学", "语文", "英语"], 0),
        ("年级", ["初二", "初三"], 0),
        ("授课方式", ["线下上门", "线上", "校内场地"], 0),
    ]
    for label, opts, act in rows:
        ctext(d, (60, y + 16), label, 18, True, INK, anchor="lm")
        x = 60
        for i, o in enumerate(opts):
            w = 40 + len(o) * 17
            on = i == 0
            box(d, [x, y + 34, x + w, y + 78], fill=VIOLET_SOFT if on else SOFT, outline=VIOLET if on else LINE, radius=18, width=2)
            ctext(d, (x + w // 2, y + 56), o, 16, True if on else False, VIOLET if on else INK)
            x += w + 12
        y += 100

    # 时段
    ctext(d, (60, y + 16), "期望时段", 18, True, INK, anchor="lm")
    for i, o in enumerate(["工作日晚上", "周末上午", "寒暑假"]):
        w = 130
        on = i == 1
        box(d, [60 + i * (w + 10), y + 34, 60 + i * (w + 10) + w, y + 78],
            fill=(253, 236, 234) if on else SOFT,
            outline=(217, 45, 32) if on else LINE, radius=18, width=2)
        ctext(d, (60 + i * (w + 10) + w // 2, y + 56), o, 15, True if on else False,
              (217, 45, 32) if on else INK)
    y += 100

    # 合规拦截提示
    box(d, [54, y, W - 54, y + 132], fill=(253, 236, 234), outline=(240, 170, 164), radius=12, width=3)
    ctext(d, (78, y + 28), "⚠ 触发双减政策红线", 20, True, (217, 45, 32), anchor="lm")
    for i, ln in enumerate(["学科类不得在周末 / 法定节假日 /", "寒暑假开展培训，请改到工作日。"]):
        ctext(d, (78, y + 60 + i * 26), ln, 16, False, (150, 30, 24), anchor="lm")
    y += 152

    # 按钮（已置灰）
    box(d, [54, y, W - 54, y + 84], fill=(238, 239, 243), outline=(226, 228, 234), radius=42, width=2)
    ctext(d, (W // 2, y + 42), "请先修改为合规时段", 20, True, (150, 154, 164))
    ctext(d, (W // 2, y + 116), "提交按钮随输入实时改写，无「继续」入口", 15, False, GREY)
    return save(img, "fig3_publish.png")


# ---- 图 4 接单池（筛选 + 卡片） ----
def fig_pool():
    img, d, W, H = phone("接单池", "共 6 条 · 点击卡片查看详情与报名")
    y = 200
    # 筛选栏
    d.rectangle([30, y, W - 30, y + 76], fill=BG)
    for i, t in enumerate(["学科", "年级", "价格", "时间"]):
        cx = 30 + (W - 60) * (i + 0.5) / 4
        on = i == 0
        ctext(d, (cx, y + 38), t + " ▾", 18, True if on else False, VIOLET if on else INK)
    d.line([(30, y + 76), (W - 30, y + 76)], fill=(232, 234, 240), width=2)
    y += 92

    # 卡片 1
    box(d, [54, y, W - 54, y + 396], fill=BG, outline=(230, 232, 240), radius=16, width=2)
    # 角标
    box(d, [W - 250, y, W - 54, y + 44], fill=VIOLET, outline=VIOLET, radius=0, width=0)
    ctext(d, (W - 152, y + 22), "招募中", 17, True, (255, 255, 255))
    ctext(d, (80, y + 44), "初二·数学", 30, True, INK, anchor="lm")
    box(d, [80, y + 74, 176, y + 106], fill=(238, 241, 255), outline=(220, 225, 250), radius=6, width=1)
    ctext(d, (128, y + 90), "学科类", 15, False, (75, 63, 191))
    # 胶囊
    for i, t in enumerate(["线下上门", "工作日晚上", "长期稳定"]):
        w = 30 + len(t) * 16
        box(d, [80 + i * (w + 10), y + 122, 80 + i * (w + 10) + w, y + 160],
            fill=SOFT, outline=(232, 234, 240), radius=20, width=1)
        ctext(d, (80 + i * (w + 10) + w // 2, y + 141), t, 14, False, (74, 78, 89))
    # 匹配度区块
    box(d, [80, y + 186, W - 80, y + 300], fill=SOFT, outline=(236, 238, 244), radius=10, width=1)
    ctext(d, (100, y + 214), "匹配度 88.4 分", 21, True, INK, anchor="lm")
    ctext(d, (100, y + 250), "需求 88.4 分 · 3.2km · 课时费 130 元", 15, False, GREY, anchor="lm")
    ctext(d, (100, y + 278), "在预算内", 14, False, GREEN, anchor="lm")
    # 底部
    d.line([(80, y + 320), (W - 80, y + 320)], fill=(240, 241, 246), width=2)
    ctext(d, (80, y + 346), "昨天 16:47", 15, False, GREY, anchor="lm")
    ctext(d, (80, y + 372), "1人已申请 · 37次浏览", 14, False, (176, 180, 190), anchor="lm")
    ctext(d, (W - 80, y + 360), "查看详情 ›", 15, False, (176, 180, 190), anchor="rm")

    # 卡片 2（部分）
    y2 = y + 420
    box(d, [54, y2, W - 54, y2 + 210], fill=BG, outline=(230, 232, 240), radius=16, width=2)
    box(d, [W - 250, y2, W - 54, y2 + 44], fill=VIOLET, outline=VIOLET, radius=0, width=0)
    ctext(d, (W - 152, y2 + 22), "沟通中", 17, True, (255, 255, 255))
    ctext(d, (80, y2 + 44), "初三·数学", 26, True, INK, anchor="lm")
    box(d, [80, y2 + 72, 300, y2 + 108], fill=(246, 247, 250), outline=(236, 238, 244), radius=6, width=1)
    ctext(d, (98, y2 + 90), "已报名，等待家长确认", 14, False, (107, 111, 122), anchor="lm")
    ctext(d, (80, y2 + 140), "匹配度 81.2 分 · 6.8km", 16, False, GREY, anchor="lm")
    return save(img, "fig4_pool.png")


# ---- 图 5 需求详情（申请列表） ----
def fig_detail():
    img, d, W, H = phone("需求详情", "初二·数学　140 元/小时")
    y = 206
    box(d, [54, y, W - 54, y + 168], fill=SOFT, outline=(232, 234, 240), radius=12, width=2)
    items = [("辅导科目", "数学（学科类）"), ("年级", "初二"), ("时段", "工作日晚上 19:00-21:00"), ("地址", "海淀区西三环北路")]
    for i, (k, v) in enumerate(items):
        ctext(d, (78, y + 28 + i * 36), k, 15, False, GREY, anchor="lm")
        ctext(d, (176, y + 28 + i * 36), v, 15, True, INK, anchor="lm")
    y += 190

    ctext(d, (60, y), "申请接单的学生（3）", 20, True, INK, anchor="lm")
    y += 28
    people = [("林", "林嘉怡", "XX大学 · 数学与应用数学", "三重认证", "已确认，等待您确认", True),
              ("陈", "陈知远", "XX大学 · 汉语言文学", "双重认证", "", False),
              ("苏", "苏雨萌", "XX大学 · 学前教育", "双重认证", "", False)]
    for i, (av, name, school, cert, hint, confirmed) in enumerate(people):
        yy = y + i * 176
        box(d, [54, yy, W - 54, yy + 160], fill=BG, outline=(232, 234, 240), radius=12, width=2)
        d.ellipse([76, yy + 22, 148, yy + 94], fill=(255, 178, 122) if i == 0 else (167, 139, 250))
        ctext(d, (112, yy + 58), av, 24, True, (255, 255, 255))
        ctext(d, (166, yy + 40), name, 20, True, INK, anchor="lm")
        box(d, [166 + len(name) * 21, yy + 26, 166 + len(name) * 21 + 92, yy + 56],
            fill=GREEN_SOFT, outline=(190, 228, 210), radius=12, width=1)
        ctext(d, (166 + len(name) * 21 + 46, yy + 41), cert, 13, False, GREEN)
        ctext(d, (166, yy + 74), school, 14, False, GREY, anchor="lm")
        if hint:
            box(d, [76, yy + 96, W - 76, yy + 126], fill=VIOLET_SOFT, outline=(212, 202, 255), radius=8, width=1)
            ctext(d, (88, yy + 111), hint, 13, True, VIOLET, anchor="lm")
        box(d, [W - 190, yy + 108, W - 76, yy + 146], fill=INK, outline=INK, radius=19, width=0)
        ctext(d, (W - 133, yy + 127), "发消息", 15, True, (255, 255, 255))

    # 底部操作条
    d.rectangle([30, H - 128, W - 30, H - 20], fill=BG)
    d.line([(30, H - 128), (W - 30, H - 128)], fill=(232, 234, 240), width=2)
    box(d, [54, H - 108, W - 230, H - 40], fill=SOFT, outline=(214, 218, 228), radius=34, width=2)
    ctext(d, (54 + (W - 284) // 2, H - 74), "长按报名", 19, True, INK)
    ctext(d, (W - 142, H - 74), "生成报告", 16, False, GREY)
    return save(img, "fig5_detail.png")


# ---- 图 6 聊天室（协商 + 双向确认） ----
def fig_chat():
    img, d, W, H = phone("协商中 · 初二数学")
    y = 200
    # 需求摘要卡
    box(d, [54, y, W - 54, y + 92], fill=SOFT, outline=(232, 234, 240), radius=12, width=2)
    ctext(d, (74, y + 30), "初二数学 · ¥140/小时", 18, True, INK, anchor="lm")
    ctext(d, (74, y + 62), "工作日晚上 · 长期稳定", 14, False, GREY, anchor="lm")
    ctext(d, (W - 84, y + 46), "›", 32, False, (176, 180, 190))
    y += 108

    # 确认进度
    d.ellipse([58, y + 4, 74, y + 20], fill=GREEN)
    ctext(d, (84, y + 12), "学生已确认", 14, False, INK, anchor="lm")
    d.ellipse([300, y + 4, 316, y + 20], fill=(216, 219, 228))
    ctext(d, (326, y + 12), "家长待确认", 14, False, GREY, anchor="lm")
    y += 44

    # 消息
    bubbles = [
        ("parent", "您好，请问您带过几届毕业班？", False),
        ("student", "带过两届初三毕业班，2025 年有位学生数学从 82 提到 108。", True),
        ("system", "学生已确认接单，等待家长确认雇佣。", None),
        ("parent", "可以先试课一次看看效果吗？", False),
    ]
    for who, text, mine in bubbles:
        if who == "system":
            box(d, [90, y, W - 90, y + 40], fill=SOFT, outline=SOFT, radius=20, width=0)
            ctext(d, (W // 2, y + 20), text, 12, False, GREY)
            y += 54
            continue
        h = 66 if len(text) < 20 else 96
        if mine:
            box(d, [W - 80 - 380, y, W - 80, y + h], fill=INK, outline=INK, radius=14, width=0)
            for i in range(0, len(text), 16):
                ctext(d, (W - 96, y + 26 + (i // 16) * 26), text[i:i + 16], 14, False, (255, 255, 255), anchor="rm")
        else:
            box(d, [80, y, 80 + 400, y + h], fill=BG, outline=(230, 232, 240), radius=14, width=2)
            for i in range(0, len(text), 16):
                ctext(d, (96, y + 26 + (i // 16) * 26), text[i:i + 16], 14, False, INK, anchor="lm")
        y += h + 16

    # 预设话术
    for i, t in enumerate(["带过几届毕业班？", "可以试课吗？"]):
        w = 20 + len(t) * 15
        box(d, [54 + i * (w + 10), H - 300, 54 + i * (w + 10) + w, H - 262],
            fill=SOFT, outline=(232, 234, 240), radius=18, width=1)
        ctext(d, (54 + i * (w + 10) + w // 2, H - 281), t, 12, False, (92, 96, 107))

    # 输入
    d.rectangle([30, H - 250, W - 30, H - 190], fill=BG)
    box(d, [54, H - 240, W - 170, H - 200], fill=SOFT, outline=(232, 234, 240), radius=20, width=1)
    ctext(d, (72, H - 220), "说说课时、时间…", 14, False, (176, 180, 190), anchor="lm")
    box(d, [W - 150, H - 240, W - 54, H - 200], fill=INK, outline=INK, radius=20, width=0)
    ctext(d, (W - 102, H - 220), "发送", 15, True, (255, 255, 255))

    # 底部确认
    d.rectangle([30, H - 190, W - 30, H - 20], fill=BG)
    d.line([(30, H - 190), (W - 30, H - 190)], fill=(232, 234, 240), width=2)
    box(d, [54, H - 170, W - 54, H - 90], fill=(238, 239, 243), outline=(226, 228, 234), radius=40, width=2)
    ctext(d, (W // 2, H - 130), "已确认接单，等待家长确认", 18, True, (150, 154, 164))
    ctext(d, (W // 2, H - 54), "双方都确认后才置为「已匹配」", 14, False, GREY)
    return save(img, "fig6_chat.png")


names = [fig_arch(), fig_home(), fig_publish(), fig_pool(), fig_detail(), fig_chat()]
for n in names:
    p = os.path.join(OUT, n)
    print("  %-22s %6.1f KB" % (n, os.path.getsize(p) / 1024))
print("输出目录: " + OUT)
