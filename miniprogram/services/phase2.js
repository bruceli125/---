/**
 * 二期业务模块：确认成单 / 履约打卡 / 课后小结 / 双向盲评 / 信用分 / 接单池筛选
 *
 * 【为什么单独成模块】
 * api.js 已承载一期全部读写接口，二期再往上堆会失控。这里独立成模块，
 * 由 api.js 末尾 `Object.assign(module.exports, require('./phase2.js'))` 统一挂载，
 * **页面仍只 require services/api.js**，不需要感知模块拆分。
 *
 * 【为什么自备 storage 读写】
 * 若这里 require('./api.js')，会与 api.js 形成循环依赖（api → phase2 → api）。
 * 因此本模块只依赖 constants / format / match / mock，storage 读写复用同一套 STORAGE_KEYS，
 * 与 api.js 操作同一份数据。读取时带 mock 兜底，保证 api.ensureSeed 之前也能正常工作。
 *
 * 统一返回 Promise<{code:0|-1|2|3, data, message}>：
 *   0 成功 / 1 参数错误（用 -1 与 fail 区分见下）/ 2 需二次确认 / 3 政策或规则禁止
 */
const {
  STORAGE_KEYS,
  DEMAND_STATUS,
  APPLY_STATUS,
  CHECKIN_STATUS,
  MOCK_CHECKIN_LOCATION,
  REVIEW_TAGS,
  REVIEW_STATUS,
  CREDIT_RULES,
  POOL_WEIGHTS,
  MATCH_CONFIG,
  CHAT_SENDER,
  NEGOTIATION,
  normalizeDemandStatus,
  DEMAND_STATUS_LABEL,
  TUTOR_PREFERENCES,
  PERSONALITY_TAGS
} = require('../utils/constants.js');
const fmt = require('../utils/format.js');
const matchService = require('./match.js');
const riskService = require('./risk.js');
const mockDemands = require('../mock/demands.js');
const mockTutors = require('../mock/tutors.js');
const mockCheckins = require('../mock/checkins.js');
const mockReviews = require('../mock/reviews.js');

/* ==================================================================
 * 公共工具
 * ================================================================== */

function ok(data, message) {
  return { code: 0, data: data, message: message || 'success' };
}

function fail(message, data) {
  return { code: -1, data: data || null, message: message || '操作失败' };
}

function readStore(key, fallback) {
  try {
    const value = wx.getStorageSync(key);
    if (value === '' || value === null || value === undefined) return fallback;
    return value;
  } catch (err) {
    console.warn('[phase2] 读取缓存失败 ' + key + '：', err);
    return fallback;
  }
}

function writeStore(key, value) {
  try {
    wx.setStorageSync(key, value);
    return true;
  } catch (err) {
    console.error('[phase2] 写入缓存失败 ' + key + '：', err);
    return false;
  }
}

/** 需求列表（storage 优先，未 seed 时用 mock 兜底） */
function loadDemands() {
  return readStore(STORAGE_KEYS.DEMANDS, mockDemands.cloneDemands());
}

function loadTutors() {
  return readStore(STORAGE_KEYS.TUTORS, mockTutors.cloneTutors());
}

function loadCheckins() {
  return readStore(STORAGE_KEYS.CHECKINS, mockCheckins.cloneCheckins());
}

function loadReviews() {
  return readStore(STORAGE_KEYS.REVIEWS, mockReviews.cloneReviews());
}

function loadUsers() {
  return readStore(STORAGE_KEYS.USERS, []);
}

function findById(list, id) {
  for (let i = 0; i < (list || []).length; i++) {
    if (list[i].id === id || list[i]._id === id) return list[i];
  }
  return null;
}

/* ==================================================================
 * 一、信用分（评价后动态更新）
 * ================================================================== */

/** 信用分夹取到 [60, 100]，保留 1 位小数 */
function clampCredit(value) {
  const v = Number(value || 0);
  const min = CREDIT_RULES.min;
  const max = CREDIT_RULES.max;
  return Math.round(Math.max(min, Math.min(max, v)) * 10) / 10;
}

/**
 * 评价 -> 信用分变化
 * 规则（与 constants.CREDIT_RULES 对应）：rating 主分 + 正向标签加成（低分不加成）
 * @param {number} rating 1~5
 * @param {Array<string>} tags
 */
function calcCreditDelta(rating, tags) {
  const r = Number(rating || 3);
  const byRating = CREDIT_RULES.byRating;
  const base = byRating[r] === undefined ? 0 : byRating[r];
  const tagCount = Math.min((tags || []).length, CREDIT_RULES.maxTagBonusCount);
  // 打分低于 4 星时，标签不再作为加分项（避免"差评+一堆好评标签"自相矛盾）
  const bonus = r >= 4 ? tagCount * CREDIT_RULES.tagBonus : 0;
  return Math.round((base + bonus) * 10) / 10;
}

/**
 * 把信用分变化写回被评价方
 * @param {'parent_to_tutor'|'tutor_to_parent'} direction
 * @param {{tutorId?:string, parentId?:string}} target
 * @param {number} delta
 * @returns {{role:string, before:number, after:number}}
 */
function applyCreditDelta(direction, target, delta) {
  const d = Number(delta || 0);
  if (direction === 'parent_to_tutor') {
    const tutors = loadTutors();
    const tutor = findById(tutors, target.tutorId);
    if (!tutor) return { role: 'tutor', before: 0, after: 0 };
    const before = Number(tutor.creditScore || CREDIT_RULES.base);
    tutor.creditScore = clampCredit(before + d);
    writeStore(STORAGE_KEYS.TUTORS, tutors);
    return { role: 'tutor', before: before, after: tutor.creditScore };
  }
  // 老师评家长：家长也有信用分（users.creditScore，默认 CREDIT_RULES.base）
  const users = loadUsers();
  let parent = null;
  for (let i = 0; i < users.length; i++) {
    if (users[i].parentId === target.parentId || users[i].id === target.parentId) {
      parent = users[i];
      break;
    }
  }
  if (!parent) return { role: 'parent', before: 0, after: 0 };
  const before = Number(parent.creditScore || CREDIT_RULES.base);
  parent.creditScore = clampCredit(before + d);
  writeStore(STORAGE_KEYS.USERS, users);
  return { role: 'parent', before: before, after: parent.creditScore };
}

