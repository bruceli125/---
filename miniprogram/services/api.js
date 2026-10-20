/**
 * 统一接口层
 * ------------------------------------------------------------------
 * 所有页面只能通过本文件访问数据，禁止页面直接读写 storage 或调用 wx.cloud。
 *
 * 切换方式：
 *   utils/constants.js -> APP_INFO.useCloud
 *     false = 本地 mock + storage（默认，导入微信开发者工具即可演示）
 *     true  = 微信云开发云函数（需在 app.js onLaunch 里 wx.cloud.init，见 README）
 *
 * 统一返回结构：{ code: 0 | -1, data: any, message: string }
 *   code === 0 表示成功；页面统一判断 code，不需要 try/catch 每个调用。
 *
 * 云函数与本地 mock 的对应关系：
 *   login               -> login()
 *   riskCheck           -> riskCheck()
 *   submitDemand        -> createDemand()
 *   submitCertification -> submitCertification() / reviewCertification()
 *   matchTutors         -> matchTutors() / getTutorPool()
 *   generateReport      -> generateReport()
 *   其余读接口（列表、详情）云函数模式下走同名云函数或数据库直读（见各函数注释 TODO）
 */
const {
  APP_INFO,
  STORAGE_KEYS,
  ROLES,
  DEMAND_STATUS,
  CERT_STATUS,
  RISK_LEVEL,
  MATCH_CONFIG,
  DISCLAIMER,
  RISK_WORDS,
  /* 二期 */
  POLICY_DOUBLE_REDUCTION,
  TRIAL_ADVICE,
  PLATFORM_POSITION,
  DISCIPLINE_SUBJECTS
} = require('../utils/constants.js');
const fmt = require('../utils/format.js');
const riskService = require('./risk.js');
const matchService = require('./match.js');
const mockTutors = require('../mock/tutors.js');
const mockDemands = require('../mock/demands.js');

const USE_CLOUD = !!APP_INFO.useCloud;

/* ==================================================================
 * 一、基础设施：storage 读写 / 云函数调用
 * ================================================================== */

function ok(data, message) {
  return { code: 0, data: data, message: message || 'success' };
}

function fail(message, data) {
  return { code: -1, data: data || null, message: message || '操作失败' };
}

/** 统一异常包装，保证页面永远拿到 { code, data, message } */
function wrap(promise, label) {
  return Promise.resolve(promise).catch((err) => {
    console.error('[' + label + '] 调用失败：', err);
    return fail((err && err.message) || (label + ' 调用失败'));
  });
}

/* ---------------------- storage 层（mock 模式） ---------------------- */

function readStore(key, fallback) {
  try {
    const value = wx.getStorageSync(key);
    if (value === '' || value === null || value === undefined) return fallback;
    return value;
  } catch (err) {
    console.warn('[api] 读取缓存失败 ' + key + '：', err);
    return fallback;
  }
}

function writeStore(key, value) {
  try {
    wx.setStorageSync(key, value);
    return true;
  } catch (err) {
    console.error('[api] 写入缓存失败 ' + key + '：', err);
    return false;
  }
}

/**
 * 首次运行时把 mock 数据灌入本地存储，之后所有增删改都基于 storage，
 * 这样「发布需求 -> 匹配 -> 报告」在重启小程序后依然能看到。
 */
function ensureSeed() {
  if (readStore(STORAGE_KEYS.SEEDED, false)) return;
  writeStore(STORAGE_KEYS.TUTORS, mockTutors.cloneTutors());
  writeStore(STORAGE_KEYS.CERTIFICATIONS, mockTutors.cloneCertifications());
  writeStore(STORAGE_KEYS.DEMANDS, mockDemands.cloneDemands());
  writeStore(STORAGE_KEYS.MATCHES, []);
  writeStore(STORAGE_KEYS.REPORTS, []);
  writeStore(STORAGE_KEYS.APPLICATIONS, []);
  writeStore(STORAGE_KEYS.USERS, [
    {
      id: 'user_demo_parent',
      openid: 'mock-openid-parent-0001',
      role: ROLES.PARENT,
      nickname: '王女士（演示家长）',
      phone: '138****6621',
      parentId: mockDemands.CURRENT_PARENT_ID,
      createdAt: fmt.formatDateTime('2026-01-05 09:00')
    },
    {
      id: 'user_demo_tutor',
      openid: 'mock-openid-tutor-0001',
      role: ROLES.TUTOR,
      nickname: '林嘉怡（演示师范生）',
      phone: '138****6621',
      tutorProfileId: mockTutors.CURRENT_TUTOR_ID,
      createdAt: fmt.formatDateTime('2026-01-05 09:00')
    }
  ]);
  writeStore(STORAGE_KEYS.SEEDED, true);
  console.log('[api] mock 数据已初始化到本地 storage');
}

/**
 * 恢复出厂 mock 数据（演示 / 调试用）
 * 保留「家长 / 师范生」身份偏好（ROLE 与 TUTOR_PROFILE_ID），便于反复演示完整流程。
 * 注意：与本文件其它接口保持一致，返回 Promise<{code,data,message}>（此前返回普通对象，
 *      导致页面侧误用 .then() 报 TypeError、按钮静默失效）。
 */
function resetMockData() {
  try {
    Object.keys(STORAGE_KEYS).forEach((k) => {
      if (k !== 'ROLE' && k !== 'TUTOR_PROFILE_ID') {
        wx.removeStorageSync(STORAGE_KEYS[k]);
      }
    });
    ensureSeed();
    return Promise.resolve(ok(true, '演示数据已重置'));
  } catch (err) {
    return Promise.resolve(fail('重置失败：' + err.message));
  }
}

