/**
 * 云函数：generateReport —— 生成「对接报告 / 避坑提示」
 * ------------------------------------------------------------------
 * 入参：{ demandId }
 * 返回：{ code, data: report, message }
 *   report = {
 *     _id, id, demandId, parentId, parentName, demand,
 *     topMatches: [{ tutorId, rank, score, reasons, distanceKm, tutor }],
 *     riskLevel, riskHits, riskTips: string[], summary, nextSteps: string[],
 *     disclaimer: string[], createdAt, createdAtTs
 *   }
 * 依赖集合：demands、matches、tutors、reports、risk_words
 * 前端调用点：miniprogram/services/api.js -> generateReport()
 *
 * 报告内容与 miniprogram/services/api.js 的 buildReportSummary / buildNextSteps 保持同一模板；
 * 报告中的 riskTips 比前端 mock 版更完整（包含命中词专属提示 + 通用提示 + 免责声明短句）。
 *
 * TODO(二期)：
 *   - summary / 推荐理由接入 LLM 生成（当前为规则模板，接口预留 buildSummaryByLLM）
 *   - 导出 Word / Excel / PDF、报告分享长图、报告存证与编号核验
 *   - 家长确认对接后的资金担保结算记录（当前平台不涉及资金往来）
 */

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const COLLECTIONS = {
  DEMANDS: 'demands',
  MATCHES: 'matches',
  TUTORS: 'tutors',
  REPORTS: 'reports',
  RISK_WORDS: 'risk_words'
};

/** 风险等级（与 miniprogram/utils/constants.js RISK_LEVEL 一致） */
const RISK_LEVEL = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high'
};

/** 通用避坑提示（与 miniprogram/services/risk.js COMMON_TIPS 逐字一致） */
const COMMON_TIPS = [
  '首次沟通建议在平台内完成，不要添加来路不明的私人联系方式。',
  '任何要求先交押金、保证金、服装费、体检费的订单都不要答应。',
  '对方索要身份证、学生证原件或照片时请直接拒绝并举报。',
  '涉及“培训贷 / 分期付款 / 先培训后上岗”的一律终止对接。',
  '未成年人线下上课需监护人全程知情，建议优先线上或校内认证场地。'
];

/** 免责声明（与 constants.js DISCLAIMER 一致） */
const DISCLAIMER = {
  short: '平台仅提供可信对接与能力认证服务，非学历培训、非办学资质、非医疗建议。',
  full: [
    '本平台由高校学生团队运营，仅提供家长与学生之间的可信对接与能力认证展示服务。',
    '平台非学历培训机构、非办学资质主体、非医疗或心理咨询机构，不提供任何形式的学科培训办学服务。',
    '平台不参与资金往来，不提供支付、担保、结算功能，任何收费要求请谨慎核实（资金担保结算为二期规划）。',
    '认证信息由学生自主提交、平台按规则校验，平台不采集真实身份证号、学号等敏感信息，展示内容已做脱敏处理。',
    '未成年人线下上课需监护人全程知情并同意，平台建议优先选择线上授课或校内认证场地。',
    '对接过程中如遇押金、扣押证件、培训贷、刷单等情形，请立即终止并保留证据报警。'
  ]
};

/** 字典（与 constants.js FREQUENCIES / TEACH_MODES 一致，用于摘要文案） */
const FREQUENCIES = [
  { value: 'once_week', label: '每周 1 次' },
  { value: 'twice_week', label: '每周 2 次' },
  { value: 'three_week', label: '每周 3 次' },
  { value: 'weekend_only', label: '仅周末' },
  { value: 'daily', label: '每天（寒暑假）' },
  { value: 'negotiable', label: '面议' }
];

const TEACH_MODES = [
  { value: 'online', label: '线上授课' },
  { value: 'offline', label: '线下上门' },
  { value: 'campus', label: '校内认证场地' }
];

/** 单次查询上限（云数据库限制） */
const QUERY_LIMIT = 100;

/* ==================================================================
 * 通用返回 / 工具
 * ================================================================== */

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

