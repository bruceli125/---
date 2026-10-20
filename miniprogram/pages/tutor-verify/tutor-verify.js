/**
 * 师范生三重认证页：学籍认证 -> 资质认证 -> 能力认证 -> 生成认证徽章
 *
 * 数据来源：只通过 services/api.js（mock + storage，或云函数模式）。
 *
 * ⚠️ mock 边界（务必看清，不要误以为已经接真实能力）：
 *   1. 学籍认证：仅做「学号位数 + 校园邮箱域名」规则校验（services/api.js buildMockOcr），
 *      TODO(二期) 对接学校学籍库 / 统一身份认证，绝不采集真实学号与身份证；
 *   2. 资质认证：上传的是本地临时图片路径，只做展示，未上传云存储；
 *      OCR 结果为 api 内写死的 mock 字段，TODO(二期) 接真实 OCR（教资证/普通话证识别）；
 *   3. 能力认证：视频链接或本地视频仅记录路径，未上传、未转码、未做真实评审；
 *      TODO(二期) 接云存储 + 转码 + 规则/人工评审，评审结论由服务端给出；
 *   4. 审核状态：提交后 1.2 秒调用 api.reviewCertification 模拟「审核通过」，
 *      真实环境应由运营后台审核，前端无权改变审核结论。
 *
 * 说明：本项目刻意不引入 Vant Weapp / TDesign，保证「导入微信开发者工具即可运行、无需构建 npm」。
 */
const api = require('../../services/api.js');
const fmt = require('../../utils/format.js');
const C = require('../../utils/constants.js');

/** mock 审核延迟（毫秒），模拟人工/规则审核耗时 */
const REVIEW_DELAY = 1200;

/** 资质认证字典 */
const QUAL_CERT_TYPES = ['教师资格证', '普通话证书', '获奖证明'];
const QUAL_LEVELS = ['幼儿园', '小学', '初级中学', '高级中学', '中职'];

/**
 * 生成 chips 选项（含 className）
 * WXML 里不做条件判断，所有样式类都在 js 里算好。
 */
function buildChipOptions(list, activeValue) {
  return (list || []).map(function (value) {
    return { value: value, className: value === activeValue ? 'chip chip-active' : 'chip' };
  });
}

/** OCR / 校验结果字段中文名 */
const FIELD_LABELS = {
  school: '学校',
  studentNo: '学号（脱敏）',
  email: '校园邮箱（脱敏）',
  verifyChannel: '校验方式',
  certName: '证书名称',
  certType: '证书类型',
  subject: '学科',
  level: '等级',
  no: '证书编号',
  videoUrl: '试讲视频',
  videoPath: '本地视频（仅演示，未上传）',
  durationMin: '视频时长（分钟）',
  tags: '能力标签',
  reviewType: '评审方式'
};

const STATUS_TEXT_CLASS = {
  approved: 'text-green',
  pending: 'text-orange',
  rejected: 'text-red',
  none: 'text-weak'
};

const MARK_CLASS = {
  approved: 'step-done',
  pending: 'step-pending',
  rejected: 'step-rejected',
  none: 'step-todo'
};

function toast(title) {
  wx.showToast({ title: title || '', icon: 'none', duration: 2000 });
}

/** 已是脱敏值就直接展示，避免二次打码 */
function maskIfNeeded(value, masker) {
  const s = String(value || '');
  if (!s) return '未提供';
  if (s.indexOf('*') > -1) return s;
  return masker(s);
}

/** 取每个认证类型的最新一条记录 */
function latestCertMap(certs) {
  const map = {};
  (certs || []).forEach(function (c) {
    const cur = map[c.type];
    if (!cur || Number(c.createdAtTs || 0) >= Number(cur.createdAtTs || 0)) {
      map[c.type] = c;
    }
  });
  return map;
}

function formatFieldValue(value) {
  if (Array.isArray(value)) return value.join('、');
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (value && typeof value === 'object') return JSON.stringify(value);
  const s = String(value);
  return s.length > 48 ? s.slice(0, 48) + '…' : s;
}

