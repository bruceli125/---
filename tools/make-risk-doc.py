# -*- coding: utf-8 -*-
"""
生成《青拾对接 · 风险词库与内容合规规则》Word 文档
数据来源：cloudfunctions/common/riskWords.js（权威）
         miniprogram/utils/constants.js（小程序副本）
         database/risk_words.json（云数据库种子，JSONL）

生成前必须先产出数据快照（三步都不可省）：
    node tools/export-risk-words.js    # -> tools/.risk-words-full.json
    node tools/compare-risk-words.js   # -> tools/.risk-compare.json
    python tools/make-risk-doc.py      # -> docs/青拾对接-风险词库说明.docx

校验与预览（docx->png 这条路径会横向裁切，务必先转 PDF 再栅格化）：
    python <checker> <docx> --out docs/.checks.json
    <node> <cli> convert --input <docx> --output docs/.preview-pdf/risk.pdf
    <node> <cli> render  --input <pdf> --output-dir docs/.preview-pdf/vN --dpi 120
    python tools/measure-render.py <png...>   # 实测左右留白，确认无溢出
"""
import json
import os
from datetime import date

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

ROOT = r"D:/2026大挑京师家教"
DATA = json.load(open(os.path.join(ROOT, "tools/.risk-words-full.json"), encoding="utf-8"))
CMP = json.load(open(os.path.join(ROOT, "tools/.risk-compare.json"), encoding="utf-8"))
OUT = os.path.join(ROOT, "docs/青拾对接-风险词库说明.docx")

FONT = "微软雅黑"
INK = RGBColor(0x0A, 0x0A, 0x0C)
INK2 = RGBColor(0x5C, 0x5F, 0x6B)
RED = RGBColor(0xD9, 0x2D, 0x20)
AMBER = RGBColor(0xB2, 0x6A, 0x00)
VIOLET = RGBColor(0x6D, 0x4A, 0xFF)

doc = Document()

# ---------- 全局字体与页面 ----------
style = doc.styles["Normal"]
style.font.name = FONT
style.font.size = Pt(10.5)
style.font.color.rgb = INK
style._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
style.paragraph_format.space_after = Pt(4)
style.paragraph_format.line_spacing = 1.4

for sec in doc.sections:
    # A4 纸（python-docx 默认是 Letter，中文公文/说明书应为 A4）
    sec.page_width = Cm(21.0)
    sec.page_height = Cm(29.7)
    sec.top_margin = Cm(2.2)
    sec.bottom_margin = Cm(2.0)
    sec.left_margin = Cm(2.4)
    sec.right_margin = Cm(2.4)


def set_run(run, size=None, bold=None, color=None, font=FONT):
    run.font.name = font
    run._element.rPr.rFonts.set(qn("w:eastAsia"), font)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.font.bold = bold
    if color is not None:
        run.font.color.rgb = color
    return run


def para(text="", size=10.5, bold=False, color=INK, align=None, space_after=4, space_before=0):
    p = doc.add_paragraph()
    if align is not None:
        p.alignment = align
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.space_before = Pt(space_before)
    if text:
        set_run(p.add_run(text), size=size, bold=bold, color=color)
    return p


def heading(text, level=1):
    sizes = {1: 15, 2: 12, 3: 11}
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(16 if level == 1 else 11)
    p.paragraph_format.space_after = Pt(7)
    p.paragraph_format.keep_with_next = True
    set_run(p.add_run(text), size=sizes.get(level, 11), bold=True, color=INK)
    # 一级标题下加一条细线（用底边框模拟）
    if level == 1:
        pPr = p._p.get_or_add_pPr()
        borders = OxmlElement("w:pBdr")
        bottom = OxmlElement("w:bottom")
        bottom.set(qn("w:val"), "single")
        bottom.set(qn("w:sz"), "6")
        bottom.set(qn("w:space"), "4")
        bottom.set(qn("w:color"), "E6E8EF")
        borders.append(bottom)
        pPr.append(borders)
    return p


def shade(cell, hexcolor):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hexcolor)
    tcPr.append(shd)


def cell_text(cell, text, size=9.5, bold=False, color=INK, align=None):
    cell.text = ""
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.line_spacing = 1.15
    if align is not None:
        p.alignment = align
    set_run(p.add_run(text), size=size, bold=bold, color=color)


def cm_to_twips(cm):
    """1 cm = 566.929 twips"""
    return int(round(cm * 566.929))


