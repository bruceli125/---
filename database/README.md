# 京师家教可信对接平台 · 云数据库集合设计与初始化数据

> 本目录是微信云开发（云数据库）的**初始化种子数据**，与 `miniprogram/mock/*.js` 完全对齐。
> 目标：把 `utils/constants.js` 里的 `APP_INFO.useCloud` 改成 `true` 并导入本目录数据后，页面无需改一行代码即可无缝切换到云端数据。

---

## 一、集合清单

| 集合 | 用途（一句话） | 记录数 | 权限建议 |
| --- | --- | --- | --- |
| `users` | 用户账号（家长 / 师范生角色、脱敏联系方式） | 2 | 仅创建者可读写 |
| `tutors` | 师范生档案（学科、学段、价格、信用分、认证等级、徽章编号） | 6 | 所有用户可读，仅创建者可写 |
| `certifications` | 三重认证记录（学籍 / 资质 / 能力）与 mock OCR 结果 | 15 | 仅创建者可读写 |
| `demands` | 家长发布的家教需求（含风险等级、命中词、双减科目分组） | 7 | 仅创建者可读写（接单池由云函数代读） |
| `matches` | 智能匹配结果（score / reasons / rank） | 3 | 仅创建者可读写 |
| `reports` | 对接报告（需求快照 + Top3 + 风险提示 + 免责声明） | 1 | 仅创建者可读写 |
| `checkins` | **二期**：履约打卡与课后小结（一次上课一条，含 mock 定位） | 2 | 仅创建者可读写（家长确认由云函数代写） |
| `reviews` | **二期**：双向盲评（家长/老师各一条，双方都评后揭晓） | 1 | 仅创建者可读写（盲评可见性由云函数裁决） |
| `risk_words` | 风险词库（风险过滤规则的唯一数据源） | 26（15 核心 + 6 双减 + 5 扩展） | 所有用户可读，仅创建者可写 |

集合间关系：

```
users(家长) ──parentId──▶ demands ──demandId──▶ matches ──tutorId──▶ tutors ──tutorId──▶ certifications
                                     ├──demandId──▶ reports（快照冗余，保证报告可溯源）
                                     ├──demandId(=orderId)──▶ checkins（履约打卡：一次上课一条）
                                     └──demandId(=orderId)──▶ reviews（双向盲评：两个方向各一条）
risk_words ──▶ 风险过滤（发布需求时命中检测 → demands.riskLevel / demands.riskHits）
demands.subjectGroup + isDiscipline + timeRange ──▶ 双减政策检测（命中即拒绝落库，见「十一」）
```

> **二次开发提示**：`checkins` / `reviews` 都用 `orderId` 关联订单，MVP 阶段 **`orderId === demandId`**（一个需求 = 一个订单），
> 二期支持「一个需求多个订单」时再引入独立 `orders` 集合，届时 `orderId` 指向 `orders._id`，其余字段无需变动。

---

## 二、数据格式说明（决定能否直接导入）

这些 `.json` 文件是 **JSON Lines**，不是标准 JSON 数组：

- **每行一个独立、完整的 JSON 对象**，无外层 `[]`，行间无逗号，UTF-8 编码；
- 文件末尾保留一个换行；
- 每行都可以被 `JSON.parse` 单独解析（可用下面命令自查）。

```powershell
# 逐行解析校验（在项目根目录执行）
node -e "const fs=require('fs');for(const f of fs.readdirSync('database').filter(x=>x.endsWith('.json'))){const ls=fs.readFileSync('database/'+f,'utf8').split('\n').filter(l=>l.trim());ls.forEach((l,i)=>JSON.parse(l));console.log(f,ls.length,'条 OK')}"
```

### 两个通用字段约定

| 字段 | 说明 |
| --- | --- |
| `_id` | 云数据库主键，**自定义字符串**（如 `tutor_001`），与前端 mock 的 `id` 完全一致，保证 `useCloud: true` 时页面按 id 查询不失效 |
| `id` | 业务主键副本，与 `_id` 同值。前端 mock 分支统一用 `id` 读写，云端保留该字段可让两套数据零改动互切 |

### 日期字段

当前全部为**字符串**，格式 `YYYY-MM-DD HH:mm`，与 `miniprogram/mock` 一致，方便直接展示。

如需导入为云数据库真实日期类型（可用 `db.command` 比较大小），把字符串替换为扩展 JSON 形式即可（云开发导入支持）：

```json
{"createdAt": {"$date": "2026-01-08T19:24:00.000Z"}}
```

> 由于前端 `utils/format.js` 的 `formatDateTime` 同时兼容 `Date` 与字符串，切换后页面展示无需改动。部分记录另有 `createdAtTs`（毫秒时间戳），用于排序，建议保留。