/**
 * 信用分总览（我的页面 / 订单详情用）
 * @param {{role?:string, tutorId?:string, parentId?:string}} query
 */
function getCredit(query) {
  const q = query || {};
  const role = q.role || 'tutor';
  const reviews = loadReviews();
  if (role === 'tutor') {
    const tutor = findById(loadTutors(), q.tutorId || mockTutors.CURRENT_TUTOR_ID) || {};
    const mine = reviews.filter(function (r) {
      return r.direction === 'parent_to_tutor' && r.tutorId === tutor.id && r.status === REVIEW_STATUS.REVEALED;
    });
    const avg = mine.length
      ? Math.round((mine.reduce(function (s, r) { return s + Number(r.rating || 0); }, 0) / mine.length) * 10) / 10
      : 0;
    return Promise.resolve(
      ok({
        role: 'tutor',
        creditScore: Number(tutor.creditScore || CREDIT_RULES.base),
        reviewCount: mine.length,
        avgRating: avg,
        rules: CREDIT_RULES
      })
    );
  }
  const users = loadUsers();
  const parent = users.filter(function (u) { return u.role === 'parent'; })[0] || {};
  const mine = reviews.filter(function (r) {
    return r.direction === 'tutor_to_parent' && r.parentId === (q.parentId || parent.parentId) && r.status === REVIEW_STATUS.REVEALED;
  });
  return Promise.resolve(
    ok({
      role: 'parent',
      creditScore: Number(parent.creditScore || CREDIT_RULES.base),
      reviewCount: mine.length,
      avgRating: 0,
      rules: CREDIT_RULES
    })
  );
}

/* ==================================================================
 * 二、确认成单（家长确认某位师范生 -> 订单进入「已匹配」）
 * ================================================================== */

/**
 * @param {{demandId:string, tutorId:string}} payload
 */
function acceptApplication(payload) {
  const p = payload || {};
  if (!p.demandId) return Promise.resolve(fail('缺少 demandId'));
  if (!p.tutorId) return Promise.resolve(fail('缺少 tutorId'));

  const demands = loadDemands();
  const demand = findById(demands, p.demandId);
  if (!demand) return Promise.resolve(fail('需求不存在'));
  if (demand.status === DEMAND_STATUS.MATCHED) {
    return Promise.resolve(fail('该需求已成单，不能重复确认'));
  }
  demand.status = DEMAND_STATUS.MATCHED;
  demand.matchedTutorId = p.tutorId;
  demand.acceptedAt = fmt.formatDateTime(Date.now());
  writeStore(STORAGE_KEYS.DEMANDS, demands);

  // 申请记录同步状态：被选中的置 accepted，其余置 rejected
  const apps = readStore(STORAGE_KEYS.APPLICATIONS, []);
  apps.forEach(function (a) {
    if (a.demandId !== p.demandId) return;
    a.status = a.tutorId === p.tutorId ? APPLY_STATUS.ACCEPTED : APPLY_STATUS.REJECTED;
    a.updatedAt = fmt.formatDateTime(Date.now());
  });
  writeStore(STORAGE_KEYS.APPLICATIONS, apps);

  return Promise.resolve(ok({ demand: demand }, '已成单，可开始上课打卡'));
}

/* ==================================================================
 * 三、履约打卡 + 课后小结
 * ================================================================== */

/** 订单是否可打卡（已匹配 + 该师范生是成单人） */
function canCheckin(demand, tutorId) {
  if (!demand) return false;
  if (demand.status !== DEMAND_STATUS.MATCHED) return false;
  if (!demand.matchedTutorId) return false;
  return !tutorId || demand.matchedTutorId === tutorId;
}

/**
 * 开始打卡：记录开始时间 + mock 定位
 * @param {{demandId:string, tutorId:string}} payload
 */
function startCheckin(payload) {
  const p = payload || {};
  if (!p.demandId) return Promise.resolve(fail('缺少 demandId'));

  const demands = loadDemands();
  const demand = findById(demands, p.demandId);
  if (!demand) return Promise.resolve(fail('订单不存在'));
  const tutorId = p.tutorId || demand.matchedTutorId;
  if (!canCheckin(demand, tutorId)) {
    return Promise.resolve(fail('订单尚未成单，暂不能打卡'));
  }

  const checkins = loadCheckins();
  const active = checkins.filter(function (c) {
    return c.orderId === p.demandId && c.status === CHECKIN_STATUS.CHECKED_IN;
  })[0];
  if (active) {
    // 幂等：已在打卡中，直接返回，避免重复生成记录
    return Promise.resolve(ok({ checkin: active, duplicated: true }, '本次打卡已在进行中'));
  }

  const now = Date.now();
  const tutor = findById(loadTutors(), tutorId) || {};
  const record = {
    id: fmt.genId('checkin'),
    orderId: p.demandId,
    demandId: p.demandId,
    tutorId: tutorId,
    tutorName: tutor.name || '',
    parentId: demand.parentId || '',
    status: CHECKIN_STATUS.CHECKED_IN,
    summaryStatus: 'pending',
    startAt: fmt.formatDateTime(now),
    endAt: '',
    durationMin: 0,
    // TODO(二期+)：接入 wx.getLocation / 校内场地蓝牙信标做真实到课校验；
    //             当前为 mock 定位，不申请 scope.userLocation（隐私声明保持一致）
    location: Object.assign({}, MOCK_CHECKIN_LOCATION),
    summary: '',
    confirmedAt: '',
    createdAt: fmt.formatDateTime(now),
    createdAtTs: now
  };
  checkins.unshift(record);
  writeStore(STORAGE_KEYS.CHECKINS, checkins);
  return Promise.resolve(ok({ checkin: record }, '打卡成功，下课时请填写授课小结'));
}

/**
 * 结束打卡 + 提交课后小结
 * @param {{checkinId:string, summary:string}} payload
 */
