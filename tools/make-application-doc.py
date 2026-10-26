# -*- coding: utf-8 -*-
"""
生成《青拾对接》申报材料正文
严格依据技术稿（docs/.tech-source.txt 导出结果）中的事实，不虚构数据与成果。
"""
import os
from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

OUT = r"D:/2026大挑京师家教/docs/青拾对接-申报材料正文.docx"
FONT = "宋体"
FONT_H = "黑体"
INK = RGBColor(0x00, 0x00, 0x00)
GREY = RGBColor(0x59, 0x59, 0x59)

doc = Document()

# ---------------- 页面与默认样式 ----------------
sec = doc.sections[0]
sec.page_width = Cm(21.0)
sec.page_height = Cm(29.7)
sec.top_margin = Cm(2.54)
sec.bottom_margin = Cm(2.5)
sec.left_margin = Cm(3.0)
sec.right_margin = Cm(2.6)

normal = doc.styles["Normal"]
normal.font.name = FONT
normal.font.size = Pt(12)  # 小四
normal.font.color.rgb = INK
normal._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
normal.paragraph_format.line_spacing = 1.5
normal.paragraph_format.space_after = Pt(0)


def set_run(run, size=None, bold=None, font=None, color=None):
    run.font.name = font or FONT
    run._element.rPr.rFonts.set(qn("w:eastAsia"), font or FONT)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.font.bold = bold
    if color is not None:
        run.font.color.rgb = color
    return run


def body(text, indent=True, size=12, bold=False, align=None, space_before=0, space_after=0):
    """正文段落：首行缩进 2 字符"""
    p = doc.add_paragraph()
    pf = p.paragraph_format
    if indent:
        pf.first_line_indent = Pt(size * 2)
    pf.space_before = Pt(space_before)
    pf.space_after = Pt(space_after)
    if align is not None:
        p.alignment = align
    set_run(p.add_run(text), size=size, bold=bold)
    return p


def heading(text, level=1):
    """标题：一级黑体三号居中，二级黑体四号，三级黑体小四"""
    cfg = {1: (16, True, WD_ALIGN_PARAGRAPH.CENTER, 12, 10),
           2: (14, True, WD_ALIGN_PARAGRAPH.LEFT, 12, 6),
           3: (12, True, WD_ALIGN_PARAGRAPH.LEFT, 8, 4)}
    size, bold, align, sb, sa = cfg[level]
    p = doc.add_paragraph()
    p.alignment = align
    p.paragraph_format.space_before = Pt(sb)
    p.paragraph_format.space_after = Pt(sa)
    p.paragraph_format.keep_with_next = True
    p.paragraph_format.line_spacing = 1.5
    set_run(p.add_run(text), size=size, bold=bold, font=FONT_H)
    return p


def bullet(text, size=12):
    """列表项：用「·」+ 悬挂缩进，避免依赖 Word 自动编号"""
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.left_indent = Pt(size * 2)
    pf.first_line_indent = Pt(-size * 1.0)
    pf.space_after = Pt(2)
    set_run(p.add_run("· " + text), size=size)
    return p


def caption(text, size=10.5):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after = Pt(8)
    set_run(p.add_run(text), size=size, bold=True, font=FONT_H)
    return p


def add_table(headers, rows, widths, size=10.5):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    tblPr = t._tbl.tblPr
    tblW = tblPr.find(qn("w:tblW"))
    if tblW is None:
        tblW = OxmlElement("w:tblW")
        tblPr.append(tblW)
    tblW.set(qn("w:type"), "dxa")
    tblW.set(qn("w:w"), str(int(sum(widths) * 566.929)))
    for i, w in enumerate(widths):
        t.columns[i].width = Cm(w)

    for i, h in enumerate(headers):
        cell = t.rows[0].cells[i]
        cell.text = ""
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(2)
        p.paragraph_format.line_spacing = 1.15
        set_run(p.add_run(h), size=size, bold=True, font=FONT_H)
        tcPr = cell._tc.get_or_add_tcPr()
        shd = OxmlElement("w:shd")
        shd.set(qn("w:val"), "clear")
        shd.set(qn("w:color"), "auto")
        shd.set(qn("w:fill"), "F2F4F8")
        tcPr.append(shd)

    for row in rows:
        cells = t.add_row().cells
        for i, val in enumerate(row):
            cells[i].text = ""
            p = cells[i].paragraphs[0]
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.line_spacing = 1.15
            if i == 0:
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            set_run(p.add_run(str(val)), size=size)

    for r in t.rows:
        for i, w in enumerate(widths):
            r.cells[i].width = Cm(w)
    return t


