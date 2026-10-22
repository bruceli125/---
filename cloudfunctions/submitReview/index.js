/**
 * 云函数：submitReview —— 双向盲评（查状态 / 提交评价 / 查已揭晓列表）
 * ------------------------------------------------------------------
 * 为什么要盲评：家教是典型的双向信任交易，若一方先看到对方评价再打分，
 * 会出现「报复性差评」和「讨好性好评」。因此规则是：
 *   - 单方提交：status='pending'、visible=false，**对方绝对看不到内容**，
 *     只能看到一个「对方已评价」的事实（hasOtherReviewed）；
 *   - 双方都提交：两条一起置 status='revealed'、visible=true、写入 revealedAt，
 *     并各自结算信用分；
 *   - 翻转必须由服务端统一执行，前端无法单方面揭晓。
 *
 * 入参（三种 action）：
 *   1) action === 'state'：{ demandId, role: 'parent'|'tutor' }
 *      返回 data: { myReview, otherReview, revealed, hasOtherReviewed, otherSubmittedAt,
 *                   canReview, tags, counterpartRole, direction, blindTip }
 *      ⚠️ 盲评核心：revealed=false 时 otherReview 恒为 null（不返回对方任何内容）
 *   2) action === 'submit'（默认）：{ demandId, role, rating(1~5), tags[], comment<=200,
 *                                    tutorId?, parentId?, reviewerName?, revieweeName? }
 *      返回 data: { myReview, otherReview, revealed, creditDelta, counterpartCredit?, myCredit? }
 *   3) action === 'list'：{ demandId?, tutorId? }
 *      返回 data: { list }（仅 revealed 且 visible 的评价）
 *
 * 返回码：0 成功 / 1 参数错误 / -1 服务端异常
 * 依赖集合：reviews、demands、tutors、users
 * 前端调用点：miniprogram/services/phase2.js -> getReviewState / submitReview / getReviews
 *
 * TODO(二期)：
 *   - 信用分申诉与人工复核（当前一评即生效，不可撤销）
 *   - 恶意评价识别（关键词 + 举报 + 人工审核后隐藏）
 *   - 评价提醒（订阅消息）与超时自动关闭（例如 7 天未评价视为放弃）
 *   - 权限：校验 OPENID 与该角色（家长 / 学生）归属，防止代评
 */

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const COLLECTIONS = {
  REVIEWS: 'reviews',
  DEMANDS: 'demands',
  TUTORS: 'tutors',
  USERS: 'users'
};

/** 评价方向（与 constants.js REVIEW_TAGS 的 key 一致） */
const DIRECTION = {
  PARENT_TO_TUTOR: 'parent_to_tutor',
  TUTOR_TO_PARENT: 'tutor_to_parent'
};

/** 双向盲评标签（与 constants.js REVIEW_TAGS 逐字一致） */
const REVIEW_TAGS = {
  parent_to_tutor: ['准时', '专业', '耐心', '提分帮助', '沟通顺畅'],
  tutor_to_parent: ['尊重老师', '付款及时', '环境安全', '诉求合理']
};

/** 评价状态（与 constants.js REVIEW_STATUS 一致） */
const REVIEW_STATUS = {
  PENDING: 'pending',
  REVEALED: 'revealed'
};

/**
 * 信用分规则（与 constants.js CREDIT_RULES 逐字一致）
 * rating 5 分 +3、1 分 -4；每命中 1 个正向标签 +0.5（最多计 3 个）；上下限 60~100
 */
const CREDIT_RULES = {
  base: 80,
  min: 60,
  max: 100,
  byRating: { 5: 3, 4: 1.5, 3: 0, 2: -2, 1: -4 },
  tagBonus: 0.5,
  maxTagBonusCount: 3
};

/** 评价内容长度上限（与 services/phase2.js submitReview 一致） */
const COMMENT_MAX_LENGTH = 200;

/** 需求状态（与 constants.js DEMAND_STATUS 一致，仅取评价需要的两个） */
const DEMAND_STATUS = {
  MATCHED: 'matched',
  CLOSED: 'closed'
};

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

/* ============================ 工具函数 ============================ */

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

/** 角色 -> 评价方向 */
function directionOfRole(role) {
  return role === 'parent' ? DIRECTION.PARENT_TO_TUTOR : DIRECTION.TUTOR_TO_PARENT;
}