---

## 三、字段表

图例：**🔒 平台内部字段**（不对外展示，仅云函数/管理员读写）、**🫥 已脱敏**（存储层即为脱敏值，不含真实信息）。

### 1. `users`

| 字段 | 类型 | 说明 | 示例 |
| --- | --- | --- | --- |
| `_id` | string | 主键 | `user_demo_parent` |
| `id` | string | 业务主键（同 `_id`） | `user_demo_parent` |
| `openid` | string | 微信 openid（演示值为 mock） 🔒 | `mock-openid-parent-0001` |
| `role` | string | 角色 `parent` / `tutor` | `parent` |
| `nickname` | string | 昵称 | `王女士（演示家长）` |
| `phone` | string | 手机号 🫥 | `138****6621` |
| `parentId` | string | 家长业务 id（师范生为空串） 🔒 | `parent_demo_001` |
| `tutorProfileId` | string | 绑定的师范生档案 id（家长为空串） 🔒 | `tutor_001` |
| `createdAt` | string | 注册时间 | `2026-01-05 09:00` |
| `mock` | boolean | 演示数据标记 🔒 | `true` |

### 2. `tutors`

| 字段 | 类型 | 说明 | 示例 |
| --- | --- | --- | --- |
| `_id` / `id` | string | 主键 | `tutor_001` |
| `userId` | string | 关联 `users.id` 🔒 | `user_demo_tutor_001` |
| `name` | string | 姓名 | `林嘉怡` |
| `gender` | string | `male` / `female` | `female` |
| `school` | string | 学校（MVP 只放开首师大白名单） | `首都师范大学` |
| `major` | string | 专业 | `数学与应用数学（师范）` |
| `grade` | string | 年级 | `大三` |
| `subjects` | array&lt;string&gt; | 可授科目（匹配打分依据） | `["数学","物理"]` |
| `grades` | array&lt;string&gt; | 可授年级 | `["初二","初三","高一"]` |
| `tags` | array&lt;string&gt; | 展示标签 | `["初三数学提分","带过毕业班"]` |
| `abilityTags` | array&lt;string&gt; | 能力认证标签 | `["初三数学提分","带过毕业班"]` |
| `price` | number | 课时费（元/小时） | `130` |
| `priceRange` | array&lt;number&gt; | 报价区间 | `[120,150]` |
| `location` | string | 常驻位置（模糊到街区） | `北京市海淀区西三环北路105号` |
| `district` | string | 城区 code（用于同城/距离打分） | `haidian` |
| `distanceKm` | number | 演示用距离（真实距离需 `wx.getLocation` + 地理计算，二期） | `3.2` |
| `teachModes` | array&lt;string&gt; | 支持的授课方式 | `["offline","online","campus"]` |
| `availableTimes` | array&lt;string&gt; | 可排课时间段 | `["weekend_morning","weekday_evening"]` |
| `creditScore` | number | 平台信用分（0-100） | `92` |
| `certLevel` | number | 认证等级 0/1/2/3 | `3` |
| `certBadgeNo` | string | 认证徽章唯一编号 | `JS-2026-000101` |
| `intro` | string | 自我介绍 | `首师大数学师范专业在读…` |
| `avatar` | string | 头像路径 | `/assets/avatar/tutor-01.png` |
| `avatarText` | string | 无图时的首字占位 | `林` |
| `rating` | number | 评分 | `4.9` |
| `orderCount` | number | 历史接单数 | `46` |
| `verifiedAt` | string | 三重认证通过时间 | `2025-09-12 10:20` |
| `status` | string | `online` / `offline`（offline 不参与匹配） | `online` |
| `phone` | string | 手机号 🫥 | `138****6621` |
| `studentNo` | string | 学号 🫥 | `1202****0918` |
| `email` | string | 校园邮箱 🫥 | `lin****@cnu.edu.cn` |
| `highlights` | array&lt;string&gt; | 亮点短句 | `["两届初三毕业班"]` |

### 3. `certifications`

| 字段 | 类型 | 说明 | 示例 |
| --- | --- | --- | --- |
| `_id` / `id` | string | 主键 | `cert_001` |
| `tutorId` | string | 关联 `tutors.id` | `tutor_001` |
| `type` | string | `student` 学籍 / `qualification` 资质 / `ability` 能力 | `student` |
| `status` | string | `pending` 审核中 / `approved` 已通过 / `rejected` 未通过 | `approved` |
| `files` | array&lt;object&gt; | 材料列表 `{name,url}`（url 为空 = 演示占位，云存储后填真实 fileID） | `[{"name":"教师资格证（mock）.jpg","url":""}]` |
| `ocrResult` | object | mock OCR / 校验结果 `{verified, mock, fields}` 🔒 | `{"verified":true,"fields":{"school":"首都师范大学"}}` |
| `reviewNote` | string | 审核备注 | `校园邮箱 @cnu.edu.cn 校验通过…` |
| `createdAt` | string | 提交时间 | `2025-09-10 09:12` |

