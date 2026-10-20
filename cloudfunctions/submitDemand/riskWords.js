/**
 * 【同步副本】本文件是 cloudfunctions/common/riskWords.js 的同步副本，除本段声明外与原文逐字一致。
 * 原因：微信云函数上传时只打包自身目录，运行时无法 require 上级目录的 common/。
 * 修改词库或双减规则时必须同时更新：
 *   1) cloudfunctions/common/riskWords.js（权威源）
 *   2) cloudfunctions/riskCheck/riskWords.js（本文件）
 *   3) cloudfunctions/submitDemand/riskWords.js
 *   4) miniprogram/utils/constants.js
 *   5) miniprogram/services/risk.js
 *   6) database/risk_words.json
 */
/**
 * 风险词库 + 双减政策合规规则（服务端权威实现）
 * ------------------------------------------------------------------
 * 本文件是风险与政策规则的**服务端权威副本**：
 *   1) 15 条普适风险词与 miniprogram/utils/constants.js 的 RISK_WORDS 逐字一致；
 *   2) 双减规则函数与文案与 miniprogram/services/risk.js **逐条一致**（同样的判定条件、
 *      同样的 POLICY_DOUBLE_REDUCTION.message），任何一侧改动都必须同步另一侧；
 *   3) 另含 6 条「双减政策」类风险词（category='双减政策'），作为结构性检测之外的
 *      文本兜底（例如用户在特殊要求里写"周末补课"但时间字段选了工作日）。
 *
 * 为什么每个云函数还要各自拷贝一份：
 *   微信云函数上传时只打包自己那一个目录，运行时 require('../common/riskWords.js')
 *   会失败（上级目录不在函数包内）。因此 riskCheck / submitDemand 各带一份同步副本。
 *   TODO(二期)：改为统一从云数据库 risk_words 集合读取词库（checkRisk 已支持 words 参数），
 *   并在构建阶段用脚本同步副本，避免多处维护。
 *
 * 维护约定：修改词库或双减规则时必须同时更新
 *   1) cloudfunctions/common/riskWords.js（本文件）
 *   2) cloudfunctions/riskCheck/riskWords.js
 *   3) cloudfunctions/submitDemand/riskWords.js
 *   4) miniprogram/utils/constants.js（词库 + 双减常量）
 *   5) miniprogram/services/risk.js（双减规则函数）
 *   6) database/risk_words.json（初始化数据）
 */

/** 风险等级枚举（与 constants.js RISK_LEVEL 一致） */
const RISK_LEVEL = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high'
};

/** 风险等级配色 / 文案（与 constants.js RISK_LEVEL_THEME 一致） */
const RISK_LEVEL_THEME = {
  low: { color: '#17B26A', bg: '#E7F8F0', text: '低风险', desc: '未发现明显风险词，仍建议线下首次见面选在公共场所' },
  medium: { color: '#F79009', bg: '#FFF4E5', text: '中风险', desc: '检测到收费/资质类敏感表述，请在沟通中核实清楚' },
  high: { color: '#F04438', bg: '#FEECEB', text: '高风险', desc: '检测到押金、证件、贷款等典型诈骗特征，强烈建议终止对接' }
};

/**
 * 普适风险词库（15 条，与 miniprogram/utils/constants.js RISK_WORDS 逐字一致）
 * level: high = 典型诈骗特征；medium = 收费/资质敏感项
 */
