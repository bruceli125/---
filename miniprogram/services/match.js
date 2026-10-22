/**
 * 匹配打分（前端规则版）
 *
 * 评分公式（总分 100）：
 *   科目 36 + 年级学段 18 + 时间地点 12 + 价格 9 + 信用分 10 + 认证完整度 5 + 偏好与性格 10
 *
 * 三期新增「偏好与性格」维度：家长选「按次试课/周末集中/线上碎片化」这类**灵活岗位**时，
 * 学生能否接得住，比距离近不近更决定撮合是否成立，因此单独给 10 分权重。
 *
 * 与云函数 matchTutors 保持同一套规则；云函数版本是权威结果，
 * 前端版本用于「进入页面前先算一版、离线也能演示」。
 *
 * TODO(二期)：把 scoreTutor 的科目/年级匹配替换为语义匹配（向量召回），
 *            把 buildReasons 替换为 LLM 生成（generateReasonsByLLM 已留接口）。
 */
const {
  MATCH_WEIGHTS,
  MATCH_CONFIG,
  POOL_WEIGHTS,
  DISTRICTS,
  TEACH_TYPES,
  PERSONALITY_TAGS,
  labelOf,
  labelsOf
} = require('../utils/constants.js');
const { getStageByGrade, round } = require('../utils/format.js');

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
  return arrA.filter((item) => arrB.indexOf(item) > -1);
}

/** 1. 科目匹配（满分 40） */
function scoreSubject(demand, tutor) {
  const max = MATCH_WEIGHTS.subject;
  const target = demand.subject;
  const subjects = tutor.subjects || [];
  if (!target) return { score: max * 0.6, note: '需求未指定科目' };
  if (subjects.indexOf(target) > -1) {
    return { score: max, note: '科目完全对口（' + target + '）' };
  }
  if (subjects.indexOf('全科') > -1) {
    return { score: max * 0.8, note: '该师范生可全科辅导' };
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

/** 2. 年级学段匹配（满分 20） */
function scoreGrade(demand, tutor) {
  const max = MATCH_WEIGHTS.grade;
  const grade = demand.grade;
  const grades = tutor.grades || [];
  if (!grade) return { score: max * 0.5, note: '需求未指定年级' };
  if (grades.indexOf(grade) > -1) {
    return { score: max, note: '带过' + grade + '，年级完全匹配' };
  }
  const demandStage = getStageByGrade(grade);
  const tutorStages = grades.map((g) => {
    const s = getStageByGrade(g);
    return s ? s.value : '';
  });
  if (demandStage && tutorStages.indexOf(demandStage.value) > -1) {
    return { score: max * 0.7, note: '同一学段（' + demandStage.label + '）教学经验' };
  }
  // 相邻学段（小学-初中 / 初中-高中）给少量分
  const order = ['kindergarten', 'primary', 'junior', 'senior'];
  const dIdx = demandStage ? order.indexOf(demandStage.value) : -1;
  const near = tutorStages.some((s) => {
    const idx = order.indexOf(s);
    return idx > -1 && dIdx > -1 && Math.abs(idx - dIdx) === 1;
  });
  if (near) return { score: max * 0.35, note: '相邻学段有教学经验' };
  return { score: 0, note: '学段不匹配' };
}

/** 3. 时间地点匹配（满分 12：授课方式/地点 9 + 时间段 6，按权重归一后在 12 内） */
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
    // 距离文案统一由 buildReasons 输出，这里只说"范围"，避免同一句里出现两次距离
    notes.push('距离在可上门范围内');
  } else if (distance !== null && distance <= MATCH_CONFIG.maxDistanceKm) {
    score += 1.5;
    notes.push('距离稍远但仍在可协商范围');
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
    max,
    note: notes.length ? notes.join('、') : '时间或地点需要再协商'
  };
}

/** 4. 价格匹配（满分 10） */
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
    max,
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
    max,
    note: labels[level] || labels[0]
  };
}

function districtText(value) {
  for (let i = 0; i < DISTRICTS.length; i++) {
    if (DISTRICTS[i].value === value) return DISTRICTS[i].label;
  }
  return '该区域';
}

