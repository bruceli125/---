/**
 * 云函数公共模块（权威版本，供构建期同步 / 二期改为 npm 私有包使用）
 * ------------------------------------------------------------------
 * 统一导出：
 *   ok(data, message)        -> { code: 0, data, message }
 *   fail(message, code, data)-> { code, data, message }
 *   validate(rules, data)    -> { ok: true, value } | { ok: false, message }
 *   —— 风险词（来自 ./riskWords.js）——
 *   RISK_WORDS / BASE_RISK_WORDS / POLICY_RISK_WORDS / COMMON_TIPS / RISK_LEVEL
 *   checkRisk / resolveLevel / uniqueHits / collectDemandRiskFields
 *   —— 双减政策（来自 ./riskWords.js，二期新增）——
 *   POLICY_DOUBLE_REDUCTION / DISCIPLINE_SUBJECTS / QUALITY_SUBJECTS /
 *   REST_DAY_TIME_RANGES / REST_DAY_KEYWORDS / EARLY_CHILDHOOD_GRADES / EARLY_CHILDHOOD_KEYWORDS
 *   isDisciplineSubject / isQualitySubject / subjectGroup /
 *   detectRestDay / detectEarlyChildhood / checkDoubleReduction / checkDemandCompliance
 *
 * 重要说明（务必阅读）：
 *   微信云函数上传时每个函数只打包自己的目录，运行时无法 require 到
 *   cloudfunctions/common。因此各云函数内部都内联了等价的 ok / fail / validate，
 *   风险词与双减规则则在 riskCheck / submitDemand 目录内各留一份同步副本。
 *   本文件是这些实现的「权威版本 + 单点维护源」。
 *   TODO(二期)：改为在项目根目录执行构建脚本，把 common/ 通过 npm 本地包或
 *   复制方式打进每个云函数目录（或改用云函数层 / 云托管共享依赖）。
 */

const riskWords = require('./riskWords.js');

/**
 * 成功返回
 * @param {*} data
 * @param {string} [message]
 */
function ok(data, message) {
  return { code: 0, data: data === undefined ? null : data, message: message || 'success' };
}

/**
 * 失败返回
 * code 约定：1 = 参数错误；2 = 需要用户二次确认；-1 = 服务端异常
 * @param {string} message
 * @param {number} [code]
 * @param {*} [data]
 */
function fail(message, code, data) {
  return {
    code: typeof code === 'number' ? code : -1,
    data: data === undefined ? null : data,
    message: message || '操作失败'
  };
}

/**
 * 通用参数校验（声明式）
 *
 * 规则项字段：
 *   key      必填，参数名
 *   label    中文名（用于错误提示）
 *   type     'string' | 'number' | 'array' | 'object' | 'enum' | 'boolean'
 *   required 是否必填
 *   min/max  string 长度 或 number 取值范围
 *   values   type === 'enum' 时的允许值数组
 *   default  缺省值（非必填且未传时写入返回值）
 *   maxItems array 最大长度
 *
 * @param {Array<object>} rules
 * @param {object} data
 * @returns {{ok:boolean, value?:object, message?:string}}
 */