/** cert.ocrResult.fields -> [{label, value}] */
function buildOcrBlock(cert) {
  if (!cert || !cert.ocrResult || !cert.ocrResult.fields) return [];
  const fields = cert.ocrResult.fields;
  const out = [];
  Object.keys(fields).forEach(function (key) {
    const value = fields[key];
    if (value === undefined || value === null || value === '') return;
    out.push({ label: FIELD_LABELS[key] || key, value: formatFieldValue(value) });
  });
  return out;
}

/** 三步状态（进度条用） */
function buildSteps(certMap) {
  return C.CERT_TYPES.map(function (type, index) {
    const cert = certMap[type.value];
    const status = cert ? cert.status : 'none';
    return {
      key: type.value,
      index: index,
      label: type.label,
      desc: type.desc,
      icon: type.icon,
      status: status,
      statusText: cert ? C.CERT_STATUS_LABEL[status] || '待提交' : '未提交',
      statusTextClass: STATUS_TEXT_CLASS[status] || 'text-weak',
      markClass: MARK_CLASS[status] || 'step-todo',
      progressMark: status === 'approved' ? '✓' : String(index + 1),
      done: status === 'approved',
      pending: status === 'pending',
      rejected: status === 'rejected'
    };
  });
}

function buildCertSummary(cert) {
  if (!cert) {
    return {
      has: false,
      status: 'none',
      statusText: '未提交',
      statusTextClass: 'text-weak',
      reviewNote: '',
      createdAt: '',
      reviewedAt: ''
    };
  }
  return {
    has: true,
    status: cert.status,
    statusText: C.CERT_STATUS_LABEL[cert.status] || '待提交',
    statusTextClass: STATUS_TEXT_CLASS[cert.status] || 'text-weak',
    reviewNote: cert.reviewNote || '',
    createdAt: cert.createdAt || '',
    reviewedAt: cert.reviewedAt || ''
  };
}

/** 能力标签选项（WXML 里不能做数组 includes 判断，所以在 js 里预计算 active） */
function buildTagOptions(selected) {
  const sel = selected || [];
  return C.ABILITY_TAGS.map(function (tag) {
    return { value: tag, active: sel.indexOf(tag) > -1 };
  });
}

/** 选择图片（不真实上传，仅取临时路径展示） */
function chooseImageFile() {
  return new Promise(function (resolve) {
    if (typeof wx.chooseMedia === 'function') {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
        success: function (res) {
          const file = (res.tempFiles || [])[0];
          resolve(file ? { path: file.tempFilePath, size: file.size || 0 } : null);
        },
        fail: function () {
          resolve(null);
        }
      });
      return;
    }
    wx.chooseImage({
      count: 1,
      success: function (res) {
        const path = (res.tempFilePaths || [])[0];
        resolve(path ? { path: path, size: 0 } : null);
      },
      fail: function () {
        resolve(null);
      }
    });
  });
}

/** 选择视频（不真实上传/转码，仅取临时路径展示） */
function chooseVideoFile() {
  return new Promise(function (resolve) {
    if (typeof wx.chooseMedia === 'function') {
      wx.chooseMedia({
        count: 1,
        mediaType: ['video'],
        sourceType: ['album', 'camera'],
        maxDuration: 60,
        success: function (res) {
          const file = (res.tempFiles || [])[0];
          resolve(file ? { path: file.tempFilePath, size: file.size || 0, duration: file.duration || 0 } : null);
        },
        fail: function () {
          resolve(null);
        }
      });
      return;
    }
    wx.chooseVideo({
      maxDuration: 60,
      success: function (res) {
        resolve({ path: res.tempFilePath, size: res.size || 0, duration: res.duration || 0 });
      },
      fail: function () {
        resolve(null);
      }
    });
  });
}

function fileNameOf(path) {
  const s = String(path || '');
  const index = s.lastIndexOf('/');
  return index > -1 ? s.slice(index + 1) : s;
}

