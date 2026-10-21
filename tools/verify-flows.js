#!/usr/bin/env node
/**
 * 京师家教可信对接平台 —— 业务链路验收脚本
 *
 * 用法：node tools/verify-flows.js
 *
 * 用最小 wx 桩 + 内存 Storage，真实驱动 miniprogram/services/api.js（mock 模式），
 * 覆盖一期 + 二期全部关键规则与链路：
 *   A. 双减政策拦截（规则 A / 规则 B / 文本兜底 / 应放行场景）
 *   B. 前端 ↔ 云函数 双减规则一致性
 *   C. 接单池三组筛选与状态计数
 *   D. 确认成单 → 打卡 → 课后小结 → 家长确认
 *   E. 双向盲评（单方不可见 → 双方揭晓）与信用分结算
 *   F. 一期回归：风险词强提示 code 2、匹配 Top3、对接报告
 *
 * 退出码 0 = 全部通过。注意：本脚本只读代码，不修改任何文件。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');

/* ---------------- wx 桩 ---------------- */
const store = {};
const noop = function () {};
global.wx = {
  getStorageSync: function (k) {
    return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : '';
  },
  setStorageSync: function (k, v) {
    store[k] = v;
  },
  removeStorageSync: function (k) {
    delete store[k];
  },
  clearStorageSync: function () {
    Object.keys(store).forEach(function (k) {
      delete store[k];
    });
  },
  showToast: noop,
  showModal: noop,
  getWindowInfo: function () {
    return {};
  },
  cloud: undefined
};
global.getApp = function () {
  return { getRole: function () { return 'parent'; }, globalData: {} };
};
global.App = noop;
global.Page = noop;
global.Component = noop;

const C = require(path.join(MP, 'utils/constants.js'));
const risk = require(path.join(MP, 'services/risk.js'));
const api = require(path.join(MP, 'services/api.js'));

/* ---------------- 断言工具 ---------------- */
let pass = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log('  ✅ ' + name + (detail ? '  → ' + detail : ''));
  } else {
    failures.push(name + (detail ? ' → ' + detail : ''));
    console.log('  ❌ ' + name + (detail ? '  → ' + detail : ''));
  }
}
function section(title) {
  console.log('');
  console.log('=== ' + title + ' ===');
}

