/**
 * 云函数：submitDemand —— 发布家教需求 / 更新需求状态 / 家长确认成单
 * ------------------------------------------------------------------
 * 入参（三种 action）：
 *   1) 默认（action 省略或 'create'）：
 *      { form: { subject, grade, frequency, timeRange[], address, district, teachMode,
 *                budget, budgetMin, budgetMax, specialRequirements, phone, deadline, remark,
 *                isDiscipline },
 *        riskAcknowledged: boolean }
 *      - teachMode !== 'online' 时 address 必填
 *      - budgetMax/budget/budgetMin 传了就必须是 0~5000 的数字
 *      - 【第一步】双减政策检测：命中则返回 code 3（政策红线），**不写库**
 *      - 【第二步】风险词检测：命中高风险且 riskAcknowledged !== true 时返回 code 2，**不写库**
 *      - 两步都通过才写库，并写入 subjectGroup / isDiscipline / policyChecked
 *   2) action === 'updateStatus'：{ demandId, status }
 *   3) action === 'accept'：{ demandId, tutorId }
 *      家长确认某位学生成单 → status='matched'、matchedTutorId、acceptedAt，
 *      并把 applications 中该需求的申请置 accepted（被选中）/ rejected（其余）
 *
 * 返回：{ code, data, message }
 *   create       -> data: { demand, risk }
 *   updateStatus -> data: 更新后的需求文档
 *   accept       -> data: { demand, applications: { accepted, rejected } }
 *
 * 返回码约定：0 成功 / 1 参数错误 / 2 需用户二次确认（高风险词）/ 3 政策红线（禁止发布）/ -1 服务端异常
 *   注：状态冲突（例如已成单却再次 accept）按参数错误 code 1 返回，消息中说明原因。
 * 依赖集合：demands、users、applications
 * 前端调用点：miniprogram/services/api.js -> createDemand() / updateDemandStatus() / acceptDemand()
 *
 * TODO(二期)：
 *   - 权限：真实环境需校验 OPENID 与 demand.parentId 归属一致才允许修改 / 确认成单
 *     （当前 MVP 未强制，见 handleCreate / handleUpdateStatus / handleAccept 内的 TODO 标记）
 *   - 资金担保结算、需求置顶/推广、需求过期自动关闭（定时触发器）
 *   - 需求内容接入内容安全审核（security.msgSecCheck）
 *   - 成单后给学生发订阅消息通知（当前无消息通道）
 */

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

/** 本地风险词库 + 双减规则副本（cloudfunctions/common/riskWords.js 的同步副本） */
const riskWords = require('./riskWords.js');

const COLLECTIONS = {
  DEMANDS: 'demands',
  USERS: 'users',
  APPLICATIONS: 'applications'
};

/** 需求状态（与 miniprogram/utils/constants.js DEMAND_STATUS 一致） */
const DEMAND_STATUS = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  MATCHING: 'matching',
  MATCHED: 'matched',
  CLOSED: 'closed',
  RISK_BLOCKED: 'risk_blocked'
};

const DEMAND_STATUS_LIST = ['draft', 'published', 'matching', 'matched', 'closed', 'risk_blocked'];

/** 申请状态（与 miniprogram/utils/constants.js APPLY_STATUS 一致） */
const APPLY_STATUS = {
  APPLIED: 'applied',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected'
};

/** 授课方式（与 constants.js TEACH_MODES 一致） */
const TEACH_MODES = ['online', 'offline', 'campus'];