/** 距离展示：3.24 -> '3.2km'；0.8 -> '800m'（与 format.js formatDistance 一致） */
function formatDistance(km) {
  if (km === null || km === undefined || isNaN(km)) return '距离未知';
  const n = Number(km);
  if (n < 1) return Math.round(n * 1000) + 'm';
  return n.toFixed(1) + 'km';
}

/** 字典取值 */
function pickLabel(list, value, fallback) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].value === value) return list[i].label;
  }
  return value || fallback;
}

function frequencyLabel(v) {
  return pickLabel(FREQUENCIES, v, '频次面议');
}

function teachModeLabel(v) {
  return pickLabel(TEACH_MODES, v, '方式面议');
}

/** 文档补 id 字段 */
function withId(doc) {
  if (!doc) return doc;
  const out = Object.assign({}, doc);
  out.id = doc._id;
  return out;
}

/* ==================================================================
 * 报告文案模板（与前端 buildReportSummary / buildNextSteps 同风格）
 * ================================================================== */

/** 报告摘要（四段：需求 / 推荐情况 / 认证情况 / 风险提示） */
function buildReportSummary(demand, topMatches) {
  if (!topMatches || !topMatches.length) return '';
  const best = topMatches[0];
  const t = best.tutor || {};
  const parts = [];

  parts.push(
    '家长需求：' +
      (demand.grade || '') +
      (demand.subject || '') +
      '，' +
      frequencyLabel(demand.frequency) +
      '，' +
      teachModeLabel(demand.teachMode) +
      (demand.budgetMax ? '，预算 ' + demand.budgetMax + ' 元/小时以内' : '') +
      '。'
  );

  parts.push(
    '平台共推荐 ' +
      topMatches.length +
      ' 位学生，匹配度最高的是' +
      (t.name || '') +
      '（' +
      (t.school || '') +
      (t.major || '') +
      '，' +
      (t.grade || '') +
      '，匹配度 ' +
      best.score +
      ' 分，' +
      (best.distanceKm !== null && best.distanceKm !== undefined
        ? '距离约 ' + formatDistance(best.distanceKm)
        : '距离待确认') +
      '）。'
  );

  parts.push(
    '认证情况：' +
      (Number(t.certLevel || 0) >= 3
        ? '已完成三重认证（编号 ' + (t.certBadgeNo || '待生成') + '）'
        : '认证等级 ' + Number(t.certLevel || 0) + ' 级，建议优先选择三重认证学生。')
  );

  parts.push(
    '风险提示：' +
      (demand.riskLevel === RISK_LEVEL.HIGH
        ? '该需求命中高风险词，平台强烈建议重新确认对接对象。'
        : demand.riskLevel === RISK_LEVEL.MEDIUM
        ? '该需求存在敏感表述，请按避坑提示逐条核实。'
        : '未发现风险词，仍建议按避坑提示完成首次沟通。')
  );

  return parts.join('\n');
}

/** 下一步建议 */
function buildNextSteps(demand, topMatches, riskLevel) {
  const steps = [
    '在平台内向 1-2 位推荐学生发起沟通，确认可排课时间与授课方式。',
    '安排一次 30-45 分钟试课（建议线上或校内认证场地），重点观察讲解方式与孩子接受度。',
    '试课不满意可随时更换学生，平台不收取任何费用、不收取押金。'
  ];
  if (demand.teachMode === 'offline') {
    steps.push('线下首次见面请选择公共场所或校内场地，未成年人上课需监护人全程知情。');
  }
  if (riskLevel === RISK_LEVEL.HIGH) {
    steps.unshift('⚠️ 该需求命中高风险词，建议先终止与对方的资金/证件相关沟通，必要时报警。');
  }
  steps.push('TODO(二期)：平台将支持资金担保结算与上课记录存证。');
  return steps;
}

/**
 * LLM 生成摘要的预留接口（当前未接入，直接走模板）
 * TODO(二期)：调用大模型生成更自然的报告摘要，失败/超时回退 buildReportSummary。
 * @returns {Promise<string|null>}
 */