def make_table(headers, rows, widths, align_map=None, header_fill="F2F4F8", zebra=True, body_size=9.5):
    table = doc.add_table(rows=1, cols=len(headers))
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    # autofit=False 会写入 tblLayout=fixed，切勿再手动 append（重复元素会让 LibreOffice 回退到自适应）
    table.autofit = False

    tblPr = table._tbl.tblPr
    tblW = tblPr.find(qn("w:tblW"))
    if tblW is None:
        tblW = OxmlElement("w:tblW")
        tblPr.append(tblW)
    tblW.set(qn("w:type"), "dxa")
    tblW.set(qn("w:w"), str(cm_to_twips(sum(widths))))

    # fixed 布局按 tblGrid 的列宽渲染 → 必须用 columns[i].width 写 gridCol
    for i, w in enumerate(widths):
        table.columns[i].width = Cm(w)

    hdr = table.rows[0]
    for i, h in enumerate(headers):
        cell_text(hdr.cells[i], h, size=9.5, bold=True, color=INK)
        shade(hdr.cells[i], header_fill)
    # 表头跨页重复
    trPr = hdr._tr.get_or_add_trPr()
    tblHeader = OxmlElement("w:tblHeader")
    tblHeader.set(qn("w:val"), "true")
    trPr.append(tblHeader)

    for r_idx, row in enumerate(rows):
        cells = table.add_row().cells
        # 禁止单行跨页断开（长文案行被切成两页很难读）
        row_trPr = table.rows[-1]._tr.get_or_add_trPr()
        cant_split = OxmlElement("w:cantSplit")
        cant_split.set(qn("w:val"), "true")
        row_trPr.append(cant_split)
        for i, val in enumerate(row):
            is_tuple = isinstance(val, tuple)
            text = val[0] if is_tuple else val
            color = val[1] if is_tuple else INK
            bold = val[2] if is_tuple and len(val) > 2 else False
            a = (align_map or {}).get(i)
            cell_text(cells[i], text, size=body_size, bold=bold, color=color, align=a)
            if zebra and r_idx % 2 == 1:
                shade(cells[i], "FAFAFC")

    # 单元格宽度同步写一遍，兼容只认 tcW 的渲染器
    for row in table.rows:
        for i, w in enumerate(widths):
            row.cells[i].width = Cm(w)
    return table


# ============================ 封面区 ============================
para("青拾对接", size=9, bold=True, color=VIOLET, space_after=2)
para("风险词库与内容合规规则", size=24, bold=True, color=INK, space_after=6)
para(
    "版本 v%s · 生效现状说明 · 生成日期 %s" % (DATA.get("version") or "0.2.0", date.today().isoformat()),
    size=10,
    color=INK2,
    space_after=14,
)

# 概览表
overview = [
    ("生效风险词", "21 条（基础 15 条 + 双减政策 6 条）"),
    ("风险分类", "收费陷阱、人身与证件安全、金融风险、虚假宣传、违法违规、中介风险、双减政策（共 7 类）"),
    ("命中处理", "风险词 → 二次确认（可继续）；双减红线 → 硬拦截（不可继续）"),
    ("判定依据", "需求标题、详细描述、补充要求等文本字段的关键词匹配"),
    ("权威数据源", "cloudfunctions/common/riskWords.js"),
    ("同步副本", "云函数 2 处、小程序 2 处、数据库种子 1 处（见第七章）"),
]
make_table(["项目", "内容"], overview, [3.4, 12.6])

# ============================ 一、概览说明 ============================
heading("一、词库总体情况")
para(
    "风险词库是本平台内容风控的第一道闸门：家长发布需求、学生填写介绍时，系统会实时扫描文本并给出分级提示。"
    "词库分为两类，处理方式完全不同——"
)
para("① 基础风险词（15 条）：针对诈骗、收费、证件、贷款、虚假宣传等典型套路，命中后弹出风险确认弹窗，用户确认无误可继续发布，但提示会保留在需求详情与对接报告中。", size=10)
para("② 双减政策风险词（6 条）：针对学科类培训的休息日违规，命中后直接硬拦截，弹窗不提供「继续」按钮，从源头阻断违规需求发布。", size=10)

# ============================ 二、风险词清单 ============================
doc.add_page_break()
heading("二、风险词清单")

heading("2.1 基础风险词（15 条）", 2)
rows = []
for i, w in enumerate(DATA["baseWords"], start=1):
    rows.append(
        [
            str(i),
            (w["word"], INK, True),
            w["category"],
            ("高风险" if w["level"] == "high" else "中风险", RED if w["level"] == "high" else AMBER),
            w["tip"],
        ]
    )