/** 学段与年级（与 constants.js STAGES 一致，用于推导 stage 字段） */
const STAGES = [
  { value: 'kindergarten', label: '幼儿', grades: ['小班', '中班', '大班', '幼小衔接'] },
  { value: 'primary', label: '小学', grades: ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级'] },
  { value: 'junior', label: '初中', grades: ['初一', '初二', '初三'] },
  { value: 'senior', label: '高中', grades: ['高一', '高二', '高三'] }
];

/** 时间段字典（与 constants.js TIME_RANGES 一致，用于 timeRangeText） */
const TIME_RANGES = [
  { value: 'weekday_evening', label: '工作日晚上' },
  { value: 'weekday_afternoon', label: '工作日下午' },
  { value: 'weekend_morning', label: '周末上午' },
  { value: 'weekend_afternoon', label: '周末下午' },
  { value: 'weekend_evening', label: '周末晚上' },
  { value: 'holiday', label: '寒暑假全天' }
];

/** 预算上限校验（元 / 小时） */
const BUDGET_MIN_LIMIT = 0;
const BUDGET_MAX_LIMIT = 5000;

function ok(data, message) {
  return { code: 0, data: data === undefined ? null : data, message: message || 'success' };
}

function fail(message, code, data) {
  return {
    code: typeof code === 'number' ? code : -1,
    data: data === undefined ? null : data,
    message: message || '操作失败'
  };
}

/** 政策红线返回（code 3），结构与 riskCheck 的 policy 动作对齐，便于前端直接渲染 */
function policyReject(policyResult) {
  return {
    code: 3,
    data: {
      policy: policyResult.policy,
      evidence: policyResult.evidence,
      ruleA: policyResult.ruleA,
      ruleB: policyResult.ruleB
    },
    message: riskWords.POLICY_DOUBLE_REDUCTION.message
  };
}

/* ============================ 工具函数 ============================ */

/** 手机号脱敏：138****8888（与 miniprogram/utils/format.js maskPhone 一致） */
function maskPhone(phone) {
  const s = String(phone || '').replace(/\s/g, '');
  if (s.length < 7) return s ? s.slice(0, 1) + '***' : '';
  return s.slice(0, 3) + '****' + s.slice(-4);
}

/** 年级 -> 学段对象 */
function getStageByGrade(grade) {
  if (!grade) return null;
  for (let i = 0; i < STAGES.length; i++) {
    if (STAGES[i].grades.indexOf(grade) > -1) return STAGES[i];
  }
  return null;
}

/** 时间段 value -> label */
function timeRangeLabel(value) {
  for (let i = 0; i < TIME_RANGES.length; i++) {
    if (TIME_RANGES[i].value === value) return TIME_RANGES[i].label;
  }
  return value;
}

/** 时间戳 -> 'YYYY-MM-DD HH:mm' */
function formatDateTime(ts) {
  const d = ts instanceof Date ? ts : new Date(ts || Date.now());
  if (isNaN(d.getTime())) return '';
  const pad = function (n) {
    return n < 10 ? '0' + n : '' + n;
  };
  return (
    d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
  );
}

/** 文档补 id 字段 */
function withId(doc) {
  if (!doc) return doc;
  const out = Object.assign({}, doc);
  out.id = doc._id;
  return out;
}

/**
 * 按 _id 或 id 字段查询需求
 * @param {string} demandId
 * @returns {Promise<object|null>}
 */
async function findDemandById(demandId) {
  let doc = null;
  try {
    const res = await db.collection(COLLECTIONS.DEMANDS).doc(demandId).get();
    doc = res && res.data;
  } catch (err) {
    console.warn('[submitDemand] 按 _id 查询需求失败，尝试按 id 字段查询：', err);
  }
  if (!doc) {
    const res2 = await db.collection(COLLECTIONS.DEMANDS).where({ id: demandId }).limit(1).get();
    const list = (res2 && res2.data) || [];
    if (list.length) doc = list[0];
  }
  return doc || null;
}

/** 校验一个可选金额字段，返回 { ok, value, message } */
function checkAmount(raw, label) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: 0 };
  const num = Number(raw);
  if (isNaN(num)) return { ok: false, message: '参数错误：' + label + '必须是数字' };
  if (num < BUDGET_MIN_LIMIT || num > BUDGET_MAX_LIMIT) {
    return { ok: false, message: '参数错误：' + label + '必须在 ' + BUDGET_MIN_LIMIT + '~' + BUDGET_MAX_LIMIT + ' 元之间' };
  }
  return { ok: true, value: num };
}

/**
 * 科目分组归一化（宁严勿宽）
 * 若科目字典判定为学科类，即使家长显式选了「非学科类」，也按学科类处理，
 * 避免通过错选 isDiscipline 绕过双减检测。
 * @returns {{ subjectGroup: string, isDiscipline: 'discipline'|'quality'|'other' }}
 */
function normalizeSubjectGroup(subject, declared) {
  const derived = riskWords.subjectGroup(subject); // 'discipline' | 'quality' | 'other'
  const declaredGroup = declared === 'discipline' || declared === 'quality' ? declared : '';
  let isDiscipline = 'other';
  if (derived === 'discipline' || declaredGroup === 'discipline') {
    isDiscipline = 'discipline';
  } else if (derived === 'quality' || declaredGroup === 'quality') {
    isDiscipline = 'quality';
  }
  return {
    subjectGroup: isDiscipline === 'other' ? derived : isDiscipline,
    isDiscipline: isDiscipline
  };
}

