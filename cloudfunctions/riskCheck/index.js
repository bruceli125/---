/**
 * 云函数：riskCheck —— 风险词检测 / 双减政策合规检测
 * ------------------------------------------------------------------
 * 两种 action（向后兼容：不传 action 且不传 demand 时按 text 处理）：
 *
 *   1) action === 'text'（默认）
 *      入参：{ text: string }（长度 1 ~ 2000）
 *      返回：{ code, data: { level, hits, tips, summary, source, count }, message }
 *
 *   2) action === 'policy'（或入参直接带 demand 对象时自动识别）
 *      入参：{ demand: { subject, grade, timeRange[], specialRequirements, remark,
 *                        address, isDiscipline } }
 *      返回：{ code, data: { blocked, blockCode, policy, evidence, ruleA, ruleB, rest, early }, message }
 *        blocked   true = 命中双减红线，禁止发布
 *        blockCode 'DOUBLE_REDUCTION'（未命中时为 ''）
 *        policy    { code, level, title, message, tips[], evidence[] }（未命中为 null）
 *        evidence  命中证据（中文数组，用于向用户解释为什么被拦）
 *        ruleA     规则 A：学科类 × 休息日/节假日/寒暑假
 *        ruleB     规则 B：学龄前/幼小衔接 × 休息日 × 学科类（含全科）
 *
 * 返回码约定：0 成功 / 1 参数错误 / -1 服务端异常
 *   （政策命中不是错误，而是业务结论：code 仍为 0，由 data.blocked 表达；
 *     submitDemand 才会把 blocked 转成 code 3 拒绝写库）
 *
 * 依赖集合：risk_words（读失败或为空时回退本地 ./riskWords.js）
 * 前端调用点：miniprogram/services/api.js -> riskCheck(text, { remote: true })
 *            miniprogram/services/api.js -> checkPolicy(demand)（二期）
 *
 * TODO(二期)：词库改为运营后台维护 + 分词/同义词/变体识别（“押 金”“押●金”），
 *            并接入内容安全审核（security.msgSecCheck）做二次兜底；
 *            双减规则改为可配置的口径表（各地实施细则不同）。
 */

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

/** 本地词库 / 双减规则副本（cloudfunctions/common/riskWords.js 的同步副本） */
const localRisk = require('./riskWords.js');

/** 文本长度限制（与 tests / 前端限制保持一致） */
const MAX_TEXT_LENGTH = 2000;

/** 词库集合每次最多读取条数 */
const RISK_WORD_LIMIT = 200;

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

/**
 * 从 risk_words 集合读取词库
 * @returns {Promise<{words:Array|null, source:string}>}
 */
async function loadCloudWords() {
  try {
    const res = await db.collection('risk_words').limit(RISK_WORD_LIMIT).get();
    const list = (res && res.data) || [];
    if (!list.length) {
      console.warn('[riskCheck] risk_words 集合为空，回退本地词库');
      return { words: null, source: 'local-fallback' };
    }
    const words = list
      .map(function (item) {
        return {
          word: item.word,
          category: item.category,
          level: item.level,
          tip: item.tip
        };
      })
      .filter(function (item) {
        return !!item.word;
      });
    if (!words.length) {
      console.warn('[riskCheck] risk_words 集合无有效词条，回退本地词库');
      return { words: null, source: 'local-fallback' };
    }
    return { words: words, source: 'cloud' };
  } catch (err) {
    console.warn('[riskCheck] 读取 risk_words 失败，回退本地词库：', err);
    return { words: null, source: 'local-fallback' };
  }
}

/* ================================================================
 * 一、风险词检测（原有行为，保持不变，返回结构向后兼容）
 * ================================================================ */

