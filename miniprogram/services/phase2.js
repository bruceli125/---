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
  MATCH_CONFIG
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

module.exports = {
  /* 信用分 */
  getCredit: getCredit,
  calcCreditDelta: calcCreditDelta,
  clampCredit: clampCredit,

  /* 成单 */
  acceptApplication: acceptApplication,

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
  getTutorPool: getTutorPool
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
    'startCheckin',
    'finishCheckin',
    'confirmCheckin',
    'getCheckins',
    'getReviewState',
    'submitReview',
    'getReviews',
    'getTutorPool'
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