/** 反向评价方向 */
function counterDirection(direction) {
  return direction === DIRECTION.PARENT_TO_TUTOR ? DIRECTION.TUTOR_TO_PARENT : DIRECTION.PARENT_TO_TUTOR;
}

/** 信用分夹取到 [60, 100]，保留 1 位小数（与 phase2.clampCredit 一致） */
function clampCredit(value) {
  const v = Number(value || 0);
  return Math.round(Math.max(CREDIT_RULES.min, Math.min(CREDIT_RULES.max, v)) * 10) / 10;
}

/**
 * 评价 -> 信用分变化（与 phase2.calcCreditDelta 逐字一致）
 * rating 主分 + 正向标签加成（打分低于 4 星时不计标签加分，避免"差评+一堆好评标签"自相矛盾）
 */
function calcCreditDelta(rating, tags) {
  const r = Number(rating || 3);
  const byRating = CREDIT_RULES.byRating;
  const base = byRating[r] === undefined ? 0 : byRating[r];
  const tagCount = Math.min((tags || []).length, CREDIT_RULES.maxTagBonusCount);
  const bonus = r >= 4 ? tagCount * CREDIT_RULES.tagBonus : 0;
  return Math.round((base + bonus) * 10) / 10;
}

/** 按 _id 或 id 字段查询需求 */
async function findDemandById(demandId) {
  let doc = null;
  try {
    const res = await db.collection(COLLECTIONS.DEMANDS).doc(demandId).get();
    doc = res && res.data;
  } catch (err) {
    console.warn('[submitReview] 按 _id 查询需求失败，尝试按 id 字段查询：', err);
  }
  if (!doc) {
    const res2 = await db.collection(COLLECTIONS.DEMANDS).where({ id: demandId }).limit(1).get();
    const list = (res2 && res2.data) || [];
    if (list.length) doc = list[0];
  }
  return doc || null;
}

/**
 * 查询某订单的全部评价（两条：家长评老师 + 老师评家长）
 * 兼容 orderId / demandId 两种存法
 */
async function findReviewsByOrder(demandId) {
  let list = [];
  try {
    const res = await db.collection(COLLECTIONS.REVIEWS).where({ orderId: demandId }).limit(10).get();
    list = (res && res.data) || [];
  } catch (err) {
    console.warn('[submitReview] 按 orderId 查询评价失败：', err);
  }
  if (!list.length) {
    try {
      const res2 = await db.collection(COLLECTIONS.REVIEWS).where({ demandId: demandId }).limit(10).get();
      list = (res2 && res2.data) || [];
    } catch (err2) {
      console.warn('[submitReview] 按 demandId 查询评价失败：', err2);
    }
  }
  return list;
}

/**
 * 按 _id 或 id 字段查询打卡/评价等通用文档
 * （这里仅用于 reviews 的去重校验，避免前端传入的 id 与 _id 不一致时漏判）
 */
async function findReviewById(reviewId) {
  try {
    const res = await db.collection(COLLECTIONS.REVIEWS).doc(reviewId).get();
    return (res && res.data) || null;
  } catch (err) {
    return null;
  }
}

/* ============================ 信用分结算 ============================ */

/**
 * 更新学生信用分（家长评老师）
 * @returns {Promise<{role:string, before:number, after:number, applied:boolean}>}
 */
async function updateTutorCredit(tutorId, delta) {
  if (!tutorId) return { role: 'tutor', before: 0, after: 0, applied: false };
  let tutor = null;
  try {
    const res = await db.collection(COLLECTIONS.TUTORS).doc(tutorId).get();
    tutor = res && res.data;
  } catch (err) {
    console.warn('[submitReview] 按 _id 查询 tutors 失败，尝试按 id 查询：', err);
  }
  if (!tutor) {
    try {
      const res2 = await db.collection(COLLECTIONS.TUTORS).where({ id: tutorId }).limit(1).get();
      const list = (res2 && res2.data) || [];
      if (list.length) tutor = list[0];
    } catch (err2) {
      console.warn('[submitReview] 按 id 查询 tutors 失败：', err2);
    }
  }
  if (!tutor) {
    console.warn('[submitReview] 未找到学生档案，跳过信用分结算：' + tutorId);
    return { role: 'tutor', before: 0, after: 0, applied: false };
  }

  const before = Number(tutor.creditScore === undefined ? CREDIT_RULES.base : tutor.creditScore);
  const after = clampCredit(before + Number(delta || 0));
  try {
    await db.collection(COLLECTIONS.TUTORS).doc(tutor._id).update({
      data: { creditScore: after, creditUpdatedAt: db.serverDate() }
    });
    return { role: 'tutor', before: before, after: after, applied: true };
  } catch (err) {
    console.error('[submitReview] 更新学生信用分失败：', err);
    return { role: 'tutor', before: before, after: before, applied: false };
  }
}