> **演示覆盖**：`tutor_001`(3 条 approved，三重认证) / `tutor_002`(3 条) / `tutor_003`(student+qualification) / `tutor_004`(3 条) / `tutor_005`(student+qualification) / `tutor_006`(student approved + qualification **pending**，用于演示「审核中」)。每条记录都与对应 `tutors.certLevel` 自洽。

### 4. `demands`

| 字段 | 类型 | 说明 | 示例 |
| --- | --- | --- | --- |
| `_id` / `id` | string | 主键 | `demo_demand_001` |
| `parentId` | string | 发布家长 | `parent_demo_001` |
| `parentName` | string | 家长称呼 🫥 | `王女士` |
| `contactPhone` | string | 联系方式 🫥 | `138****6621` |
| `subject` | string | 科目 | `数学` |
| `subjectGroup` | string | **二期**：科目分组 `discipline`（学科类）/ `quality`（素质拓展）/ `other` | `discipline` |
| `isDiscipline` | string | **二期**：双减标记，决定是否受休息日限制 | `discipline` |
| `grade` | string | 年级 | `初三` |
| `stage` | string | 学段 code | `junior` |
| `frequency` | string | 频次 code | `twice_week` |
| `timeRange` | array&lt;string&gt; | 时间段（多选） | `["weekday_evening"]` |
| `timeRangeText` | string | 时间段展示文案 | `工作日晚上 19:00-21:00` |
| `address` | string | 授课地点 | `北京市海淀区西三环北路 105 号院 3 号楼` |
| `district` | string | 城区 code | `haidian` |
| `teachMode` | string | `online` / `offline` / `campus` | `offline` |
| `budget` / `budgetMin` / `budgetMax` | number | 预算（元/小时） | `140` / `120` / `140` |
| `specialRequirements` | string | 特殊要求（**风险词与双减时段词检测的主要文本源**） | `孩子初三，函数和几何压轴题…` |
| `riskLevel` | string | `low` / `medium` / `high` | `low` |
| `riskHits` | array&lt;object&gt; | 命中词 `{word,category,level,tip}` | `[{"word":"押金",...}]` |
| `riskAcknowledged` | boolean | 高风险是否已二次确认 🔒 | `true` |
| `policyChecked` | boolean | **二期**：发布时已通过双减检测（恒 `true`，审计用） | `true` |
| `matchedTutorId` | string | **二期**：成单师范生（未成单为 `""`） | `tutor_001` |
| `acceptedAt` | string | **二期**：家长确认成单时间（未成单为 `""`） | `2026-01-03 20:12` |
| `status` | string | `draft`/`published`/`matching`/`matched`/`closed`/`risk_blocked` | `published` |
| `createdAt` | string | 发布时间 | `2026-01-08 19:24` |
| `applyCount` / `viewCount` | number | 申请数 / 浏览数 🔒 | `2` / `37` |
| `deadline` | string | 期望开始日期 | `2026-02-28` |

> **风险演示数据（请勿删除）**：
> - `demo_demand_002`：`riskLevel = medium`，命中「中介费」；
> - `demo_demand_004`：`riskLevel = high`，命中「先交费 / 日入过千 / 押金 / 身份证」，是演示「风险过滤 + 高风险强提示」的关键样本；
> - `demo_demand_007`：`status = closed`（已完成的历史单，用于报告与评价演示）；
> - 其余为 `low`。
>
> **二期合规化（重要）**：7 条种子需求中，**所有学科类需求都已改为工作日时段**（`weekday_evening` / `weekday_afternoon`），
> 否则种子数据本身就违反双减红线（学科类不得在周末、法定节假日、寒暑假开展）。其中：
> - `demo_demand_001` / `003` / `005` / `007` 学科类 → 仅工作日时段；
> - `demo_demand_006`（编程）与 `demo_demand_002`（美术）为**素质拓展类**，可以安排在周末——用于证明"非学科类不受休息日限制"；
> - `demo_demand_005` 为**已成单订单**（`status=matched`、`matchedTutorId=tutor_001`），是履约打卡与双向盲评的演示入口。

### 5. `matches`

| 字段 | 类型 | 说明 | 示例 |
| --- | --- | --- | --- |
| `_id` / `id` | string | 主键 | `match_001` |
| `demandId` | string | 关联需求 | `demo_demand_001` |
| `tutorId` | string | 关联师范生 | `tutor_001` |
| `score` | number | 匹配总分（100 分制） | `99.2` |
| `reasons` | array&lt;string&gt; | 推荐理由（模板生成，二期换 LLM） | `["林嘉怡为首都师范大学…"]` |
| `rank` | number | 名次 1/2/3 | `1` |
| `createdAt` | string | 生成时间 | `2026-01-08 19:26` |

