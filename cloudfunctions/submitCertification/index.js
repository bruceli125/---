/**
 * 云函数：submitCertification —— 提交三重认证材料 / 模拟审核
 * ------------------------------------------------------------------
 * 入参（两种 action）：
 *   1) 默认（不传 action 或 'create'）：
 *      { tutorId, type: 'student' | 'qualification' | 'ability', files?: Array, form?: Object }
 *      - student:       form.school / form.studentNo / form.email
 *      - qualification: form.certName / form.certSubject / form.certLevel / form.certNo
 *      - ability:       form.videoUrl / form.durationMin / form.abilityTags[]
 *   2) action === 'review'：
 *      { certId, decision: 'approved' | 'rejected', reviewNote? }
 *
 * 返回：{ code, data, message }
 *   create -> data: 认证记录（含 mock ocrResult）
 *   review -> data: { certification, tutor }（tutor 为按已通过认证重算后的档案）
 * 依赖集合：certifications、tutors
 * 前端调用点：miniprogram/services/api.js -> submitCertification() / reviewCertification()
 *
 * TODO(二期)（当前全部为 mock，未接入任何真实能力）：
 *   - 接入真实 OCR（教师资格证、普通话证书识别）—— 建议走云函数 + 第三方 OCR API
 *   - 接入真实学籍校验（校园邮箱验证码 / 学校教务接口）
 *   - 接入真实视频评审（试讲视频转码 + 人工评审工作台 / 语音转写打分）
 *   - 认证结果上链 / 存证，认证编号可对外核验（含失效与撤销机制）
 */

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const COLLECTIONS = {
  CERTIFICATIONS: 'certifications',
  TUTORS: 'tutors'
};

/** 认证类型（与 miniprogram/utils/constants.js CERT_TYPES 一致） */
const CERT_TYPES = ['student', 'qualification', 'ability'];

/** 认证状态（与 constants.js CERT_STATUS 一致） */
const CERT_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected'
};

/** 信用分重算基线（与 miniprogram/services/api.js recalcTutorCertLevel 一致） */
const CREDIT_BASE = 70;
const CREDIT_BONUS = { student: 8, qualification: 8, ability: 6 };

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

/** 学号脱敏：2021****1234（与 format.js maskStudentNo 一致） */
function maskStudentNo(no) {
  const s = String(no || '');
  if (s.length <= 4) return s ? '****' : '';
  if (s.length <= 8) return s.slice(0, 2) + '****';
  return s.slice(0, 4) + '****' + s.slice(-4);
}

/** 邮箱脱敏：ab****@cnu.edu.cn（与 format.js maskEmail 一致） */
function maskEmail(email) {
  const s = String(email || '');
  const at = s.indexOf('@');
  if (at <= 0) return s;
  const name = s.slice(0, at);
  const domain = s.slice(at);
  if (name.length <= 2) return name.slice(0, 1) + '****' + domain;
  return name.slice(0, 2) + '****' + domain;
}

/** 认证徽章编号：JS-2026-000123（与 format.js genBadgeNo 一致） */
function genBadgeNo(seq) {
  let n = seq ? String(seq) : String(Math.floor(Math.random() * 999999) + 1);
  while (n.length < 6) n = '0' + n;
  return 'JS-' + new Date().getFullYear() + '-' + n;
}

/** 文档补 id 字段 */
function withId(doc) {
  if (!doc) return doc;
  const out = Object.assign({}, doc);
  out.id = doc._id;
  return out;
}

/**
 * mock OCR / 校验结果
 * TODO(二期)：接入真实 OCR 与学籍库校验，当前全部为模拟结果。
 */