/**
 * 更新家长信用分（老师评家长，存 users.creditScore）
 * @returns {Promise<{role:string, before:number, after:number, applied:boolean}>}
 */
async function updateParentCredit(parentId, delta) {
  if (!parentId) return { role: 'parent', before: 0, after: 0, applied: false };
  let user = null;
  try {
    const res = await db.collection(COLLECTIONS.USERS).doc(parentId).get();
    user = res && res.data;
  } catch (err) {
    console.warn('[submitReview] 按 _id 查询 users 失败，尝试按 parentId 查询：', err);
  }
  if (!user) {
    try {
      const res2 = await db.collection(COLLECTIONS.USERS).where({ parentId: parentId }).limit(1).get();
      const list = (res2 && res2.data) || [];
      if (list.length) user = list[0];
    } catch (err2) {
      console.warn('[submitReview] 按 parentId 查询 users 失败：', err2);
    }
  }
  if (!user) {
    console.warn('[submitReview] 未找到家长用户，跳过信用分结算：' + parentId);
    return { role: 'parent', before: 0, after: 0, applied: false };
  }

  const before = Number(user.creditScore === undefined ? CREDIT_RULES.base : user.creditScore);
  const after = clampCredit(before + Number(delta || 0));
  try {
    await db.collection(COLLECTIONS.USERS).doc(user._id).update({
      data: { creditScore: after, creditUpdatedAt: db.serverDate() }
    });
    return { role: 'parent', before: before, after: after, applied: true };
  } catch (err) {
    console.error('[submitReview] 更新家长信用分失败：', err);
    return { role: 'parent', before: before, after: before, applied: false };
  }
}

/**
 * 统一结算入口：按评价方向把分数记到被评价方
 * @param {string} direction 'parent_to_tutor' | 'tutor_to_parent'
 */
async function applyCreditDelta(direction, target, delta) {
  if (direction === DIRECTION.PARENT_TO_TUTOR) {
    return updateTutorCredit(target.tutorId, delta);
  }
  return updateParentCredit(target.parentId, delta);
}

/* ============================ 业务逻辑 ============================ */

/** 归一化 role：缺省按 tutor，非法值报错 */
function resolveRole(raw) {
  if (raw === undefined || raw === null || raw === '') return 'tutor';
  if (raw === 'parent' || raw === 'tutor') return raw;
  return '';
}

/**
 * 查询评价状态（盲评可见性判定都集中在这里）
 */
async function handleState(event) {
  const demandId = event && event.demandId;
  if (!demandId || typeof demandId !== 'string') {
    return fail('参数错误：demandId 不能为空', 1);
  }
  const role = resolveRole(event && event.role);
  if (!role) {
    return fail('参数错误：role 必须是 parent / tutor 之一', 1);
  }

  const myDirection = directionOfRole(role);
  const otherDirection = counterDirection(myDirection);

  let reviews = [];
  try {
    reviews = await findReviewsByOrder(demandId);
  } catch (err) {
    console.error('[submitReview] 查询评价失败：', err);
    return fail('查询评价状态失败：' + err.message);
  }

  let myReview = null;
  let otherRaw = null;
  for (let i = 0; i < reviews.length; i++) {
    if (reviews[i].direction === myDirection) myReview = reviews[i];
    if (reviews[i].direction === otherDirection) otherRaw = reviews[i];
  }

  // ⚠️ 盲评核心：对方评价只有「双方都提交且已揭晓」才返回内容
  const revealed = !!(
    myReview &&
    otherRaw &&
    otherRaw.status === REVIEW_STATUS.REVEALED &&
    otherRaw.visible
  );
  const otherReview = revealed ? withId(otherRaw) : null;

  let demand = null;
  try {
    demand = await findDemandById(demandId);
  } catch (err) {
    console.warn('[submitReview] 查询需求失败（不影响状态判断）：', err);
  }
  const orderDone = !!demand && (demand.status === DEMAND_STATUS.MATCHED || demand.status === DEMAND_STATUS.CLOSED);

  return ok(
    {
      myReview: withId(myReview),
      /** 未揭晓时恒为 null，只暴露「对方已评价」这一事实 */
      otherReview: otherReview,
      revealed: revealed,
      hasOtherReviewed: !!otherRaw,
      /** 仅给出对方提交时间，不泄露评分/标签/内容 */
      otherSubmittedAt: otherRaw && !revealed ? otherRaw.createdAt || '' : '',
      canReview: orderDone && !myReview,
      counterpartRole: role === 'parent' ? 'tutor' : 'parent',
      direction: myDirection,
      tags: REVIEW_TAGS[myDirection],
      blindTip: '双向盲评：双方都提交评价后才能看到对方的评价内容。'
    },
    revealed ? '双方评价已揭晓' : '评价状态已获取'
  );
}