/**
 * 估算距离（mock）
 * 优先使用 tutor.distanceKm（mock 数据自带），否则用城区中心点做粗略估算。
 * TODO(二期)：接入 wx.getLocation + 云函数地理计算（geoNear）得到真实距离。
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

function findDistrict(value) {
  for (let i = 0; i < DISTRICTS.length; i++) {
    if (DISTRICTS[i].value === value) return DISTRICTS[i];
  }
  return null;
}

/**
 * 偏好与性格匹配（满分 10 = 授课类型 6 + 性格期望 4）
 * ---------------------------------------------------------------------------
 * 为什么单独做一个维度：
 *   灵活岗位（按次试课 / 周末集中 / 线上碎片化）能不能接，是"能不能成"的前置条件，
 *   而不是加分项。把它混进"时间地点"里会被距离分数稀释，所以独立成维度。
 *
 * 打分规则：
 *   1) 授课类型命中（teachType ∈ tutor.preferences）→ 6 分；未命中 → 1 分（不是 0，
 *      因为愿意谈的老师仍可能协商，只是优先级低）
 *   2) 性格期望命中（expectedPersonality ∩ tutor.personality）：
 *      命中 ≥2 个 → 4 分；命中 1 个 → 2.5 分；未命中 → 0.5 分
 *   3) 任一侧数据缺失（老数据/未填写）→ 该子项按 50% 给分，避免"没填就吃亏"
 *
 * @returns {{score:number, note:string, hitTeachType:boolean, hitPersonality:string[]}}
 */
function scorePreference(demand, tutor) {
  const max = MATCH_WEIGHTS.preference || 10;
  const teachMax = max * 0.6; // 6
  const personaMax = max * 0.4; // 4

  const teachType = demand && demand.teachType;
  const prefs = (tutor && tutor.preferences) || [];
  const expected = (demand && demand.expectedPersonality) || [];
  const persona = (tutor && tutor.personality) || [];

  /* ---- 授课类型 ---- */
  let teachScore;
  let hitTeachType = false;
  const teachLabel = teachType ? labelOf(TEACH_TYPES, teachType) : '';
  if (!teachType) {
    teachScore = teachMax * 0.5; // 家长没指定授课类型
  } else if (!prefs.length) {
    teachScore = teachMax * 0.5; // 学生没填偏好
  } else if (prefs.indexOf(teachType) > -1) {
    teachScore = teachMax;
    hitTeachType = true;
  } else {
    teachScore = teachMax * (1 / 6); // 1 分
  }

  /* ---- 性格期望 ---- */
  const hitPersonality = expected.filter(function (p) {
    return persona.indexOf(p) > -1;
  });
  let personaScore;
  if (!expected.length || !persona.length) {
    personaScore = personaMax * 0.5;
  } else if (hitPersonality.length >= 2) {
    personaScore = personaMax;
  } else if (hitPersonality.length === 1) {
    personaScore = personaMax * 0.625; // 2.5
  } else {
    personaScore = personaMax * 0.125; // 0.5
  }

  const score = round(Math.min(teachScore + personaScore, max), 1);

  /* ---- 一句话说明（同时用于推荐理由） ---- */
  const parts = [];
  if (teachType) {
    parts.push(hitTeachType ? '支持' + teachLabel + '授课' : '偏好中未包含' + teachLabel);
  }
  if (hitPersonality.length) {
    parts.push('性格标签包含' + labelsOf(PERSONALITY_TAGS, hitPersonality).join('、'));
  } else if (expected.length) {
    parts.push('性格标签与期望不完全一致');
  }
  const note = parts.length ? parts.join('，') : '偏好与性格信息待完善';

  return {
    score: score,
    note: note,
    hitTeachType: hitTeachType,
    hitPersonality: hitPersonality
  };
}

/**
 * 单个师范生打分
 * @returns {{score:number, detail:object, reasons:string[], distanceKm:number|null}}
 */
function scoreTutor(demand, tutor) {
  const subject = scoreSubject(demand, tutor);
  const grade = scoreGrade(demand, tutor);
  const timePlace = scoreTimePlace(demand, tutor);
  const price = scorePrice(demand, tutor);
  const credit = scoreCredit(demand, tutor);
  const cert = scoreCert(demand, tutor);
  const preference = scorePreference(demand, tutor);

  const total =
    subject.score +
    grade.score +
    timePlace.score +
    price.score +
    credit.score +
    cert.score +
    preference.score;

  const detail = {
    subject,
    grade,
    timePlace,
    price,
    credit,
    cert,
    preference,
    weights: MATCH_WEIGHTS
  };

  return {
    score: round(Math.min(total, 100), 1),
    detail,
    reasons: buildReasons(demand, tutor, detail),
    distanceKm: estimateDistance(demand, tutor)
  };
}

/**
 * 推荐理由模板生成
 * TODO(二期)：替换为 generateReasonsByLLM()，模板仅作为兜底
 */
