/**
 * 云函数：matchTutors —— 智能匹配（TopN 推荐）/ 学生接单池
 * ------------------------------------------------------------------
 * 入参（两种 action）：
 *   1) 默认（不传 action 或 'match'）：{ demandId, topN? }
 *      - 读取需求与学生档案，按规则打分，取 TopN（默认 3）
 *      - 写入 matches 集合（先清空该需求的旧记录），并把需求状态 published -> matching
 *   2) action === 'pool'：{ tutorId }
 *      - 返回该学生可接的需求列表，按「匹配度 0.5 + 距离 0.2 + 价格 0.15 + 信用分 0.15」排序
 *
 * 返回：{ code, data, message }
 *   match -> data: { demand, list: [{ tutorId, tutor, score, detail, reasons, rank, distanceKm }], matches }
 *   pool  -> data: { tutor, list: [{ demandId, demand, matchScore, score, distanceKm, reasons }] }
 * 依赖集合：demands、tutors、matches
 * 前端调用点：miniprogram/services/api.js -> matchTutors() / getTutorPool()
 *
 * 【重要】本文件的打分公式是 miniprogram/services/match.js 的逐条移植，二者必须保持一致：
 *   科目 40 + 年级学段 20 + 时间地点 15 + 价格 10 + 信用分 10 + 认证完整度 5 = 100
 *
 * TODO(二期)：
 *   - 科目/年级匹配替换为语义匹配（向量召回 + 大模型），本文件保留 matchScoreByRules 主流程
 *   - 推荐理由替换为 LLM 生成（模板 buildReasons 作为兜底）
 *   - 距离替换为 wx.getLocation + 地理位置索引（geoNear），当前为 mock 估算
 *   - 云数据库单次查询上限 100 条，学生/需求超过 100 条时需改为分页聚合
 */

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const COLLECTIONS = {
  DEMANDS: 'demands',
  TUTORS: 'tutors',
  MATCHES: 'matches'
};

/* ==================================================================
 * 常量（与 miniprogram/utils/constants.js 逐字一致）
 * ================================================================== */

/** 匹配打分权重（总分 100） */
const MATCH_WEIGHTS = {
  subject: 40,
  grade: 20,
  timePlace: 15,
  price: 10,
  credit: 10,
  cert: 5
};

/** 接单池排序权重 */
const POOL_WEIGHTS = {
  match: 0.5,
  distance: 0.2,
  price: 0.15,
  credit: 0.15
};

/** 匹配配置 */
const MATCH_CONFIG = {
  topN: 3,
  maxDistanceKm: 20,
  priceTolerance: 0.2
};

