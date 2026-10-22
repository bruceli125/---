/**
 * 云函数：submitCheckin —— 履约打卡（开始打卡 / 结束写小结 / 家长确认）
 * ------------------------------------------------------------------
 * 业务背景：家教对接最容易扯皮的是「到底上没上课、上了多久、讲了什么」。
 * 本函数把一次上课固化为一条 checkins 记录，形成可追溯的履约凭证。
 *
 * 入参（三种 action）：
 *   1) action === 'start'：{ demandId, tutorId? }
 *      - demand 必须状态为 matched（已成单）才能打卡
 *      - tutorId 不传时取 demand.matchedTutorId；传了必须与成单人一致
 *      - 幂等：同一订单已有 checked_in 记录时直接返回该记录 + duplicated:true
 *      - 写入 checkinAt/startAt（开始时间）、location（MOCK_CHECKIN_LOCATION）、
 *        status='checked_in'、summaryStatus='pending'
 *   2) action === 'finish'：{ checkinId, summary, rewrite? }
 *      - 小结 10 ~ 500 字（家长要据此确认）
 *      - 更新 status='finished'、summary、endAt、durationMin
 *      - 已 confirmed 不可再提交；已 finished 未传 rewrite 时不覆盖
 *   3) action === 'confirm'：{ checkinId }
 *      - 仅 finished 可确认 → status='confirmed'、summaryStatus='confirmed'、confirmedAt
 *
 * 返回：{ code, data: { checkin, duplicated? }, message }
 * 返回码：0 成功 / 1 参数错误 / -1 服务端异常
 * 依赖集合：checkins、demands、tutors
 * 前端调用点：miniprogram/services/phase2.js -> startCheckin / finishCheckin / confirmCheckin
 *
 * TODO(二期)：
 *   - 真实到课校验：wx.getLocation 与上课地点围栏比对，或校内场地蓝牙/WiFi 信标
 *     （当前为 mock 定位，不申请 scope.userLocation，隐私声明保持一致）
 *   - 打卡异常申诉（家长否认、时长争议）与人工复核
 *   - 课时结算：按 durationMin × 课时费生成结算单（资金担保为二期，不在此实现）
 *   - 权限：校验 OPENID 与 tutorId / parentId 归属，防止代打卡或越权确认
 */

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const COLLECTIONS = {
  CHECKINS: 'checkins',
  DEMANDS: 'demands',
  TUTORS: 'tutors'
};

/** 打卡状态（与 miniprogram/utils/constants.js CHECKIN_STATUS 一致） */
const CHECKIN_STATUS = {
  CHECKED_IN: 'checked_in',
  FINISHED: 'finished',
  CONFIRMED: 'confirmed'
};

/** 需求状态（与 constants.js DEMAND_STATUS 一致） */
const DEMAND_STATUS = {
  MATCHED: 'matched'
};

/**
 * mock 打卡定位（与 constants.js MOCK_CHECKIN_LOCATION 一致）
 * ⚠️ 不采集真实位置：MVP 阶段一律写入该固定值，隐私声明里也未申请位置权限。
 */
const MOCK_CHECKIN_LOCATION = {
  name: '校内认证场地（mock 定位）',
  address: '北京市海淀区西三环北路 105 号',
  latitude: 39.959,
  longitude: 116.298,
  mock: true
};

/** 授课小结长度限制（与 services/phase2.js finishCheckin 一致） */
const SUMMARY_MIN_LENGTH = 10;
const SUMMARY_MAX_LENGTH = 500;

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

/** 时间戳 -> 'YYYY-MM-DD HH:mm'（与前端 format.js formatDateTime 一致） */
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

/**
 * 任意时间表示 -> 毫秒时间戳（兼容 'YYYY-MM-DD HH:mm'、Date、number）
 * iOS / 部分内核不接受 '2026-01-06 19:03' 这种格式，必须手动拆解
 */
function toTimestamp(value) {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return isNaN(value.getTime()) ? 0 : value.getTime();
  const s = String(value).trim();
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (m) {
    const d = new Date(
      Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)
    );
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }
  const fallback = new Date(s.replace(/-/g, '/'));
  return isNaN(fallback.getTime()) ? 0 : fallback.getTime();
}

/** 文档补 id 字段（前端在 mock / 云端两种模式下统一用 xxx.id） */
function withId(doc) {
  if (!doc) return doc;
  const out = Object.assign({}, doc);
  out.id = doc._id;
  return out;
}

/** 按 _id 或 id 字段查询需求 */
async function findDemandById(demandId) {
  let doc = null;
  try {
    const res = await db.collection(COLLECTIONS.DEMANDS).doc(demandId).get();
    doc = res && res.data;
  } catch (err) {
    console.warn('[submitCheckin] 按 _id 查询需求失败，尝试按 id 字段查询：', err);
  }
  if (!doc) {
    const res2 = await db.collection(COLLECTIONS.DEMANDS).where({ id: demandId }).limit(1).get();
    const list = (res2 && res2.data) || [];
    if (list.length) doc = list[0];
  }
  return doc || null;
}