function buildSummaryByLLM(/* demand, topMatches */) {
  return Promise.resolve(null);
}

/* ==================================================================
 * 数据访问
 * ================================================================== */

async function getDemandById(demandId) {
  try {
    const res = await db.collection(COLLECTIONS.DEMANDS).doc(demandId).get();
    if (res && res.data) return res.data;
  } catch (err) {
    console.warn('[generateReport] 按 _id 查询需求失败，尝试按 id 字段查询：', err);
  }
  try {
    const res2 = await db.collection(COLLECTIONS.DEMANDS).where({ id: demandId }).limit(1).get();
    const list = (res2 && res2.data) || [];
    if (list.length) return list[0];
  } catch (err2) {
    console.error('[generateReport] 查询需求失败：', err2);
  }
  return null;
}

/** 读取某需求的匹配结果（按 rank 升序） */
async function listMatches(demandId) {
  const res = await db
    .collection(COLLECTIONS.MATCHES)
    .where({ demandId: demandId })
    .orderBy('rank', 'asc')
    .limit(QUERY_LIMIT)
    .get();
  return (res && res.data) || [];
}

/** 批量读取学生档案 */
async function listTutorsByIds(tutorIds) {
  const ids = (tutorIds || []).filter(Boolean);
  if (!ids.length) return [];
  const res = await db
    .collection(COLLECTIONS.TUTORS)
    .where({ _id: _.in(ids) })
    .limit(QUERY_LIMIT)
    .get();
  return (res && res.data) || [];
}

/** 从 risk_words 集合取高危通用提示（riskHits 为空时使用） */
async function loadGenericRiskTips() {
  try {
    const res = await db
      .collection(COLLECTIONS.RISK_WORDS)
      .where({ level: RISK_LEVEL.HIGH })
      .limit(3)
      .get();
    const list = (res && res.data) || [];
    return list
      .map(function (item) {
        return item.tip;
      })
      .filter(Boolean);
  } catch (err) {
    console.warn('[generateReport] 读取 risk_words 失败（降级为通用提示）：', err);
    return [];
  }
}

/** 组装风险提示（命中词专属提示 + 通用提示 + 免责声明短句，去重） */
async function buildRiskTips(demand) {
  const tips = [];
  const push = function (t) {
    if (t && tips.indexOf(t) === -1) tips.push(t);
  };

  const riskHits = (demand && demand.riskHits) || [];
  riskHits.forEach(function (hit) {
    push(hit && hit.tip);
  });

  // 未命中风险词时，从词库取高危通用提示作为提示内容
  if (!riskHits.length) {
    const generic = await loadGenericRiskTips();
    generic.forEach(push);
  }

  COMMON_TIPS.forEach(push);
  push(DISCLAIMER.short);

  return tips;
}

/* ==================================================================
 * 业务逻辑
 * ================================================================== */