function finishCheckin(payload) {
  const p = payload || {};
  if (!p.checkinId) return Promise.resolve(fail('缺少 checkinId'));
  const summary = String(p.summary || '').trim();
  if (summary.length < 10) {
    return Promise.resolve(fail('授课小结请至少填写 10 个字，家长需要据此确认'));
  }
  if (summary.length > 500) {
    return Promise.resolve(fail('授课小结请控制在 500 字以内'));
  }

  const checkins = loadCheckins();
  const record = findById(checkins, p.checkinId);
  if (!record) return Promise.resolve(fail('打卡记录不存在'));
  if (record.status === CHECKIN_STATUS.CONFIRMED) {
    return Promise.resolve(fail('本次打卡已结束并由家长确认，不能重复提交'));
  }
  if (record.status === CHECKIN_STATUS.FINISHED && !p.rewrite) {
    return Promise.resolve(fail('小结已提交，等待家长确认；如需修改请调用覆盖提交'));
  }

  const now = Date.now();
  const startTs = fmt.toTimestamp(record.startAt) || now;
  record.status = CHECKIN_STATUS.FINISHED;
  record.summaryStatus = 'pending';
  record.summary = summary;
  record.endAt = fmt.formatDateTime(now);
  record.durationMin = Math.max(1, Math.round((now - startTs) / 60000));
  writeStore(STORAGE_KEYS.CHECKINS, checkins);
  return Promise.resolve(ok({ checkin: record }, '小结已提交，等待家长确认'));
}

/**
 * 家长确认小结（履约闭环）
 * @param {{checkinId:string}} payload
 */
function confirmCheckin(payload) {
  const p = payload || {};
  if (!p.checkinId) return Promise.resolve(fail('缺少 checkinId'));
  const checkins = loadCheckins();
  const record = findById(checkins, p.checkinId);
  if (!record) return Promise.resolve(fail('打卡记录不存在'));
  if (record.status !== CHECKIN_STATUS.FINISHED) {
    return Promise.resolve(fail('只有待确认的小结才能确认'));
  }
  record.status = CHECKIN_STATUS.CONFIRMED;
  record.summaryStatus = 'confirmed';
  record.confirmedAt = fmt.formatDateTime(Date.now());
  writeStore(STORAGE_KEYS.CHECKINS, checkins);
  return Promise.resolve(ok({ checkin: record }, '已确认本次履约'));
}

/**
 * 查询打卡记录
 * @param {{demandId?:string, tutorId?:string}} query
 */
function getCheckins(query) {
  const q = query || {};
  let list = loadCheckins();
  if (q.demandId) list = list.filter(function (c) { return c.orderId === q.demandId || c.demandId === q.demandId; });
  if (q.tutorId) list = list.filter(function (c) { return c.tutorId === q.tutorId; });
  list = list.slice().sort(function (a, b) {
    return (b.createdAtTs || 0) - (a.createdAtTs || 0);
  });
  const stats = {
    count: list.length,
    totalMinutes: list.reduce(function (s, c) { return s + Number(c.durationMin || 0); }, 0),
    confirmedCount: list.filter(function (c) { return c.status === CHECKIN_STATUS.CONFIRMED; }).length,
    pendingCount: list.filter(function (c) { return c.status === CHECKIN_STATUS.FINISHED; }).length,
    activeCount: list.filter(function (c) { return c.status === CHECKIN_STATUS.CHECKED_IN; }).length
  };
  return Promise.resolve(ok({ list: list, stats: stats }));
}

/* ==================================================================
 * 四、双向盲评
 * ================================================================== */

function directionOfRole(role) {
  return role === 'parent' ? 'parent_to_tutor' : 'tutor_to_parent';
}

function counterDirection(direction) {
  return direction === 'parent_to_tutor' ? 'tutor_to_parent' : 'parent_to_tutor';
}

/**
 * 评价状态（决定页面显示"待你评价 / 等待对方 / 双方可见"）
 * @param {{demandId:string, role:'parent'|'tutor'}} query
 * @returns {Promise<{myReview, otherReview|null, revealed, canReview, counterpartRole,
 *                    hasOtherReviewed, tags, directionLabel}>}
 */
function getReviewState(query) {
  const q = query || {};
  if (!q.demandId) return Promise.resolve(fail('缺少 demandId'));
  const role = q.role === 'parent' ? 'parent' : 'tutor';
  const myDirection = directionOfRole(role);
  const otherDirection = counterDirection(myDirection);

  const reviews = loadReviews();
  const scoped = reviews.filter(function (r) { return r.orderId === q.demandId || r.demandId === q.demandId; });
  const myReview = scoped.filter(function (r) { return r.direction === myDirection; })[0] || null;
  const otherRaw = scoped.filter(function (r) { return r.direction === otherDirection; })[0] || null;
  // 盲评核心：对方评价只有在双方都提交（revealed）后才返回内容
  const revealed = !!(myReview && otherRaw && otherRaw.status === REVIEW_STATUS.REVEALED && otherRaw.visible);
  const otherReview = revealed ? otherRaw : null;

  const demands = loadDemands();
  const demand = findById(demands, q.demandId);
  const orderDone = !!demand && (demand.status === DEMAND_STATUS.MATCHED || demand.status === DEMAND_STATUS.CLOSED);

  return Promise.resolve(
    ok({
      myReview: myReview,
      otherReview: otherReview,
      revealed: revealed,
      /** 对方是否已提交（只暴露"已评价"这一事实，不暴露内容） */
      hasOtherReviewed: !!otherRaw,
      otherSubmittedAt: otherRaw && !revealed ? otherRaw.createdAt : '',
      canReview: orderDone && !myReview,
      counterpartRole: role === 'parent' ? 'tutor' : 'parent',
      direction: myDirection,
      tags: REVIEW_TAGS[myDirection],
      blindTip: '双向盲评：双方都提交评价后才能看到对方的评价内容。'
    })
  );
}

/**
 * 提交评价（单方提交后仍不可见，双方都提交后一起揭晓并结算信用分）
 * @param {{demandId:string, role:'parent'|'tutor', rating:number, tags:Array, comment:string,
 *          tutorId?:string, parentId?:string, reviewerName?:string, revieweeName?:string}} payload
 */