async function handleTextCheck(event) {
  // ---------- 参数校验 ----------
  const raw = event && event.text;
  if (typeof raw !== 'string') {
    return fail('参数错误：text 必须是字符串', 1);
  }
  const text = raw.trim();
  if (!text.length) {
    return fail('参数错误：text 不能为空', 1);
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return fail('参数错误：text 长度不能超过 ' + MAX_TEXT_LENGTH + ' 个字符', 1);
  }

  // ---------- 优先使用云数据库词库 ----------
  const loaded = await loadCloudWords();

  // ---------- 检测 ----------
  const result = localRisk.checkRisk(text, loaded.words);

  return ok(
    {
      level: result.level,
      hits: result.hits,
      tips: result.tips,
      summary: result.summary,
      source: loaded.source,
      count: result.count
    },
    '风险检测完成'
  );
}

/* ================================================================
 * 二、双减政策合规检测（规则与 miniprogram/services/risk.js 逐条一致）
 * ================================================================ */

/**
 * 校验 demand 入参的基本结构
 * 说明：只做类型与长度校验；科目/年级是否在字典内不阻断（避免字典升级导致误拦），
 *      规则判定本身对未知取值是「不命中」的安全默认。
 * @returns {string} 错误信息，空串表示通过
 */
function validateDemand(demand) {
  if (!demand || typeof demand !== 'object' || Array.isArray(demand)) {
    return '参数错误：demand 必须是对象';
  }
  if (demand.subject !== undefined && typeof demand.subject !== 'string') {
    return '参数错误：demand.subject 必须是字符串';
  }
  if (demand.grade !== undefined && typeof demand.grade !== 'string') {
    return '参数错误：demand.grade 必须是字符串';
  }
  if (demand.timeRange !== undefined && demand.timeRange !== null && !Array.isArray(demand.timeRange)) {
    return '参数错误：demand.timeRange 必须是数组';
  }
  if (demand.timeRange && demand.timeRange.length > 20) {
    return '参数错误：demand.timeRange 最多 20 项';
  }
  if (String(demand.specialRequirements || '').length > 2000) {
    return '参数错误：demand.specialRequirements 不能超过 2000 个字符';
  }
  if (String(demand.address || '').length > 500) {
    return '参数错误：demand.address 不能超过 500 个字符';
  }
  if (String(demand.remark || '').length > 2000) {
    return '参数错误：demand.remark 不能超过 2000 个字符';
  }
  return '';
}

async function handlePolicyCheck(event) {
  const demand = event && event.demand;
  const invalid = validateDemand(demand);
  if (invalid) return fail(invalid, 1);

  // 纯函数判定，不访问数据库；命中即政策红线
  const result = localRisk.checkDoubleReduction(demand);

  return ok(
    {
      blocked: result.blocked,
      blockCode: result.blocked ? localRisk.POLICY_DOUBLE_REDUCTION.code : '',
      policy: result.policy,
      evidence: result.evidence,
      ruleA: result.ruleA,
      ruleB: result.ruleB,
      rest: result.rest,
      early: result.early
    },
    result.blocked ? localRisk.POLICY_DOUBLE_REDUCTION.message : '未触发双减政策红线'
  );
}

/**
 * 动作识别：
 *   - 显式 action 优先（'text' / 'policy'）
 *   - 未传 action 但带了 demand 对象 → 视为 policy（方便前端只传 demand）
 *   - 其余 → text（向后兼容）
 */
function resolveAction(event) {
  const explicit = event && event.action;
  if (explicit === 'policy' || explicit === 'text') return explicit;
  if (explicit !== undefined && explicit !== null && explicit !== '') {
    return 'unsupported';
  }
  if (event && event.demand && typeof event.demand === 'object') return 'policy';
  return 'text';
}

exports.main = async (event, context) => {
  try {
    const action = resolveAction(event);

    if (action === 'policy') {
      return await handlePolicyCheck(event);
    }
    if (action === 'text') {
      return await handleTextCheck(event);
    }
    return fail('参数错误：不支持的 action（仅支持 text / policy）', 1);
  } catch (err) {
    console.error('[riskCheck] 执行失败：', err);
    return fail('风险检测失败：' + (err && err.message ? err.message : '未知异常'));
  }
};