/** 学段与年级（与 constants.js STAGES 一致） */
const STAGES = [
  { value: 'kindergarten', label: '幼儿', grades: ['小班', '中班', '大班', '幼小衔接'] },
  { value: 'primary', label: '小学', grades: ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级'] },
  { value: 'junior', label: '初中', grades: ['初一', '初二', '初三'] },
  { value: 'senior', label: '高中', grades: ['高一', '高二', '高三'] }
];

/** 北京主要城区中心点（与 constants.js DISTRICTS 一致，mock 距离估算用） */
const DISTRICTS = [
  { value: 'haidian', label: '海淀区', center: { lat: 39.959, lng: 116.298 } },
  { value: 'chaoyang', label: '朝阳区', center: { lat: 39.921, lng: 116.486 } },
  { value: 'xicheng', label: '西城区', center: { lat: 39.912, lng: 116.366 } },
  { value: 'dongcheng', label: '东城区', center: { lat: 39.928, lng: 116.416 } },
  { value: 'fengtai', label: '丰台区', center: { lat: 39.858, lng: 116.286 } },
  { value: 'shijingshan', label: '石景山区', center: { lat: 39.906, lng: 116.223 } },
  { value: 'changping', label: '昌平区', center: { lat: 40.220, lng: 116.231 } },
  { value: 'tongzhou', label: '通州区', center: { lat: 39.909, lng: 116.657 } }
];

/** 需求状态（与 constants.js DEMAND_STATUS 一致） */
const DEMAND_STATUS = {
  PUBLISHED: 'published',
  MATCHING: 'matching',
  MATCHED: 'matched'
};

/** 单次查询上限（云数据库限制） */
const QUERY_LIMIT = 100;

/* ==================================================================
 * 通用返回
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

/* ==================================================================
 * 工具函数（与 miniprogram/utils/format.js / match.js 对齐）
 * ================================================================== */

/** 数字保留 n 位小数（返回 number，与 format.js round 一致） */
function round(num, digits) {
  const d = digits === undefined ? 1 : digits;
  const f = Math.pow(10, d);
  return Math.round(Number(num || 0) * f) / f;
}

/** 判断两个数组是否有交集 */
function hasIntersection(a, b) {
  const arrA = a || [];
  const arrB = b || [];
  for (let i = 0; i < arrA.length; i++) {
    if (arrB.indexOf(arrA[i]) > -1) return true;
  }
  return false;
}

/** 取交集 */
function intersect(a, b) {
  const arrA = a || [];
  const arrB = b || [];
  return arrA.filter(function (item) {
    return arrB.indexOf(item) > -1;
  });
}

/** 根据年级取学段对象 */
function getStageByGrade(grade) {
  if (!grade) return null;
  for (let i = 0; i < STAGES.length; i++) {
    if (STAGES[i].grades.indexOf(grade) > -1) return STAGES[i];
  }
  return null;
}

/** 城区 value -> label */
function districtText(value) {
  for (let i = 0; i < DISTRICTS.length; i++) {
    if (DISTRICTS[i].value === value) return DISTRICTS[i].label;
  }
  return '该区域';
}

function findDistrict(value) {
  for (let i = 0; i < DISTRICTS.length; i++) {
    if (DISTRICTS[i].value === value) return DISTRICTS[i];
  }
  return null;
}

/** 文档补 id 字段（云数据库主键是 _id，前端统一用 id） */
function withId(doc) {
  if (!doc) return doc;
  const out = Object.assign({}, doc);
  out.id = doc._id;
  return out;
}

/* ==================================================================
 * 打分逻辑（逐条移植 miniprogram/services/match.js）
 * ================================================================== */

/**
 * 1. 科目匹配（满分 40）
 * 注意：为与前端 scoreSubject 的返回结构严格一致，本函数各分支都不返回 max 字段
 *      （前端该函数只返回 { score, note }，其余打分函数才返回 { score, max, note }）。
 */
function scoreSubject(demand, tutor) {
  const max = MATCH_WEIGHTS.subject;
  const target = demand.subject;
  const subjects = tutor.subjects || [];
  if (!target) return { score: max * 0.6, note: '需求未指定科目' };
  if (subjects.indexOf(target) > -1) {
    return { score: max, note: '科目完全对口（' + target + '）' };
  }
  if (subjects.indexOf('全科') > -1) {
    return { score: max * 0.8, note: '该学生可全科辅导' };
  }
  // 同门类近似：数学/物理/化学 视为理科相关，语文/英语/历史 视为文科相关
  const science = ['数学', '物理', '化学', '生物', '科学', '编程'];
  const arts = ['语文', '英语', '历史', '地理', '政治'];
  const sameGroup =
    (science.indexOf(target) > -1 && hasIntersection(subjects, science)) ||
    (arts.indexOf(target) > -1 && hasIntersection(subjects, arts));
  if (sameGroup) {
    return { score: max * 0.45, note: '学科门类相近，可跨科辅导' };
  }
  return { score: 0, note: '科目不匹配' };
}

/**
 * 2. 年级学段匹配（满分 20）
 * 注意：与前端 scoreGrade 返回结构严格一致，各分支不返回 max 字段。
 */
function scoreGrade(demand, tutor) {
  const max = MATCH_WEIGHTS.grade;
  const grade = demand.grade;
  const grades = tutor.grades || [];
  if (!grade) return { score: max * 0.5, note: '需求未指定年级' };
  if (grades.indexOf(grade) > -1) {
    return { score: max, note: '带过' + grade + '，年级完全匹配' };
  }
  const demandStage = getStageByGrade(grade);
  const tutorStages = grades.map(function (g) {
    const s = getStageByGrade(g);
    return s ? s.value : '';
  });
  if (demandStage && tutorStages.indexOf(demandStage.value) > -1) {
    return { score: max * 0.7, note: '同一学段（' + demandStage.label + '）教学经验' };
  }
  // 相邻学段（小学-初中 / 初中-高中）给少量分
  const order = ['kindergarten', 'primary', 'junior', 'senior'];
  const dIdx = demandStage ? order.indexOf(demandStage.value) : -1;
  const near = tutorStages.some(function (s) {
    const idx = order.indexOf(s);
    return idx > -1 && dIdx > -1 && Math.abs(idx - dIdx) === 1;
  });
  if (near) return { score: max * 0.35, note: '相邻学段有教学经验' };
  return { score: 0, note: '学段不匹配' };
}

/** 3. 时间地点匹配（满分 15：授课方式/地点 9 + 时间段 6） */
function scoreTimePlace(demand, tutor) {
  const max = MATCH_WEIGHTS.timePlace;
  let score = 0;
  const notes = [];

  // 授课方式
  const modes = tutor.teachModes || [];
  if (demand.teachMode && modes.indexOf(demand.teachMode) > -1) {
    score += 5;
    notes.push('支持' + (demand.teachMode === 'online' ? '线上' : demand.teachMode === 'campus' ? '校内场地' : '线下上门') + '授课');
  } else if (!demand.teachMode) {
    score += 3;
  }

  // 地点（同区满分）
  const sameDistrict = demand.district && tutor.district && demand.district === tutor.district;
  const distance = estimateDistance(demand, tutor);
  if (demand.teachMode === 'online') {
    score += 4;
  } else if (sameDistrict) {
    score += 4;
    notes.push('同在' + districtText(demand.district) + '，通勤方便');
  } else if (distance !== null && distance <= 5) {
    score += 3;
    notes.push('距离约 ' + round(distance, 1) + 'km');
  } else if (distance !== null && distance <= MATCH_CONFIG.maxDistanceKm) {
    score += 1.5;
    notes.push('距离约 ' + round(distance, 1) + 'km');
  }

  // 时间段
  const demandTimes = demand.timeRange ? [].concat(demand.timeRange) : [];
  const tutorTimes = tutor.availableTimes || [];
  const overlap = intersect(demandTimes, tutorTimes);
  if (!demandTimes.length) {
    score += 3;
  } else if (overlap.length) {
    score += 6;
    notes.push('可排课时间段吻合');
  } else if (tutorTimes.indexOf('negotiable') > -1) {
    score += 2;
    notes.push('时间可协商');
  }

  return {
    score: Math.min(round(score, 1), max),
    max: max,
    note: notes.length ? notes.join('、') : '时间或地点需要再协商'
  };
}

/**
 * 4. 价格匹配（满分 10）
 * 注意：与前端 scorePrice 返回结构严格一致，各分支不返回 max 字段。
 */
function scorePrice(demand, tutor) {
  const max = MATCH_WEIGHTS.price;
  const budget = Number(demand.budgetMax || demand.budget || 0);
  const price = Number(tutor.price || 0);
  if (!budget || !price) return { score: max * 0.5, note: '价格待沟通' };
  if (price <= budget) {
    return { score: max, note: '课时费 ' + price + ' 元，在预算内' };
  }
  const tolerance = budget * (1 + MATCH_CONFIG.priceTolerance);
  if (price <= tolerance) {
    return { score: max * 0.6, note: '课时费 ' + price + ' 元，略高于预算' };
  }
  return { score: max * 0.2, note: '课时费 ' + price + ' 元，超出预算' };
}

/** 5. 信用分（满分 10，按 creditScore/100 折算） */
function scoreCredit(demand, tutor) {
  const max = MATCH_WEIGHTS.credit;
  const credit = Number(tutor.creditScore || 0);
  return {
    score: round((credit / 100) * max, 1),
    max: max,
    note: '平台信用分 ' + credit
  };
}

/** 6. 认证完整度（满分 5） */
function scoreCert(demand, tutor) {
  const max = MATCH_WEIGHTS.cert;
  const level = Number(tutor.certLevel || 0);
  const map = { 3: max, 2: max * 0.7, 1: max * 0.4, 0: 0 };
  const labels = { 3: '已完成三重认证', 2: '已完成双重认证', 1: '已通过学籍认证', 0: '尚未完成认证' };
  return {
    score: round(map[level] || 0, 1),
    max: max,
    note: labels[level] || labels[0]
  };
}

/**
 * 估算距离（mock）
 * 优先使用 tutor.distanceKm（mock 数据自带），否则用城区中心点做粗略估算。
 * TODO(二期)：接入 wx.getLocation + 云函数地理位置检索（geoNear），返回真实通勤距离。
 */
function estimateDistance(demand, tutor) {
  if (tutor && typeof tutor.distanceKm === 'number') return tutor.distanceKm;
  const a = findDistrict(demand && demand.district);
  const b = findDistrict(tutor && tutor.district);
  if (!a || !b) return null;
  if (a.value === b.value) return 1.5 + Math.random() * 2;
  const dLat = (a.center.lat - b.center.lat) * 111;
  const dLng = (a.center.lng - b.center.lng) * 111 * Math.cos((a.center.lat * Math.PI) / 180);
  return round(Math.sqrt(dLat * dLat + dLng * dLng), 1);
}

/**
 * 推荐理由模板生成（与前端 buildReasons 逐字一致）
 * TODO(二期)：替换为 LLM 生成（本函数作为超时/失败兜底）。
 */
function buildReasons(demand, tutor, detail) {
  const reasons = [];
  const name = tutor.name || '该学生';
  const school = tutor.school || 'XX大学';
  const major = tutor.major || '对口专业';

  reasons.push(name + '为' + school + major + '，' + (detail.cert ? detail.cert.note : '') + '。');

  if (detail.subject && detail.subject.score >= MATCH_WEIGHTS.subject * 0.8) {
    const tags = (tutor.tags || []).slice(0, 2).join('、');
    reasons.push(
      '主攻' + (tutor.subjects || []).slice(0, 2).join('/') + '，' +
        (tags ? '擅长' + tags + '，' : '') +
        (detail.grade ? detail.grade.note : '') + '。'
    );
  } else if (detail.subject) {
    reasons.push(detail.subject.note + '，可作为备选方案。');
  }

  if (detail.timePlace) {
    const dist = estimateDistance(demand, tutor);
    reasons.push(
      detail.timePlace.note + (dist !== null ? '，距离您约 ' + round(dist, 1) + 'km' : '') + '。'
    );
  }

  reasons.push(
    (detail.price ? detail.price.note + '，' : '') +
      (detail.credit ? detail.credit.note + '，' : '') +
      '综合匹配度较高。'
  );

  return reasons.filter(Boolean);
}

/**
 * 单个学生打分
 * @returns {{score:number, detail:object, reasons:string[], distanceKm:number|null}}
 */
function scoreTutor(demand, tutor) {
  const subject = scoreSubject(demand, tutor);
  const grade = scoreGrade(demand, tutor);
  const timePlace = scoreTimePlace(demand, tutor);
  const price = scorePrice(demand, tutor);
  const credit = scoreCredit(demand, tutor);
  const cert = scoreCert(demand, tutor);

  const total = subject.score + grade.score + timePlace.score + price.score + credit.score + cert.score;

  const detail = {
    subject: subject,
    grade: grade,
    timePlace: timePlace,
    price: price,
    credit: credit,
    cert: cert,
    weights: MATCH_WEIGHTS
  };

  return {
    score: round(Math.min(total, 100), 1),
    detail: detail,
    reasons: buildReasons(demand, tutor, detail),
    distanceKm: estimateDistance(demand, tutor)
  };
}

/**
 * 批量打分 + 排序 + 取 TopN（与前端 rankTutors 一致）
 * 排序：分数降序，同分按信用分降序
 */
function rankTutors(demand, tutors, topN) {
  const n = topN || MATCH_CONFIG.topN;
  const list = (tutors || [])
    .filter(function (t) {
      return t && t.status !== 'offline';
    })
    .map(function (tutor) {
      const result = scoreTutor(demand || {}, tutor);
      return {
        tutorId: tutor.id || tutor._id,
        tutor: tutor,
        score: result.score,
        detail: result.detail,
        reasons: result.reasons,
        distanceKm: result.distanceKm
      };
    })
    .sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return (b.tutor.creditScore || 0) - (a.tutor.creditScore || 0);
    });

  return list.slice(0, n).map(function (item, index) {
    item.rank = index + 1;
    return item;
  });
}