/**
 * 隐私合规：清除本机保存的全部个人相关数据
 * 对应微信后台《用户隐私保护指引》中「撤回授权 / 删除我的信息」的落地入口。
 * 与 resetMockData 的区别：
 *   - resetMockData：保留身份偏好，仅恢复演示数据；
 *   - clearLocalData：连同身份偏好一并清除，随后重新灌入不含任何用户操作痕迹的初始演示数据，
 *     保证清除后小程序仍可继续使用（种子数据是应用的演示固定数据，不属于用户信息）。
 */
function clearLocalData() {
  try {
    Object.keys(STORAGE_KEYS).forEach((key) => {
      wx.removeStorageSync(STORAGE_KEYS[key]);
    });
    ensureSeed();
    return Promise.resolve(ok(true, '本地数据已清除'));
  } catch (err) {
    console.error('[api] 清除本地数据失败：', err);
    return Promise.resolve(fail('清除失败：' + (err && err.message)));
  }
}

/* ---------------------- 云函数层 ---------------------- */

let cloudInited = false;

function ensureCloud() {
  if (!USE_CLOUD) return false;
  if (cloudInited) return true;
  if (!wx.cloud) {
    console.error('[api] 当前基础库不支持云开发，请在 project.config.json 中调高 libVersion');
    return false;
  }
  wx.cloud.init({
    env: APP_INFO.cloudEnv,
    traceUser: true
  });
  cloudInited = true;
  return true;
}

/**
 * 调用云函数
 * @param {string} name 云函数名
 * @param {object} data 入参
 * @returns {Promise<{code:number,data:any,message:string}>}
 */
function callCloud(name, data) {
  if (!ensureCloud()) {
    return Promise.resolve(fail('云开发未初始化：请检查 APP_INFO.useCloud 与 cloudEnv 配置'));
  }
  return new Promise((resolve) => {
    wx.cloud.callFunction({
      name: name,
      data: data || {},
      success: (res) => {
        const result = res && res.result;
        if (result && typeof result.code === 'number') {
          resolve(result);
        } else {
          resolve(ok(result, 'success'));
        }
      },
      fail: (err) => {
        console.error('[api] 云函数 ' + name + ' 调用失败：', err);
        resolve(fail('云函数 ' + name + ' 调用失败：' + ((err && err.errMsg) || '')));
      }
    });
  });
}

/* ==================================================================
 * 二、用户与登录
 * ================================================================== */

/**
 * 登录：获取 openid，创建或查询用户
 * @param {{role?:string}} options
 */
function login(options) {
  const role = (options && options.role) === ROLES.TUTOR ? ROLES.TUTOR : ROLES.PARENT;
  if (USE_CLOUD) {
    return wrap(callCloud('login', { role: role }), 'login');
  }
  ensureSeed();
  const users = readStore(STORAGE_KEYS.USERS, []);
  let user = null;
  for (let i = 0; i < users.length; i++) {
    if (users[i].role === role) {
      user = users[i];
      break;
    }
  }
  if (!user) {
    user = {
      id: fmt.genId('user'),
      openid: 'mock-openid-' + role + '-' + Date.now().toString(36),
      role: role,
      nickname: role === ROLES.TUTOR ? '演示师范生' : '演示家长',
      phone: '',
      parentId: role === ROLES.PARENT ? mockDemands.CURRENT_PARENT_ID : '',
      tutorProfileId: role === ROLES.TUTOR ? mockTutors.CURRENT_TUTOR_ID : '',
      createdAt: fmt.formatDateTime(Date.now())
    };
    users.push(user);
    writeStore(STORAGE_KEYS.USERS, users);
  }
  return Promise.resolve(
    ok({
      openid: user.openid,
      user: user,
      tutorProfileId: user.tutorProfileId || '',
      parentId: user.parentId || '',
      mock: true
    })
  );
}

/** 读取当前用户信息（本地缓存优先） */
function getProfile() {
  if (USE_CLOUD) {
    // TODO(二期)：新增 getUserProfile 云函数，按 openid 查询 users 集合
    return Promise.resolve(fail('云函数模式暂未实现 getProfile，请先用 login 返回值'));
  }
  ensureSeed();
  const role = (getApp() && getApp().getRole()) || ROLES.PARENT;
  return login({ role: role });
}

/* ==================================================================
 * 三、风险检测
 * ================================================================== */

/**
 * 风险词检测（前端本地 + 可选云函数二次校验）
 * @param {string} text
 * @param {{remote?:boolean}} options remote=true 时优先调用云函数
 */
function riskCheck(text, options) {
  const local = riskService.checkRisk(text);
  const useRemote = options && options.remote;
  if (!USE_CLOUD || !useRemote) {
    return Promise.resolve(ok(Object.assign({}, local, { source: 'local' })));
  }
  return wrap(
    callCloud('riskCheck', { text: text }).then((res) => {
      if (res.code !== 0) return res;
      return ok(riskService.mergeRisk(local, res.data), 'success');
    }),
    'riskCheck'
  );
}

/** 批量字段风险检测（发布需求时用） */
function riskCheckFields(fields) {
  return riskCheck((fields || []).filter(Boolean).join('\n'));
}

/** 返回风险词库（用于「风险词说明」页面，云模式读数据库 risk_words） */
function getRiskWords() {
  if (USE_CLOUD) {
    // TODO(二期)：新增 riskWords 查询云函数，读取 risk_words 集合
    return Promise.resolve(ok(RISK_WORDS));
  }
  return Promise.resolve(ok(RISK_WORDS));
}

/* ==================================================================
 * 四、家长需求
 * ================================================================== */

/**
 * 发布需求
 * @param {object} form 需求表单
 * @param {{riskAcknowledged?:boolean}} options 命中高风险词后用户二次确认传 true
 * @returns {Promise<{code:number,data:{demand:object,risk:object},message:string}>}
 */