> 打分公式（`services/match.js` 与云函数 `matchTutors` 同规则）：
> 科目 40 + 年级学段 20 + 时间地点 15 + 价格 10 + 信用分 10 + 认证完整度 5。
> 本文件 3 条记录是用**真实规则实算**得出的 Top3（见下方「六、数值来源」）。

### 6. `reports`

| 字段 | 类型 | 说明 | 示例 |
| --- | --- | --- | --- |
| `_id` / `id` | string | 主键 | `report_001` |
| `demandId` | string | 关联需求 | `demo_demand_001` |
| `parentId` / `parentName` | string | 家长维度（列表查询用） | `parent_demo_001` / `王女士` |
| `demand` | object | 需求**快照**（报告可溯源，不受后续修改影响） | `{...}` |
| `topMatches` | array&lt;object&gt; | `[{tutorId,rank,score,reasons,distanceKm,tutor}]`，`tutor` 为档案快照 | `[{...}]` |
| `riskLevel` / `riskHits` | string / array | 风险等级与命中词快照 | `low` / `[]` |
| `riskTips` | array&lt;string&gt; | 避坑提示（通用提示 + 免责声明短句） | `["任何要求先交押金…"]` |
| `summary` | string | 中文摘要，四段以 `\n` 分隔（需求 / 推荐 / 认证 / 风险） | `家长需求：初三数学…` |
| `nextSteps` | array&lt;string&gt; | 下一步建议（含资金担保结算 TODO） | `["在平台内向 1-2 位推荐师范生发起沟通…"]` |
| `disclaimer` | array&lt;string&gt; | 6 条完整免责声明（与 `constants.DISCLAIMER.full` 一致） | `["本平台由高校学生团队运营…"]` |
| `createdAt` | string | 生成时间 | `2026-01-08 19:26` |
| `createdAtTs` | number | 生成时间戳（排序用） 🔒 | `1767871560000` |

### 7. `risk_words`

| 字段 | 类型 | 说明 | 示例 |
| --- | --- | --- | --- |
| `_id` | string | 主键 | `risk_word_002` |
| `word` | string | 风险词（唯一） | `押金` |
| `category` | string | 分类 | `收费陷阱` |
| `level` | string | `high` 典型诈骗特征 / `medium` 收费与资质敏感项 | `high` |
| `tip` | string | 避坑提示文案 | `平台禁止收取押金，遇到请立即停止沟通并举报。` |
| `extended` | boolean | 是否为扩展词（仅扩展词带此字段） | `true` |

**扩展词（5 条，标注 `extended: true`，代码中仍未内置，二期统一从本集合下发）**：

| # | word | category | level |
| --- | --- | --- | --- |
| 16 | 免费培训 | 收费陷阱 | medium |
| 17 | 先上岗后付费 | 收费陷阱 | high |
| 18 | 包就业 | 虚假宣传 | high |
| 19 | 代考 | 违法违规 | high |
| 20 | 刷课 | 违法违规 | medium |

**双减政策词（6 条，二期新增，属正式规则、**不是**扩展词，不带 `extended` 字段）**：

| # | word | category | level | tip 摘要 |
| --- | --- | --- | --- | --- |
| 21 | 周末补课 | 双减政策 | high | 学科类培训不得在周末开展，如需周末安排请改为素质拓展类 |
| 22 | 节假日补课 | 双减政策 | high | 法定节假日禁止开展学科类培训 |
| 23 | 寒暑假补课 | 双减政策 | high | 寒暑假禁止开展学科类培训 |
| 24 | 学科类培训 | 双减政策 | high | 平台仅提供个人零星家教撮合，不组织学科类培训 |
| 25 | 学前班学科培训 | 双减政策 | high | 学龄前儿童不得开展学科类培训 |
| 26 | 超前教学 | 双减政策 | high | 禁止超前超纲教学，按当前学段进度安排 |

> **词库现状（二期，务必区分三者）**：
> 1. 前端 `constants.RISK_WORDS` = **15 条**普适词（用于输入时的即时提示）；
> 2. 云函数 `common/riskWords.js` = **15 + 6 = 21 条**（服务端比前端更严格，多出 6 条双减词做文本兜底）；
> 3. `risk_words` 集合 = **26 条**（再额外含 5 条扩展词，目前仅作为二期「以集合为唯一数据源」的预留数据）。
>
> 这是**有意的防御性设计**：前端只做即时提示，服务端做最终裁决。因此云端可能比前端多命中 6 个双减词，
> 此时 `submitDemand` 会返回 `code 2`（需二次确认）或 `code 3`（政策红线），前端两种分支都已处理。