/**
 * 接单池排序：匹配度 50% + 距离 20% + 价格 15% + 信用分 15%（与前端 rankPoolDemands 一致）
 */
function rankPoolDemands(tutor, demands) {
  const w = POOL_WEIGHTS;
  const list = (demands || []).map(function (demand) {
    const result = scoreTutor(demand, tutor);
    const distance = result.distanceKm === null ? MATCH_CONFIG.maxDistanceKm : result.distanceKm;
    const distanceScore = Math.max(0, 1 - distance / MATCH_CONFIG.maxDistanceKm) * 100;
    // 价格维度：学生报价相对家长预算越宽裕得分越高
    const budget = Number(demand.budgetMax || demand.budget || 0);
    const price = Number(tutor.price || 0);
    let priceScore = 60;
    if (budget && price) {
      priceScore = price <= budget ? 100 : Math.max(0, 100 - ((price - budget) / budget) * 200);
    }
    const creditScore = Number(tutor.creditScore || 0);
    const poolScore = round(
      result.score * w.match + distanceScore * w.distance + priceScore * w.price + creditScore * w.credit,
      1
    );
    const distanceText = result.distanceKm === null ? '距离未知' : round(result.distanceKm, 1) + 'km';
    return {
      demandId: demand.id || demand._id,
      demand: demand,
      matchScore: result.score,
      score: poolScore,
      distanceKm: result.distanceKm,
      reasons: [
        '需求匹配度 ' + result.score + ' 分',
        distanceText,
        result.detail.price ? result.detail.price.note : '价格待沟通',
        '您的信用分 ' + creditScore
      ]
    };
  });
  return list.sort(function (a, b) {
    return b.score - a.score;
  });
}