function submitReview(payload) {
  const p = payload || {};
  if (!p.demandId) return Promise.resolve(fail('缺少 demandId'));
  const role = p.role === 'parent' ? 'parent' : 'tutor';
  const rating = Number(p.rating || 0);
  if (!rating || rating < 1 || rating > 5) {
    return Promise.resolve(fail('请先选择 1~5 星评分'));
  }
  const myDirection = directionOfRole(role);
  const allowedTags = REVIEW_TAGS[myDirection];
  const tags = (p.tags || []).filter(function (t) { return allowedTags.indexOf(t) > -1; });
  const comment = String(p.comment || '').trim();
  if (comment.length > 200) {
    return Promise.resolve(fail('评价内容请控制在 200 字以内'));
  }

  const demands = loadDemands();
  const demand = findById(demands, p.demandId);
  if (!demand) return Promise.resolve(fail('订单不存在'));
  if (demand.status !== DEMAND_STATUS.MATCHED && demand.status !== DEMAND_STATUS.CLOSED) {
    return Promise.resolve(fail('订单尚未成单或未结束，暂不能评价'));
  }

  const reviews = loadReviews();
  const mine = reviews.filter(function (r) {
    return (r.orderId === p.demandId || r.demandId === p.demandId) && r.direction === myDirection;
  })[0];
  if (mine) return Promise.resolve(fail('您已提交过评价，评价不可修改'));

  const tutorId = p.tutorId || demand.matchedTutorId || '';
  const parentId = p.parentId || demand.parentId || '';
  const now = Date.now();
  const record = {
    id: fmt.genId('review'),
    orderId: p.demandId,
    demandId: p.demandId,
    tutorId: tutorId,
    parentId: parentId,
    direction: myDirection,
    reviewerRole: role,
    reviewerName: p.reviewerName || '',
    revieweeRole: role === 'parent' ? 'tutor' : 'parent',
    revieweeName: p.revieweeName || '',
    rating: rating,
    tags: tags,
    comment: comment,
    status: REVIEW_STATUS.PENDING,
    visible: false,
    creditDelta: 0,
    createdAt: fmt.formatDateTime(now),
    createdAtTs: now,
    revealedAt: ''
  };
  reviews.unshift(record);
  writeStore(STORAGE_KEYS.REVIEWS, reviews);

  // 检查对方是否已评 -> 双方都评则一起揭晓 + 结算信用分
  const otherDirection = counterDirection(myDirection);
  const other = reviews.filter(function (r) {
    return (r.orderId === p.demandId || r.demandId === p.demandId) && r.direction === otherDirection;
  })[0];

  if (!other) {
    return Promise.resolve(
      ok(
        {
          myReview: record,
          revealed: false,
          otherReview: null,
          creditDelta: 0,
          message: '评价已提交。双方都评价后才能互相看到内容。'
        },
        '评价已提交，等待对方评价'
      )
    );
  }

  // 双盲揭晓：两条一起可见 + 各算各的信用分
  const revealedAt = fmt.formatDateTime(now);
  const deltaMine = calcCreditDelta(record.rating, record.tags);
  const deltaOther = calcCreditDelta(other.rating, other.tags);

  record.status = REVIEW_STATUS.REVEALED;
  record.visible = true;
  record.creditDelta = deltaMine;
  record.revealedAt = revealedAt;
  other.status = REVIEW_STATUS.REVEALED;
  other.visible = true;
  other.creditDelta = deltaOther;
  other.revealedAt = revealedAt;

  // 我评对方 -> 影响对方分数；对方评我 -> 影响我的分数
  const mineImpact = applyCreditDelta(myDirection, { tutorId: tutorId, parentId: parentId }, deltaMine);
  const otherImpact = applyCreditDelta(otherDirection, { tutorId: tutorId, parentId: parentId }, deltaOther);

  writeStore(STORAGE_KEYS.REVIEWS, reviews);

  return Promise.resolve(
    ok(
      {
        myReview: record,
        otherReview: other,
        revealed: true,
        /** 我这次评价导致对方信用分的变化 */
        creditDelta: deltaMine,
        counterpartCredit: mineImpact,
        myCredit: otherImpact
      },
      '双方评价已揭晓，信用分已更新'
    )
  );
}

/** 已揭晓的评价列表（只返回双方都评完的，避免泄露） */
function getReviews(query) {
  const q = query || {};
  let list = loadReviews().filter(function (r) { return r.status === REVIEW_STATUS.REVEALED; });
  if (q.demandId) list = list.filter(function (r) { return r.orderId === q.demandId || r.demandId === q.demandId; });
  if (q.tutorId) list = list.filter(function (r) { return r.tutorId === q.tutorId; });
  return Promise.resolve(ok(list));
}

/* ==================================================================
 * 五、接单池（二期：科目 / 授课方式 / 状态 三组筛选 + 计数）
 * ================================================================== */

/** 科目 Tab 匹配：'all' 全放行；'quality' 聚合所有非学科类科目 */
function subjectMatched(demand, tab) {
  if (!tab || tab === 'all') return true;
  const group = demand.subjectGroup || riskService.subjectGroup(demand.subject);
  if (tab === 'quality') return group === 'quality';
  return demand.subject === tab;
}

/**
 * 接单池列表
 * @param {{tutorId?:string, subject?:string, teachMode?:string, status?:string, minMatch?:number}} query
 * @returns {Promise<{tutor, list, counts}>}
 */