### 8. `checkins`（二期新增：履约打卡）

| 字段 | 类型 | 说明 | 示例 |
| --- | --- | --- | --- |
| `_id` / `id` | string | 主键 | `checkin_001` |
| `orderId` | string | 订单号；**MVP 阶段复用 `demandId`**（见「十」） | `demo_demand_005` |
| `demandId` | string | 兼容字段，值同 `orderId` | `demo_demand_005` |
| `tutorId` / `tutorName` | string | 打卡师范生 🔒 | `tutor_001` / `林嘉怡` |
| `parentId` | string | 家长（确认方） 🔒 | `parent_demo_001` |
| `status` | string | `checked_in`（进行中）/ `finished`（待家长确认）/ `confirmed`（已确认） | `confirmed` |
| `summaryStatus` | string | 小结状态：`pending` / `confirmed` | `confirmed` |
| `checkinAt` / `startAt` | string | 开始时间。`checkinAt` 为**云端规范字段**，`startAt` 保留以兼容前端读取 | `2026-01-06 19:03` |
| `endAt` | string | 结束时间（`finish` 时写入） | `2026-01-06 20:48` |
| `durationMin` | number | 课时长（分钟，结束时按 `now - startAt` 计算，最小 1） | `105` |
| `location` | object | **mock 定位**（不采集真实位置）`{name,address,latitude,longitude,mock:true}` | `{...,"mock":true}` |
| `summary` | string | 授课小结（**10~500 字**，家长据此确认） | `本次课复习分数的四则运算…` |
| `confirmedAt` | string | 家长确认时间 | `2026-01-06 21:10` |
| `createdAt` / `createdAtTs` | string / number | 创建时间与时间戳（排序用） | `2026-01-06 19:03` / `1767697380000` |

**生命周期状态机**：

```
（无记录）
   │  start（订单 status 必须为 matched，且 tutorId === demand.matchedTutorId）
   ▼
checked_in ──finish（小结 10~500 字）──▶ finished ──confirm（家长确认）──▶ confirmed
   │                                        │
   │ 同一订单重复 start                      │ finish + rewrite:true
   └── 幂等：返回已有记录 + duplicated:true   └── 覆盖小结（status 仍为 finished）

confirmed 为终态：finish / confirm 都会被拒绝
```

> 演示数据：`checkin_001` = 已确认（`confirmed`，课时 105 分钟）；`checkin_002` = 已写小结待家长确认（`finished`）——
> 正好覆盖「可确认」与「已闭环」两种界面状态。

### 9. `reviews`（二期新增：双向盲评）

| 字段 | 类型 | 说明 | 示例 |
| --- | --- | --- | --- |
| `_id` / `id` | string | 主键 | `review_001` |
| `orderId` / `demandId` | string | 订单号（MVP = `demandId`） | `demo_demand_005` |
| `tutorId` | string | 被评/评价师范生 | `tutor_001` |
| `parentId` | string | 家长用户 | `parent_demo_001` |
| `direction` | string | `parent_to_tutor`（家长评老师）/ `tutor_to_parent`（老师评家长） | `parent_to_tutor` |
| `reviewerRole` / `revieweeRole` | string | `parent` / `tutor` | `parent` / `tutor` |
| `reviewerName` / `revieweeName` | string | 展示名 🫥 | `王女士` / `林嘉怡` |
| `rating` | number | 1~5 星 | `5` |
| `tags` | array&lt;string&gt; | 只接受该方向允许的标签（白名单过滤） | `["准时","专业","提分帮助"]` |
| `comment` | string | 评价内容（≤200 字） | `老师每次提前 10 分钟到…` |
| `status` | string | `pending`（对方不可见）/ `revealed`（双方可见） | `pending` |
| `visible` | boolean | **未揭晓恒为 `false`**；揭晓时置 `true` | `false` |
| `creditDelta` | number | 揭晓时结算的信用分变化 | `0`（未揭晓）→ `4.5`（揭晓后） |
| `createdAt` / `createdAtTs` | string / number | 提交时间 | `2026-01-07 09:30` |
| `revealedAt` | string | 揭晓时间（双方都评时写入） | `""` → `2026-01-07 10:12` |

**盲评可见性规则（盲评的核心，务必遵守）**：

| 场景 | `myReview` | `otherReview` | `revealed` | `hasOtherReviewed` |
| --- | --- | --- | --- | --- |
| 双方都未评价 | `null` | `null` | `false` | `false` |
| 我已评价、对方未评 | 我的评价 | `null` | `false` | `false` |
| 对方已评价、我未评价 | `null` | **`null`（内容绝不下发）** | `false` | `true` |
| 双方都已评价 | 我的评价 | 对方的评价 | `true` | `true` |