exports.main = async (event, context) => {
  try {
    // ---------- 1. 参数校验 ----------
    const demandId = event && event.demandId;
    if (!demandId || typeof demandId !== 'string') {
      return fail('参数错误：demandId 不能为空', 1);
    }

    // ---------- 2. 读取需求 ----------
    const rawDemand = await getDemandById(demandId);
    if (!rawDemand) return fail('参数错误：需求不存在或已删除', 1);
    const demand = withId(rawDemand);

    // ---------- 3. 读取匹配结果 ----------
    let matches = [];
    try {
      matches = await listMatches(demandId);
    } catch (err) {
      console.error('[generateReport] 读取 matches 失败：', err);
      return fail('生成报告失败：匹配结果读取异常（' + err.message + '）');
    }

    // 没有匹配结果时，自动补跑一次匹配（前端也可能是直接进入报告页）
    if (!matches.length) {
      try {
        // TODO(二期)：改为内部共享打分模块（当前通过云函数互调，增加一次冷启动开销）
        await cloud.callFunction({ name: 'matchTutors', data: { demandId: demandId } });
        matches = await listMatches(demandId);
      } catch (err) {
        console.warn('[generateReport] 自动补跑 matchTutors 失败：', err);
      }
    }
    if (!matches.length) {
      return fail('生成报告失败：暂无匹配结果，无法生成报告', 1);
    }

    // ---------- 4. 读取学生档案 ----------
    let tutors = [];
    try {
      tutors = await listTutorsByIds(
        matches.map(function (m) {
          return m.tutorId;
        })
      );
    } catch (err) {
      console.error('[generateReport] 读取 tutors 失败：', err);
      return fail('生成报告失败：学生档案读取异常（' + err.message + '）');
    }

    const tutorMap = {};
    tutors.forEach(function (t) {
      tutorMap[t._id] = withId(t);
    });

    // ---------- 5. 组装 topMatches ----------
    const topMatches = [];
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const tutor = tutorMap[m.tutorId];
      if (!tutor) {
        console.warn('[generateReport] 匹配记录对应的学生档案缺失，已跳过：', m.tutorId);
        continue;
      }
      topMatches.push({
        tutorId: m.tutorId,
        rank: m.rank || topMatches.length + 1,
        score: m.score,
        reasons: m.reasons || [],
        distanceKm: m.distanceKm === undefined ? null : m.distanceKm,
        tutor: tutor
      });
    }
    topMatches.sort(function (a, b) {
      return a.rank - b.rank;
    });

    if (!topMatches.length) {
      return fail('生成报告失败：推荐学生档案已失效，请重新匹配', 1);
    }

    // ---------- 6. 风险提示 ----------
    const riskTips = await buildRiskTips(demand);

    // ---------- 7. 摘要（当前模板生成，二期接入 LLM） ----------
    let summary = '';
    try {
      const byLLM = await buildSummaryByLLM(demand, topMatches);
      summary = byLLM || buildReportSummary(demand, topMatches);
    } catch (err) {
      console.warn('[generateReport] LLM 摘要失败，回退模板：', err);
      summary = buildReportSummary(demand, topMatches);
    }

    const now = Date.now();
    const reportDoc = {
      demandId: demandId,
      parentId: demand.parentId || '',
      parentName: demand.parentName || '',
      demand: demand,
      topMatches: topMatches,
      riskLevel: demand.riskLevel || RISK_LEVEL.LOW,
      riskHits: demand.riskHits || [],
      riskTips: riskTips,
      summary: summary,
      nextSteps: buildNextSteps(demand, topMatches, demand.riskLevel || RISK_LEVEL.LOW),
      disclaimer: DISCLAIMER.full,
      createdAt: db.serverDate(),
      createdAtTs: now
    };

    // ---------- 8. 写库（同一需求覆盖旧报告） ----------
    try {
      await db.collection(COLLECTIONS.REPORTS).where({ demandId: demandId }).remove();
    } catch (err) {
      console.warn('[generateReport] 清理旧报告失败（继续执行）：', err);
    }

    let reportId = '';
    try {
      const addRes = await db.collection(COLLECTIONS.REPORTS).add({ data: reportDoc });
      reportId = addRes._id;
      await db.collection(COLLECTIONS.REPORTS).doc(reportId).update({ data: { id: reportId } });
    } catch (err) {
      console.error('[generateReport] 写入 reports 失败：', err);
      // 写库失败时仍返回报告内容，保证家长能当场看到结果
      return ok(
        Object.assign({}, reportDoc, {
          _id: '',
          id: '',
          createdAt: formatDateTime(now),
          saveFailed: true
        }),
        '报告已生成（保存失败，仅本次可见）'
      );
    }

    const report = Object.assign({}, reportDoc, {
      _id: reportId,
      id: reportId,
      createdAt: formatDateTime(now)
    });

    return ok(report, '报告已生成');
  } catch (err) {
    console.error('[generateReport] 执行失败：', err);
    return fail('生成报告失败：' + (err && err.message ? err.message : '未知异常'));
  }
};