const BASE_RISK_WORDS = [
  { word: '交押金', category: '收费陷阱', level: 'high', tip: '任何要求先交押金的订单都极可能是骗局，正规家教不存在押金。' },
  { word: '押金', category: '收费陷阱', level: 'high', tip: '平台禁止收取押金，遇到请立即停止沟通并举报。' },
  { word: '保证金', category: '收费陷阱', level: 'high', tip: '以保证金名义收费属于典型套路，平台绝不介入资金往来。' },
  { word: '扣押证件', category: '人身与证件安全', level: 'high', tip: '任何单位或个人无权扣押他人证件，涉嫌违法，请立即终止对接。' },
  { word: '身份证', category: '人身与证件安全', level: 'medium', tip: '平台不采集身份证信息；如对方索要身份证照片或原件，请拒绝。' },
  { word: '培训贷', category: '金融风险', level: 'high', tip: '“先培训后上岗、分期还款”是培训贷典型话术，切勿签署任何贷款协议。' },
  { word: '贷款', category: '金融风险', level: 'high', tip: '家教兼职不需要任何形式的贷款，涉及贷款一律终止。' },
  { word: '日入过千', category: '虚假宣传', level: 'high', tip: '家教收入与课时挂钩，宣称“日入过千”基本是招募话术或刷单陷阱。' },
  { word: '轻松月入过万', category: '虚假宣传', level: 'high', tip: '高薪承诺往往是引流话术，请以真实课时费和结算方式为准。' },
  { word: '刷单', category: '违法违规', level: 'high', tip: '刷单本身属于违法行为，与家教无关，请直接举报。' },
  { word: '黑中介', category: '中介风险', level: 'high', tip: '无资质中介常以老乡、学长名义拉人，建议只通过平台内认证账号对接。' },
  { word: '中介费', category: '中介风险', level: 'medium', tip: '平台不收取中介费；若第三方索要中介费，请先核实其资质。' },
  { word: '先交费', category: '收费陷阱', level: 'medium', tip: '“先交费再安排学生”是常见套路，正规流程不会要求提前付费。' },
  { word: '服装费', category: '收费陷阱', level: 'medium', tip: '以服装费、工牌费名义收费属于变相收费，请拒绝。' },
  { word: '体检费', category: '收费陷阱', level: 'medium', tip: '家教岗位无强制体检要求，涉及体检费请谨慎核实。' }
];

/**
 * 双减政策类风险词（6 条，服务端文本兜底）
 * 说明：这些词条用于捕捉「结构性字段看起来合规、但文本里明说要违规」的情形，
 *      与 miniprogram/utils/constants.js 的 15 条普适词库并存（前端未包含这 6 条，
 *      属于服务端更严格的防御层：前端只提示，服务端最终裁决）。
 */
const POLICY_RISK_WORDS = [
  { word: '周末补课', category: '双减政策', level: 'high', tip: '学科类培训不得在周末开展；如需周末安排，请改为素质拓展类科目。' },
  { word: '节假日补课', category: '双减政策', level: 'high', tip: '法定节假日禁止开展学科类培训，请调整到工作日。' },
  { word: '寒暑假补课', category: '双减政策', level: 'high', tip: '寒暑假禁止开展学科类培训，请调整到工作日。' },
  { word: '学科类培训', category: '双减政策', level: 'high', tip: '平台仅提供个人零星家教撮合，不组织学科类培训；请按非学科或工作日时段安排。' },
  { word: '学前班学科培训', category: '双减政策', level: 'high', tip: '学龄前儿童（含幼小衔接、学前班）不得开展学科类培训。' },
  { word: '超前教学', category: '双减政策', level: 'high', tip: '禁止超前超纲教学，请按孩子当前学段进度安排内容。' }
];

/** 完整词库 = 15 条普适词 + 6 条双减词（顺序固定，保证 checkRisk 的 hits 顺序稳定） */
const RISK_WORDS = BASE_RISK_WORDS.concat(POLICY_RISK_WORDS);

/** 通用避坑提示（与 miniprogram/services/risk.js COMMON_TIPS 逐字一致） */
const COMMON_TIPS = [
  '首次沟通建议在平台内完成，不要添加来路不明的私人联系方式。',
  '任何要求先交押金、保证金、服装费、体检费的订单都不要答应。',
  '对方索要身份证、学生证原件或照片时请直接拒绝并举报。',
  '涉及“培训贷 / 分期付款 / 先培训后上岗”的一律终止对接。',
  '未成年人线下上课需监护人全程知情，建议优先线上或校内认证场地。'
];

/* ================================================================
 * 双减政策常量（与 miniprogram/utils/constants.js 逐字一致）
 * ================================================================ */

/** 学科类科目（双减监管范围：语数外理化生 + 政史地） */
const DISCIPLINE_SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理'];

/** 素质拓展科目（不受休息日限制） */
const QUALITY_SUBJECTS = ['美术', '音乐', '体育', '编程', '科学'];

/** 休息日 / 节假日 / 寒暑假时段（双减禁止开展学科类培训的时间） */
const REST_DAY_TIME_RANGES = ['weekend_morning', 'weekend_afternoon', 'weekend_evening', 'holiday'];

const REST_DAY_KEYWORDS = ['周末', '周六', '周日', '双休', '节假日', '法定节假日', '寒暑假', '寒假', '暑假', '假期', '小长假'];

/** 学龄前 / 幼小衔接学段 */
const EARLY_CHILDHOOD_GRADES = ['小班', '中班', '大班', '幼小衔接', '学前班'];
const EARLY_CHILDHOOD_KEYWORDS = ['幼小衔接', '学前班'];