/* ============================ 业务逻辑 ============================ */

/**
 * 创建需求
 */
async function handleCreate(event) {
  const form = (event && event.form) || null;
  const riskAcknowledged = !!(event && event.riskAcknowledged);

  // ---------- 参数校验 ----------
  if (!form || typeof form !== 'object' || Array.isArray(form)) {
    return fail('参数错误：form 必须是对象', 1);
  }
  if (!form.subject || typeof form.subject !== 'string') {
    return fail('参数错误：请选择辅导科目（subject）', 1);
  }
  if (!form.grade || typeof form.grade !== 'string') {
    return fail('参数错误：请选择学段年级（grade）', 1);
  }
  if (!form.teachMode || TEACH_MODES.indexOf(form.teachMode) === -1) {
    return fail('参数错误：teachMode 必须是 ' + TEACH_MODES.join(' / ') + ' 之一', 1);
  }
  if (form.teachMode !== 'online' && !String(form.address || '').trim()) {
    return fail('参数错误：线下授课请填写上课地点（address）', 1);
  }
  if (form.subject.length > 20) return fail('参数错误：科目名称过长', 1);
  if (String(form.grade).length > 20) return fail('参数错误：年级名称过长', 1);
  if (String(form.specialRequirements || '').length > 500) {
    return fail('参数错误：特殊要求不能超过 500 个字符', 1);
  }
  if (String(form.address || '').length > 200) {
    return fail('参数错误：上课地点不能超过 200 个字符', 1);
  }
  if (form.timeRange !== undefined && form.timeRange !== null && !Array.isArray(form.timeRange)) {
    return fail('参数错误：timeRange 必须是数组', 1);
  }
  if (Array.isArray(form.timeRange) && form.timeRange.length > 20) {
    return fail('参数错误：timeRange 最多 20 项', 1);
  }

  const budgetMaxCheck = checkAmount(form.budgetMax, '预算上限 budgetMax');
  if (!budgetMaxCheck.ok) return fail(budgetMaxCheck.message, 1);
  const budgetMinCheck = checkAmount(form.budgetMin, '预算下限 budgetMin');
  if (!budgetMinCheck.ok) return fail(budgetMinCheck.message, 1);
  const budgetCheck = checkAmount(form.budget, '预算 budget');
  if (!budgetCheck.ok) return fail(budgetCheck.message, 1);

  // ---------- 第一步：双减政策检测（红线，优先级最高，命中直接拒绝且不写库） ----------
  const policyResult = riskWords.checkDoubleReduction(form);
  if (policyResult.blocked) {
    console.warn('[submitDemand] 双减红线拦截：', JSON.stringify(policyResult.evidence));
    return policyReject(policyResult);
  }

  // ---------- 第二步：风险词检测（本地词库，与 riskCheck 云函数同一套规则） ----------
  const riskText = riskWords.collectDemandRiskFields(form).join('\n');
  const risk = riskWords.checkRisk(riskText);

  // 高风险且未经用户二次确认：不写库，返回 code 2 由前端弹 RiskAlert
  if (risk.level === riskWords.RISK_LEVEL.HIGH && !riskAcknowledged) {
    return {
      code: 2,
      data: { risk: risk },
      message: '检测到高风险表述，请确认后重新提交'
    };
  }

  // ---------- 归属信息（家长） ----------
  const wxContext = cloud.getWXContext();
  const openid = (wxContext && wxContext.OPENID) || '';
  let user = null;
  try {
    if (openid) {
      const userRes = await db.collection(COLLECTIONS.USERS).where({ openid: openid }).limit(1).get();
      const users = (userRes && userRes.data) || [];
      if (users.length) user = users[0];
    }
  } catch (err) {
    // 查用户失败不阻断发布，退化为用 openid 作为 parentId
    console.warn('[submitDemand] 查询 users 失败（降级用 openid）：', err);
  }

  // TODO(二期)：此处应校验 OPENID 与家长身份一致后再落库（当前 MVP 允许匿名演示）
  const parentId = (user && user._id) || openid || 'anonymous';
  const parentName = (user && user.nickname) || form.parentName || '微信用户';
  const contactPhone = maskPhone(form.phone || (user && user.phone) || '');

  const now = Date.now();
  const timeRange = [].concat(form.timeRange || []).filter(Boolean);
  const stage = (getStageByGrade(form.grade) || {}).value || '';
  const budgetMax = budgetMaxCheck.value || budgetCheck.value || 0;

  // 科目分组 + 双减标记（供接单池筛选、政策复核与审计使用）
  const groupInfo = normalizeSubjectGroup(form.subject, form.isDiscipline);

  // ---------- 组装需求文档（字段与 miniprogram/services/api.js 的 mock 分支保持一致） ----------
  const doc = {
    parentId: parentId,
    parentName: parentName,
    contactPhone: contactPhone,
    subject: form.subject,
    /** 'discipline'（学科类）/ 'quality'（素质拓展）/ 'other' */
    subjectGroup: groupInfo.subjectGroup,
    /** 双减标记：学科类受休息日限制 */
    isDiscipline: groupInfo.isDiscipline,
    grade: form.grade,
    stage: stage,
    frequency: form.frequency || 'negotiable',
    timeRange: timeRange,
    timeRangeText:
      timeRange.map(function (v) { return timeRangeLabel(v); }).join(' / ') || '时间面议',
    address: form.address || '',
    district: form.district || '',
    teachMode: form.teachMode,
    budget: budgetMax,
    budgetMin: budgetMinCheck.value || 0,
    budgetMax: budgetMax,
    specialRequirements: form.specialRequirements || '',
    riskLevel: risk.level,
    riskHits: risk.hits,
    riskAcknowledged: riskAcknowledged,
    /** 发布时已通过双减政策检测（恒为 true，审计用） */
    policyChecked: true,
    /** MVP：一个需求 = 一个订单，成单后回填 matchedTutorId / acceptedAt */
    matchedTutorId: '',
    acceptedAt: '',
    status: DEMAND_STATUS.PUBLISHED,
    createdAt: db.serverDate(),
    createdAtTs: now,
    applyCount: 0,
    viewCount: 0,
    deadline: form.deadline || ''
  };

  // ---------- 写库 ----------
  let demandId = '';
  try {
    const addRes = await db.collection(COLLECTIONS.DEMANDS).add({ data: doc });
    demandId = addRes._id;
  } catch (err) {
    console.error('[submitDemand] 写入 demands 失败：', err);
    return fail('发布失败：需求写入异常（' + err.message + '）');
  }

  // 额外写一个 id 字段 = _id，保证前端在 mock / 云函数两种模式下都能用 demand.id
  try {
    await db.collection(COLLECTIONS.DEMANDS).doc(demandId).update({ data: { id: demandId } });
  } catch (err) {
    console.warn('[submitDemand] 回写 id 字段失败（不影响主流程）：', err);
  }

  const demand = Object.assign({}, doc, { _id: demandId, id: demandId, createdAt: formatDateTime(now) });

  // 返回体里的 risk 与前端 checkRisk 返回结构对齐（便于 RiskAlert 组件直接渲染）
  return ok(
    {
      demand: demand,
      risk: {
        level: risk.level,
        hits: risk.hits,
        tips: risk.tips,
        tipText: risk.tipText,
        summary: risk.summary,
        levelTheme: risk.levelTheme,
        blocked: risk.blocked,
        source: 'cloud'
      }
    },
    '需求已发布'
  );
}

