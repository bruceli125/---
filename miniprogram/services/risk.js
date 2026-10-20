/**
 * 风险词检测（前端本地版）
 *
 * 设计原则：
 * - 前端检测 = 用户输入时的「即时提示」，保证不联网也能演示；
 * - 提交时仍会调用云函数 riskCheck 做二次校验（服务端为准）；
 * - 词库统一来自 utils/constants.js，二期建议改为从云数据库 risk_words 拉取并本地缓存。
 */
const {
  RISK_WORDS,
  RISK_LEVEL,
  RISK_LEVEL_THEME,
  DISCLAIMER,
  /* 二期：双减合规 */
  DISCIPLINE_SUBJECTS,
  QUALITY_SUBJECTS,
  REST_DAY_TIME_RANGES,
  REST_DAY_KEYWORDS,
  EARLY_CHILDHOOD_GRADES,
  EARLY_CHILDHOOD_KEYWORDS,
  POLICY_DOUBLE_REDUCTION,
  TIME_RANGES
} = require('../utils/constants.js');

/** 通用避坑提示（无论是否命中风险词都建议展示） */
const COMMON_TIPS = [
  '首次沟通建议在平台内完成，不要添加来路不明的私人联系方式。',
  '任何要求先交押金、保证金、服装费、体检费的订单都不要答应。',
  '对方索要身份证、学生证原件或照片时请直接拒绝并举报。',
  '涉及“培训贷 / 分期付款 / 先培训后上岗”的一律终止对接。',
  '未成年人线下上课需监护人全程知情，建议优先线上或校内认证场地。'
];

/**
 * 判断词库条目是否命中文本
 * 使用大小写不敏感的直接匹配；二期可替换为分词 + 同义词/变体（如“押 金”“押·金”）
 */