/* ==================================================================
 * 数据访问
 * ================================================================== */

/** 按 _id 或 id 字段读取需求 */
async function getDemandById(demandId) {
  try {
    const res = await db.collection(COLLECTIONS.DEMANDS).doc(demandId).get();
    if (res && res.data) return res.data;
  } catch (err) {
    console.warn('[matchTutors] 按 _id 查询需求失败，尝试按 id 字段查询：', err);
  }
  try {
    const res2 = await db.collection(COLLECTIONS.DEMANDS).where({ id: demandId }).limit(1).get();
    const list = (res2 && res2.data) || [];
    if (list.length) return list[0];
  } catch (err2) {
    console.error('[matchTutors] 查询需求失败：', err2);
  }
  return null;
}

/** 读取可用学生档案（status !== offline） */
async function listAvailableTutors() {
  // 注意：云数据库单次最多返回 100 条
  // TODO(二期)：学生超过 100 人时改为按科目/学段分片查询或使用聚合分页
  const res = await db
    .collection(COLLECTIONS.TUTORS)
    .where({ status: _.neq('offline') })
    .limit(QUERY_LIMIT)
    .get();
  const list = (res && res.data) || [];
  return list.map(withId);
}

/** 按 _id 或 id 字段读取学生 */
async function getTutorById(tutorId) {
  try {
    const res = await db.collection(COLLECTIONS.TUTORS).doc(tutorId).get();
    if (res && res.data) return withId(res.data);
  } catch (err) {
    console.warn('[matchTutors] 按 _id 查询学生失败，尝试按 id 字段查询：', err);
  }
  try {
    const res2 = await db.collection(COLLECTIONS.TUTORS).where({ id: tutorId }).limit(1).get();
    const list = (res2 && res2.data) || [];
    if (list.length) return withId(list[0]);
  } catch (err2) {
    console.error('[matchTutors] 查询学生失败：', err2);
  }
  return null;
}