function createDemand(form, options) {
  const payload = form || {};
  const acknowledged = !!(options && options.riskAcknowledged);

  // 参数校验
  if (!payload.subject) return Promise.resolve(fail('请选择辅导科目'));
  if (!payload.grade) return Promise.resolve(fail('请选择学段年级'));
  if (!payload.teachMode) return Promise.resolve(fail('请选择授课方式'));
  if (!payload.address && payload.teachMode !== 'online') {
    return Promise.resolve(fail('线下授课请填写上课地点'));
  }

  if (USE_CLOUD) {
    return wrap(
      callCloud('submitDemand', {
        form: payload,
        riskAcknowledged: acknowledged
      }),
      'submitDemand'
    );
  }

  ensureSeed();

  // 二期：学科类标记（表单必选；缺失时按科目自动推断，保证旧调用方仍可运行）
  let disciplineFlag = 'quality';
  if (payload.isDiscipline === true || payload.isDiscipline === 'discipline') {
    disciplineFlag = 'discipline';
  } else if (payload.isDiscipline === false || payload.isDiscipline === 'quality') {
    disciplineFlag = 'quality';
  } else {
    disciplineFlag = riskService.isDisciplineSubject(payload.subject) ? 'discipline' : 'quality';
  }

  /* ---------- 第一步：双减政策红线（硬拦，不能通过"确认"放行） ---------- */
  const policyResult = riskService.checkDoubleReduction(
    Object.assign({}, payload, { isDiscipline: disciplineFlag })
  );
  if (policyResult.blocked) {
    return Promise.resolve({
      code: 3, // 3 = 政策红线，禁止发布（与 code 2 的"强提示可继续"区分）
      data: {
        policy: policyResult.policy,
        evidence: policyResult.evidence,
        compliance: {
          blocked: true,
          blockCode: POLICY_DOUBLE_REDUCTION.code
        }
      },
      message: POLICY_DOUBLE_REDUCTION.message
    });
  }

  /* ---------- 第二步：风险词检测（命中高风险可二次确认发布） ---------- */
  const riskFields = riskService.collectDemandRiskFields(payload);
  const risk = riskService.checkRiskFields(riskFields);

  // 高风险：必须二次确认后才允许发布
  if (risk.level === RISK_LEVEL.HIGH && !acknowledged) {
    return Promise.resolve({
      code: 2, // 2 = 需要用户确认风险
      data: { risk: risk },
      message: '检测到高风险表述，请确认后重新提交'
    });
  }

  const parentUser = readStore(STORAGE_KEYS.USERS, []).filter((u) => u.role === ROLES.PARENT)[0] || {};
  const now = Date.now();
  const demand = {
    id: fmt.genId('demand'),
    parentId: parentUser.parentId || mockDemands.CURRENT_PARENT_ID,
    parentName: parentUser.nickname || '演示家长',
    contactPhone: fmt.maskPhone(payload.phone || parentUser.phone || ''),
    subject: payload.subject,
    /* 二期：科目分组 + 学科类标记（接单池科目 Tab 与双减规则共用） */
    subjectGroup: disciplineFlag === 'discipline' ? 'discipline' : 'quality',
    isDiscipline: disciplineFlag,
    grade: payload.grade,
    stage: (fmt.getStageByGrade(payload.grade) || {}).value || '',
    frequency: payload.frequency || 'negotiable',
    timeRange: [].concat(payload.timeRange || []).filter(Boolean),
    timeRangeText: [].concat(payload.timeRange || []).map(fmt.timeRangeLabel).join(' / ') || '时间面议',
    address: payload.address || '',
    district: payload.district || '',
    teachMode: payload.teachMode,
    budget: Number(payload.budgetMax || payload.budget || 0),
    budgetMin: Number(payload.budgetMin || 0),
    budgetMax: Number(payload.budgetMax || payload.budget || 0),
    specialRequirements: payload.specialRequirements || '',
    riskLevel: risk.level,
    riskHits: risk.hits,
    /** 双减政策已通过（未通过时根本不会走到这里） */
    policyChecked: true,
    riskAcknowledged: acknowledged,
    status: DEMAND_STATUS.PUBLISHED,
    createdAt: fmt.formatDateTime(now),
    createdAtTs: now,
    applyCount: 0,
    viewCount: 0,
    deadline: payload.deadline || '',
    /** 二期：成单关系（MVP 一个需求对应一个订单） */
    matchedTutorId: '',
    acceptedAt: ''
  };

  const demands = readStore(STORAGE_KEYS.DEMANDS, []);
  demands.unshift(demand);
  writeStore(STORAGE_KEYS.DEMANDS, demands);
  writeStore(STORAGE_KEYS.RISK_ACK, demand.id);

  return Promise.resolve(ok({ demand: demand, risk: risk }, '需求已发布'));
}

/**
 * 需求列表
 * @param {{parentId?:string, status?:string, keyword?:string, onlyMine?:boolean}} query
 */
function getDemandList(query) {
  const q = query || {};
  if (USE_CLOUD) {
    // TODO(二期)：新增 listDemands 云函数（分页 + 权限过滤）
    return Promise.resolve(fail('云函数模式暂未实现 getDemandList'));
  }
  ensureSeed();
  let list = readStore(STORAGE_KEYS.DEMANDS, []);
  if (q.parentId) list = list.filter((d) => d.parentId === q.parentId);
  if (q.status && q.status !== 'all') list = list.filter((d) => d.status === q.status);
  if (q.keyword) {
    const kw = q.keyword;
    list = list.filter(
      (d) =>
        (d.subject && d.subject.indexOf(kw) > -1) ||
        (d.grade && d.grade.indexOf(kw) > -1) ||
        (d.address && d.address.indexOf(kw) > -1)
    );
  }
  list = list.slice().sort((a, b) => (b.createdAtTs || 0) - (a.createdAtTs || 0));
  return Promise.resolve(ok(list));
}