/** 时间段字典（与 constants.js TIME_RANGES 一致，仅用于 rangeText 展示） */
const TIME_RANGES = [
  { value: 'weekday_evening', label: '工作日晚上' },
  { value: 'weekday_afternoon', label: '工作日下午' },
  { value: 'weekend_morning', label: '周末上午' },
  { value: 'weekend_afternoon', label: '周末下午' },
  { value: 'weekend_evening', label: '周末晚上' },
  { value: 'holiday', label: '寒暑假全天' }
];

/**
 * 双减红线（前端弹窗、云函数、数据库共用同一套文案，不可各自表述）
 * ⚠️ message 必须与 miniprogram/utils/constants.js POLICY_DOUBLE_REDUCTION.message 逐字一致
 */
const POLICY_DOUBLE_REDUCTION = {
  code: 'DOUBLE_REDUCTION',
  level: 'high',
  title: '⚠️ 触发双减政策红线',
  message: '根据双减政策，严禁在休息日及节假日开展学科类培训，请勿发布违规需求',
  tips: [
    '学科类（语文、数学、英语、物理、化学、生物等）不得在周末、法定节假日、寒暑假开展培训。',
    '学龄前儿童（含幼小衔接、学前班）不得开展学科类培训。',
    '如需在休息日安排，可改为素质拓展类（美术、音乐、体育、编程、科学等），或改到工作日晚上。',
    '本平台仅为个人零星家教信息撮合，不提供固定办学场所，也不组织任何形式的学科类培训。'
  ]
};

/* ================================================================
 * 一、风险词检测（与 miniprogram/services/risk.js 行为一致）
 * ================================================================ */

/**
 * 判断词库条目是否命中文本（大小写不敏感的直接匹配，逻辑同前端 matchHits）
 * TODO(二期)：替换为分词 + 同义词/变体识别（如“押 金”“押·金”“yā jīn”）。
 * @param {string} text
 * @param {Array<object>} [words]
 * @returns {Array<{word:string,category:string,level:string,tip:string}>}
 */
function matchHits(text, words) {
  const source = String(text || '');
  if (!source) return [];
  const lower = source.toLowerCase();
  const hits = [];
  const list = words && words.length ? words : RISK_WORDS;
  for (let i = 0; i < list.length; i++) {
    const item = list[i] || {};
    const w = String(item.word || '').toLowerCase();
    if (!w) continue;
    if (lower.indexOf(w) > -1) {
      hits.push({
        word: item.word,
        category: item.category || '其他',
        level: item.level || RISK_LEVEL.MEDIUM,
        tip: item.tip || ''
      });
    }
  }
  return hits;
}

/** 去重命中词（同一词在多个字段重复出现时只留一条） */
function uniqueHits(hits) {
  const seen = {};
  const out = [];
  (hits || []).forEach(function (h) {
    if (!seen[h.word]) {
      seen[h.word] = true;
      out.push(h);
    }
  });
  return out;
}

/**
 * 根据命中词计算整体风险等级
 * 规则：任一 high -> high；否则任一 medium -> medium；无命中或仅 low -> low
 * @returns {'low'|'medium'|'high'}
 */
function resolveLevel(hits) {
  if (!hits || !hits.length) return RISK_LEVEL.LOW;
  let hasHigh = false;
  let hasMedium = false;
  for (let i = 0; i < hits.length; i++) {
    if (hits[i].level === RISK_LEVEL.HIGH) hasHigh = true;
    if (hits[i].level === RISK_LEVEL.MEDIUM) hasMedium = true;
  }
  if (hasHigh) return RISK_LEVEL.HIGH;
  if (hasMedium) return RISK_LEVEL.MEDIUM;
  return RISK_LEVEL.LOW;
}

/**
 * 核心检测函数（与 miniprogram/services/risk.js checkRisk 行为一致）
 * @param {string} text 待检测文本
 * @param {Array<object>} [words] 自定义词库（云数据库 risk_words 集合），为空则用本地词库
 * @returns {{level:string,hits:Array,tips:string[],tipText:string,summary:string,blocked:boolean,levelTheme:object,count:number}}
 */