/* ==================================================================
 * 业务逻辑
 * ================================================================== */

/** 默认动作：对需求做 TopN 匹配 */
async function handleMatch(event) {
  const demandId = event && event.demandId;
  let topN = event && event.topN !== undefined ? Number(event.topN) : MATCH_CONFIG.topN;

  // ---------- 参数校验 ----------
  if (!demandId || typeof demandId !== 'string') {
    return fail('参数错误：demandId 不能为空', 1);
  }
  if (isNaN(topN) || topN < 1 || topN > 10) {
    return fail('参数错误：topN 必须是 1~10 之间的数字', 1);
  }
  topN = Math.floor(topN);

  // ---------- 读取需求 ----------
  const rawDemand = await getDemandById(demandId);
  if (!rawDemand) return fail('参数错误：需求不存在或已删除', 1);
  const demand = withId(rawDemand);

  // ---------- 读取学生并打分 ----------
  let tutors = [];
  try {
    tutors = await listAvailableTutors();
  } catch (err) {
    console.error('[matchTutors] 读取学生列表失败：', err);
    return fail('匹配失败：学生档案读取异常（' + err.message + '）');
  }
  if (!tutors.length) return fail('匹配失败：暂无可推荐的学生档案', 1);

  const list = rankTutors(demand, tutors, topN);
  if (!list.length) return fail('匹配失败：暂无符合条件的学生', 1);

  // ---------- 写入 matches（同一需求覆盖上一轮结果） ----------
  const now = Date.now();
  try {
    await db.collection(COLLECTIONS.MATCHES).where({ demandId: demandId }).remove();
  } catch (err) {
    console.warn('[matchTutors] 清理旧匹配记录失败（继续执行）：', err);
  }

  const matches = [];
  try {
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const addRes = await db.collection(COLLECTIONS.MATCHES).add({
        data: {
          demandId: demandId,
          tutorId: item.tutorId,
          score: item.score,
          reasons: item.reasons,
          rank: item.rank,
          // 距离随匹配结果一起留存，generateReport 生成报告摘要时需要（否则只能显示「距离待确认」）
          distanceKm: item.distanceKm === undefined ? null : item.distanceKm,
          createdAt: db.serverDate(),
          createdAtTs: now
        }
      });
      matches.push({
        _id: addRes._id,
        id: addRes._id,
        demandId: demandId,
        tutorId: item.tutorId,
        score: item.score,
        reasons: item.reasons,
        rank: item.rank,
        distanceKm: item.distanceKm === undefined ? null : item.distanceKm
      });
    }
  } catch (err) {
    console.error('[matchTutors] 写入 matches 失败：', err);
    // 匹配结果已算出，写库失败不阻断返回（前端仍可展示并生成报告）
    console.warn('[matchTutors] 已降级返回内存中的匹配结果');
  }

  // ---------- 需求状态推进到「匹配中」 ----------
  if (demand.status === DEMAND_STATUS.PUBLISHED && demand._id) {
    try {
      await db.collection(COLLECTIONS.DEMANDS).doc(demand._id).update({
        data: { status: DEMAND_STATUS.MATCHING, matchedAt: db.serverDate() }
      });
      demand.status = DEMAND_STATUS.MATCHING;
    } catch (err) {
      console.warn('[matchTutors] 更新需求状态失败（不阻断返回）：', err);
    }
  }

  return ok({ demand: demand, list: list, matches: matches }, '匹配完成');
}