/** 需求详情 */
function getDemandDetail(demandId) {
  if (!demandId) return Promise.resolve(fail('缺少 demandId'));
  if (USE_CLOUD) {
    // TODO(二期)：新增 getDemandDetail 云函数
    return Promise.resolve(fail('云函数模式暂未实现 getDemandDetail'));
  }
  ensureSeed();
  const list = readStore(STORAGE_KEYS.DEMANDS, []);
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === demandId) return Promise.resolve(ok(list[i]));
  }
  return Promise.resolve(fail('需求不存在或已删除'));
}

/** 更新需求状态（关闭 / 重新开启匹配） */
function updateDemandStatus(demandId, status) {
  if (USE_CLOUD) {
    return wrap(callCloud('submitDemand', { action: 'updateStatus', demandId: demandId, status: status }), 'updateDemandStatus');
  }
  const list = readStore(STORAGE_KEYS.DEMANDS, []);
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === demandId) {
      list[i].status = status;
      writeStore(STORAGE_KEYS.DEMANDS, list);
      return Promise.resolve(ok(list[i], '状态已更新'));
    }
  }
  return Promise.resolve(fail('需求不存在'));
}

/* ==================================================================
 * 五、师范生档案与认证
 * ================================================================== */

/** 师范生列表（可选按科目/学段过滤） */
function getTutorList(query) {
  const q = query || {};
  if (USE_CLOUD) {
    // TODO(二期)：新增 listTutors 云函数
    return Promise.resolve(fail('云函数模式暂未实现 getTutorList'));
  }
  ensureSeed();
  let list = readStore(STORAGE_KEYS.TUTORS, []);
  if (q.subject && q.subject !== 'all') list = list.filter((t) => (t.subjects || []).indexOf(q.subject) > -1);
  if (q.district && q.district !== 'all') list = list.filter((t) => t.district === q.district);
  if (q.minCertLevel) list = list.filter((t) => Number(t.certLevel || 0) >= Number(q.minCertLevel));
  return Promise.resolve(ok(list));
}

/** 师范生详情 */
function getTutorDetail(tutorId) {
  if (!tutorId) return Promise.resolve(fail('缺少 tutorId'));
  if (USE_CLOUD) {
    // TODO(二期)：新增 getTutorDetail 云函数
    return Promise.resolve(fail('云函数模式暂未实现 getTutorDetail'));
  }
  ensureSeed();
  const list = readStore(STORAGE_KEYS.TUTORS, []);
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === tutorId) {
      const certs = readStore(STORAGE_KEYS.CERTIFICATIONS, []).filter((c) => c.tutorId === tutorId);
      return Promise.resolve(ok(Object.assign({}, list[i], { certifications: certs })));
    }
  }
  return Promise.resolve(fail('师范生档案不存在'));
}

/** 当前登录师范生档案 */
function getMyTutorProfile(tutorId) {
  const id = tutorId || mockTutors.CURRENT_TUTOR_ID;
  return getTutorDetail(id);
}

/**
 * 提交认证
 * @param {{tutorId:string, type:'student'|'qualification'|'ability', files?:Array, form?:object}} payload
 */
function submitCertification(payload) {
  const p = payload || {};
  if (!p.tutorId) return Promise.resolve(fail('缺少 tutorId'));
  if (!p.type) return Promise.resolve(fail('缺少认证类型'));

  if (USE_CLOUD) {
    return wrap(callCloud('submitCertification', p), 'submitCertification');
  }

  ensureSeed();
  const certs = readStore(STORAGE_KEYS.CERTIFICATIONS, []);
  const now = Date.now();
  const record = {
    id: fmt.genId('cert'),
    tutorId: p.tutorId,
    type: p.type,
    status: CERT_STATUS.PENDING,
    files: p.files || [],
    form: p.form || {},
    ocrResult: buildMockOcr(p),
    reviewNote: '已提交，等待审核（mock：调用 reviewCertification 模拟审核通过）',
    createdAt: fmt.formatDateTime(now),
    createdAtTs: now
  };
  // 同一类型只保留最新一条
  const rest = certs.filter((c) => !(c.tutorId === p.tutorId && c.type === p.type));
  rest.unshift(record);
  writeStore(STORAGE_KEYS.CERTIFICATIONS, rest);
  return Promise.resolve(ok(record, '认证材料已提交'));
}

/**
 * mock OCR / 校验结果
 * TODO(二期)：接入真实 OCR（教资证、普通话证识别）与学籍库校验，当前全部为模拟结果。
 */
function buildMockOcr(payload) {
  const form = payload.form || {};
  const base = { verified: true, mock: true, ocrAt: fmt.formatDateTime(Date.now()) };
  if (payload.type === 'student') {
    return Object.assign(base, {
      fields: {
        school: form.school || '首都师范大学',
        studentNo: fmt.maskStudentNo(form.studentNo || '12020000' + Math.floor(Math.random() * 9000 + 1000)),
        email: fmt.maskEmail(form.email || 'demo@cnu.edu.cn'),
        verifyChannel: form.email ? '校园邮箱校验（mock）' : '学号规则校验（mock）'
      },
      reviewNote: 'mock 校验通过：邮箱域名 @cnu.edu.cn / 学号规则符合首师大编码'
    });
  }
  if (payload.type === 'qualification') {
    return Object.assign(base, {
      fields: {
        certName: form.certName || '教师资格证（mock）',
        subject: form.certSubject || '',
        level: form.certLevel || '高级中学',
        no: 'MOCK-' + Math.floor(Math.random() * 900000 + 100000)
      },
      reviewNote: 'mock OCR 识别成功，字段与填报信息一致'
    });
  }
  return Object.assign(base, {
    fields: {
      videoUrl: form.videoUrl || '',
      durationMin: form.durationMin || 8,
      tags: form.abilityTags || [],
      reviewType: 'mock 规则评审（时长/清晰度/标签完整性）'
    },
    reviewNote: 'mock 评审通过：视频可播放，能力标签填写完整'
  });
}