/**
 * 提交评价
 */
async function handleSubmit(event) {
  const demandId = event && event.demandId;
  if (!demandId || typeof demandId !== 'string') {
    return fail('参数错误：demandId 不能为空', 1);
  }
  const role = resolveRole(event && event.role);
  if (!role) {
    return fail('参数错误：role 必须是 parent / tutor 之一', 1);
  }

  const rating = Number((event && event.rating) || 0);
  if (!rating || isNaN(rating) || rating < 1 || rating > 5) {
    return fail('参数错误：请先选择 1~5 星评分', 1);
  }

  const myDirection = directionOfRole(role);
  const allowedTags = REVIEW_TAGS[myDirection];
  const rawTags = [].concat((event && event.tags) || []);
  if (rawTags.length > 10) {
    return fail('参数错误：评价标签最多 10 个', 1);
  }
  // 只接受该方向允许的标签（前端传错/伪造的标签直接丢弃，不报错）
  const tags = rawTags.filter(function (t) {
    return allowedTags.indexOf(t) > -1;
  });

  const comment = String((event && event.comment) || '').trim();
  if (comment.length > COMMENT_MAX_LENGTH) {
    return fail('参数错误：评价内容请控制在 ' + COMMENT_MAX_LENGTH + ' 字以内', 1);
  }

  // ---------- 订单校验 ----------
  let demand = null;
  try {
    demand = await findDemandById(demandId);
  } catch (err) {
    console.error('[submitReview] 查询需求失败：', err);
    return fail('提交评价失败：订单查询异常（' + err.message + '）');
  }
  if (!demand) return fail('参数错误：订单不存在', 1);
  if (demand.status !== DEMAND_STATUS.MATCHED && demand.status !== DEMAND_STATUS.CLOSED) {
    return fail('订单尚未成单或未结束，暂不能评价', 1);
  }

  // ---------- 防重复评价 ----------
  let reviews = [];
  try {
    reviews = await findReviewsByOrder(demandId);
  } catch (err) {
    console.error('[submitReview] 查询已有评价失败：', err);
    return fail('提交评价失败：评价查询异常（' + err.message + '）');
  }
  let other = null;
  for (let i = 0; i < reviews.length; i++) {
    if (reviews[i].direction === myDirection) {
      return fail('您已提交过评价，评价不可修改', 1);
    }
    if (reviews[i].direction === counterDirection(myDirection)) {
      other = reviews[i];
    }
  }

  // TODO(二期)：校验 OPENID 与该角色归属一致，防止代评

  const tutorId = (event && event.tutorId) || demand.matchedTutorId || '';
  const parentId = (event && event.parentId) || demand.parentId || '';
  const now = Date.now();
  const createdAt = formatDateTime(now);

  const record = {
    orderId: demandId,
    demandId: demandId,
    tutorId: tutorId,
    parentId: parentId,
    direction: myDirection,
    reviewerRole: role,
    reviewerName: (event && event.reviewerName) || '',
    revieweeRole: role === 'parent' ? 'tutor' : 'parent',
    revieweeName: (event && event.revieweeName) || '',
    rating: rating,
    tags: tags,
    comment: comment,
    status: REVIEW_STATUS.PENDING,
    /** 未揭晓前不可见 */
    visible: false,
    creditDelta: 0,
    createdAt: createdAt,
    createdAtTs: now,
    revealedAt: ''
  };

  let reviewId = '';
  try {
    const addRes = await db.collection(COLLECTIONS.REVIEWS).add({ data: record });
    reviewId = addRes._id;
  } catch (err) {
    console.error('[submitReview] 写入 reviews 失败：', err);
    return fail('提交评价失败：' + err.message);
  }

  try {
    await db.collection(COLLECTIONS.REVIEWS).doc(reviewId).update({ data: { id: reviewId } });
  } catch (err) {
    console.warn('[submitReview] 回写 id 字段失败：', err);
  }

  const myReview = Object.assign({}, record, { _id: reviewId, id: reviewId });

  // ---------- 对方还没评：单方提交，内容仅自己可见 ----------
  if (!other) {
    return ok(
      {
        myReview: myReview,
        otherReview: null,
        revealed: false,
        creditDelta: 0
      },
      '评价已提交，等待对方评价'
    );
  }

  // ---------- 双方都评了：一起揭晓 + 结算信用分 ----------
  const revealedAt = formatDateTime(now);
  const deltaMine = calcCreditDelta(record.rating, record.tags);
  const deltaOther = calcCreditDelta(other.rating, other.tags);

  try {
    await db.collection(COLLECTIONS.REVIEWS).doc(reviewId).update({
      data: {
        status: REVIEW_STATUS.REVEALED,
        visible: true,
        creditDelta: deltaMine,
        revealedAt: revealedAt
      }
    });
    await db.collection(COLLECTIONS.REVIEWS).doc(other._id).update({
      data: {
        status: REVIEW_STATUS.REVEALED,
        visible: true,
        creditDelta: deltaOther,
        revealedAt: revealedAt
      }
    });
  } catch (err) {
    console.error('[submitReview] 揭晓评价失败：', err);
    // 评价已写入，但揭晓失败：返回成功 + 提示，避免用户重复提交（可人工修数据）
    return ok(
      {
        myReview: myReview,
        otherReview: null,
        revealed: false,
        creditDelta: 0
      },
      '评价已提交，但揭晓过程异常，请稍后刷新查看'
    );
  }

  // 我评对方 -> 影响对方分数；对方评我 -> 影响我的分数
  const mineImpact = await applyCreditDelta(myDirection, { tutorId: tutorId, parentId: parentId }, deltaMine);
  const otherImpact = await applyCreditDelta(counterDirection(myDirection), { tutorId: tutorId, parentId: parentId }, deltaOther);

  const revealedOther = Object.assign({}, other, {
    status: REVIEW_STATUS.REVEALED,
    visible: true,
    creditDelta: deltaOther,
    revealedAt: revealedAt
  });

  return ok(
    {
      myReview: Object.assign({}, myReview, {
        status: REVIEW_STATUS.REVEALED,
        visible: true,
        creditDelta: deltaMine,
        revealedAt: revealedAt
      }),
      otherReview: withId(revealedOther),
      revealed: true,
      /** 我这次评价导致对方信用分的变化 */
      creditDelta: deltaMine,
      counterpartCredit: mineImpact,
      myCredit: otherImpact
    },
    '双方评价已揭晓，信用分已更新'
  );
}