# ============================================================
# 标题
# ============================================================
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_after = Pt(4)
set_run(p.add_run("“挑战杯”大学生课外学术科技作品竞赛"), size=14, bold=True, font=FONT_H)

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_after = Pt(6)
set_run(p.add_run("申报材料正文"), size=14, bold=True, font=FONT_H)

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_after = Pt(16)
set_run(p.add_run("青拾对接（微信小程序）"), size=15, bold=True, font=FONT_H)

# ============================================================
heading("一、作品简介", 1)
body(
    "《青拾对接》是一款面向高校学生家教兼职与家长家教招聘场景的微信小程序。"
    "作品针对当前家教市场长期存在的“三无序”问题——资质无从核验、沟通无据可查、履约无凭可依，"
    "以“可信对接”为设计主线，构建了覆盖“认证—发布—匹配—撮合—履约—评价”的全链路闭环。"
)
body(
    "作品已完成可运行的微信小程序原型：共 13 个页面、8 个自研组件、4 个服务模块、8 个云函数与 9 个数据集合，"
    "在不引入任何第三方组件库、不依赖 npm 构建的前提下，导入微信开发者工具即可运行。"
    "技术上形成了三项具有独立价值的设计："
    "一是“七维可解释加权匹配引擎”，每一个推荐分数都同时产出一句用户能读懂的说明，且分值与解释同源；"
    "二是“双引擎内容风控”，将“双减”政策从关键词查表升级为“科目属性 × 时间属性 × 学段属性”三维规则推理，"
    "并按“硬拦截 / 强提示 / 仅提示”三级分层处置；"
    "三是“双向确认撮合状态机”，以双方共识而非单方抢占作为成单条件，从机制上消除“一个需求被多次占用”与“一对多悬空”两类冲突。"
)
body(
    "在工程科学性方面，作品的匹配权重、风控规则、状态流转均为代码中的具名常量，"
    "并配有可执行的自动化验证脚本，其中前后端双减规则的 8 组用例比对要求差异必须为 0；"
    "6 位学生的逐维度评分明细与复算命令已写入数据字典文档，任何第三方可独立复算推荐结果。"
    "作品同时如实标注了当前边界（匹配为子串级关键词匹配而非语义匹配、内容风控尚未覆盖评价与打卡小结等自由文本链路），"
    "并给出了明确的后续迭代路径。"
)

# ============================================================
heading("二、目的与思路", 1)

heading("（一）立项背景与现实需求", 2)
body(
    "家教是大学生最主要的勤工助学渠道之一，也是家长改善子女学业的重要选择。但这一市场长期呈现高度分散、缺乏中介规范的状态，"
    "供需双方都处于信息劣势。项目组在需求分析阶段归纳出四个真实痛点："
)
bullet("学生端“怕被骗”。押金、保证金、服装费、体检费、培训贷等收费陷阱在兼职市场屡见不鲜，学生往往缺乏识别经验。")
bullet("家长端“怕不靠谱”。家长难以核验家教的真实身份、学校、专业与教学能力，也无法判断对方是否具备带相应学段学生的经验。")
bullet("撮合端“怕扯皮”。口头约定的课时、价格、时间缺乏书面凭据，一旦发生纠纷，双方各执一词，无从追溯。")
bullet("合规端“怕踩线”。“双减”政策对学科类培训的时间、学段有明确限制，而非专业运营者的家长与学生并不熟悉政策边界，容易在无意识中发布或承接违规需求。")
body(
    "针对上述痛点，作品的立项目的可以概括为：在不改变家教“个人零星撮合”性质、不触碰资金与办学资质红线的前提下，"
    "用技术手段把“可信”这一抽象目标拆解为可工程化实现的四件事——身份可核验、规则可执行、过程可追溯、结果可解释。"
)

heading("（二）总体设计思路", 2)
body(
    "作品采用“前端表现层 → 服务编排层 → 云函数/数据层”的三段式架构，并在中间设置一道强制收敛点："
    "全部 13 个页面与 8 个组件只能通过统一的服务网关访问数据，禁止页面直接读写本地存储或直接调用云开发接口。"
    "这一约束并非注释约定，而是由工程校验脚本中的“架构约束”自检项强制执行，使“数据从哪来”在全项目内只有一个答案，"
    "避免了小程序项目中常见的多数据源分裂问题。"
)
body(
    "在业务主线上，作品将家教对接拆解为六个阶段，每个阶段都对应一套可验证的技术机制："
)
add_table(
    ["阶段", "用户动作", "技术机制", "解决的痛点"],
    [
        ["认证", "学生提交学籍/资质/能力材料", "三重认证 + 认证编号可核验 + 仓储层脱敏", "家长无法核验身份"],
        ["发布", "家长填写需求并提交", "双减结构化规则 + 风险词双引擎，三级处置", "无意发布违规需求"],
        ["匹配", "家长查看推荐结果", "七维可加权打分，逐维产出可读说明", "推荐不可解释"],
        ["撮合", "双方沟通后分别确认", "双向确认状态机，共识达成才成单", "抢占与扯皮"],
        ["履约", "上课打卡 + 课后小结", "四态状态机，幂等打卡，小结字数双向校验", "过程无凭据"],
        ["评价", "双方盲评", "信息隔离不变量，揭晓权唯一在服务端", "评价互相影响"],
    ],
    [2.2, 3.6, 6.2, 3.4],
    size=10,
)
caption("表 1  家教对接六阶段与对应技术机制")