Page({
  data: {
    loading: true,
    submitting: false,
    tutorId: '',
    tutor: {},

    /* 进度条 */
    steps: [],
    approvedCount: 0,
    progressText: '已完成 0 / 3 项认证',
    allPassed: false,

    /* 徽章 */
    badge: {
      level: 0,
      name: '',
      school: '',
      major: '',
      grade: '',
      badgeNo: '',
      tags: [],
      abilityTags: [],
      verifiedAt: ''
    },
    certLevel: 0,
    certLevelText: '未认证',
    certLevelDesc: '',
    levelTagClass: 'tag-line',

    /* 各步骤折叠状态与图标 */
    ui: {
      student: { expanded: true, mark: '1', markClass: 'step-todo', toggleText: '收起' },
      qualification: { expanded: false, mark: '2', markClass: 'step-todo', toggleText: '展开' },
      ability: { expanded: false, mark: '3', markClass: 'step-todo', toggleText: '展开' }
    },
    studentCert: buildCertSummary(null),
    qualCert: buildCertSummary(null),
    abilityCert: buildCertSummary(null),

    /* 学籍认证表单 */
    studentForm: { school: '首都师范大学', studentNo: '', email: '' },

    /* 资质认证表单 */
    qualForm: { certType: '教师资格证', certName: '', certSubject: '', certLevel: '高级中学' },
    certTypeOptions: buildChipOptions(QUAL_CERT_TYPES, '教师资格证'),
    qualLevelOptions: buildChipOptions(QUAL_LEVELS, '高级中学'),
    qualFile: { path: '', name: '', sizeText: '' },

    /* 能力认证表单 */
    abilityForm: { videoUrl: '', durationMin: '' },
    tagOptions: buildTagOptions([]),
    selectedTags: [],
    abilityVideo: { path: '', name: '', durationText: '' },

    /* mock OCR / 评审结果 */
    ocrBlocks: { student: [], qualification: [], ability: [] },

    /* 按钮态 */
    studentBtnText: '提交学籍认证',
    qualBtnText: '提交资质认证',
    abilityBtnText: '提交能力认证',
    studentBtnClass: 'btn btn-primary step-btn',
    qualBtnClass: 'btn btn-primary step-btn',
    abilityBtnClass: 'btn btn-primary step-btn',
    studentBusy: false,
    qualBusy: false,
    abilityBusy: false,

    /* 隐私说明 */
    privacyRows: [],
    privacyNotice:
      '平台不采集真实身份证号与学号，手机号 / 学号 / 邮箱均脱敏存储与展示；开发阶段全部为 mock 数据。'
  },

  onLoad() {
    const app = getApp();
    if (app.getRole() !== C.ROLES.TUTOR) {
      app.setRole(C.ROLES.TUTOR);
      app.ensureLogin(true).catch(function () {});
      wx.showToast({ title: '已切换为师范生身份', icon: 'none' });
    }
    /** 页面内所有 setTimeout 句柄，onUnload 时统一清理 */
    this._timers = [];
    this.loadData();
  },

  onUnload() {
    (this._timers || []).forEach(function (timer) {
      clearTimeout(timer);
    });
    this._timers = [];
  },

  /** 加载档案 + 认证记录，并重建整页展示数据 */
  loadData() {
    const self = this;
    this.setData({ loading: true });
    return api
      .getMyTutorProfile(this.data.tutorId || undefined)
      .then(function (res) {
        if (!res || res.code !== 0 || !res.data) {
          self.setData({ loading: false });
          toast((res && res.message) || '师范生档案加载失败');
          return null;
        }
        const tutor = res.data;
        return api.getCertifications(tutor.id).then(function (certRes) {
          const certs = (certRes && certRes.code === 0 && certRes.data) || [];
          self.applyTutor(tutor, certs);
          return tutor;
        });
      });
  },

  applyTutor(tutor, certs) {
    const certMap = latestCertMap(certs);
    const steps = buildSteps(certMap);
    const approvedCount = steps.filter(function (s) {
      return s.done;
    }).length;
    const level = Number(tutor.certLevel || 0);
    const levelItem = C.CERT_LEVELS[level] || C.CERT_LEVELS[0];

    /* 折叠状态：第一个未通过的步骤默认展开，已通过的默认收起 */
    let activeKey = '';
    for (let i = 0; i < steps.length; i++) {
      if (!steps[i].done) {
        activeKey = steps[i].key;
        break;
      }
    }
    const ui = {};
    steps.forEach(function (step, index) {
      const expanded = step.key === activeKey;
      ui[step.key] = {
        expanded: expanded,
        mark: step.done ? '✓' : String(index + 1),
        markClass: step.markClass,
        toggleText: expanded ? '收起' : '展开'
      };
    });

    /* 表单回填：把上一次提交的内容填回来，方便继续修改 */
    const studentForm = Object.assign({ school: '首都师范大学', studentNo: '', email: '' }, (certMap.student || {}).form || {});
    const qualForm = Object.assign(
      { certType: '教师资格证', certName: '', certSubject: '', certLevel: '高级中学' },
      (certMap.qualification || {}).form || {}
    );
    const abilityFormData = (certMap.ability || {}).form || {};
    const abilityForm = {
      videoUrl: abilityFormData.videoUrl || '',
      durationMin: abilityFormData.durationMin ? String(abilityFormData.durationMin) : ''
    };
    const selectedTags = abilityFormData.abilityTags || [];

    this.setData({
      loading: false,
      tutorId: tutor.id || '',
      tutor: tutor,
      steps: steps,
      approvedCount: approvedCount,
      progressText: '已完成 ' + approvedCount + ' / ' + steps.length + ' 项认证',
      allPassed: level >= 3,
      badge: {
        level: level,
        name: tutor.name || '',
        school: tutor.school || '',
        major: tutor.major || '',
        grade: tutor.grade || '',
        badgeNo: tutor.certBadgeNo || '',
        tags: tutor.tags || [],
        abilityTags: tutor.abilityTags || [],
        verifiedAt: tutor.verifiedAt || ''
      },
      certLevel: level,
      certLevelText: levelItem.label,
      certLevelDesc: levelItem.desc,
      levelTagClass: level >= 3 ? 'tag-green' : level >= 1 ? 'tag-blue' : 'tag-line',
      ui: ui,
      studentCert: buildCertSummary(certMap.student),
      qualCert: buildCertSummary(certMap.qualification),
      abilityCert: buildCertSummary(certMap.ability),
      studentForm: studentForm,
      qualForm: qualForm,
      certTypeOptions: buildChipOptions(QUAL_CERT_TYPES, qualForm.certType),
      qualLevelOptions: buildChipOptions(QUAL_LEVELS, qualForm.certLevel),
      abilityForm: abilityForm,
      selectedTags: selectedTags,
      tagOptions: buildTagOptions(selectedTags),
      ocrBlocks: {
        student: buildOcrBlock(certMap.student),
        qualification: buildOcrBlock(certMap.qualification),
        ability: buildOcrBlock(certMap.ability)
      },
      privacyRows: [
        { label: '手机号', value: maskIfNeeded(tutor.phone, fmt.maskPhone) },
        { label: '学号', value: maskIfNeeded(studentForm.studentNo || tutor.studentNo, fmt.maskStudentNo) },
        { label: '校园邮箱', value: maskIfNeeded(studentForm.email || tutor.email, fmt.maskEmail) }
      ]
    });
  },

  /* ================= 折叠交互 ================= */

  onToggleStep(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || !this.data.ui[key]) return;
    const expanded = !this.data.ui[key].expanded;
    const patch = {};
    patch['ui.' + key + '.expanded'] = expanded;
    patch['ui.' + key + '.toggleText'] = expanded ? '收起' : '展开';
    this.setData(patch);
  },

  /* ================= 学籍认证 ================= */

  onStudentInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    const patch = {};
    patch['studentForm.' + field] = e.detail.value;
    this.setData(patch);
  },

  onSubmitStudent() {
    if (this.data.submitting) return;
    const form = this.data.studentForm;
    const studentNo = String(form.studentNo || '').trim();
    const email = String(form.email || '').trim();
    const hasStudentNo = studentNo.length >= 8;
    const hasCampusEmail = /@cnu\.edu\.cn$/i.test(email);

    if (!studentNo && !email) {
      toast('请填写学号或首师大校园邮箱');
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast('校园邮箱格式不正确');
      return;
    }
    // mock 校验规则：学号 ≥ 8 位，或校园邮箱域名为 @cnu.edu.cn
    if (!hasStudentNo && !hasCampusEmail) {
      toast('请填写 8 位以上学号，或 @cnu.edu.cn 校园邮箱');
      return;
    }

    this.submitCert(
      'student',
      { school: form.school || '首都师范大学', studentNo: studentNo, email: email },
      '学籍认证',
      []
    );
  },

  /* ================= 资质认证 ================= */

  onCertTypeTap(e) {
    const value = e.currentTarget.dataset.value;
    if (!value) return;
    this.setData({
      'qualForm.certType': value,
      certTypeOptions: buildChipOptions(QUAL_CERT_TYPES, value)
    });
  },

  onQualLevelTap(e) {
    const value = e.currentTarget.dataset.value;
    if (!value) return;
    this.setData({
      'qualForm.certLevel': value,
      qualLevelOptions: buildChipOptions(QUAL_LEVELS, value)
    });
  },

  onQualInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    const patch = {};
    patch['qualForm.' + field] = e.detail.value;
    this.setData(patch);
  },

  /** 选择证书图片：仅取本地临时路径用于展示，未上传云存储 */
  onChooseQualImage() {
    const self = this;
    chooseImageFile().then(function (file) {
      if (!file) return;
      // TODO(二期)：wx.cloud.uploadFile 上传到云存储，落库只存 fileID，前端不再持有本地路径
      self.setData({
        qualFile: {
          path: file.path,
          name: fileNameOf(file.path) || '证书图片',
          sizeText: file.size ? Math.round(file.size / 1024) + ' KB' : ''
        }
      });
      toast('图片已选择（仅本地预览，未上传；二期接云存储）');
    });
  },

  onSubmitQualification() {
    if (this.data.submitting) return;
    const form = this.data.qualForm;
    const certName = String(form.certName || '').trim();
    if (!certName) {
      toast('请填写证书名称');
      return;
    }
    const files = this.data.qualFile.path
      ? [{ name: this.data.qualFile.name, url: '', localPath: this.data.qualFile.path, mock: true }]
      : [];
    this.submitCert(
      'qualification',
      {
        certType: form.certType || '教师资格证',
        certName: certName,
        certSubject: String(form.certSubject || '').trim(),
        certLevel: form.certLevel || '高级中学'
      },
      '资质认证',
      files
    );
  },

  /* ================= 能力认证 ================= */

  onAbilityInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    const patch = {};
    patch['abilityForm.' + field] = e.detail.value;
    this.setData(patch);
  },

  onTagTap(e) {
    const tag = e.currentTarget.dataset.tag;
    if (!tag) return;
    const selected = this.data.selectedTags.slice();
    const index = selected.indexOf(tag);
    if (index > -1) {
      selected.splice(index, 1);
    } else {
      selected.push(tag);
    }
    this.setData({ selectedTags: selected, tagOptions: buildTagOptions(selected) });
  },

  /** 选择试讲视频：仅取本地临时路径，未上传、未转码 */
  onChooseVideo() {
    const self = this;
    chooseVideoFile().then(function (file) {
      if (!file) return;
      // TODO(二期)：上传云存储 + 云函数转码/截帧，评审由服务端规则引擎 + 人工完成
      self.setData({
        abilityVideo: {
          path: file.path,
          name: fileNameOf(file.path) || '试讲视频',
          durationText: file.duration ? Math.round(file.duration) + ' 秒' : ''
        }
      });
      toast('视频已选择（仅本地预览，未上传；二期接云存储与转码）');
    });
  },

  onSubmitAbility() {
    if (this.data.submitting) return;
    const form = this.data.abilityForm;
    const videoUrl = String(form.videoUrl || '').trim();
    const hasLocalVideo = !!this.data.abilityVideo.path;
    if (!videoUrl && !hasLocalVideo) {
      toast('请填写试讲视频链接，或选择一个本地视频');
      return;
    }
    if (this.data.selectedTags.length < 1) {
      toast('请至少选择 1 个教学能力标签（建议 2-3 个）');
      return;
    }
    const durationMin = Number(form.durationMin || 0) || 8;
    const files = hasLocalVideo
      ? [{ name: this.data.abilityVideo.name, url: '', localPath: this.data.abilityVideo.path, mock: true }]
      : [{ name: '试讲视频链接.txt', url: videoUrl, mock: true }];
    this.submitCert(
      'ability',
      {
        videoUrl: videoUrl,
        videoPath: this.data.abilityVideo.path || '',
        durationMin: durationMin,
        abilityTags: this.data.selectedTags.slice()
      },
      '能力认证',
      files
    );
  },

  /* ================= 通用提交 + mock 审核 ================= */

  submitCert(type, form, label, files) {
    const self = this;
    this.setBusy(type);
    api
      .submitCertification({
        tutorId: this.data.tutorId,
        type: type,
        form: form,
        files: files || []
      })
      .then(function (res) {
        if (!res || res.code !== 0 || !res.data) {
          self.setBusy('');
          toast((res && res.message) || label + '提交失败');
          return;
        }
        toast(label + '已提交，审核中…');
        self.setBusy('');
        self.loadData();
        self.scheduleMockReview(res.data.id, type, label);
      });
  },

  /**
   * mock 审核：1.2 秒后自动「审核通过」
   * TODO(二期)：删除本方法，改由运营后台 / 服务端规则引擎审核，
   *            前端只轮询或订阅审核结果，不能自行改变审核结论。
   */
  scheduleMockReview(certId, type, label) {
    const self = this;
    const timer = setTimeout(function () {
      api
        .reviewCertification(certId, 'approved', 'mock 审核通过（模拟规则校验 + 人工复核）')
        .then(function (res) {
          if (!res || res.code !== 0) {
            toast('审核状态更新失败');
            return;
          }
          const tutor = (res.data && res.data.tutor) || {};
          self.loadData();
          if (Number(tutor.certLevel || 0) >= 3) {
            wx.showToast({ title: '🎉 三重认证已全部通过（mock 模拟审核）', icon: 'none', duration: 2400 });
          } else {
            toast(label + '审核通过（mock 模拟审核）');
          }
        });
    }, REVIEW_DELAY);
    this._timers.push(timer);
  },

  setBusy(type) {
    this.setData({
      submitting: !!type,
      studentBusy: type === 'student',
      qualBusy: type === 'qualification',
      abilityBusy: type === 'ability',
      studentBtnText: type === 'student' ? '提交中…' : '提交学籍认证',
      qualBtnText: type === 'qualification' ? '提交中…' : '提交资质认证',
      abilityBtnText: type === 'ability' ? '提交中…' : '提交能力认证',
      studentBtnClass: type === 'student' ? 'btn btn-primary step-btn btn-disabled' : 'btn btn-primary step-btn',
      qualBtnClass: type === 'qualification' ? 'btn btn-primary step-btn btn-disabled' : 'btn btn-primary step-btn',
      abilityBtnClass: type === 'ability' ? 'btn btn-primary step-btn btn-disabled' : 'btn btn-primary step-btn'
    });
  },

  /* ================= 徽章与跳转 ================= */

  onCopyBadgeNo() {
    const badgeNo = this.data.badge.badgeNo;
    if (!badgeNo) {
      toast('完成三重认证后才会生成认证编号');
      return;
    }
    wx.setClipboardData({
      data: badgeNo,
      success: function () {
        wx.showToast({ title: '认证编号已复制', icon: 'none' });
      },
      fail: function () {
        toast('复制失败，请重试');
      }
    });
  },

  onGoPool() {
    // 接单池是 tabBar 页面，必须用 switchTab
    wx.switchTab({ url: '/pages/tutor-pool/tutor-pool' });
  },

  onGoProfile() {
    // 「我的」同样是 tabBar 页面，navigateTo 会失败，这里用 switchTab
    wx.switchTab({ url: '/pages/profile/profile' });
  },

  onResetCert() {
    const self = this;
    wx.showModal({
      title: '重置认证（演示用）',
      content: '将清空当前师范生的三重认证记录与徽章编号，便于完整重走一遍认证流程。确认继续？',
      confirmText: '确认重置',
      success: function (res) {
        if (!res.confirm) return;
        api.resetCertifications(self.data.tutorId).then(function (result) {
          if (!result || result.code !== 0) {
            toast((result && result.message) || '重置失败');
            return;
          }
          self.loadData();
          toast('认证记录已重置（演示用）');
        });
      }
    });
  }
});