> 未揭晓时服务端**只**返回 `hasOtherReviewed: true` 与 `otherSubmittedAt`（对方提交时间），
> 评分 / 标签 / 内容一律不返回；揭晓动作只能由云函数 `submitReview` 统一执行，前端无法单方面翻转。

**信用分规则（揭晓时结算，`calcCreditDelta`）**：

| 评分 | 基础变化 | 标签加成 |
| --- | --- | --- |
| 5 星 | **+3** | 每命中 1 个正向标签 **+0.5**，最多计 3 个 |
| 4 星 | **+1.5** | 同上 |
| 3 星 | 0 | 无（评分 <4 星不计标签加分，避免"差评+一堆好评标签"自相矛盾） |
| 2 星 | **-2** | 无 |
| 1 星 | **-4** | 无 |

- 结果夹取到 **[60, 100]**，保留 1 位小数（`clampCredit`）；
- 例：5 星 + 3 个标签 = 3 + 1.5 = **+4.5**；
- 家长评老师 → 写入 `tutors.creditScore`；老师评家长 → 写入 `users.creditScore`（默认 80）。

### 10. 建模取舍：MVP「一个需求 = 一个订单」

二期做履约与评价时，最直接的建模问题是「要不要引入 orders 集合」。本项目的取舍：

| 方案 | 做法 | 代价 |
| --- | --- | --- |
| **MVP 采用** | `orderId` 直接复用 `demandId`，`checkins` / `reviews` 通过 `orderId` 关联需求 | 一个需求只能对应一次成单；同一需求重复找老师需另发需求 |
| 二期演进 | 引入 `orders` 集合（`_id`、`demandId`、`tutorId`、`status`、`acceptedAt`、`settleStatus`），`orderId` 改指 `orders._id` | 需数据迁移：把现有 `orderId` 回填为订单 `_id` |

之所以 MVP 这样简化：真实场景里「一个家长需求 → 确认一位老师 → 上课若干次」是主要路径，
一需求多订单（同时试用 2-3 位老师）属于二期能力。`checkins` 一条记录对应**一次上课**，天然支持「一个订单多次打卡」，
所以这个简化不会阻碍课时统计与履约追溯——**扩展点已经留在 `orderId` 这一层**。

### 11. 双减政策字段与检测链路

新增的 3 个字段是政策合规的基础数据，**不要删**：

| 字段 | 作用 |
| --- | --- |
| `subjectGroup` | `discipline` / `quality` / `other`。接单池按科目分组筛选、"素质拓展"聚合 tab 依赖它 |
| `isDiscipline` | 双减标记：学科类受休息日限制。由云函数按科目字典推导（**宁严勿宽**：科目是学科类时，即使家长选了"非学科"也记为 `discipline`） |
| `policyChecked` | 发布时已通过双减检测，恒为 `true`。用于审计与后续补检（例如政策口径更新后批量复查历史需求） |

检测链路（`cloudfunctions/riskCheck` 的 `policy` 动作与 `submitDemand` 的 create 分支共用同一套规则）：

```
form(demand) ──▶ checkDoubleReduction
                 ├─ 规则 A：学科类 ×（周末/节假日/寒暑假）           → 阻断
                 └─ 规则 B：学龄前/幼小衔接 × 休息日 × 学科类(含全科) → 阻断
                            │
                            ├─ 命中 → submitDemand 返回 code 3（政策红线），**不写库**
                            └─ 未命中 → 继续风险词检测（high 且未确认 → code 2）
                                        └─ 通过 → 写入 demands（policyChecked: true）
```

> 时段判定是「值 + 文本」双重的：即使把 `timeRange` 选成工作日，只要特殊要求里写了"周末补课"，也会被识别
> （`REST_DAY_KEYWORDS` 兜底），防止绕过下拉框。

---

## 四、导入步骤（微信开发者工具）

1. 打开项目 → 顶部工具栏点 **云开发** → 开通环境（如已开通则直接进入控制台）。
2. 把环境 ID 填进 `miniprogram/utils/constants.js` 的 `APP_INFO.cloudEnv`，并把 `APP_INFO.useCloud` 改为 `true`。
3. 控制台左侧 **数据库** → **新建集合**，依次创建 **9 个**集合：`users`、`tutors`、`certifications`、`demands`、`matches`、`reports`、`risk_words`、`checkins`、`reviews`（后两个为二期新增：履约打卡、双向盲评）。
   - 集合名区分大小写，必须与上表完全一致。
4. 进入某个集合 → 右上角 **导入** → 选择本目录对应的 `.json` 文件 → 冲突处理方式选 **Insert**（首次导入）或 **Upsert**（`_id` 已存在时覆盖更新）→ 确定。
   - 导入前确认文件是 JSON Lines（见第二节），否则控制台会报「文件格式错误」。