/** action='pool'：学生接单池 */
async function handlePool(event) {
  const tutorId = event && event.tutorId;

  // ---------- 参数校验 ----------
  if (!tutorId || typeof tutorId !== 'string') {
    return fail('参数错误：tutorId 不能为空', 1);
  }

  const tutor = await getTutorById(tutorId);
  if (!tutor) return fail('参数错误：学生档案不存在', 1);

  // ---------- 读取可接需求 ----------
  // 注意：云数据库单次最多返回 100 条
  // TODO(二期)：需求超过 100 条时改为按城区/科目分片 + 分页，或使用聚合管道
  let demands = [];
  try {
    const res = await db
      .collection(COLLECTIONS.DEMANDS)
      .where({
        status: _.in([DEMAND_STATUS.PUBLISHED, DEMAND_STATUS.MATCHING, DEMAND_STATUS.MATCHED])
      })
      .limit(QUERY_LIMIT)
      .get();
    demands = ((res && res.data) || []).map(withId);
  } catch (err) {
    console.error('[matchTutors] 读取需求列表失败：', err);
    return fail('接单池加载失败：需求读取异常（' + err.message + '）');
  }

  const list = rankPoolDemands(tutor, demands);
  return ok({ tutor: tutor, list: list }, '接单池加载完成');
}

exports.main = async (event, context) => {
  try {
    const action = (event && event.action) || 'match';
    if (action === 'match') {
      return await handleMatch(event);
    }
    if (action === 'pool') {
      return await handlePool(event);
    }
    return fail('参数错误：不支持的 action（仅支持 match / pool）', 1);
  } catch (err) {
    console.error('[matchTutors] 执行失败：', err);
    return fail('智能匹配失败：' + (err && err.message ? err.message : '未知异常'));
  }
};