/** 按 _id 或 id 字段查询打卡记录 */
async function findCheckinById(checkinId) {
  let doc = null;
  try {
    const res = await db.collection(COLLECTIONS.CHECKINS).doc(checkinId).get();
    doc = res && res.data;
  } catch (err) {
    console.warn('[submitCheckin] 按 _id 查询打卡记录失败，尝试按 id 字段查询：', err);
  }
  if (!doc) {
    const res2 = await db.collection(COLLECTIONS.CHECKINS).where({ id: checkinId }).limit(1).get();
    const list = (res2 && res2.data) || [];
    if (list.length) doc = list[0];
  }
  return doc || null;
}

/** 查询某订单当前进行中的打卡（用于幂等） */
async function findActiveCheckin(orderId) {
  try {
    const res = await db
      .collection(COLLECTIONS.CHECKINS)
      .where({ orderId: orderId, status: CHECKIN_STATUS.CHECKED_IN })
      .limit(1)
      .get();
    const list = (res && res.data) || [];
    return list.length ? list[0] : null;
  } catch (err) {
    console.warn('[submitCheckin] 查询进行中打卡失败：', err);
    return null;
  }
}

/** 查询学生档案（拿姓名，失败不阻断） */
async function findTutor(tutorId) {
  try {
    const res = await db.collection(COLLECTIONS.TUTORS).doc(tutorId).get();
    return (res && res.data) || null;
  } catch (err) {
    console.warn('[submitCheckin] 查询 tutors 失败（不影响打卡）：', err);
    return null;
  }
}

/* ============================ 业务逻辑 ============================ */

/**
 * 开始打卡
 */
async function handleStart(event) {
  const demandId = event && event.demandId;
  if (!demandId || typeof demandId !== 'string') {
    return fail('参数错误：demandId 不能为空', 1);
  }

  let demand = null;
  try {
    demand = await findDemandById(demandId);
  } catch (err) {
    console.error('[submitCheckin] 查询需求失败：', err);
    return fail('打卡失败：订单查询异常（' + err.message + '）');
  }
  if (!demand) return fail('参数错误：订单不存在或已删除', 1);

  const tutorId = (event && event.tutorId) || demand.matchedTutorId || '';
  if (!tutorId) {
    return fail('该订单尚未成单，暂不能打卡', 1);
  }
  if (demand.status !== DEMAND_STATUS.MATCHED) {
    return fail('该订单尚未成单，暂不能打卡', 1);
  }
  // 只有成单人能打卡（防止其他学生误打卡）
  if (demand.matchedTutorId && demand.matchedTutorId !== tutorId) {
    return fail('该订单已成单给其他学生，你无法打卡', 1);
  }

  // TODO(二期)：校验 OPENID 对应的 tutors 档案 _id === tutorId，防止代打卡

  // 幂等：已在进行中则直接返回，避免重复生成记录
  const active = await findActiveCheckin(demandId);
  if (active) {
    return ok({ checkin: withId(active), duplicated: true }, '本次打卡已在进行中');
  }

  const now = Date.now();
  const startAt = formatDateTime(now);
  const tutor = await findTutor(tutorId);

  const record = {
    orderId: demandId,
    demandId: demandId,
    tutorId: tutorId,
    tutorName: (tutor && tutor.name) || '',
    parentId: demand.parentId || '',
    status: CHECKIN_STATUS.CHECKED_IN,
    summaryStatus: 'pending',
    /** 开始时间：checkinAt 为云端规范字段，startAt 保留以兼容前端 phase2.js 的读取 */
    checkinAt: startAt,
    startAt: startAt,
    endAt: '',
    durationMin: 0,
    // TODO(二期)：接入真实定位 / 场地信标做得到课校验；当前固定 mock 定位
    location: Object.assign({}, MOCK_CHECKIN_LOCATION),
    summary: '',
    confirmedAt: '',
    createdAt: startAt,
    createdAtTs: now
  };

  let checkinId = '';
  try {
    const addRes = await db.collection(COLLECTIONS.CHECKINS).add({ data: record });
    checkinId = addRes._id;
  } catch (err) {
    console.error('[submitCheckin] 写入 checkins 失败：', err);
    return fail('打卡失败：打卡记录写入异常（' + err.message + '）');
  }

  // 回写 id 字段（失败不影响主流程）
  try {
    await db.collection(COLLECTIONS.CHECKINS).doc(checkinId).update({ data: { id: checkinId } });
  } catch (err) {
    console.warn('[submitCheckin] 回写 id 字段失败：', err);
  }

  return ok(
    { checkin: Object.assign({}, record, { _id: checkinId, id: checkinId }) },
    '打卡成功，下课时请填写授课小结'
  );
}