/**
 * 更新需求状态
 */
async function handleUpdateStatus(event) {
  const demandId = event && event.demandId;
  const status = event && event.status;

  if (!demandId || typeof demandId !== 'string') {
    return fail('参数错误：demandId 不能为空', 1);
  }
  if (DEMAND_STATUS_LIST.indexOf(status) === -1) {
    return fail('参数错误：status 必须是 ' + DEMAND_STATUS_LIST.join(' / ') + ' 之一', 1);
  }

  let doc = null;
  try {
    doc = await findDemandById(demandId);
  } catch (err2) {
    console.error('[submitDemand] 查询需求失败：', err2);
    return fail('更新失败：需求查询异常（' + err2.message + '）');
  }
  if (!doc) return fail('参数错误：需求不存在或已删除', 1);

  // TODO(二期)：校验 OPENID 与 doc.parentId 归属一致，防止越权修改他人需求

  try {
    await db.collection(COLLECTIONS.DEMANDS).doc(doc._id).update({
      data: { status: status, updatedAt: db.serverDate() }
    });
  } catch (err) {
    console.error('[submitDemand] 更新需求状态失败：', err);
    return fail('更新失败：' + err.message);
  }

  const updated = withId(Object.assign({}, doc, { status: status }));
  return ok(updated, '需求状态已更新');
}