5. 逐个集合导入完成后，建议按第五节建立索引，再按第三节设置权限。
6. 云函数：右键 `cloudfunctions` 下每个函数目录 → **上传并部署（云端安装依赖）**。`cloudfunctions/common` 是共享代码目录，**不是云函数**，不单独上传（详见 `cloudfunctions/README.md`）。

### 权限设置建议（控制台 → 集合 → 权限设置）

| 集合 | 建议权限 | 理由 |
| --- | --- | --- |
| `tutors` | 所有用户可读，仅创建者可写 | 接单池、匹配结果需要读到全部师范生档案；写操作只允许本人（云函数校验 `openid`） |
| `risk_words` | 所有用户可读，仅创建者可写 | 词库对全端只读；仅管理员维护 |
| `certifications` | 仅创建者可读写 | 含学号/邮箱等脱敏材料与 OCR 结果，不应全量外泄 |
| `demands` | 仅创建者可读写 | 家长隐私（地址/联系方式）；师范生看接单池由云函数 `matchTutors` 以管理员权限转发**脱敏后的**字段 |
| `matches` | 仅创建者可读写 | 只对发布该需求的家长可见 |
| `reports` | 仅创建者可读写 | 含需求与联系方式快照 |
| `checkins` | 仅创建者可读写 | 含 mock 定位与授课小结，属于履约凭证；家长确认由云函数 `submitCheckin` 以管理员权限代写 |
| `reviews` | 仅创建者可读写 | 盲评内容未揭晓前绝不能外泄；可见性由云函数 `submitReview` 统一裁决，**不能信任前端** |
| `users` | 仅创建者可读写 | 账号与 openid 映射 |

> 云函数使用管理员权限访问数据库，不受上述客户端权限限制；所有按 `openid` 的归属校验必须在云函数内完成。

### 建议索引

| 集合 | 索引字段 | 类型 | 说明 |
| --- | --- | --- | --- |
| `users` | `openid` | 唯一 | 登录时 upsert，防重复账号 |
| `tutors` | `userId` | 普通 | 按账号查档案 |
| `tutors` | `certLevel` | 普通 | 认证等级筛选 |
| `certifications` | `tutorId` | 普通 | 徽章与认证列表 |
| `certifications` | `tutorId + type` | 组合（唯一，可选） | 同一类型只保留最新一条 |
| `demands` | `parentId` | 普通 | 「我的需求」 |
| `demands` | `status` | 普通 | 接单池过滤 |
| `demands` | `status + createdAtTs` | 组合 | 接单池排序（建议给种子/新数据补 `createdAtTs`） |
| `demands` | `matchedTutorId` | 普通 | **二期**：查「我接的单」（履约与评价入口） |
| `matches` | `demandId` | 普通 | 匹配结果查询 |
| `reports` | `demandId` | 普通 | 报告溯源 |
| `reports` | `parentId` | 普通 | 「我的报告」 |
| `checkins` | `orderId` | 普通 | **二期**：按订单查打卡记录（按 `createdAtTs` 正序展示履约时间线） |
| `checkins` | `orderId + status` | 组合（可选） | **二期**：`start` 幂等校验（查是否已有 `checked_in`） |
| `checkins` | `tutorId` | 普通 | **二期**：师范生课时统计与履约率 |
| `reviews` | `orderId` | 普通 | **二期**：按订单取两条评价做盲评判定与揭晓 |
| `reviews` | `direction` | 普通 | **二期**：区分「家长评老师 / 老师评家长」 |
| `reviews` | `tutorId` | 普通 | **二期**：查某师范生已揭晓评价（详情页口碑区） |
| `reviews` | `orderId + direction` | 组合（唯一，可选） | **二期**：同一订单同一方向只允许一条（服务端已校验，索引做兜底） |
| `risk_words` | `word` | 唯一 | 词库去重与命中查询 |

---

## 五、合规与隐私声明

1. 本目录**全部为演示用假数据**，人名、学校专业、价格、地址均为虚构或公开信息组合。
2. 手机号（`phone`、`contactPhone`）、学号（`studentNo`）、邮箱（`email`）**在存储层即为脱敏值**（`138****6621` / `1202****0918` / `lin****@cnu.edu.cn`），不落任何真实明文。
3. **不含任何真实身份证号、真实学号、真实联系方式**，`certifications.ocrResult` 与 `files[].url` 为 mock 占位（`reviewNote` 已明确标注 mock）。
4. 开发与演示阶段**禁止导入真实个人信息**；接入真实用户前，须先完成用户授权、最小必要采集、脱敏存储与删除机制（二期 TODO）。
5. 平台定位声明已在 `reports.disclaimer` 与小程序页面固定展示：**非学历培训、非办学资质、非医疗建议**；平台不参与资金往来，不提供支付/担保/结算（资金担保结算为二期规划）。
6. 未成年人线下上课需监护人全程知情同意，平台建议优先线上授课或校内认证实践场地。