function checkRisk(text, words) {
  const hits = uniqueHits(matchHits(text, words));
  const level = resolveLevel(hits);
  const theme = RISK_LEVEL_THEME[level] || RISK_LEVEL_THEME.low;

  // 命中词的专属提示优先，其余补充通用提示
  const tips = [];
  hits.forEach(function (h) {
    if (h.tip && tips.indexOf(h.tip) === -1) tips.push(h.tip);
  });
  COMMON_TIPS.forEach(function (t) {
    if (tips.indexOf(t) === -1) tips.push(t);
  });

  const summary = hits.length
    ? '检测到 ' + hits.length + ' 处风险表述（' + theme.text + '）：' + hits.map(function (h) { return h.word; }).join('、')
    : '未检测到风险词，平台建议仍按下方的通用避坑提示对接。';

  return {
    level: level,
    hits: hits,
    tips: tips,
    tipText: tips.join('\n'),
    summary: summary,
    levelTheme: theme,
    /** 是否属于「需要二次确认才允许发布」的情形 */
    blocked: level === RISK_LEVEL.HIGH,
    count: hits.length
  };
}

/** 需求对象 -> 需要检测的文本字段（与前端 collectDemandRiskFields 一致） */
function collectDemandRiskFields(demand) {
  if (!demand) return [];
  return [
    demand.specialRequirements,
    demand.address,
    demand.remark,
    demand.subject,
    demand.grade
  ].filter(Boolean);
}

/* ================================================================
 * 二、双减政策合规检测
 *
 * 判定规则（与 miniprogram/services/risk.js 完全一致）：
 *   规则 A：学科类科目（含「全科」，或显式声明 isDiscipline=discipline）+ 休息日/节假日/寒暑假 → 阻断
 *   规则 B：学龄前/幼小衔接 + 休息日 + 学科类（含全科） → 阻断
 * 命中即「禁止发布」（code 3），不是「强提示」——这是政策红线，必须硬拦。
 * TODO(二期+)：接教育主管部门最新口径（各地差异化细则）时，只改本区块的规则函数与文案。
 * ================================================================ */

/** 是否学科类科目（含「全科」） */
function isDisciplineSubject(subject) {
  const s = String(subject || '');
  if (!s) return false;
  if (s.indexOf('全科') > -1) return true;
  return DISCIPLINE_SUBJECTS.indexOf(s) > -1;
}

/** 是否素质拓展类科目 */
function isQualitySubject(subject) {
  return QUALITY_SUBJECTS.indexOf(String(subject || '')) > -1;
}

/** 科目分组：discipline（学科类）/ quality（素质拓展）/ other */
function subjectGroup(subject) {
  if (isDisciplineSubject(subject)) return 'discipline';
  if (isQualitySubject(subject)) return 'quality';
  return 'other';
}

/**
 * 时间是否落在休息日 / 节假日 / 寒暑假
 * 值 + 文本双重判定，防止用户绕过下拉框（例如选了工作日但备注写"周末"）
 * @param {{timeRange?:Array<string>, text?:string}} input
 */
function detectRestDay(input) {
  const src = input || {};
  const ranges = [].concat(src.timeRange || []);
  const hitRanges = ranges.filter(function (r) {
    return REST_DAY_TIME_RANGES.indexOf(r) > -1;
  });
  const text = String(src.text || '');
  const hitWords = REST_DAY_KEYWORDS.filter(function (w) {
    return text.indexOf(w) > -1;
  });
  return {
    isRest: hitRanges.length > 0 || hitWords.length > 0,
    hitRanges: hitRanges,
    hitWords: hitWords,
    rangeText: hitRanges
      .map(function (r) {
        for (let i = 0; i < TIME_RANGES.length; i++) {
          if (TIME_RANGES[i].value === r) return TIME_RANGES[i].label;
        }
        return r;
      })
      .join(' / ')
  };
}

/**
 * 是否学龄前 / 幼小衔接学段（年级或文本命中）
 * @param {string} grade
 * @param {string} [text]
 */
function detectEarlyChildhood(grade, text) {
  const g = String(grade || '');
  const t = String(text || '') + ' ' + g;
  const byGrade = EARLY_CHILDHOOD_GRADES.indexOf(g) > -1;
  const hitWords = EARLY_CHILDHOOD_KEYWORDS.filter(function (w) {
    return t.indexOf(w) > -1;
  });
  return { isEarly: byGrade || hitWords.length > 0, hitWords: hitWords, grade: g };
}

/**
 * 双减合规检测（纯函数，前端即时提示 + 云函数最终裁决共用同一套规则）
 * @param {{subject?:string, grade?:string, timeRange?:Array<string>, specialRequirements?:string,
 *          remark?:string, address?:string, isDiscipline?:boolean|string}} demand
 * @returns {{blocked:boolean, policy:object|null, evidence:Array<string>,
 *            ruleA:boolean, ruleB:boolean, rest:object, early:object}}
 */