/**
 * 模拟审核（云函数模式下对应 submitCertification 的 review 动作）
 * @param {string} certId
 * @param {'approved'|'rejected'} decision
 * @param {string} note
 */
function reviewCertification(certId, decision, note) {
  if (USE_CLOUD) {
    return wrap(
      callCloud('submitCertification', { action: 'review', certId: certId, decision: decision, reviewNote: note }),
      'reviewCertification'
    );
  }
  const certs = readStore(STORAGE_KEYS.CERTIFICATIONS, []);
  let target = null;
  for (let i = 0; i < certs.length; i++) {
    if (certs[i].id === certId) {
      certs[i].status = decision || CERT_STATUS.APPROVED;
      certs[i].reviewNote = note || 'mock 审核通过（模拟人工/规则评审）';
      certs[i].reviewedAt = fmt.formatDateTime(Date.now());
      target = certs[i];
      break;
    }
  }
  if (!target) return Promise.resolve(fail('认证记录不存在'));
  writeStore(STORAGE_KEYS.CERTIFICATIONS, certs);
  return recalcTutorCertLevel(target.tutorId).then((res) => {
    if (res.code !== 0) return res;
    return ok({ certification: target, tutor: res.data.tutor }, '审核完成');
  });
}

/**
 * 根据已通过的认证重算认证等级、徽章编号、信用分
 * @returns {Promise<{code:number,data:{tutor:object,level:number},message:string}>}
 */
function recalcTutorCertLevel(tutorId) {
  const certs = readStore(STORAGE_KEYS.CERTIFICATIONS, []).filter((c) => c.tutorId === tutorId);
  const approvedTypes = certs.filter((c) => c.status === CERT_STATUS.APPROVED).map((c) => c.type);
  const hasStudent = approvedTypes.indexOf('student') > -1;
  const hasQualification = approvedTypes.indexOf('qualification') > -1;
  const hasAbility = approvedTypes.indexOf('ability') > -1;

  let level = 0;
  if (hasStudent) level = 1;
  if (hasStudent && hasQualification) level = 2;
  if (hasStudent && hasQualification && hasAbility) level = 3;

  const tutors = readStore(STORAGE_KEYS.TUTORS, []);
  let tutor = null;
  for (let i = 0; i < tutors.length; i++) {
    if (tutors[i].id === tutorId) {
      tutors[i].certLevel = level;
      if (level === 3 && !tutors[i].certBadgeNo) {
        tutors[i].certBadgeNo = fmt.genBadgeNo();
      }
      if (level === 3 && !tutors[i].verifiedAt) {
        tutors[i].verifiedAt = fmt.formatDateTime(Date.now());
      }
      // 信用分：基础 70，学籍 +8、资质 +8、能力 +6，上限 100
      const abilityTags = (certs.filter((c) => c.type === 'ability')[0] || {}).form || {};
      if (abilityTags.abilityTags && abilityTags.abilityTags.length) {
        tutors[i].abilityTags = abilityTags.abilityTags;
        tutors[i].tags = abilityTags.abilityTags;
      }
      tutors[i].creditScore = Math.min(
        100,
        70 + (hasStudent ? 8 : 0) + (hasQualification ? 8 : 0) + (hasAbility ? 6 : 0)
      );
      tutor = tutors[i];
      break;
    }
  }
  if (!tutor) return Promise.resolve(fail('师范生档案不存在'));
  writeStore(STORAGE_KEYS.TUTORS, tutors);
  return Promise.resolve(ok({ tutor: tutor, level: level }));
}

/** 查询某师范生的认证记录 */
function getCertifications(tutorId) {
  if (!tutorId) return Promise.resolve(fail('缺少 tutorId'));
  if (USE_CLOUD) {
    // TODO(二期)：新增 listCertifications 云函数
    return Promise.resolve(fail('云函数模式暂未实现 getCertifications'));
  }
  ensureSeed();
  const certs = readStore(STORAGE_KEYS.CERTIFICATIONS, []).filter((c) => c.tutorId === tutorId);
  return Promise.resolve(ok(certs));
}

/** 演示用：清空某师范生的认证记录，便于完整走一遍三重认证流程 */
function resetCertifications(tutorId) {
  const id = tutorId || mockTutors.CURRENT_TUTOR_ID;
  const certs = readStore(STORAGE_KEYS.CERTIFICATIONS, []).filter((c) => c.tutorId !== id);
  writeStore(STORAGE_KEYS.CERTIFICATIONS, certs);
  const tutors = readStore(STORAGE_KEYS.TUTORS, []);
  for (let i = 0; i < tutors.length; i++) {
    if (tutors[i].id === id) {
      tutors[i].certLevel = 0;
      tutors[i].certBadgeNo = '';
      tutors[i].verifiedAt = '';
      break;
    }
  }
  writeStore(STORAGE_KEYS.TUTORS, tutors);
  return Promise.resolve(ok(true, '认证记录已清空（演示用）'));
}

/* ==================================================================
 * 六、智能匹配
 * ================================================================== */

/**
 * 对需求做 TopN 匹配
 * @param {string} demandId
 * @param {{topN?:number, save?:boolean}} options
 */