/**
 * 家长确认成单（accept）
 * 入参：{ demandId, tutorId }
 *  - demand 状态为 matched → 拒绝（不能重复确认）
 *  - 更新 status='matched'、matchedTutorId、acceptedAt
 *  - applications 中该需求的申请：被选中置 accepted，其余置 rejected
 */
async function handleAccept(event) {
  const demandId = event && event.demandId;
  const tutorId = event && event.tutorId;

  if (!demandId || typeof demandId !== 'string') {
    return fail('参数错误：demandId 不能为空', 1);
  }
  if (!tutorId || typeof tutorId !== 'string') {
    return fail('参数错误：tutorId 不能为空', 1);
  }

  let demand = null;
  try {
    demand = await findDemandById(demandId);
  } catch (err) {
    console.error('[submitDemand] 成单时查询需求失败：', err);
    return fail('成单失败：需求查询异常（' + err.message + '）');
  }
  if (!demand) return fail('参数错误：需求不存在或已删除', 1);
  if (demand.status === DEMAND_STATUS.MATCHED) {
    return fail('该需求已成单，不能重复确认', 1);
  }
  if (demand.status === DEMAND_STATUS.CLOSED) {
    return fail('该需求已关闭，不能确认成单', 1);
  }

  // TODO(二期)：校验 OPENID 与 demand.parentId 归属一致，只有家长本人能确认成单
  // TODO(二期)：校验 tutorId 确实投递过该需求（applications 中存在该申请）

  const now = Date.now();
  const acceptedAt = formatDateTime(now);

  try {
    await db.collection(COLLECTIONS.DEMANDS).doc(demand._id).update({
      data: {
        status: DEMAND_STATUS.MATCHED,
        matchedTutorId: tutorId,
        acceptedAt: acceptedAt,
        acceptedAtTs: now,
        updatedAt: db.serverDate()
      }
    });
  } catch (err) {
    console.error('[submitDemand] 更新需求为已匹配失败：', err);
    return fail('成单失败：' + err.message);
  }

  // ---------- 同步申请记录状态（失败不影响成单主流程） ----------
  let accepted = 0;
  let rejected = 0;
  try {
    const appRes = await db
      .collection(COLLECTIONS.APPLICATIONS)
      .where({ demandId: demandId })
      .limit(100)
      .get();
    const apps = (appRes && appRes.data) || [];
    for (let i = 0; i < apps.length; i++) {
      const app = apps[i];
      const nextStatus = app.tutorId === tutorId ? APPLY_STATUS.ACCEPTED : APPLY_STATUS.REJECTED;
      if (nextStatus === APPLY_STATUS.ACCEPTED) accepted++;
      else rejected++;
      try {
        await db.collection(COLLECTIONS.APPLICATIONS).doc(app._id).update({
          data: { status: nextStatus, updatedAt: db.serverDate() }
        });
      } catch (err) {
        console.warn('[submitDemand] 更新申请状态失败（' + app._id + '）：', err);
      }
    }
  } catch (err) {
    console.warn('[submitDemand] 查询 applications 失败（不影响成单）：', err);
  }

  const updated = withId(
    Object.assign({}, demand, {
      status: DEMAND_STATUS.MATCHED,
      matchedTutorId: tutorId,
      acceptedAt: acceptedAt,
      acceptedAtTs: now
    })
  );

  return ok(
    { demand: updated, applications: { accepted: accepted, rejected: rejected } },
    '已成单，可开始上课打卡'
  );
}

exports.main = async (event, context) => {
  try {
    const action = (event && event.action) || 'create';
    if (action === 'create') {
      return await handleCreate(event);
    }
    if (action === 'updateStatus') {
      return await handleUpdateStatus(event);
    }
    if (action === 'accept') {
      return await handleAccept(event);
    }
    return fail('参数错误：不支持的 action（仅支持 create / updateStatus / accept）', 1);
  } catch (err) {
    console.error('[submitDemand] 执行失败：', err);
    return fail('发布需求失败：' + (err && err.message ? err.message : '未知异常'));
  }
};