/**
 * 已揭晓评价列表（只返回 revealed + visible，避免泄露未揭晓内容）
 */
async function handleList(event) {
  const demandId = (event && event.demandId) || '';
  const tutorId = (event && event.tutorId) || '';

  if (demandId && typeof demandId !== 'string') {
    return fail('参数错误：demandId 必须是字符串', 1);
  }
  if (tutorId && typeof tutorId !== 'string') {
    return fail('参数错误：tutorId 必须是字符串', 1);
  }

  let list = [];
  try {
    const where = { status: REVIEW_STATUS.REVEALED };
    if (demandId) where.orderId = demandId;
    if (tutorId) where.tutorId = tutorId;
    const res = await db.collection(COLLECTIONS.REVIEWS).where(where).limit(100).get();
    list = (res && res.data) || [];
  } catch (err) {
    console.error('[submitReview] 查询评价列表失败：', err);
    return fail('查询评价列表失败：' + err.message);
  }

  // 双保险：即使 status 被误改，visible === false 也绝不外泄
  const revealed = list
    .filter(function (r) {
      return r.visible !== false;
    })
    .map(function (r) {
      return withId(r);
    });

  return ok({ list: revealed }, '已获取已揭晓评价');
}

exports.main = async (event, context) => {
  try {
    const action = (event && event.action) || 'submit';
    if (action === 'state') {
      return await handleState(event);
    }
    if (action === 'submit') {
      return await handleSubmit(event);
    }
    if (action === 'list') {
      return await handleList(event);
    }
    return fail('参数错误：不支持的 action（仅支持 state / submit / list）', 1);
  } catch (err) {
    console.error('[submitReview] 执行失败：', err);
    return fail('评价处理失败：' + (err && err.message ? err.message : '未知异常'));
  }
};