function buildMockOcr(payload) {
  const form = payload.form || {};
  const base = { verified: true, mock: true, ocrAt: formatDateTime(Date.now()) };

  if (payload.type === 'student') {
    return Object.assign(base, {
      fields: {
        school: form.school || 'XX大学',
        studentNo: maskStudentNo(form.studentNo || '12020000' + Math.floor(Math.random() * 9000 + 1000)),
        email: maskEmail(form.email || 'demo@cnu.edu.cn'),
        verifyChannel: form.email ? '校园邮箱校验（mock）' : '学号规则校验（mock）'
      },
      reviewNote: 'mock 校验通过：邮箱域名 @cnu.edu.cn / 学号规则符合XX大学编码'
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

/** 按 _id 或 id 字段查认证记录 */
async function findCertification(certId) {
  try {
    const res = await db.collection(COLLECTIONS.CERTIFICATIONS).doc(certId).get();
    if (res && res.data) return res.data;
  } catch (err) {
    console.warn('[submitCertification] 按 _id 查询认证失败，尝试按 id 字段查询：', err);
  }
  try {
    const res2 = await db
      .collection(COLLECTIONS.CERTIFICATIONS)
      .where({ id: certId })
      .limit(1)
      .get();
    const list = (res2 && res2.data) || [];
    if (list.length) return list[0];
  } catch (err2) {
    console.error('[submitCertification] 查询认证记录失败：', err2);
  }
  return null;
}

/** 按 _id 或 id 字段查学生档案 */
async function findTutor(tutorId) {
  try {
    const res = await db.collection(COLLECTIONS.TUTORS).doc(tutorId).get();
    if (res && res.data) return res.data;
  } catch (err) {
    console.warn('[submitCertification] 按 _id 查询学生失败，尝试按 id 字段查询：', err);
  }
  try {
    const res2 = await db.collection(COLLECTIONS.TUTORS).where({ id: tutorId }).limit(1).get();
    const list = (res2 && res2.data) || [];
    if (list.length) return list[0];
  } catch (err2) {
    console.error('[submitCertification] 查询学生档案失败：', err2);
  }
  return null;
}

/* ============================ 业务逻辑 ============================ */

/** 提交认证材料 */
async function handleCreate(event) {
  const tutorId = event && event.tutorId;
  const type = event && event.type;
  const files = (event && event.files) || [];
  const form = (event && event.form) || {};

  // ---------- 参数校验 ----------
  if (!tutorId || typeof tutorId !== 'string') {
    return fail('参数错误：tutorId 不能为空', 1);
  }
  if (CERT_TYPES.indexOf(type) === -1) {
    return fail('参数错误：type 必须是 ' + CERT_TYPES.join(' / ') + ' 之一', 1);
  }
  if (!Array.isArray(files)) {
    return fail('参数错误：files 必须是数组', 1);
  }
  if (files.length > 9) {
    return fail('参数错误：files 最多 9 个文件', 1);
  }
  if (typeof form !== 'object' || Array.isArray(form)) {
    return fail('参数错误：form 必须是对象', 1);
  }
  if (type === 'ability') {
    const tags = form.abilityTags || [];
    if (!Array.isArray(tags)) return fail('参数错误：abilityTags 必须是数组', 1);
    if (tags.length > 6) return fail('参数错误：能力标签最多选择 6 个', 1);
    if (!form.videoUrl && !files.length) {
      return fail('参数错误：能力认证需填写试讲视频链接或上传视频', 1);
    }
  }
  if (type === 'student' && !form.studentNo && !form.email) {
    return fail('参数错误：学籍认证需填写学号或校园邮箱', 1);
  }

  // 档案存在性校验（保存前先确认学生档案存在，避免脏数据）
  const tutor = await findTutor(tutorId);
  if (!tutor) {
    return fail('参数错误：学生档案不存在，请先完善档案', 1);
  }

  // ---------- 写库 ----------
  const now = Date.now();
  const ocrResult = buildMockOcr({ type: type, form: form });

  const doc = {
    tutorId: tutor._id,
    type: type,
    status: CERT_STATUS.PENDING,
    files: files,
    form: form,
    ocrResult: ocrResult,
    reviewNote: '已提交，等待审核（mock：可调用 review 动作模拟审核通过）',
    createdAt: db.serverDate(),
    createdAtTs: now
  };

  let certId = '';
  try {
    const addRes = await db.collection(COLLECTIONS.CERTIFICATIONS).add({ data: doc });
    certId = addRes._id;
    await db.collection(COLLECTIONS.CERTIFICATIONS).doc(certId).update({ data: { id: certId } });
  } catch (err) {
    console.error('[submitCertification] 写入 certifications 失败：', err);
    return fail('提交失败：认证记录写入异常（' + err.message + '）');
  }

  const record = Object.assign({}, doc, { _id: certId, id: certId, createdAt: formatDateTime(now) });
  return ok(record, '认证材料已提交，等待审核');
}

/**
 * 重算学生认证等级 / 徽章编号 / 信用分
 * 规则（与 miniprogram/services/api.js recalcTutorCertLevel 一致）：
 *   等级：学籍 1 级；学籍 + 资质 2 级；学籍 + 资质 + 能力 3 级
 *   信用分：70 + 学籍 8 + 资质 8 + 能力 6（上限 100）
 */
async function recalcTutor(tutorDoc, certs) {
  const approvedTypes = certs
    .filter(function (c) {
      return c.status === CERT_STATUS.APPROVED;
    })
    .map(function (c) {
      return c.type;
    });

  const hasStudent = approvedTypes.indexOf('student') > -1;
  const hasQualification = approvedTypes.indexOf('qualification') > -1;
  const hasAbility = approvedTypes.indexOf('ability') > -1;

  let level = 0;
  if (hasStudent) level = 1;
  if (hasStudent && hasQualification) level = 2;
  if (hasStudent && hasQualification && hasAbility) level = 3;

  const patch = {
    certLevel: level,
    creditScore: Math.min(
      100,
      CREDIT_BASE +
        (hasStudent ? CREDIT_BONUS.student : 0) +
        (hasQualification ? CREDIT_BONUS.qualification : 0) +
        (hasAbility ? CREDIT_BONUS.ability : 0)
    )
  };

  // 三重认证通过且尚无编号时生成唯一编号
  if (level === 3 && !tutorDoc.certBadgeNo) {
    patch.certBadgeNo = genBadgeNo();
    patch.verifiedAt = formatDateTime(Date.now());
  }

  // 能力认证通过后，把能力标签写入档案（tags 与 abilityTags 同步，便于匹配与展示）
  if (hasAbility) {
    const abilityCert =
      certs.filter(function (c) {
        return c.type === 'ability' && c.status === CERT_STATUS.APPROVED;
      })[0] || null;
    const abilityForm = (abilityCert && abilityCert.form) || {};
    const tags = abilityForm.abilityTags || [];
    if (tags.length) {
      patch.abilityTags = tags;
      patch.tags = tags;
    }
  }

  await db.collection(COLLECTIONS.TUTORS).doc(tutorDoc._id).update({ data: patch });
  return Object.assign({}, tutorDoc, patch, { id: tutorDoc._id, _id: tutorDoc._id });
}

/** 模拟审核（MVP 用于演示三重认证流程） */
async function handleReview(event) {
  const certId = event && event.certId;
  const decision = (event && event.decision) || CERT_STATUS.APPROVED;
  const reviewNote = (event && event.reviewNote) || 'mock 审核通过（模拟人工/规则评审）';

  // ---------- 参数校验 ----------
  if (!certId || typeof certId !== 'string') {
    return fail('参数错误：certId 不能为空', 1);
  }
  if ([CERT_STATUS.APPROVED, CERT_STATUS.REJECTED].indexOf(decision) === -1) {
    return fail('参数错误：decision 必须是 approved 或 rejected', 1);
  }
  if (typeof reviewNote !== 'string' || reviewNote.length > 300) {
    return fail('参数错误：reviewNote 必须是 300 字以内的字符串', 1);
  }

  const cert = await findCertification(certId);
  if (!cert) return fail('参数错误：认证记录不存在', 1);

  // TODO(二期)：审核动作需限定为管理员/审核员角色（校验 users.role === 'admin'）

  try {
    await db.collection(COLLECTIONS.CERTIFICATIONS).doc(cert._id).update({
      data: {
        status: decision,
        reviewNote: reviewNote,
        reviewedAt: db.serverDate()
      }
    });
  } catch (err) {
    console.error('[submitCertification] 更新认证状态失败：', err);
    return fail('审核失败：' + err.message);
  }

  const updatedCert = Object.assign({}, cert, {
    status: decision,
    reviewNote: reviewNote,
    reviewedAt: formatDateTime(Date.now()),
    id: cert._id
  });

  // ---------- 重算学生档案 ----------
  let tutor = await findTutor(cert.tutorId);
  if (!tutor) return fail('审核完成，但学生档案不存在，无法重算认证等级', 1);

  let certs = [];
  try {
    // 注意：云数据库单次最多返回 100 条，MVP 单个学生认证记录远小于该上限
    const certRes = await db
      .collection(COLLECTIONS.CERTIFICATIONS)
      .where({ tutorId: tutor._id })
      .limit(100)
      .get();
    certs = (certRes && certRes.data) || [];
  } catch (err) {
    console.error('[submitCertification] 读取认证记录失败：', err);
    return fail('审核完成，但认证记录读取失败：' + err.message);
  }

  try {
    tutor = await recalcTutor(tutor, certs);
  } catch (err) {
    console.error('[submitCertification] 重算学生档案失败：', err);
    return fail('审核完成，但档案重算失败：' + err.message);
  }

  return ok({ certification: updatedCert, tutor: tutor }, '审核完成');
}

exports.main = async (event, context) => {
  try {
    const action = (event && event.action) || 'create';
    if (action === 'create') {
      return await handleCreate(event);
    }
    if (action === 'review') {
      return await handleReview(event);
    }
    return fail('参数错误：不支持的 action（仅支持 create / review）', 1);
  } catch (err) {
    console.error('[submitCertification] 执行失败：', err);
    return fail('认证提交失败：' + (err && err.message ? err.message : '未知异常'));
  }
};