make_table(
    ["序号", "风险词", "分类", "等级", "命中提示文案"],
    rows,
    [1.35, 2.25, 2.75, 1.45, 8.2],
    align_map={0: WD_ALIGN_PARAGRAPH.CENTER, 3: WD_ALIGN_PARAGRAPH.CENTER},
    body_size=9,
)

heading("2.2 双减政策风险词（6 条）", 2)
rows = []
for i, w in enumerate(DATA["policyWords"], start=1):
    rows.append(
        [
            str(i),
            (w["word"], INK, True),
            w["category"],
            ("高风险", RED),
            w["tip"],
        ]
    )
make_table(
    ["序号", "风险词", "分类", "等级", "命中提示文案"],
    rows,
    [1.35, 2.25, 2.75, 1.45, 8.2],
    align_map={0: WD_ALIGN_PARAGRAPH.CENTER, 3: WD_ALIGN_PARAGRAPH.CENTER},
)

# ============================ 三、等级与处置 ============================
heading("三、风险等级与处置方式")
para("等级决定界面配色与文案，处置方式决定用户能否绕过。二者相互独立，不能混用。")
theme = DATA["riskLevelTheme"]
rows = []
for key in ["high", "medium", "low"]:
    t = theme[key]
    rows.append(
        [
            (t["text"], RED if key == "high" else AMBER if key == "medium" else INK, True),
            t["color"],
            t["desc"],
        ]
    )
make_table(["等级", "主题色", "界面说明文案"], rows, [2.2, 2.6, 11.2])

para("")
rows = [
    [("风险词命中", INK, True), "二次确认（code 2）", "弹出风险提示弹窗，用户确认后仍可继续；提示保留在需求详情页与对接报告中"],
    [("双减红线", RED, True), "硬拦截（code 3）", "弹出政策提示弹窗，不提供「继续」按钮，需求无法发布"],
    [("接口异常", INK, True), "报错（code -1）", "网络或服务异常，提示稍后重试"],
    [("参数问题", INK, True), "提示（code 1）", "必填项缺失或格式不合规"],
]
make_table(["触发类型", "处理码", "用户可见行为"], rows, [3.0, 3.4, 9.6])

# ============================ 四、双减规则 ============================
heading("四、双减合规规则（二期红线）")
para("除单一风险词匹配外，系统还对「时段 × 科目 × 学段」三个维度做组合判定，避免用词规避（例如不提「周末补课」但把时段选成周末上午）。")

heading("4.1 触发条件", 2)
rows = [
    [("规则 A", INK, True), "学科类科目", "休息日时段", "—", "命中即硬拦截"],
    [("规则 B", RED, True), "学科类科目（含「全科」）", "休息日时段", "学龄前 / 幼小衔接 / 学前班", "命中即硬拦截"],
]
make_table(["规则", "科目维度", "时段维度", "学段维度", "结果"], rows, [2.0, 4.4, 2.8, 4.2, 2.6])

heading("4.2 判定维度枚举", 2)
rows = [
    ["学科类科目", "、".join(DATA["disciplineSubjects"])],
    ["素质类科目（放行）", "、".join(DATA["qualitySubjects"])],
    ["休息日时段", "周末上午、周末下午、周末晚上、寒暑假全天（法定节假日同属此列）"],
    ["非休息日时段（放行）", "工作日晚上、工作日下午"],
    ["学龄前年级", "、".join(DATA["earlyChildhoodGrades"])],
    ["文本兜底关键词", "、".join(DATA["restDayKeywords"])],
]
make_table(["维度", "取值"], rows, [4.0, 12.0])

heading("4.3 拦截文案（用户实际看到的）", 2)
policy = DATA["policy"]
p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(6)
set_run(p.add_run(policy["title"]), size=11, bold=True, color=RED)
p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(6)
set_run(p.add_run(policy["message"]), size=10.5, bold=True, color=INK)
para("附带说明（弹窗内逐条展示）：", size=10, color=INK2)
for tip in policy["tips"]:
    pp = doc.add_paragraph(style="List Bullet")
    pp.paragraph_format.space_after = Pt(2)
    set_run(pp.add_run(tip), size=10)

# ============================ 五、平台性质 ============================
heading("五、平台性质声明")
pos = DATA.get("platformPosition") or {}
if isinstance(pos, dict):
    text = pos.get("text") or pos.get("full") or json.dumps(pos, ensure_ascii=False)