heading("（三）技术路线选择的三条原则", 2)
body(
    "第一，规则优先于模型。家教撮合的核心判断（科目是否对口、学段是否匹配、时间能否排开、价格是否合适）本身是强规则的，"
    "用可复算的加权规则比用黑箱模型更适合这一场景，也更符合竞赛作品对“可验证性”的要求。"
    "因此作品的匹配引擎与报告生成均为纯规则引擎，不接入大模型，报告摘要由模板拼接而非模型生成。"
)
body(
    "第二，宁可显式失败，也不静默降级。作品设计了云开发与本地两套数据模式，通过一个编译期开关切换。"
    "当处于云模式而某些接口尚未接线时，代码选择直接返回明确的“暂未实现”错误，而不是悄悄回落到本地数据。"
    "这样做的理由写在代码注释中：会造成“云端需求 + 本地打卡”的静默数据错乱，比直接报错更难排查。"
)
body(
    "第三，把合规声明变成基础设施。作品将“本平台仅为个人零星家教信息撮合，非培训机构，不提供固定办学场所”这一平台性质声明"
    "封装为全局注册的组件，被 12 个页面复用，并提供紧凑、完整、内联三种呈现形态。"
    "由此，“是否在办培训机构”这一合规风险从单个页面的文案问题，变成了全域生效的基础设施。"
)

# ============================================================
heading("三、创新点", 1)
body(
    "作品的创新可归纳为“一个撮合范式、两项规则引擎、三处工程治理”。以下分别说明，并给出对应的技术依据。"
)

heading("（一）撮合范式创新：以“共识”替代“抢占”", 2)
body(
    "常规家教平台的做法是家长一键选定或先到先得。这两种做法存在一个共同缺陷：在“一个需求对应多位候选人”的场景下，"
    "只要有一方单方面确认，需求就可能被多次占用，或者出现“多个候选人都在等答复”的悬空状态。"
)
body(
    "作品将撮合落地条件改为双向确认：学生点击“确认接单”只写入自己的确认标记，家长点击“确认雇佣”只写入自己的确认标记，"
    "两个布尔值同时为真时，服务端才在一个原子操作中把需求状态置为“已匹配”，并把同一需求下其余全部投递批量置为“已拒绝”，"
    "同时向会话写入系统消息“双方已达成共识，正式匹配成功！”。"
    "代码注释给出的设计依据是：“家长可能同时和多个学生沟通，若学生单方点击就成单，会造成一个需求被多次占用。双向确认是撮合的最小安全集。”"
)
body(
    "与之配套，作品彻底移除了家长端的“一键成单”入口，原接口被显式标注为仅内部使用，并在页面层写明“家长端一键成单入口已彻底删除，页面不得再调用”。"
    "这一处“减法”使撮合路径唯一：所有成单都必须经过沟通与双方确认。"
)

heading("（二）规则引擎创新之一：双减政策从“查表”到“推理”", 2)
body(
    "常规做法是在敏感词库中加入“周末补课”“节假日补课”等词条。这种做法有两个明显漏洞：一是用户可以换一种表述绕过；"
    "二是用户如果在下拉框里选择“工作日”、却在备注里写“周六”，纯词库匹配也无法关联到时间属性上。"
)
body(
    "作品将双减政策编码为“科目属性 × 时间属性 × 学段属性”三维特征空间上的两条结构化规则："
    "规则一为“学科类科目 × 休息日/节假日/寒暑假”；规则二为“学龄前/幼小衔接 × 休息日 × 学科类（含全科）”。"
    "其中“休息日”的判定采用双通道或运算：结构化通道检查用户选择的时段是否落入休息日值域，"
    "文本通道扫描备注中的 11 个休息日关键词（周末、周六、周日、双休、节假日、法定节假日、寒暑假、寒假、暑假、假期、小长假），"
    "任一命中即判为休息日。代码注释说明了这一设计的意图：“防止用户绕过下拉框，例如选了工作日但备注写周末。”"
)
body(
    "更深一层的“防绕过”放在服务端：服务端不信任客户端对科目属性的声明，当科目字典判定为学科类时，"
    "即使家长显式选择了“非学科类”，仍强制按学科类处理（注释标注“宁严勿宽”）。"
    "这一处理把防绕过从交互层下沉到了数据处理层。"
)
body(
    "规则推理的另一收益是可解释。命中时系统生成最多四类中文证据（学科类科目、学龄前学段、休息日时段、文本命中时段词），"
    "前端逐条编号展示，使家长能明白“为什么被拦”，而不是收到一句笼统的“内容违规”。"
)