function getTutorPool(query) {
  const q = query || {};
  const tutorId = q.tutorId || mockTutors.CURRENT_TUTOR_ID;
  const tutor = findById(loadTutors(), tutorId);
  if (!tutor) return Promise.resolve(fail('师范生档案不存在'));

  const all = loadDemands().filter(function (d) {
    return (
      d.status === DEMAND_STATUS.PUBLISHED ||
      d.status === DEMAND_STATUS.MATCHING ||
      d.status === DEMAND_STATUS.MATCHED
    );
  });

  // 1) 科目 + 授课方式筛选（这一层的计数用于 Tab 上的角标）
  const scoped = all.filter(function (d) {
    if (!subjectMatched(d, q.subject)) return false;
    if (q.teachMode && q.teachMode !== 'all' && d.teachMode !== q.teachMode) return false;
    return true;
  });

  // 2) 状态计数：已匹配只算「我成单的单」，否则别人成单的单对你是无意义的
  const mine = function (d) { return d.matchedTutorId === tutorId; };
  const counts = {
    published: scoped.filter(function (d) { return d.status === DEMAND_STATUS.PUBLISHED; }).length,
    matching: scoped.filter(function (d) { return d.status === DEMAND_STATUS.MATCHING; }).length,
    matched: scoped.filter(function (d) { return d.status === DEMAND_STATUS.MATCHED && mine(d); }).length,
    total: scoped.length
  };

  // 3) 状态筛选
  let filtered = scoped;
  if (q.status && q.status !== 'all') {
    if (q.status === DEMAND_STATUS.MATCHED) {
      filtered = scoped.filter(function (d) { return d.status === DEMAND_STATUS.MATCHED && mine(d); });
    } else {
      filtered = scoped.filter(function (d) { return d.status === q.status; });
    }
  } else {
    // 全部：不展示"别人已成单"的订单
    filtered = scoped.filter(function (d) {
      return d.status !== DEMAND_STATUS.MATCHED || mine(d);
    });
  }

  // 4) 打分排序（匹配度 50% + 距离 20% + 价格 15% + 信用分 15%）
  const ranked = matchService.rankPoolDemands(tutor, filtered);

  // 5) 匹配度阈值开关
  const minMatch = Number(q.minMatch || 0);
  const list = minMatch
    ? ranked.filter(function (r) { return Number(r.matchScore || 0) >= minMatch; })
    : ranked;

  return Promise.resolve(
    ok({
      tutor: tutor,
      list: list,
      counts: counts,
      filters: { subject: q.subject || 'all', teachMode: q.teachMode || 'all', status: q.status || 'all', minMatch: minMatch },
      weights: POOL_WEIGHTS,
      maxDistanceKm: MATCH_CONFIG.maxDistanceKm
    })
  );
}

/**
 * 取消接单（撤回投递）
 * 说明：仅在订单尚未成单、且投递记录仍是 applied 时允许撤回；
 *      撤回后需求侧 applyCount 同步减一，家长端看不到该投递。
 * @param {{demandId:string, tutorId:string}} payload
 */
function cancelApplication(payload) {
  const p = payload || {};
  if (!p.demandId) return Promise.resolve(fail('缺少 demandId'));
  if (!p.tutorId) return Promise.resolve(fail('缺少 tutorId'));

  const demands = loadDemands();
  const demand = findById(demands, p.demandId);
  if (!demand) return Promise.resolve(fail('需求不存在'));

  // 已成单（且是自己）不允许撤回：避免履约中丢掉订单关系
  if (demand.status === DEMAND_STATUS.MATCHED && demand.matchedTutorId === p.tutorId) {
    return Promise.resolve({
      code: 3,
      data: { demand: demand },
      message: '该订单已成单，如需取消请联系家长或平台运营'
    });
  }

  const apps = readStore(STORAGE_KEYS.APPLICATIONS, []);
  const target = apps.filter(function (a) {
    return a.demandId === p.demandId && a.tutorId === p.tutorId && a.status !== APPLY_STATUS.REJECTED;
  })[0];
  if (!target) return Promise.resolve(fail('没有找到可撤回的接单记录'));

  const rest = apps.filter(function (a) {
    return a.id !== target.id;
  });
  writeStore(STORAGE_KEYS.APPLICATIONS, rest);

  // 需求侧申请数减一（不低于 0）
  for (let i = 0; i < demands.length; i++) {
    if (demands[i].id === p.demandId) {
      demands[i].applyCount = Math.max(0, Number(demands[i].applyCount || 0) - 1);
      break;
    }
  }
  writeStore(STORAGE_KEYS.DEMANDS, demands);

  return Promise.resolve(ok({ removed: target, demandId: p.demandId }, '已取消接单'));
}

/* ==================================================================
 * 八、三期：沟通会话 + 双向确认状态机
 * ------------------------------------------------------------------
 * 状态主线：recruiting（招募中）→ communicating（沟通中）→ matched（已匹配）
 *
 *   [学生] 长按报名 signupByHold()
 *        ├─ 写 applications（投递记录）
 *        ├─ demands.status: recruiting → communicating
 *        ├─ 建沟通会话（demandId × tutorId 唯一）
 *        └─ 自动生成一条开场消息（长得像学生发的，但由系统写入，标记 auto）
 *
 *   [双方] 在会话里自由发文字消息 sendChatMessage()
 *
 *   [学生] 确认接单 confirmByStudent()   → studentConfirmed = true
 *   [家长] 同意雇佣 confirmByParent()    → parentConfirmed  = true
 *
 *   两者都为 true 时才 matched（见 settleIfBothConfirmed），并写入系统消息
 *   「双方已达成共识，正式匹配成功！」。任一方单独确认只发提示消息，状态不变。
 *
 * 为什么不做「学生确认即 matched」：家长可能同时和多个学生沟通，
 * 若学生单方点击就成单，会造成一个需求被多次占用。双向确认是撮合的最小安全集。
 * ================================================================== */

/** 会话 id：一个需求 + 一个学生 = 一条独立会话 */
function threadIdOf(demandId, tutorId) {
  return 'chat__' + demandId + '__' + tutorId;
}