function matchTutors(demandId, options) {
  const opts = options || {};
  const topN = opts.topN || MATCH_CONFIG.topN;
  if (!demandId) return Promise.resolve(fail('缺少 demandId'));

  if (USE_CLOUD) {
    return wrap(callCloud('matchTutors', { demandId: demandId, topN: topN }), 'matchTutors');
  }

  return getDemandDetail(demandId).then((demandRes) => {
    if (demandRes.code !== 0) return demandRes;
    const demand = demandRes.data;
    const tutors = readStore(STORAGE_KEYS.TUTORS, []);
    const list = matchService.rankTutors(demand, tutors, topN);
    if (!list.length) return fail('暂无可推荐的师范生');

    // 写入 matches 集合（同一需求覆盖上一轮结果）
    const matches = readStore(STORAGE_KEYS.MATCHES, []).filter((m) => m.demandId !== demandId);
    const now = Date.now();
    list.forEach((item) => {
      matches.push({
        id: fmt.genId('match'),
        demandId: demandId,
        tutorId: item.tutorId,
        score: item.score,
        reasons: item.reasons,
        rank: item.rank,
        createdAt: fmt.formatDateTime(now)
      });
    });
    writeStore(STORAGE_KEYS.MATCHES, matches);

    // 需求状态推进到「匹配中」
    if (demand.status === DEMAND_STATUS.PUBLISHED) {
      updateDemandStatus(demandId, DEMAND_STATUS.MATCHING);
      demand.status = DEMAND_STATUS.MATCHING;
    }

    return ok({ demand: demand, list: list, matches: matches.filter((m) => m.demandId === demandId) });
  });
}

/** 读取某需求已保存的匹配结果（不再重算） */
function getMatchesByDemand(demandId) {
  ensureSeed();
  const matches = readStore(STORAGE_KEYS.MATCHES, [])
    .filter((m) => m.demandId === demandId)
    .sort((a, b) => a.rank - b.rank);
  return Promise.resolve(ok(matches));
}

/**
 * 师范生接单池：按 匹配度 + 距离 + 价格 + 信用分 排序
 * @param {{tutorId?:string}} query
 */
function getTutorPool(query) {
  const q = query || {};
  const tutorId = q.tutorId || mockTutors.CURRENT_TUTOR_ID;
  if (USE_CLOUD) {
    return wrap(callCloud('matchTutors', { action: 'pool', tutorId: tutorId }), 'getTutorPool');
  }
  return getTutorDetail(tutorId).then((tutorRes) => {
    if (tutorRes.code !== 0) return tutorRes;
    const demands = readStore(STORAGE_KEYS.DEMANDS, []).filter(
      (d) =>
        d.status === DEMAND_STATUS.PUBLISHED ||
        d.status === DEMAND_STATUS.MATCHING ||
        d.status === DEMAND_STATUS.MATCHED
    );
    const list = matchService.rankPoolDemands(tutorRes.data, demands);
    return ok({ tutor: tutorRes.data, list: list });
  });
}

/* ==================================================================
 * 七、申请接单
 * ================================================================== */

/** 师范生申请接单 */
function applyDemand(payload) {
  const p = payload || {};
  if (!p.demandId) return Promise.resolve(fail('缺少 demandId'));
  if (!p.tutorId) return Promise.resolve(fail('缺少 tutorId'));
  if (USE_CLOUD) {
    // TODO(二期)：新增 applyDemand 云函数，写入 applications 集合 + 消息通知
    return Promise.resolve(fail('云函数模式暂未实现 applyDemand'));
  }
  ensureSeed();
  const apps = readStore(STORAGE_KEYS.APPLICATIONS, []);
  const existed = apps.filter((a) => a.demandId === p.demandId && a.tutorId === p.tutorId)[0];
  if (existed) return Promise.resolve(ok(existed, '您已申请过该订单'));

  const record = {
    id: fmt.genId('apply'),
    demandId: p.demandId,
    tutorId: p.tutorId,
    tutorName: p.tutorName || '',
    status: 'applied',
    message: p.message || '',
    createdAt: fmt.formatDateTime(Date.now()),
    createdAtTs: Date.now()
  };
  apps.unshift(record);
  writeStore(STORAGE_KEYS.APPLICATIONS, apps);

  // 需求侧申请数 +1
  const demands = readStore(STORAGE_KEYS.DEMANDS, []);
  for (let i = 0; i < demands.length; i++) {
    if (demands[i].id === p.demandId) {
      demands[i].applyCount = Number(demands[i].applyCount || 0) + 1;
      break;
    }
  }
  writeStore(STORAGE_KEYS.DEMANDS, demands);
  return Promise.resolve(ok(record, '申请已提交，等待家长确认'));
}

/** 我的接单申请 */
function getMyApplications(tutorId) {
  ensureSeed();
  const apps = readStore(STORAGE_KEYS.APPLICATIONS, []).filter((a) => !tutorId || a.tutorId === tutorId);
  return Promise.resolve(ok(apps));
}

/* ==================================================================
 * 八、对接报告
 * ================================================================== */

/**
 * 生成对接报告
 * @param {string} demandId
 * @param {{topMatches?:Array}} options 可传入已算好的匹配结果，避免重复计算
 */
function generateReport(demandId, options) {
  const opts = options || {};
  if (!demandId) return Promise.resolve(fail('缺少 demandId'));

  if (USE_CLOUD) {
    return wrap(callCloud('generateReport', { demandId: demandId }), 'generateReport');
  }

  const build = (demand, list) => {
    const riskHits = demand.riskHits || [];
    const riskResult = {
      level: demand.riskLevel || RISK_LEVEL.LOW,
      hits: riskHits,
      tips: riskService.buildRiskTips({ level: demand.riskLevel, hits: riskHits })
    };
    const topMatches = list.map((item) => ({
      tutorId: item.tutorId,
      rank: item.rank,
      score: item.score,
      reasons: item.reasons,
      distanceKm: item.distanceKm,
      tutor: item.tutor
    }));

    const summary = buildReportSummary(demand, topMatches);
    const report = {
      id: fmt.genId('report'),
      demandId: demandId,
      parentId: demand.parentId,
      parentName: demand.parentName,
      demand: demand,
      topMatches: topMatches,
      riskLevel: riskResult.level,
      riskHits: riskHits,
      riskTips: riskResult.tips,
      summary: summary,
      nextSteps: buildNextSteps(demand, topMatches, riskResult.level),
      /* 二期：试课建议（合规固定文案，报告页与复制文本都要出现） */
      trialAdvice: TRIAL_ADVICE,
      /* 二期：平台性质声明（合规红线：非培训机构、不提供固定办学场所） */
      platformPosition: PLATFORM_POSITION,
      disclaimer: DISCLAIMER.full,
      createdAt: fmt.formatDateTime(Date.now()),
      createdAtTs: Date.now()
    };

    const reports = readStore(STORAGE_KEYS.REPORTS, []).filter((r) => r.demandId !== demandId);
    reports.unshift(report);
    writeStore(STORAGE_KEYS.REPORTS, reports);
    return report;
  };

  const proceed = (demand, list) => {
    if (!list || !list.length) return Promise.resolve(fail('暂无匹配结果，无法生成报告'));
    return Promise.resolve(ok(build(demand, list)));
  };

  if (opts.topMatches && opts.topMatches.length) {
    return getDemandDetail(demandId).then((res) => {
      if (res.code !== 0) return res;
      return proceed(res.data, opts.topMatches);
    });
  }

  return matchTutors(demandId, { topN: MATCH_CONFIG.topN }).then((res) => {
    if (res.code !== 0) return res;
    return proceed(res.data.demand, res.data.list);
  });
}