heading("（三）规则引擎创新之二：风控处置的三级分层", 2)
body(
    "常规风控是“命中即拦”或“提示即放行”的二选一。作品建立了三级分层，核心是把“政策红线”与“商业风险提示”在协议层面彻底分开："
)
add_table(
    ["命中类型", "返回码", "是否写库", "用户可否放行", "设计意图"],
    [
        ["双减政策红线", "code 3", "否", "不可", "硬拦截分支不读取“我已知晓”参数，前端弹窗不提供“继续”按钮"],
        ["风险词（高危）", "code 2", "未确认时不写", "可，需显式二次确认", "知情后可继续，提示保留在详情与报告中"],
        ["风险词（中危）", "code 0", "是", "无需确认，仅提示", "避免过度打扰，保留信息透明"],
    ],
    [2.8, 1.8, 2.4, 3.0, 5.4],
    size=10,
)
caption("表 2  风险处置的三级分层")

body(
    "这一分层的关键在于：政策红线在协议层就不接受用户确认，服务端在该分支根本不读取“已确认风险”字段，"
    "因此前端无论怎样传参都无法放行；而商业风险允许用户在知情后继续，体现“提示而不代替决策”的原则。"
)

heading("（四）工程治理创新之一：状态一致性的单一事实源", 2)
body(
    "小程序开发中一类高发缺陷是“同一份状态在多处各自计算”。作品在三处做了收敛，每一处都对应一个真实修复过的缺陷："
)
bullet("角色状态的收敛：以全局唯一字段作为角色事实源，所有角色变更必须经过唯一入口（同时更新内存、写缓存、同步用户信息、通知订阅者），越权访问由统一守卫函数拦截。对应修复的缺陷是“首页已切换为家长、但接单池仍按学生身份渲染”。")
bullet("跨页报名状态的收敛：把“我是否已报名”从各页重算改为全局唯一缓存，写操作全部幂等，并提供以服务端为准的校正函数。对应修复的缺陷是“列表页已报名、详情页仍显示长按报名”。")
bullet("数据访问的收敛：全部页面只能经由统一服务网关访问数据，由工程校验脚本强制执行。")
body(
    "三处收敛共同构成“状态不分裂”的系统性保障。作品认为，对中小规模应用而言，约定式架构配合自动化校验，"
    "其投入产出比优于引入重量级状态管理框架。"
)

heading("（五）工程治理创新之二：词库治理的工程化链路", 2)
body(
    "风控词库在工程中天然存在多份副本（前端即时提示用、服务端裁决用、数据库管理用）。副本不同步是这类系统的典型隐患。"
    "作品为词库建立了一条完整的工程管线：一个权威源，两份差异可验证的副本，一套跨端一致性自动回归（三份服务端词库副本 × 8 组双减用例逐一比对，差异必须为 0），"
    "一个三方比对脚本（输出前端/服务端/数据库三份词库的差集），以及一份由脚本自动生成的词库说明文档。"
    "由此，风控词库不是一张静态的表，而是一条有版本、有校验、有文档产出的工程链路。"
)

heading("（六）交互创新：自研长按环形确认", 2)
body(
    "在撮合场景中，“报名”是一个应当郑重对待的动作。作品要求用户按住若干秒才能完成报名，但微信原生 longpress 事件的触发阈值固定约 350 毫秒，"
    "且没有参数可以配置为 2 秒。为此作品自研了长按确认组件：以触摸事件自行计时，用锥形渐变绘制环形进度，"
    "进度更新节流至 40 毫秒，手指移动超过 10 像素即判定取消（避免用户想滚动列表时误报名），并以一次轻微振动作为触感反馈。"
)
body(
    "该组件在实现过程中沉淀了四条可复用的工程经验，并写入了代码注释：按钮宽度必须固定（否则文案切换会撑动整行）；"
    "不做缩放变换（哪怕 0.985，配合列表重绘也会被感知为“抖”）；环形进度不能加过渡动画（锥形渐变不可插值，过渡会让环每帧闪烁）；"
    "进度更新必须节流。这四条经验对同类小程序交互开发具有参考价值。"
)