(async function main() {
  /* ================= A. 双减政策 ================= */
  section('A. 双减政策拦截（红线）');
  const cases = [
    { n: '学科类 + 周末 → 阻断', d: { subject: '数学', grade: '初三', timeRange: ['weekend_morning'], isDiscipline: 'discipline' }, e: true },
    { n: '学科类 + 寒暑假 → 阻断', d: { subject: '英语', grade: '高二', timeRange: ['holiday'], isDiscipline: 'discipline' }, e: true },
    { n: '学科类 + 工作日晚上 → 放行', d: { subject: '数学', grade: '初三', timeRange: ['weekday_evening'], isDiscipline: 'discipline' }, e: false },
    { n: '素质拓展 + 周末 → 放行', d: { subject: '美术', grade: '大班', timeRange: ['weekend_morning'], isDiscipline: 'quality' }, e: false },
    { n: '幼小衔接 + 全科 + 周末 → 阻断(规则B)', d: { subject: '全科', grade: '幼小衔接', timeRange: ['weekend_morning'], isDiscipline: 'discipline' }, e: true },
    { n: '幼小衔接 + 数学 + 工作日 → 放行', d: { subject: '数学', grade: '幼小衔接', timeRange: ['weekday_afternoon'], isDiscipline: 'discipline' }, e: false },
    { n: '下拉选工作日但文本写周六 → 阻断(兜底)', d: { subject: '物理', grade: '高一', timeRange: ['weekday_evening'], specialRequirements: '希望周六周日上午来', isDiscipline: 'discipline' }, e: true },
    { n: '编程 + 寒暑假 → 放行', d: { subject: '编程', grade: '五年级', timeRange: ['holiday'], isDiscipline: 'quality' }, e: false }
  ];
  cases.forEach(function (c) {
    const r = risk.checkDoubleReduction(c.d);
    check(c.n, r.blocked === c.e, 'blocked=' + r.blocked + (r.blocked ? ' | ' + r.evidence.join(' ; ') : ''));
  });
  check(
    '红线文案与规定逐字一致',
    C.POLICY_DOUBLE_REDUCTION.message === '根据双减政策，严禁在休息日及节假日开展学科类培训，请勿发布违规需求',
    C.POLICY_DOUBLE_REDUCTION.message
  );

  // 端到端：违规需求必须 code 3 且不写库
  const bad = await api.createDemand(
    { subject: '数学', grade: '初二', teachMode: 'online', timeRange: ['weekend_morning'], budgetMax: 150, isDiscipline: 'discipline' },
    { riskAcknowledged: true }
  );
  check('违规需求返回 code 3（不可放行）', bad.code === 3, 'code=' + bad.code + ' | ' + bad.message);
  check('返回证据链', !!(bad.data && bad.data.evidence && bad.data.evidence.length >= 2), (bad.data.evidence || []).join(' ; '));
  const listAfterBad = await api.getDemandList({ parentId: 'parent_demo_001' });
  check(
    '违规需求未写入数据库',
    listAfterBad.data.filter(function (d) { return d.grade === '初二'; }).length === 0,
    '当前 ' + listAfterBad.data.length + ' 条'
  );

  /* ================= B. 前端 ↔ 云函数规则一致 ================= */
  section('B. 前端 ↔ 云函数 双减规则一致性');
  const copies = {
    common: 'cloudfunctions/common/riskWords.js',
    riskCheck: 'cloudfunctions/riskCheck/riskWords.js',
    submitDemand: 'cloudfunctions/submitDemand/riskWords.js'
  };
  Object.keys(copies).forEach(function (k) {
    const p = path.join(ROOT, copies[k]);
    if (!fs.existsSync(p)) {
      check(k + ' 副本存在', false, '文件缺失');
      return;
    }
    const mod = require(p);
    const sameMsg = (mod.POLICY_DOUBLE_REDUCTION || {}).message === C.POLICY_DOUBLE_REDUCTION.message;
    check(k + ' 政策文案一致', sameMsg, sameMsg ? 'ok' : '不一致');
    let diff = 0;
    cases.forEach(function (c) {
      if (typeof mod.checkDoubleReduction !== 'function') {
        diff++;
        return;
      }
      if (mod.checkDoubleReduction(c.d).blocked !== risk.checkDoubleReduction(c.d).blocked) diff++;
    });
    check(k + ' 8 组用例判定一致', diff === 0, diff ? diff + ' 组不一致' : '全部一致');
  });

  /* ================= C. 接单池 ================= */
  section('C. 接单池筛选与计数');
  const poolAll = await api.getTutorPool({ tutorId: 'tutor_001' });
  check('返回 counts 计数', !!(poolAll.data && poolAll.data.counts), JSON.stringify(poolAll.data.counts));
  const poolMath = await api.getTutorPool({ tutorId: 'tutor_001', subject: '数学' });
  check('科目 Tab=数学', poolMath.data.list.every(function (r) { return r.demand.subject === '数学'; }), '条数=' + poolMath.data.list.length);
  const poolQuality = await api.getTutorPool({ tutorId: 'tutor_006', subject: 'quality' });
  check(
    '科目 Tab=素质拓展（聚合非学科类）',
    poolQuality.data.list.every(function (r) { return r.demand.subjectGroup === 'quality'; }),
    poolQuality.data.list.map(function (r) { return r.demand.subject; }).join('/')
  );
  const poolOnline = await api.getTutorPool({ tutorId: 'tutor_001', teachMode: 'online' });
  check('授课方式 Tab=线上', poolOnline.data.list.every(function (r) { return r.demand.teachMode === 'online'; }), '条数=' + poolOnline.data.list.length);
  const poolMatched = await api.getTutorPool({ tutorId: 'tutor_001', status: 'matched' });
  check(
    '状态 Tab=已匹配 只含我成单的',
    poolMatched.data.list.every(function (r) { return r.demand.matchedTutorId === 'tutor_001'; }),
    poolMatched.data.list.map(function (r) { return r.demandId; }).join('/')
  );
  const poolMin = await api.getTutorPool({ tutorId: 'tutor_001', minMatch: 70 });
  check('匹配度 ≥70 开关', poolMin.data.list.every(function (r) { return r.matchScore >= 70; }), '条数=' + poolMin.data.list.length);

  /* ================= D. 履约打卡 ================= */
  section('D. 确认成单 → 打卡 → 小结 → 家长确认');
  const good = await api.createDemand(
    { subject: '数学', grade: '初二', teachMode: 'online', timeRange: ['weekday_evening'], budgetMax: 150, isDiscipline: 'discipline' },
    { riskAcknowledged: true }
  );
  check('合规需求发布成功（学科类 + 工作日）', good.code === 0, 'demandId=' + (good.code === 0 ? good.data.demand.id : '-'));
  const id = good.code === 0 ? good.data.demand.id : '';

  const acc = await api.acceptApplication({ demandId: id, tutorId: 'tutor_002' });
  check('家长确认成单', acc.code === 0 && acc.data.demand.status === 'matched', 'status=' + (acc.data && acc.data.demand.status));
  check('成单后可打卡', api.canCheckin(acc.data.demand, 'tutor_002') === true);
  check('非成单师范生不可打卡', api.canCheckin(acc.data.demand, 'tutor_003') === false);

  const c1 = await api.startCheckin({ demandId: id, tutorId: 'tutor_002' });
  check('开始打卡（时间 + mock 定位）', c1.code === 0 && c1.data.checkin.location.mock === true, c1.data && c1.data.checkin.location.name);
  const dup = await api.startCheckin({ demandId: id, tutorId: 'tutor_002' });
  check('重复打卡幂等', dup.code === 0 && dup.data.duplicated === true);
  const short = await api.finishCheckin({ checkinId: c1.data.checkin.id, summary: '讲完了' });
  check('小结少于 10 字被拒', short.code !== 0, short.message);
  const fin = await api.finishCheckin({ checkinId: c1.data.checkin.id, summary: '本次课讲一元一次方程应用题，孩子独立完成 8/10 道，下次做行程问题。' });
  check('提交小结（待家长确认）', fin.code === 0 && fin.data.checkin.status === 'finished', 'duration=' + (fin.data && fin.data.checkin.durationMin) + 'min');
  const conf = await api.confirmCheckin({ checkinId: c1.data.checkin.id });
  check('家长确认履约', conf.code === 0 && conf.data.checkin.status === 'confirmed', 'confirmedAt=' + (conf.data && conf.data.checkin.confirmedAt));
  const ck = await api.getCheckins({ demandId: id });
  check('打卡统计', ck.data.stats.count === 1 && ck.data.stats.confirmedCount === 1, JSON.stringify(ck.data.stats));

  /* ================= E. 双向盲评 ================= */
  section('E. 双向盲评与信用分');
  const s1 = await api.getReviewState({ demandId: 'demo_demand_005', role: 'tutor' });
  check('师范生视角：对方已评但内容不可见', s1.data.hasOtherReviewed === true && s1.data.otherReview === null, 'hasOtherReviewed=' + s1.data.hasOtherReviewed);
  check('可评价', s1.data.canReview === true);
  check('未揭晓时不泄露对方评价（响应里无对方内容）', JSON.stringify(s1.data).indexOf('错题复盘') === -1 && s1.data.otherReview === null);

  const creditBefore = (await api.getCredit({ role: 'tutor', tutorId: 'tutor_001' })).data.creditScore;
  const r1 = await api.submitReview({
    demandId: 'demo_demand_005', role: 'tutor', rating: 5,
    tags: ['尊重老师', '付款及时'], comment: '家长很配合，提前准备好学习材料。'
  });
  check('师范生提交评价 → 双方揭晓', r1.code === 0 && r1.data.revealed === true && !!r1.data.otherReview, '对方评分=' + (r1.data && r1.data.otherReview && r1.data.otherReview.rating));
  const creditAfter = (await api.getCredit({ role: 'tutor', tutorId: 'tutor_001' })).data.creditScore;
  check('信用分动态更新', creditAfter > creditBefore, creditBefore + ' → ' + creditAfter);
  const again = await api.submitReview({ demandId: 'demo_demand_005', role: 'tutor', rating: 4, tags: [], comment: '改一下' });
  check('评价不可重复/篡改', again.code !== 0, again.message);
  const s2 = await api.getReviewState({ demandId: 'demo_demand_005', role: 'parent' });
  check('家长视角：双方评价均可见', s2.data.revealed === true && !!s2.data.otherReview, '对方评分=' + (s2.data.otherReview && s2.data.otherReview.rating));
  const revealed = await api.getReviews({ demandId: 'demo_demand_005' });
  check('已揭晓评价列表', revealed.data.length === 2, '条数=' + revealed.data.length);

  /* ================= F. 一期回归 ================= */
  section('F. 一期回归（风险词 / 匹配 / 报告）');
  const riskForm = {
    subject: '数学', grade: '初三', frequency: 'twice_week', timeRange: ['weekday_evening'],
    district: 'haidian', address: '北京市海淀区西三环北路 105 号', teachMode: 'offline',
    budgetMin: 120, budgetMax: 140, isDiscipline: 'discipline',
    specialRequirements: '需要先交押金，并提供身份证复印件'
  };
  const code2 = await api.createDemand(riskForm, { riskAcknowledged: false });
  check('风险词命中 → code 2（强提示可确认）', code2.code === 2, 'hits=' + (code2.data && code2.data.risk && code2.data.risk.hits.map(function (h) { return h.word; }).join('/')));
  const code0 = await api.createDemand(riskForm, { riskAcknowledged: true });
  check('确认后发布成功', code0.code === 0, 'demandId=' + (code0.code === 0 ? code0.data.demand.id : '-'));
  const rid = code0.code === 0 ? code0.data.demand.id : '';
  const m = await api.matchTutors(rid, { topN: 3 });
  check('匹配 Top3', m.code === 0 && m.data.list.length === 3, m.code === 0 ? m.data.list.map(function (x) { return x.tutor.name + '(' + x.score + ')'; }).join(' | ') : m.message);
  const rep = await api.generateReport(rid, { topMatches: m.code === 0 ? m.data.list : [] });
  check('生成对接报告', rep.code === 0 && rep.data.topMatches.length === 3, 'riskTips=' + (rep.code === 0 ? rep.data.riskTips.length : 0));
  check('报告含试课建议', rep.code === 0 && rep.data.trialAdvice.indexOf('试课建议') > -1, rep.code === 0 ? rep.data.trialAdvice : '');
  check('报告含平台性质声明', rep.code === 0 && rep.data.platformPosition.indexOf('非培训机构') > -1);
  const text = api.buildReportText(rep.data);
  check(
    '复制文本含一~七段与关键声明',
    text.indexOf('一、需求摘要') > -1 && text.indexOf('试课建议') > -1 && text.indexOf('非培训机构') > -1 && text.indexOf('七、免责声明') > -1,
    text.length + ' 字'
  );

  /* ================= G. 接单 / 取消接单 ================= */
  section('G. 接单与取消接单');
  const applyTarget = 'demo_demand_003'; // 招募/匹配中，未成单
  const beforeApply = await api.getDemandDetail(applyTarget);
  const beforeCount = beforeApply.code === 0 ? Number(beforeApply.data.applyCount || 0) : 0;

  const applied = await api.applyDemand({ demandId: applyTarget, tutorId: 'tutor_001', tutorName: '林嘉怡' });
  check('投递接单成功', applied.code === 0, applied.message);
  const afterApply = await api.getDemandDetail(applyTarget);
  check(
    '投递后申请数 +1',
    afterApply.code === 0 && Number(afterApply.data.applyCount || 0) === beforeCount + 1,
    beforeCount + ' → ' + (afterApply.code === 0 ? afterApply.data.applyCount : '?')
  );
  const myApps = await api.getMyApplications('tutor_001');
  check(
    '我的投递里能查到',
    myApps.code === 0 && myApps.data.some(function (a) { return a.demandId === applyTarget; }),
    '共 ' + (myApps.code === 0 ? myApps.data.length : 0) + ' 条'
  );

  const cancelled = await api.cancelApplication({ demandId: applyTarget, tutorId: 'tutor_001' });
  check('取消接单成功', cancelled.code === 0, cancelled.message);
  const afterCancel = await api.getDemandDetail(applyTarget);
  check(
    '取消后申请数回退',
    afterCancel.code === 0 && Number(afterCancel.data.applyCount || 0) === beforeCount,
    (afterApply.code === 0 ? afterApply.data.applyCount : '?') + ' → ' + (afterCancel.code === 0 ? afterCancel.data.applyCount : '?')
  );
  const myApps2 = await api.getMyApplications('tutor_001');
  check(
    '我的投递里已移除',
    myApps2.code === 0 && !myApps2.data.some(function (a) { return a.demandId === applyTarget; }),
    '剩 ' + (myApps2.code === 0 ? myApps2.data.length : 0) + ' 条'
  );
  const cancelAgain = await api.cancelApplication({ demandId: applyTarget, tutorId: 'tutor_001' });
  check('重复取消被拒（无记录可撤）', cancelAgain.code !== 0, cancelAgain.message);

  // 已成单的订单不允许撤回
  const matchedCancel = await api.cancelApplication({ demandId: 'demo_demand_005', tutorId: 'tutor_001' });
  check('已成单订单禁止撤回（code 3）', matchedCancel.code === 3, matchedCancel.message);

  /* ================= 汇总 ================= */
  console.log('');
  const total = pass + failures.length;
  if (failures.length) {
    console.log('=== ❌ ' + pass + '/' + total + ' 通过，失败项： ===');
    failures.forEach(function (f) { console.log('  - ' + f); });
    process.exit(1);
  }
  console.log('=== ✅ ' + total + '/' + total + ' 全部通过 ===');
  process.exit(0);
})().catch(function (err) {
  console.error('脚本异常：', err);
  process.exit(1);
});