/** 报告摘要文案（模板生成，二期可换 LLM） */
function buildReportSummary(demand, topMatches) {
  if (!topMatches || !topMatches.length) return '';
  const best = topMatches[0];
  const t = best.tutor || {};
  const parts = [];
  parts.push(
    '家长需求：' +
      demand.grade +
      demand.subject +
      '，' +
      fmt.frequencyLabel(demand.frequency) +
      '，' +
      fmt.teachModeLabel(demand.teachMode) +
      (demand.budgetMax ? '，预算 ' + demand.budgetMax + ' 元/小时以内' : '') +
      '。'
  );
  parts.push(
    '平台共推荐 ' +
      topMatches.length +
      ' 位师范生，匹配度最高的是' +
      (t.name || '') +
      '（' +
      (t.school || '') +
      (t.major || '') +
      '，' +
      (t.grade || '') +
      '，匹配度 ' +
      best.score +
      ' 分，' +
      (best.distanceKm !== null && best.distanceKm !== undefined ? '距离约 ' + fmt.formatDistance(best.distanceKm) : '距离待确认') +
      '）。'
  );
  parts.push('认证情况：' + (t.certLevel >= 3 ? '已完成三重认证（编号 ' + (t.certBadgeNo || '待生成') + '）' : '认证等级 ' + (t.certLevel || 0) + ' 级，建议优先选择三重认证师范生。'));
  parts.push('风险提示：' + (demand.riskLevel === RISK_LEVEL.HIGH ? '该需求命中高风险词，平台强烈建议重新确认对接对象。' : demand.riskLevel === RISK_LEVEL.MEDIUM ? '该需求存在敏感表述，请按避坑提示逐条核实。' : '未发现风险词，仍建议按避坑提示完成首次沟通。'));
  return parts.join('\n');
}

/** 下一步建议 */
function buildNextSteps(demand, topMatches, riskLevel) {
  const steps = [
    '在平台内向 1-2 位推荐师范生发起沟通，确认可排课时间与授课方式。',
    '安排一次 30-45 分钟试课（建议线上或校内认证场地），重点观察讲解方式与孩子接受度。',
    '试课不满意可随时更换师范生，平台不收取任何费用、不收取押金。'
  ];
  if (demand.teachMode === 'offline') {
    steps.push('线下首次见面请选择公共场所或校内场地，未成年人上课需监护人全程知情。');
  }
  if (riskLevel === RISK_LEVEL.HIGH) {
    steps.unshift('⚠️ 该需求命中高风险词，建议先终止与对方的资金/证件相关沟通，必要时报警。');
  }
  steps.push('TODO(二期)：平台将支持资金担保结算与上课记录存证。');
  return steps;
}

/** 报告列表（家长维度） */
function getReportList(query) {
  const q = query || {};
  if (USE_CLOUD) {
    // TODO(二期)：新增 listReports 云函数
    return Promise.resolve(fail('云函数模式暂未实现 getReportList'));
  }
  ensureSeed();
  let list = readStore(STORAGE_KEYS.REPORTS, []);
  if (q.parentId) list = list.filter((r) => r.parentId === q.parentId);
  if (q.demandId) list = list.filter((r) => r.demandId === q.demandId);
  return Promise.resolve(ok(list));
}

/** 报告详情 */
function getReportDetail(reportId) {
  if (!reportId) return Promise.resolve(fail('缺少 reportId'));
  ensureSeed();
  const list = readStore(STORAGE_KEYS.REPORTS, []);
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === reportId) return Promise.resolve(ok(list[i]));
  }
  // 允许用 demandId 兜底查询（首次从匹配页跳转时可能只有 demandId）
  for (let j = 0; j < list.length; j++) {
    if (list[j].demandId === reportId) return Promise.resolve(ok(list[j]));
  }
  return Promise.resolve(fail('报告不存在，请先生成'));
}

/**
 * 报告纯文本（复制到剪贴板用）
 * @param {object} report
 */