---

## 六、数值来源与已知偏差（重要）

`matches.json` 与 `reports.json` 不是手写估值，而是**用项目内真实规则实算**后落库，保证「导入云数据库后的种子数据」与「小程序运行时算出的结果」逐字节一致：

```powershell
# 复算命令（在项目根目录执行，输出全量排名与 Top3）
node -e "const b='./miniprogram/';const m=require(b+'services/match.js');const t=require(b+'mock/tutors.js');const d=require(b+'mock/demands.js');m.rankTutors(d.demands[0],t.tutors,6).forEach(r=>console.log(r.rank,r.tutorId,r.tutor.name,r.score))"
```

实算结果（`demo_demand_001`：初三数学 / 线下 / 海淀 / 预算 ≤140 / **时段仅工作日晚上**）：

| 排名 | tutorId | 姓名 | 得分 | 科目 | 年级 | 时间地点 | 价格 | 信用 | 认证 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `tutor_001` | 林嘉怡 | **99.2** | 40 | 20 | 15 | 10 | 9.2 | 5 |
| 2 | `tutor_006` | 郑一诺 | **75.3** | 40 | 14 | 1.5 | 10 | 7.8 | 2 |
| 3 | `tutor_004` | 赵沐阳 | **74** | 40 | 7 | 6.5 | 6 | 9.5 | 5 |
| 4 | `tutor_003` | 苏雨萌 | 60.5 | 32 | 0 | 6.5 | 10 | 8.5 | 3.5 |
| 5 | `tutor_002` | 陈知远 | 58.8 | 0 | 20 | 15 | 10 | 8.8 | 5 |
| 6 | `tutor_005` | 何雨桐 | 49 | 0 | 14 | 12.5 | 10 | 9 | 3.5 |

> **二期数据已随「双减合规化」重算（与一期不同，属预期变化）**
>
> 一期本表的 Top3 是 `tutor_001 / tutor_004 / tutor_006`（99.2 / 80 / 75.3）。二期把 `demo_demand_001` 的时段
> 从「周末上午 / 工作日晚上」改为**仅工作日晚上**（合规要求），于是只在周末与寒暑假可排课的 `tutor_004`（赵沐阳）
> 时间地点分由 **12.5 → 6.5**，总分 80 → 74，**排名由第 2 降到第 3**，被 `tutor_006`（郑一诺）反超。
>
> - `matches.json` / `reports.json` 均已按新规则**重新实算生成**（`_id` 与 `createdAt` 保持不变）；
> - 这也顺带说明了一个设计事实：**匹配结果对可排课时间高度敏感**，合规约束会真实影响推荐排序——
>   家长若坚持周末补学科，将同时面临「政策拦截」与「可选老师变少」两个后果。
>
> 一期「Top3 第 3 名不是 `tutor_002`」的结论依然成立：`tutor_002` 是语文方向，科目分 0（40 分权重最大），
> 总分更低，排名靠后。

其他对齐点（校验脚本已逐项断言通过）：

- `summary` 四段文案 = `services/api.js::buildReportSummary` 的模板输出（含其原文标点，例如认证段落末尾无句号，与运行时一致）；
- `riskTips` = `services/risk.js::buildRiskTips` 输出（5 条通用避坑提示 + 免责声明短句）；
- `nextSteps` = `services/api.js::buildNextSteps` 输出（3 条通用 + 线下监护人提示 + `TODO(二期)` 资金担保结算，共 5 条）；
- `disclaimer` = `constants.DISCLAIMER.full` 全 6 条；
- `tutors.json` / `demands.json` / `cert_001~003` 与 `miniprogram/mock/*.js` **逐字段完全一致**；
- 每位师范生的 `certLevel` 都与其 `certifications` 中 `approved` 记录推出的等级一致。

### 其他备注

- 演示账号绑定：`users` 只有 2 条演示账号。`user_demo_tutor`（演示师范生）的 `tutorProfileId = tutor_001`，而 `tutor_001.userId = user_demo_tutor_001`（沿用 mock 原值，未改字段以保证与前端一致）。
- `demands.json` 沿用 mock，未写 `createdAtTs`；如需按时间排序，导入后可用云函数或控制台补该字段（见索引建议）。
- `tutors.distanceKm` 为演示距离；真实距离需 `wx.getLocation` + 云函数地理计算（`geoNear`），已在 `services/match.js` 标注 `TODO(二期)`。