function buildReasons(demand, tutor, detail) {
  const reasons = [];
  const name = tutor.name || '该师范生';
  const school = tutor.school || '首都师范大学';
  const major = tutor.major || '师范专业';

  reasons.push(
    name + '为' + school + major + '，' + (detail.cert ? detail.cert.note : '') + '。'
  );

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
      detail.timePlace.note +
      (dist !== null ? '，距离您约 ' + round(dist, 1) + 'km' : '') +
      '。'
    );
  }

  // 偏好与性格：命中时给一条"人话"理由，这是三期最想让家长看到的差异化信息
  if (detail.preference) {
    const pref = detail.preference;
    const teachLabel = demand && demand.teachType ? labelOf(TEACH_TYPES, demand.teachType) : '';
    const personaText = pref.hitPersonality.length
      ? labelsOf(PERSONALITY_TAGS, pref.hitPersonality).join('、')
      : '';

    if (pref.hitTeachType && personaText) {
      reasons.push(
        '该老师标签包含' + personaText + '，符合您的期望，且支持' + teachLabel + '授课。'
      );
    } else if (pref.hitTeachType) {
      reasons.push('支持' + teachLabel + '授课，适配您的时间安排。');
    } else if (personaText) {
      reasons.push('该老师标签包含' + personaText + '，符合您对老师性格的期望。');
    }
  }

  reasons.push(
    (detail.price ? detail.price.note + '，' : '') +
    (detail.credit ? detail.credit.note + '，' : '') +
    '综合匹配度较高。'
  );

  return reasons.filter(Boolean);
}

/**
 * LLM 生成推荐理由的预留接口（当前未接入，直接走模板）
 * @returns {Promise<string[]>}
 */
function generateReasonsByLLM(/* demand, tutor, detail */) {
  // TODO(二期)：调用云函数 llmGenerateReasons（接大模型）生成更自然的推荐理由，
  // 失败或超时则回退到 buildReasons() 模板。
  return Promise.resolve(null);
}

/**
 * 批量打分 + 排序 + 取 TopN
 * @param {object} demand
 * @param {Array<object>} tutors
 * @param {number} topN
 * @returns {Array<{tutorId:string, tutor:object, score:number, detail:object, reasons:string[], rank:number, distanceKm:number|null}>}
 */
function rankTutors(demand, tutors, topN) {
  const n = topN || MATCH_CONFIG.topN;
  const list = (tutors || [])
    .filter((t) => t && t.status !== 'offline')
    .map((tutor) => {
      const result = scoreTutor(demand || {}, tutor);
      return {
        tutorId: tutor.id || tutor._id,
        tutor,
        score: result.score,
        detail: result.detail,
        reasons: result.reasons,
        distanceKm: result.distanceKm
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.tutor.creditScore || 0) - (a.tutor.creditScore || 0);
    });

  return list.slice(0, n).map((item, index) => {
    item.rank = index + 1;
    return item;
  });
}

/**
 * 接单池排序：匹配度 50% + 距离 20% + 价格 15% + 信用分 15%
 * @param {object} tutor 当前师范生档案
 * @param {Array<object>} demands 可接需求
 */
function rankPoolDemands(tutor, demands) {
  const w = POOL_WEIGHTS;
  const list = (demands || []).map((demand) => {
    const result = scoreTutor(demand, tutor);
    const distance = result.distanceKm === null ? MATCH_CONFIG.maxDistanceKm : result.distanceKm;
    const distanceScore = Math.max(0, 1 - distance / MATCH_CONFIG.maxDistanceKm) * 100;
    // 价格维度：师范生报价相对家长预算越宽裕得分越高
    const budget = Number(demand.budgetMax || demand.budget || 0);
    const price = Number(tutor.price || 0);
    let priceScore = 60;
    if (budget && price) {
      priceScore = price <= budget ? 100 : Math.max(0, 100 - ((price - budget) / budget) * 200);
    }
    const creditScore = Number(tutor.creditScore || 0);
    const poolScore = round(
      result.score * w.match +
        distanceScore * w.distance +
        priceScore * w.price +
        creditScore * w.credit,
      1
    );
    const distanceText = result.distanceKm === null ? '距离未知' : round(result.distanceKm, 1) + 'km';
    return {
      demandId: demand.id || demand._id,
      demand,
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
  return list.sort((a, b) => b.score - a.score);
}

module.exports = {
  scoreSubject,
  scoreGrade,
  scoreTimePlace,
  scorePrice,
  scoreCredit,
  scoreCert,
  scorePreference,
  scoreTutor,
  buildReasons,
  generateReasonsByLLM,
  rankTutors,
  rankPoolDemands,
  estimateDistance,
  findDistrict
};