/** 极简模板替换：{name} 形式的占位符换成变量值 */
function renderTemplate(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, function (m, key) {
    const v = vars && vars[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

function loadChats() {
  return readStore(STORAGE_KEYS.CHATS, []);
}

function saveChats(list) {
  writeStore(STORAGE_KEYS.CHATS, list);
}

function loadMessages() {
  return readStore(STORAGE_KEYS.MESSAGES, []);
}

function saveMessages(list) {
  writeStore(STORAGE_KEYS.MESSAGES, list);
}

/** 认证等级 → 中文，用于开场白 */
function certLevelText(level) {
  const map = { 1: '学籍认证', 2: '双重认证', 3: '三重认证' };
  return map[Number(level)] || '平台认证';
}

/**
 * 追加一条消息
 * @param {string} threadId
 * @param {'student'|'parent'|'system'} sender
 * @param {string} text
 * @param {object} [extra] 额外字段（如 auto:true 表示系统代学生生成）
 */
function appendMessage(threadId, sender, text, extra) {
  const messages = loadMessages();
  const msg = Object.assign(
    {
      id: fmt.genId('msg'),
      threadId: threadId,
      sender: sender,
      text: text,
      createdAt: fmt.formatDateTime(Date.now()),
      createdAtTs: Date.now()
    },
    extra || {}
  );
  messages.push(msg);

  // 只保留最近 N 条，避免 storage 无限增长（mock 阶段的简单容量控制）
  const limit = NEGOTIATION.maxMessages || 200;
  const trimmed = messages.length > limit ? messages.slice(messages.length - limit) : messages;
  saveMessages(trimmed);
  return msg;
}

/** 取某会话的消息（按时间正序） */
function messagesOf(threadId) {
  return loadMessages()
    .filter(function (m) {
      return m.threadId === threadId;
    })
    .sort(function (a, b) {
      return a.createdAtTs - b.createdAtTs;
    });
}

/**
 * 确保会话存在
 * @returns {{thread:object, created:boolean}}
 */
function ensureThread(demand, tutorId) {
  const chats = loadChats();
  const id = threadIdOf(demand.id, tutorId);
  let thread = chats.filter(function (c) {
    return c.id === id;
  })[0];
  if (thread) return { thread: thread, created: false };

  thread = {
    id: id,
    demandId: demand.id,
    demandTitle: demand.title || demand.subject + ' / ' + demand.grade,
    parentId: demand.parentId || '',
    parentName: demand.parentName || '家长',
    tutorId: tutorId,
    status: 'open',
    createdAt: fmt.formatDateTime(Date.now()),
    createdAtTs: Date.now(),
    lastMessage: '',
    lastMessageAt: ''
  };
  chats.unshift(thread);
  saveChats(chats);
  return { thread: thread, created: true };
}

/** 更新会话的最后一条消息摘要（列表页要展示） */
function touchThread(threadId, text) {
  const chats = loadChats();
  for (let i = 0; i < chats.length; i++) {
    if (chats[i].id === threadId) {
      chats[i].lastMessage = text;
      chats[i].lastMessageAt = fmt.formatDateTime(Date.now());
      break;
    }
  }
  saveChats(chats);
}

/**
 * 学生长按报名（三期入口）
 * ------------------------------------------------------------------
 * 与一期 applyDemand 的差别：报名即开启沟通，并把需求推进到 communicating。
 * 幂等：重复长按不会重复建会话、不会重复发开场白。
 */
function signupByHold(payload) {
  const p = payload || {};
  if (!p.demandId) return Promise.resolve(fail('缺少 demandId'));
  if (!p.tutorId) return Promise.resolve(fail('缺少 tutorId'));

  const demands = loadDemands();
  const demand = findById(demands, p.demandId);
  if (!demand) return Promise.resolve(fail('需求不存在'));

  const status = normalizeDemandStatus(demand.status);
  if (status === DEMAND_STATUS.MATCHED) {
    return Promise.resolve({
      code: 3,
      data: { demand: demand },
      message: '该需求已完成匹配，无法再报名'
    });
  }
  if (status === DEMAND_STATUS.CLOSED) {
    return Promise.resolve({ code: 3, data: { demand: demand }, message: '该需求已结束' });
  }

  /* ---- 1. 写投递记录（已存在则复用，不重复计数） ---- */
  const apps = readStore(STORAGE_KEYS.APPLICATIONS, []);
  let record = apps.filter(function (a) {
    return a.demandId === p.demandId && a.tutorId === p.tutorId;
  })[0];

  if (record && record.status === APPLY_STATUS.ACCEPTED) {
    return Promise.resolve(ok({ demand: demand, application: record }, '您已被家长选中，无需重复报名'));
  }

  const now = fmt.formatDateTime(Date.now());
  if (!record) {
    record = {
      id: fmt.genId('apply'),
      demandId: p.demandId,
      tutorId: p.tutorId,
      tutorName: p.tutorName || '',
      status: APPLY_STATUS.APPLIED,
      message: '',
      channel: 'hold_longpress',
      createdAt: now,
      createdAtTs: Date.now(),
      updatedAt: now
    };
    apps.unshift(record);
    writeStore(STORAGE_KEYS.APPLICATIONS, apps);
    demand.applyCount = Number(demand.applyCount || 0) + 1;
  } else {
    record.status = APPLY_STATUS.APPLIED;
    record.updatedAt = now;
    writeStore(STORAGE_KEYS.APPLICATIONS, apps);
  }

  /* ---- 2. 状态机：recruiting / matching → communicating ---- */
  if (status === DEMAND_STATUS.RECRUITING || status === DEMAND_STATUS.MATCHING) {
    demand.status = DEMAND_STATUS.COMMUNICATING;
  }
  if (demand.studentConfirmed === undefined) demand.studentConfirmed = false;
  if (demand.parentConfirmed === undefined) demand.parentConfirmed = false;
  writeStore(STORAGE_KEYS.DEMANDS, demands);

  /* ---- 3. 建会话 + 开场白（仅首次） ---- */
  const ensured = ensureThread(demand, p.tutorId);
  const thread = ensured.thread;
  let opened = [];

  if (ensured.created) {
    const tutor = findById(loadTutors(), p.tutorId) || {};
    const text = renderTemplate(NEGOTIATION.templates.signup, {
      university: tutor.school || '首都师范大学',
      name: tutor.name || p.tutorName || '同学',
      certLevel: certLevelText(tutor.certLevel),
      demandTitle: thread.demandTitle
    });
    // sender=student 让家长端看起来像学生发来的；auto=true 标明是系统代写
    appendMessage(thread.id, CHAT_SENDER.STUDENT, text, { auto: true });
    touchThread(thread.id, text);
    opened = messagesOf(thread.id);
  }

  return Promise.resolve(
    ok(
      {
        demand: demand,
        application: record,
        thread: thread,
        messages: opened.length ? opened : messagesOf(thread.id)
      },
      '报名成功，已开启沟通'
    )
  );
}

/** 会话详情（消息 + 协商状态），页面进入沟通弹层时调用 */
function getChatThread(query) {
  const q = query || {};
  if (!q.demandId || !q.tutorId) return Promise.resolve(fail('缺少 demandId 或 tutorId'));

  const demand = findById(loadDemands(), q.demandId);
  if (!demand) return Promise.resolve(fail('需求不存在'));

  const chats = loadChats();
  const thread = chats.filter(function (c) {
    return c.id === threadIdOf(q.demandId, q.tutorId);
  })[0];

  const status = normalizeDemandStatus(demand.status);
  const messages = thread ? messagesOf(thread.id) : [];

  return Promise.resolve(
    ok({
      demand: demand,
      thread: thread || null,
      messages: messages,
      negotiation: {
        status: status,
        statusLabel: DEMAND_STATUS_LABEL[status] || status,
        studentConfirmed: !!demand.studentConfirmed,
        parentConfirmed: !!demand.parentConfirmed,
        bothConfirmed: !!demand.studentConfirmed && !!demand.parentConfirmed,
        tip: NEGOTIATION.statusTip[status] || ''
      }
    })
  );
}

/** 发一条文字消息（双方都走这个接口，sender 由页面按当前角色传） */
function sendChatMessage(payload) {
  const p = payload || {};
  if (!p.demandId || !p.tutorId) return Promise.resolve(fail('缺少 demandId 或 tutorId'));
  const text = String(p.text || '').trim();
  if (!text) return Promise.resolve(fail('消息不能为空'));
  if (text.length > (NEGOTIATION.maxMessageLen || 500)) {
    return Promise.resolve(fail('单条消息过长，请精简'));
  }

  const sender = p.sender === CHAT_SENDER.PARENT ? CHAT_SENDER.PARENT : CHAT_SENDER.STUDENT;
  const demand = findById(loadDemands(), p.demandId);
  if (!demand) return Promise.resolve(fail('需求不存在'));

  const ensured = ensureThread(demand, p.tutorId);
  const msg = appendMessage(ensured.thread.id, sender, text);
  touchThread(ensured.thread.id, text);

  return Promise.resolve(ok({ message: msg, thread: ensured.thread }, '已发送'));
}

/**
 * 双方都确认 → 正式匹配（内部函数）
 * @returns {boolean} 是否完成匹配
 */
function settleIfBothConfirmed(demand, tutorId) {
  if (!demand.studentConfirmed || !demand.parentConfirmed) return false;

  const now = fmt.formatDateTime(Date.now());
  demand.status = DEMAND_STATUS.MATCHED;
  demand.matchedTutorId = tutorId;
  demand.acceptedAt = now;
  writeStore(STORAGE_KEYS.DEMANDS, loadDemands().map(function (d) {
    return d.id === demand.id ? demand : d;
  }));

  // 投递记录：中标者 accepted，同需求其他投递置 rejected（避免"一对多"悬空）
  const apps = readStore(STORAGE_KEYS.APPLICATIONS, []);
  apps.forEach(function (a) {
    if (a.demandId !== demand.id) return;
    a.status = a.tutorId === tutorId ? APPLY_STATUS.ACCEPTED : APPLY_STATUS.REJECTED;
    a.updatedAt = now;
  });
  writeStore(STORAGE_KEYS.APPLICATIONS, apps);

  const threadId = threadIdOf(demand.id, tutorId);
  const sys = NEGOTIATION.templates.matched;
  appendMessage(threadId, CHAT_SENDER.SYSTEM, sys);
  touchThread(threadId, sys);
  return true;
}

/** 学生点【确认接单】 */
function confirmByStudent(payload) {
  const p = payload || {};
  if (!p.demandId || !p.tutorId) return Promise.resolve(fail('缺少 demandId 或 tutorId'));

  const demands = loadDemands();
  const demand = findById(demands, p.demandId);
  if (!demand) return Promise.resolve(fail('需求不存在'));

  const status = normalizeDemandStatus(demand.status);
  if (status === DEMAND_STATUS.MATCHED) {
    return Promise.resolve({ code: 3, data: { demand: demand }, message: '该需求已匹配成功' });
  }
  if (demand.studentConfirmed) {
    return Promise.resolve(ok({ demand: demand }, '您已确认过，等待家长确认'));
  }

  demand.studentConfirmed = true;
  if (demand.parentConfirmed === undefined) demand.parentConfirmed = false;
  writeStore(STORAGE_KEYS.DEMANDS, demands);

  const threadId = threadIdOf(p.demandId, p.tutorId);
  ensureThread(demand, p.tutorId);
  const sys = NEGOTIATION.templates.studentConfirmed;
  appendMessage(threadId, CHAT_SENDER.SYSTEM, sys);
  touchThread(threadId, sys);

  const matched = settleIfBothConfirmed(demand, p.tutorId);
  return Promise.resolve(
    ok(
      { demand: demand, matched: matched },
      matched ? NEGOTIATION.templates.matched : '已确认接单，等待家长同意雇佣'
    )
  );
}

/** 家长点【同意雇佣】 */
function confirmByParent(payload) {
  const p = payload || {};
  if (!p.demandId || !p.tutorId) return Promise.resolve(fail('缺少 demandId 或 tutorId'));

  const demands = loadDemands();
  const demand = findById(demands, p.demandId);
  if (!demand) return Promise.resolve(fail('需求不存在'));

  const status = normalizeDemandStatus(demand.status);
  if (status === DEMAND_STATUS.MATCHED) {
    return Promise.resolve({ code: 3, data: { demand: demand }, message: '该需求已匹配成功' });
  }
  if (demand.parentConfirmed) {
    return Promise.resolve(ok({ demand: demand }, '您已同意过，等待学生确认'));
  }

  demand.parentConfirmed = true;
  if (demand.studentConfirmed === undefined) demand.studentConfirmed = false;
  writeStore(STORAGE_KEYS.DEMANDS, demands);

  const threadId = threadIdOf(p.demandId, p.tutorId);
  ensureThread(demand, p.tutorId);
  const sys = NEGOTIATION.templates.parentConfirmed;
  appendMessage(threadId, CHAT_SENDER.SYSTEM, sys);
  touchThread(threadId, sys);

  const matched = settleIfBothConfirmed(demand, p.tutorId);
  return Promise.resolve(
    ok(
      { demand: demand, matched: matched },
      matched ? NEGOTIATION.templates.matched : '已同意雇佣，等待学生确认接单'
    )
  );
}

/**
 * 家长端：某需求下的全部沟通会话（含学生基本信息与最后一条消息）
 * 用于"家长在需求详情页看沟通列表"
 */
function getDemandChats(query) {
  const q = query || {};
  if (!q.demandId) return Promise.resolve(fail('缺少 demandId'));

  const demand = findById(loadDemands(), q.demandId);
  if (!demand) return Promise.resolve(fail('需求不存在'));

  const tutors = loadTutors();
  const chats = loadChats().filter(function (c) {
    return c.demandId === q.demandId;
  });

  const list = chats.map(function (c) {
    const tutor = findById(tutors, c.tutorId) || {};
    const msgs = messagesOf(c.id);
    return {
      threadId: c.id,
      tutorId: c.tutorId,
      tutorName: tutor.name || c.tutorName || '同学',
      tutorMajor: tutor.major || '',
      certLevel: tutor.certLevel || 1,
      creditScore: tutor.creditScore || 0,
      lastMessage: c.lastMessage || '',
      lastMessageAt: c.lastMessageAt || '',
      messageCount: msgs.length,
      /** 该学生是否已确认接单 */
      studentConfirmed: !!demand.studentConfirmed
    };
  });

  return Promise.resolve(
    ok({
      demand: demand,
      list: list,
      status: normalizeDemandStatus(demand.status),
      parentConfirmed: !!demand.parentConfirmed
    })
  );
}


/**
 * 三期：更新师范生的「接单偏好」与「性格特点」
 * ------------------------------------------------------------------
 * 这两个标签同时服务于：① 匹配算法加分；② 家长在推荐理由里看到差异化信息。
 * 只允许写入 constants 里定义的合法值，防止前端传脏数据进来。
 */
function updateTutorTags(payload) {
  const p = payload || {};
  if (!p.tutorId) return Promise.resolve(fail('缺少 tutorId'));

  const tutors = loadTutors();
  const tutor = findById(tutors, p.tutorId);
  if (!tutor) return Promise.resolve(fail('师范生档案不存在'));

  if (Array.isArray(p.preferences)) {
    tutor.preferences = p.preferences.filter(function (v) {
      return TUTOR_PREFERENCES.some(function (o) {
        return o.value === v;
      });
    });
  }
  if (Array.isArray(p.personality)) {
    tutor.personality = p.personality.filter(function (v) {
      return PERSONALITY_TAGS.some(function (o) {
        return o.value === v;
      });
    });
  }
  tutor.tagsUpdatedAt = fmt.formatDateTime(Date.now());
  writeStore(STORAGE_KEYS.TUTORS, tutors);

  return Promise.resolve(
    ok({ tutor: tutor, preferences: tutor.preferences, personality: tutor.personality }, '标签已保存')
  );
}

/** 读取师范生的接单偏好与性格标签（档案页编辑用） */
function getTutorTags(tutorId) {
  if (!tutorId) return Promise.resolve(fail('缺少 tutorId'));
  const tutor = findById(loadTutors(), tutorId);
  if (!tutor) return Promise.resolve(fail('师范生档案不存在'));
  return Promise.resolve(
    ok({
      tutorId: tutorId,
      preferences: tutor.preferences || [],
      personality: tutor.personality || []
    })
  );
}

module.exports = {
  /* 信用分 */
  getCredit: getCredit,
  calcCreditDelta: calcCreditDelta,
  clampCredit: clampCredit,

  /* 成单 / 接单 */
  acceptApplication: acceptApplication,
  cancelApplication: cancelApplication,

  /* 履约打卡 */
  canCheckin: canCheckin,
  startCheckin: startCheckin,
  finishCheckin: finishCheckin,
  confirmCheckin: confirmCheckin,
  getCheckins: getCheckins,

  /* 双向盲评 */
  getReviewState: getReviewState,
  submitReview: submitReview,
  getReviews: getReviews,

  /* 接单池（覆盖 api.js 的一期实现） */
  getTutorPool: getTutorPool,

  /* 三期：沟通 + 双向确认 */
  signupByHold: signupByHold,
  getChatThread: getChatThread,
  sendChatMessage: sendChatMessage,
  confirmByStudent: confirmByStudent,
  confirmByParent: confirmByParent,
  getDemandChats: getDemandChats,
  updateTutorTags: updateTutorTags,
  getTutorTags: getTutorTags
};

/* ==================================================================
 * 云开发模式下的显式保护
 * ------------------------------------------------------------------
 * 本模块目前是**纯 mock 实现**（读写本地 Storage）。若 APP_INFO.useCloud = true，
 * 继续用本地数据会造成"云端需求 + 本地打卡/评价"的静默数据错乱，比直接报错更难排查。
 * 因此云模式下统一返回明确的未实现提示（与 api.js 里各读接口的处理方式一致），
 * 待二期把 submitCheckin / submitReview / accept / pool 接到云函数后再移除本段。
 * TODO(二期+)：接线后删除该保护，并删掉本注释。
 * ================================================================== */
const USE_CLOUD = !!(require('../utils/constants.js').APP_INFO || {}).useCloud;

if (USE_CLOUD) {
  const GUARDED = [
    'getCredit',
    'acceptApplication',
    'cancelApplication',
    'startCheckin',
    'finishCheckin',
    'confirmCheckin',
    'getCheckins',
    'getReviewState',
    'submitReview',
    'getReviews',
    'getTutorPool',
    /* 三期：沟通与双向确认（云函数未接线前一律显式报错，避免半截数据） */
    'signupByHold',
    'getChatThread',
    'sendChatMessage',
    'confirmByStudent',
    'confirmByParent',
    'getDemandChats'
  ];
  GUARDED.forEach(function (name) {
    module.exports[name] = function () {
      return Promise.resolve({
        code: -1,
        data: null,
        message: '云函数模式尚未实现 ' + name + '()：请先在 services/api.js 接线对应云函数，或把 APP_INFO.useCloud 改回 false'
      });
    };
  });
}