function buildReportText(report) {
  if (!report) return '';
  const lines = [];
  const demand = report.demand || {};
  lines.push('【京师家教可信对接平台 · 对接报告】');
  lines.push('生成时间：' + (report.createdAt || ''));
  lines.push('');
  lines.push('一、需求摘要');
  lines.push(
    '  ' +
      (demand.grade || '') +
      (demand.subject || '') +
      ' | ' +
      fmt.frequencyLabel(demand.frequency) +
      ' | ' +
      fmt.teachModeLabel(demand.teachMode) +
      ' | ' +
      (demand.district ? fmt.districtLabel(demand.district) : '地点面议')
  );
  lines.push(
    '  预算：' + fmt.formatBudget(demand.budgetMin, demand.budgetMax) + ' | 时间：' + (demand.timeRangeText || '时间面议')
  );
  if (demand.specialRequirements) lines.push('  特殊要求：' + demand.specialRequirements);
  lines.push('  风险等级：' + (report.riskLevel || 'low'));
  lines.push('  双减合规：' + (demand.policyChecked ? '已通过（时段与学科类符合政策要求）' : '待核验'));
  lines.push('');
  lines.push('二、试课建议');
  lines.push('  ' + (report.trialAdvice || TRIAL_ADVICE));
  lines.push('');
  lines.push('三、推荐师范生 Top' + (report.topMatches || []).length);
  (report.topMatches || []).forEach((m) => {
    const t = m.tutor || {};
    lines.push(
      '  ' +
        m.rank +
        '. ' +
        (t.name || '') +
        '（匹配度 ' +
        m.score +
        ' 分）| ' +
        (t.school || '') +
        (t.major || '') +
        ' ' +
        (t.grade || '') +
        ' | 课时费 ' +
        (t.price || '-') +
        ' 元/小时 | 信用分 ' +
        (t.creditScore || '-') +
        ' | ' +
        (t.certLevel >= 3 ? '三重认证' : '认证等级 ' + (t.certLevel || 0))
    );
    lines.push('     认证编号：' + (t.certBadgeNo || '未生成'));
    (m.reasons || []).forEach((r) => lines.push('     理由：' + r));
  });
  lines.push('');
  lines.push('四、风险提示与避坑建议');
  (report.riskTips || []).forEach((t) => lines.push('  - ' + t));
  lines.push('');
  lines.push('五、下一步建议');
  (report.nextSteps || []).forEach((s, i) => lines.push('  ' + (i + 1) + '. ' + s));
  lines.push('');
  lines.push('六、平台性质声明');
  lines.push('  ' + (report.platformPosition || PLATFORM_POSITION));
  lines.push('');
  lines.push('七、免责声明');
  (Array.isArray(report.disclaimer) ? report.disclaimer : [report.disclaimer]).forEach((d) => lines.push('  - ' + d));
  lines.push('');
  lines.push('（本报告由平台规则引擎自动生成，认证信息可凭编号核验。）');
  return lines.join('\n');
}

/* ==================================================================
 * 九、统计（我的页面用）
 * ================================================================== */

/** 家长侧统计 */
function getParentStats(parentId) {
  ensureSeed();
  const demands = readStore(STORAGE_KEYS.DEMANDS, []).filter((d) => !parentId || d.parentId === parentId);
  const reports = readStore(STORAGE_KEYS.REPORTS, []).filter((r) => !parentId || r.parentId === parentId);
  return Promise.resolve(
    ok({
      demandCount: demands.length,
      publishedCount: demands.filter((d) => d.status === DEMAND_STATUS.PUBLISHED).length,
      reportCount: reports.length,
      riskCount: demands.filter((d) => d.riskLevel !== RISK_LEVEL.LOW).length
    })
  );
}

/** 师范生侧统计 */
function getTutorStats(tutorId) {
  ensureSeed();
  const id = tutorId || mockTutors.CURRENT_TUTOR_ID;
  const tutors = readStore(STORAGE_KEYS.TUTORS, []);
  const tutor = tutors.filter((t) => t.id === id)[0] || {};
  const certs = readStore(STORAGE_KEYS.CERTIFICATIONS, []).filter((c) => c.tutorId === id);
  const apps = readStore(STORAGE_KEYS.APPLICATIONS, []).filter((a) => a.tutorId === id);
  return Promise.resolve(
    ok({
      creditScore: tutor.creditScore || 0,
      certLevel: tutor.certLevel || 0,
      certBadgeNo: tutor.certBadgeNo || '',
      approvedCount: certs.filter((c) => c.status === CERT_STATUS.APPROVED).length,
      pendingCount: certs.filter((c) => c.status === CERT_STATUS.PENDING).length,
      applyCount: apps.length,
      orderCount: tutor.orderCount || 0,
      rating: tutor.rating || 0
    })
  );
}

module.exports = {
  /* 元信息 */
  isCloud: function () {
    return USE_CLOUD;
  },
  resetMockData: resetMockData,
  clearLocalData: clearLocalData,

  /* 用户 */
  login: login,
  getProfile: getProfile,

  /* 风险 */
  riskCheck: riskCheck,
  riskCheckFields: riskCheckFields,
  getRiskWords: getRiskWords,

  /* 需求 */
  createDemand: createDemand,
  getDemandList: getDemandList,
  getDemandDetail: getDemandDetail,
  updateDemandStatus: updateDemandStatus,

  /* 师范生 */
  getTutorList: getTutorList,
  getTutorDetail: getTutorDetail,
  getMyTutorProfile: getMyTutorProfile,

  /* 认证 */
  submitCertification: submitCertification,
  reviewCertification: reviewCertification,
  recalcTutorCertLevel: recalcTutorCertLevel,
  getCertifications: getCertifications,
  resetCertifications: resetCertifications,

  /* 匹配 */
  matchTutors: matchTutors,
  getMatchesByDemand: getMatchesByDemand,
  getTutorPool: getTutorPool,

  /* 接单 */
  applyDemand: applyDemand,
  getMyApplications: getMyApplications,

  /* 报告 */
  generateReport: generateReport,
  getReportList: getReportList,
  getReportDetail: getReportDetail,
  buildReportText: buildReportText,

  /* 统计 */
  getParentStats: getParentStats,
  getTutorStats: getTutorStats
};

/* ==================================================================
 * 二期模块挂载
 * 履约打卡 / 课后小结 / 双向盲评 / 信用分 / 确认成单 / 接单池筛选
 * 挂在 api 上导出，页面仍然只 require services/api.js（模块拆分对页面透明）。
 * 注意：phase2 的 getTutorPool 会覆盖上面一期的实现（新增科目/方式/状态筛选与计数）。
 * ================================================================== */
Object.assign(module.exports, require('./phase2.js'));