function validate(rules, data) {
  const source = data || {};
  const value = {};
  const list = rules || [];
  for (let i = 0; i < list.length; i++) {
    const rule = list[i] || {};
    const key = rule.key;
    const label = rule.label || key;
    let raw = source[key];

    // 缺省值处理
    if ((raw === undefined || raw === null || raw === '') && rule.default !== undefined) {
      raw = rule.default;
    }

    // 必填校验
    if (raw === undefined || raw === null || raw === '') {
      if (rule.required) return { ok: false, message: '参数错误：' + label + '不能为空' };
      value[key] = rule.default === undefined ? raw : rule.default;
      continue;
    }

    const type = rule.type || 'string';

    if (type === 'string') {
      if (typeof raw !== 'string') return { ok: false, message: '参数错误：' + label + '必须是字符串' };
      const str = raw.trim();
      if (rule.required && !str) return { ok: false, message: '参数错误：' + label + '不能为空' };
      if (rule.min !== undefined && str.length < rule.min) {
        return { ok: false, message: '参数错误：' + label + '长度不能少于 ' + rule.min + ' 个字符' };
      }
      if (rule.max !== undefined && str.length > rule.max) {
        return { ok: false, message: '参数错误：' + label + '长度不能超过 ' + rule.max + ' 个字符' };
      }
      value[key] = str;
      continue;
    }

    if (type === 'number') {
      const num = Number(raw);
      if (isNaN(num)) return { ok: false, message: '参数错误：' + label + '必须是数字' };
      if (rule.min !== undefined && num < rule.min) {
        return { ok: false, message: '参数错误：' + label + '不能小于 ' + rule.min };
      }
      if (rule.max !== undefined && num > rule.max) {
        return { ok: false, message: '参数错误：' + label + '不能大于 ' + rule.max };
      }
      value[key] = num;
      continue;
    }

    if (type === 'array') {
      const arr = Array.isArray(raw) ? raw : [raw];
      if (rule.maxItems !== undefined && arr.length > rule.maxItems) {
        return { ok: false, message: '参数错误：' + label + '最多 ' + rule.maxItems + ' 项' };
      }
      value[key] = arr;
      continue;
    }

    if (type === 'object') {
      if (typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, message: '参数错误：' + label + '必须是对象' };
      }
      value[key] = raw;
      continue;
    }

    if (type === 'boolean') {
      value[key] = !!raw;
      continue;
    }

    if (type === 'enum') {
      const values = rule.values || [];
      if (values.indexOf(raw) === -1) {
        return { ok: false, message: '参数错误：' + label + '必须是 ' + values.join(' / ') + ' 之一' };
      }
      value[key] = raw;
      continue;
    }

    value[key] = raw;
  }
  return { ok: true, value: value };
}

module.exports = {
  ok: ok,
  fail: fail,
  validate: validate,

  /* 风险词 */
  RISK_WORDS: riskWords.RISK_WORDS,
  BASE_RISK_WORDS: riskWords.BASE_RISK_WORDS,
  POLICY_RISK_WORDS: riskWords.POLICY_RISK_WORDS,
  COMMON_TIPS: riskWords.COMMON_TIPS,
  RISK_LEVEL: riskWords.RISK_LEVEL,
  RISK_LEVEL_THEME: riskWords.RISK_LEVEL_THEME,
  uniqueHits: riskWords.uniqueHits,
  checkRisk: riskWords.checkRisk,
  resolveLevel: riskWords.resolveLevel,
  collectDemandRiskFields: riskWords.collectDemandRiskFields,

  /* 双减政策 */
  POLICY_DOUBLE_REDUCTION: riskWords.POLICY_DOUBLE_REDUCTION,
  DISCIPLINE_SUBJECTS: riskWords.DISCIPLINE_SUBJECTS,
  QUALITY_SUBJECTS: riskWords.QUALITY_SUBJECTS,
  REST_DAY_TIME_RANGES: riskWords.REST_DAY_TIME_RANGES,
  REST_DAY_KEYWORDS: riskWords.REST_DAY_KEYWORDS,
  EARLY_CHILDHOOD_GRADES: riskWords.EARLY_CHILDHOOD_GRADES,
  EARLY_CHILDHOOD_KEYWORDS: riskWords.EARLY_CHILDHOOD_KEYWORDS,
  TIME_RANGES: riskWords.TIME_RANGES,
  isDisciplineSubject: riskWords.isDisciplineSubject,
  isQualitySubject: riskWords.isQualitySubject,
  subjectGroup: riskWords.subjectGroup,
  detectRestDay: riskWords.detectRestDay,
  detectEarlyChildhood: riskWords.detectEarlyChildhood,
  checkDoubleReduction: riskWords.checkDoubleReduction,
  checkDemandCompliance: riskWords.checkDemandCompliance
};