function checkDoubleReduction(demand) {
  const d = demand || {};
  const text = [d.specialRequirements, d.remark, d.address].filter(Boolean).join('\n');
  const declaredDiscipline =
    d.isDiscipline === true || d.isDiscipline === 'discipline' || d.isDiscipline === 'subject';
  const isDiscipline = isDisciplineSubject(d.subject) || declaredDiscipline;
  const rest = detectRestDay({ timeRange: d.timeRange, text: text });
  const early = detectEarlyChildhood(d.grade, text);
  const isAllSubject = String(d.subject || '').indexOf('全科') > -1;

  // 规则 A：学科类 × 休息日/节假日/寒暑假
  const ruleA = isDiscipline && rest.isRest;
  // 规则 B：学龄前/幼小衔接 × 休息日 × 学科类（含全科）
  const ruleB = early.isEarly && rest.isRest && (isDiscipline || isAllSubject);
  const blocked = ruleA || ruleB;

  const evidence = [];
  if (blocked) {
    if (isDiscipline) {
      evidence.push('学科类科目：' + (d.subject || '已声明为学科类'));
    }
    if (early.isEarly) {
      evidence.push('学龄前/幼小衔接学段：' + (early.hitWords.length ? early.hitWords.join('、') : early.grade));
    }
    if (rest.hitRanges.length) {
      evidence.push('休息日/节假日时段：' + rest.rangeText);
    }
    if (rest.hitWords.length) {
      evidence.push('需求描述命中时段词：' + rest.hitWords.join('、'));
    }
  }

  return {
    blocked: blocked,
    policy: blocked
      ? Object.assign({}, POLICY_DOUBLE_REDUCTION, { evidence: evidence })
      : null,
    evidence: evidence,
    ruleA: ruleA,
    ruleB: ruleB,
    rest: rest,
    early: early
  };
}

/**
 * 发布前完整合规检测 = 双减政策硬拦 + 风险词强提示
 * @returns {{blocked:boolean, blockCode:string, level:string, policy:object, risk:object, summary:string}}
 */
function checkDemandCompliance(demand) {
  const policy = checkDoubleReduction(demand);
  const risk = checkRisk(collectDemandRiskFields(demand).join('\n'));
  return {
    blocked: policy.blocked,
    blockCode: policy.blocked ? POLICY_DOUBLE_REDUCTION.code : '',
    level: policy.blocked ? RISK_LEVEL.HIGH : risk.level,
    policy: policy,
    risk: risk,
    summary: policy.blocked ? POLICY_DOUBLE_REDUCTION.message : risk.summary
  };
}

module.exports = {
  RISK_LEVEL: RISK_LEVEL,
  RISK_LEVEL_THEME: RISK_LEVEL_THEME,
  RISK_WORDS: RISK_WORDS,
  BASE_RISK_WORDS: BASE_RISK_WORDS,
  POLICY_RISK_WORDS: POLICY_RISK_WORDS,
  COMMON_TIPS: COMMON_TIPS,
  matchHits: matchHits,
  uniqueHits: uniqueHits,
  resolveLevel: resolveLevel,
  checkRisk: checkRisk,
  collectDemandRiskFields: collectDemandRiskFields,

  /* 双减政策 */
  DISCIPLINE_SUBJECTS: DISCIPLINE_SUBJECTS,
  QUALITY_SUBJECTS: QUALITY_SUBJECTS,
  REST_DAY_TIME_RANGES: REST_DAY_TIME_RANGES,
  REST_DAY_KEYWORDS: REST_DAY_KEYWORDS,
  EARLY_CHILDHOOD_GRADES: EARLY_CHILDHOOD_GRADES,
  EARLY_CHILDHOOD_KEYWORDS: EARLY_CHILDHOOD_KEYWORDS,
  TIME_RANGES: TIME_RANGES,
  POLICY_DOUBLE_REDUCTION: POLICY_DOUBLE_REDUCTION,
  isDisciplineSubject: isDisciplineSubject,
  isQualitySubject: isQualitySubject,
  subjectGroup: subjectGroup,
  detectRestDay: detectRestDay,
  detectEarlyChildhood: detectEarlyChildhood,
  checkDoubleReduction: checkDoubleReduction,
  checkDemandCompliance: checkDemandCompliance
};