else:
    text = str(pos)
para("以下声明在全部页面展示，并写入每一份对接报告的结尾：", size=10, color=INK2)
pp = doc.add_paragraph()
pp.paragraph_format.left_indent = Cm(0.6)
pp.paragraph_format.space_after = Pt(6)
set_run(pp.add_run("「%s」" % text), size=10.5, bold=True, color=INK)

# ============================ 六、通用提示 ============================
heading("六、通用安全提示文案（无论是否命中风险词均展示）")
for tip in DATA["commonTips"]:
    pp = doc.add_paragraph(style="List Number")
    pp.paragraph_format.space_after = Pt(2)
    set_run(pp.add_run(tip), size=10)

# ============================ 七、数据一致性 ============================
heading("七、数据一致性核查（重要）")
para(
    "词库在工程中有 6 处副本。本次核查发现：数据库种子比代码多出 5 条，这 5 条当前不会生效——"
    "因为匹配依据是代码里的词数组，数据库表仅作为内容管理用途，尚未接入运行时。",
    size=10,
)
rows = [
    ["cloudfunctions/common/riskWords.js", "21 条", ("生效", INK, True), "权威源，改词库改这里"],
    ["cloudfunctions/riskCheck/riskWords.js", "21 条", ("生效", INK, True), "云函数独立打包所需副本"],
    ["cloudfunctions/submitDemand/riskWords.js", "21 条", ("生效", INK, True), "云函数独立打包所需副本"],
    ["miniprogram/utils/constants.js", "15 条", ("生效", INK, True), "小程序前端提示文案与等级配色"],
    ["miniprogram/services/risk.js", "15 条 + 规则", ("生效", INK, True), "前端预检，与云函数规则对齐"],
    ["database/risk_words.json", "26 条", ("部分生效", AMBER, True), "多出 5 条，未接入运行时"],
]
make_table(["文件位置", "条数", "状态", "说明"], rows, [7.0, 2.0, 2.4, 4.6])

para("")
para("多出的 5 条（建议二选一：补进代码词库使其生效，或从种子数据中删除以免误导）：", size=10, color=INK2, space_before=6)
only_db = CMP.get("onlyDb") or []
rows = []
db_map = {r["word"]: r for r in CMP.get("dbList", [])}
for w in only_db:
    r = db_map.get(w, {})
    rows.append([(w, INK, True), r.get("category", ""), r.get("tip", "")])
make_table(["风险词", "分类", "已写入的提示文案（当前不生效）"], rows, [3.2, 3.4, 9.4])

# ============================ 八、维护须知 ============================
heading("八、维护须知")
para("修改风险词或双减规则时，必须同步以下 6 处，否则会出现「云端拦截、前端不提示」或「前端提示、云端放行」的不一致：", size=10)
for i, f in enumerate(
    [
        "cloudfunctions/common/riskWords.js（权威源）",
        "cloudfunctions/riskCheck/riskWords.js",
        "cloudfunctions/submitDemand/riskWords.js",
        "miniprogram/utils/constants.js",
        "miniprogram/services/risk.js",
        "database/risk_words.json",
    ],
    start=1,
):
    # 不用 List Number：Word 的自动编号会延续上一处列表（第六章已用掉 1~5），这里显式编号更可控
    pp = doc.add_paragraph()
    pp.paragraph_format.left_indent = Cm(1.0)
    pp.paragraph_format.first_line_indent = Cm(-0.5)
    pp.paragraph_format.space_after = Pt(2)
    set_run(pp.add_run("%d. %s" % (i, f)), size=10)

para("")
para("改完请执行以下自检，确保规则仍然对齐：", size=10, color=INK2)
for cmd in ["node tools/validate-project.js", "node tools/verify-flows.js", "node tools/compare-risk-words.js"]:
    pp = doc.add_paragraph()
    pp.paragraph_format.left_indent = Cm(0.6)
    pp.paragraph_format.space_after = Pt(2)
    set_run(pp.add_run(cmd), size=9.5, font="Consolas", color=VIOLET)

para("")
para(
    "本文档由 tools/make-risk-doc.py 依据代码自动生成，词库有变更时请重新生成，不要手工编辑本文档。",
    size=9,
    color=INK2,
    space_before=10,
)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
doc.save(OUT)
print("已生成: " + OUT)
print("段落数: %d，表格数: %d" % (len(doc.paragraphs), len(doc.tables)))