/**
 * 结束打卡 + 提交授课小结
 */
async function handleFinish(event) {
  const checkinId = event && event.checkinId;
  if (!checkinId || typeof checkinId !== 'string') {
    return fail('参数错误：checkinId 不能为空', 1);
  }
  const summary = String((event && event.summary) || '').trim();
  if (summary.length < SUMMARY_MIN_LENGTH) {
    return fail('授课小结请至少填写 ' + SUMMARY_MIN_LENGTH + ' 个字，家长需要据此确认', 1);
  }
  if (summary.length > SUMMARY_MAX_LENGTH) {
    return fail('授课小结请控制在 ' + SUMMARY_MAX_LENGTH + ' 字以内', 1);
  }

  let record = null;
  try {
    record = await findCheckinById(checkinId);
  } catch (err) {
    console.error('[submitCheckin] 查询打卡记录失败：', err);
    return fail('提交小结失败：打卡记录查询异常（' + err.message + '）');
  }
  if (!record) return fail('参数错误：打卡记录不存在', 1);

  if (record.status === CHECKIN_STATUS.CONFIRMED) {
    return fail('本次打卡已结束并由家长确认，不能重复提交', 1);
  }
  if (record.status === CHECKIN_STATUS.FINISHED && !(event && event.rewrite)) {
    return fail('小结已提交，等待家长确认；如需修改请传 rewrite:true 覆盖提交', 1);
  }

  const now = Date.now();
  const endAt = formatDateTime(now);
  const startTs = toTimestamp(record.checkinAt || record.startAt) || now;
  const durationMin = Math.max(1, Math.round((now - startTs) / 60000));

  try {
    await db.collection(COLLECTIONS.CHECKINS).doc(record._id).update({
      data: {
        status: CHECKIN_STATUS.FINISHED,
        summaryStatus: 'pending',
        summary: summary,
        endAt: endAt,
        durationMin: durationMin,
        updatedAt: db.serverDate()
      }
    });
  } catch (err) {
    console.error('[submitCheckin] 更新打卡记录失败：', err);
    return fail('提交小结失败：' + err.message);
  }

  const updated = withId(
    Object.assign({}, record, {
      status: CHECKIN_STATUS.FINISHED,
      summaryStatus: 'pending',
      summary: summary,
      endAt: endAt,
      durationMin: durationMin
    })
  );
  return ok({ checkin: updated }, '小结已提交，等待家长确认');
}

/**
 * 家长确认小结（履约闭环）
 */
async function handleConfirm(event) {
  const checkinId = event && event.checkinId;
  if (!checkinId || typeof checkinId !== 'string') {
    return fail('参数错误：checkinId 不能为空', 1);
  }

  let record = null;
  try {
    record = await findCheckinById(checkinId);
  } catch (err) {
    console.error('[submitCheckin] 查询打卡记录失败：', err);
    return fail('确认失败：打卡记录查询异常（' + err.message + '）');
  }
  if (!record) return fail('参数错误：打卡记录不存在', 1);
  if (record.status !== CHECKIN_STATUS.FINISHED) {
    return fail('只有待确认的小结才能确认', 1);
  }

  // TODO(二期)：校验 OPENID 与 record.parentId 归属一致，只有家长本人能确认履约
  const confirmedAt = formatDateTime(Date.now());

  try {
    await db.collection(COLLECTIONS.CHECKINS).doc(record._id).update({
      data: {
        status: CHECKIN_STATUS.CONFIRMED,
        summaryStatus: 'confirmed',
        confirmedAt: confirmedAt,
        updatedAt: db.serverDate()
      }
    });
  } catch (err) {
    console.error('[submitCheckin] 确认打卡失败：', err);
    return fail('确认失败：' + err.message);
  }

  const updated = withId(
    Object.assign({}, record, {
      status: CHECKIN_STATUS.CONFIRMED,
      summaryStatus: 'confirmed',
      confirmedAt: confirmedAt
    })
  );
  return ok({ checkin: updated }, '已确认本次履约');
}

exports.main = async (event, context) => {
  try {
    const action = (event && event.action) || 'start';
    if (action === 'start') {
      return await handleStart(event);
    }
    if (action === 'finish') {
      return await handleFinish(event);
    }
    if (action === 'confirm') {
      return await handleConfirm(event);
    }
    return fail('参数错误：不支持的 action（仅支持 start / finish / confirm）', 1);
  } catch (err) {
    console.error('[submitCheckin] 执行失败：', err);
    return fail('打卡失败：' + (err && err.message ? err.message : '未知异常'));
  }
};