function matchHits(text, words) {
  const source = String(text || '');
  if (!source) return [];
  const lower = source.toLowerCase();
  const hits = [];
  const list = words || RISK_WORDS;
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
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

/**
 * 根据命中词计算整体风险等级
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

/** 去重命中词（同一词在多个字段重复出现时只留一条） */
function uniqueHits(hits) {
  const seen = {};
  const out = [];
  (hits || []).forEach((h) => {
    if (!seen[h.word]) {
      seen[h.word] = true;
      out.push(h);
    }
  });
  return out;
}

/**
 * 核心检测函数（纯本地，同步返回）
 * @param {string} text 待检测文本
 * @returns {{level:string, hits:Array, tips:string[], tipText:string, summary:string, blocked:boolean, levelTheme:object}}
 */
function checkRisk(text) {
  const hits = uniqueHits(matchHits(text));
  const level = resolveLevel(hits);
  const theme = RISK_LEVEL_THEME[level] || RISK_LEVEL_THEME.low;

  // 命中词的专属提示优先，其余补充通用提示
  const tips = [];
  hits.forEach((h) => {
    if (h.tip && tips.indexOf(h.tip) === -1) tips.push(h.tip);
  });
  COMMON_TIPS.forEach((t) => {
    if (tips.indexOf(t) === -1) tips.push(t);
  });

  const summary = hits.length
    ? '检测到 ' + hits.length + ' 处风险表述（' + theme.text + '）：' + hits.map((h) => h.word).join('、')
    : '未检测到风险词，平台建议仍按下方的通用避坑提示对接。';

  return {
    level,
    hits,
    tips,
    tipText: tips.join('\n'),
    summary,
    levelTheme: theme,
    /** 是否属于「需要二次确认才允许发布」的情形 */
    blocked: level === RISK_LEVEL.HIGH,
    /** 前端本地检测标记，便于与云函数结果区分 */
    source: 'local'
  };
}

/**
 * 多字段合并检测（发布需求时把特殊要求、地址、备注拼在一起）
 * @param {Array<string>} fields
 */
function checkRiskFields(fields) {
  const text = (fields || []).filter(Boolean).join('\n');
  const result = checkRisk(text);
  result.checkedText = text;
  return result;
}

/**
 * 合并「本地检测」与「云函数检测」结果，取更高风险等级
 * @param {object} local
 * @param {object} remote
 */
function mergeRisk(local, remote) {
  if (!remote) return local || checkRisk('');
  if (!local) return remote;
  const order = { low: 0, medium: 1, high: 2 };
  const hits = uniqueHits((local.hits || []).concat(remote.hits || []));
  const level = (order[remote.level] || 0) >= (order[local.level] || 0) ? remote.level : local.level;
  const theme = RISK_LEVEL_THEME[level] || RISK_LEVEL_THEME.low;
  const tips = [];
  hits.forEach((h) => {
    if (h.tip && tips.indexOf(h.tip) === -1) tips.push(h.tip);
  });
  (remote.tips || []).concat(local.tips || []).forEach((t) => {
    if (t && tips.indexOf(t) === -1) tips.push(t);
  });
  return {
    level,
    hits,
    tips,
    tipText: tips.join('\n'),
    summary: hits.length ? '共检测到 ' + hits.length + ' 处风险表述（' + theme.text + '）' : '未检测到风险词',
    levelTheme: theme,
    blocked: level === 'high',
    source: 'merged'
  };
}

/** 需求对象 -> 需要检测的文本字段 */
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

/** 面向界面的风险提示（对接报告用） */
function buildRiskTips(riskResult) {
  const tips = (riskResult && riskResult.tips) || COMMON_TIPS;
  return tips.concat([DISCLAIMER.short]);
}

/* ================================================================
 * 二期：双减政策合规检测（红线，优先级高于普适风险词）
 *
 * 判定规则（与云函数 cloudfunctions/common/riskWords.js 保持一致）：
 *   规则 A：学科类科目（或无科目标记但选了「学科类」）+ 休息日/节假日/寒暑假时段 → 阻断
 *   规则 B：学段为学龄前 / 幼小衔接 + 休息日 + 学科类（含全科） → 阻断
 * 说明：规则命中即「禁止发布」，不是「强提示」——这是政策红线，必须硬拦。
 * TODO(二期+)：接教育主管部门最新口径（如各地差异化细则）时，只改规则函数与文案常量。
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

/** 时间是否落在休息日 / 节假日 / 寒暑假（值 + 文本双重判定，防止用户绕过下拉框） */
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

/** 是否学龄前 / 幼小衔接学段 */
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
 * @param {{subject:string, grade:string, timeRange:Array, specialRequirements:string,
 *          remark:string, address:string, isDiscipline:boolean|string}} demand
 * @returns {{blocked:boolean, policy:object|null, evidence:Array<string>,
 *            ruleA:boolean, ruleB:boolean, rest:object, early:object}}
 */
function checkDoubleReduction(demand) {
  const d = demand || {};
  const text = [d.specialRequirements, d.remark, d.address].filter(Boolean).join('\n');
  const declaredDiscipline =
    d.isDiscipline === true || d.isDiscipline === 'discipline' || d.isDiscipline === 'subject';
  const subjectDiscipline = isDisciplineSubject(d.subject) || declaredDiscipline;
  const rest = detectRestDay({ timeRange: d.timeRange, text: text });
  const early = detectEarlyChildhood(d.grade, text);
  const isAllSubject = String(d.subject || '').indexOf('全科') > -1;

  // 规则 A：学科类 × 休息日/节假日/寒暑假
  const ruleA = subjectDiscipline && rest.isRest;
  // 规则 B：学龄前/幼小衔接 × 休息日 × 学科类（含全科）
  const ruleB = early.isEarly && rest.isRest && (subjectDiscipline || isAllSubject);
  const blocked = ruleA || ruleB;

  const evidence = [];
  if (blocked) {
    if (subjectDiscipline) {
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
 * @returns {{blocked:boolean, blockCode:string, level:string, policy:object|null, risk:object}}
 */
function checkDemandCompliance(demand) {
  const policy = checkDoubleReduction(demand);
  const risk = checkRiskFields(collectDemandRiskFields(demand));
  return {
    blocked: policy.blocked,
    blockCode: policy.blocked ? POLICY_DOUBLE_REDUCTION.code : '',
    level: policy.blocked ? RISK_LEVEL.HIGH : risk.level,
    policy: policy,
    risk: risk,
    /** 供页面直接展示的一行结论 */
    summary: policy.blocked
      ? POLICY_DOUBLE_REDUCTION.message
      : risk.summary
  };
}

module.exports = {
  COMMON_TIPS,
  checkRisk,
  checkRiskFields,
  mergeRisk,
  matchHits,
  resolveLevel,
  uniqueHits,
  collectDemandRiskFields,
  buildRiskTips,

  /* 二期：双减合规 */
  isDisciplineSubject,
  isQualitySubject,
  subjectGroup,
  detectRestDay,
  detectEarlyChildhood,
  checkDoubleReduction,
  checkDemandCompliance
};