# ============================================================
heading("四、应用前景", 1)

heading("（一）可直接复用的应用场景", 2)
body(
    "作品的核心不是“家教”这一具体品类，而是“互不认识的双方如何在缺乏信任基础的前提下完成一次有约束的撮合”。这一命题广泛存在于校园与社区服务中，"
    "作品的四项核心机制具有明确的迁移价值："
)
add_table(
    ["可复用机制", "迁移场景举例", "迁移所需改动"],
    [
        ["三重认证与认证编号可核验", "校园跑腿、实验室助研、社区志愿服务", "替换认证类型与核验渠道"],
        ["双减结构化规则引擎", "其他受政策约束的服务撮合（如校外托管、研学）", "替换规则维度与值域"],
        ["双向确认撮合状态机", "二手交易、技能交换、校内组队", "替换确认主体与状态名"],
        ["双向盲评与双向信用分", "任何需要“双方互评”的平台", "替换评价标签体系"],
    ],
    [4.4, 6.0, 4.8],
    size=10,
)
caption("表 3  核心机制的可迁移性")

heading("（二）推广路径设想", 2)
body(
    "从落地角度看，作品具备三点有利条件。其一，载体是微信小程序，用户无需安装、传播成本低，适合在高校与社区内快速铺开。"
    "其二，作品不涉及资金流转、不提供办学场所、不组织培训，"
    "其“个人零星撮合”的定位与现行监管要求相容，推广时的合规解释成本较低。"
    "其三，全部技术为自研、零第三方组件库依赖，代码体积与维护成本可控，便于由学生团队长期迭代。"
)
body(
    "据此，作品设想“三步走”的推广路径：第一步以单所高校为试点，验证认证核验流程与双向确认撮合的可用性；"
    "第二步在同城高校间复制，重点验证多校区、跨区通勤场景下的匹配权重是否需要调整；"
    "第三步向社区与家长侧延伸，探索与中小学家委会、社区服务中心的合作形态。"
)

heading("（三）社会价值", 2)
body(
    "作品的社会价值主要体现在三个方面。对学生而言，可信认证与收费陷阱拦截降低了兼职风险，"
    "响应了保障大学生勤工助学权益的现实关切。对家长而言，可核验的认证与可追溯的履约记录降低了选择成本。"
    "对行业而言，作品把“双减”政策约束前置到需求发布环节，以技术手段辅助政策落地，"
    "“宁严勿宽”的取值取向为同类平台提供了一种可参考的实现思路。"
)

heading("（四）当前局限与后续计划", 2)
body(
    "本作品尚处原型阶段，项目组如实列出主要局限与对应计划，以保证申报材料的可信度："
)
add_table(
    ["当前局限", "影响", "后续计划"],
    [
        ["匹配为子串级关键词匹配，非语义匹配", "对“初中数学”与“初一数学”这类表述差异依赖同义词规则", "引入语义向量召回作为规则打分的补充通道"],
        ["内容风控仅覆盖需求发布链路", "评价、打卡小结、认证材料三条自由文本链路尚未接入", "将双引擎风控抽为通用中间件，接入其余写入链路"],
        ["前后端匹配权重已发生维度漂移", "云端仍为 6 维、前端已为 7 维（新增偏好与性格）", "统一权重权威源，由云端下发权重供前端渲染"],
        ["认证审核为模拟实现", "OCR 识别与真实审核流程尚未接入", "对接真实证件识别与人工审核后台"],
        ["尚未接入单元测试框架与性能度量", "验证依赖脚本式流程驱动与人工比对", "引入测试框架与首屏耗时、包体积的自动化度量"],
    ],
    [5.0, 5.4, 4.8],
    size=10,
)
caption("表 4  当前局限与后续计划")

body(
    "最后需要说明的是，本作品在技术文档中坚持“所有结论均以代码中真实存在的文件、函数、常量、字段为依据”，"
    "凡代码中无法确证的内容一律标注为推断，凡未实现的功能一律如实列出并标注 TODO 位置。"
    "项目组认为，一个学生作品的可信度不仅来自它实现了什么，也来自它敢于说明自己还没有实现什么。"
)

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
p.paragraph_format.space_before = Pt(12)
set_run(p.add_run("（申报材料正文完）"), size=10.5, color=GREY)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
doc.save(OUT)
print("已生成: " + OUT)
print("段落 %d，表格 %d" % (len(doc.paragraphs), len(doc.tables)))
