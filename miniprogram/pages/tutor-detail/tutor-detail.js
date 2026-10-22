/**
 * 学生详情页
 *
 * 数据来源：api.getTutorDetail(id)（含该学生的 certifications 认证记录）
 *
 * TODO(二期)：
 *   1. 「发起对接」目前只记录意向并弹窗说明，站内沟通 / 资金担保结算尚未接入；
 *   2. 认证材料原图查看需接入云存储签名链接（当前只展示脱敏字段）；
 *   3. 家长评价 / 上课记录存证。
 * 说明：本项目刻意不引入 Vant Weapp / TDesign，保证「导入微信开发者工具即可运行、无需构建 npm」。
 */
const api = require('../../services/api.js');
const fmt = require('../../utils/format.js');
const C = require('../../utils/constants.js');

const FALLBACK_TUTOR_ID = 'tutor_001';

const GENDER_TEXT = { male: '男', female: '女' };

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
  durationMin: '视频时长（分钟）',
  tags: '能力标签',
  reviewType: '评审方式'
};

const STATUS_TEXT_CLASS = {
  approved: 'tag tag-green',
  pending: 'tag tag-orange',
  rejected: 'tag tag-red'
};

function toast(title) {
  wx.showToast({ title: title || '', icon: 'none', duration: 2000 });
}

/** 已是脱敏值就直接展示 */
function maskIfNeeded(value, masker) {
  const s = String(value || '');
  if (!s) return '未提供';
  if (s.indexOf('*') > -1) return s;
  return masker(s);
}

function formatFieldValue(value) {
  if (Array.isArray(value)) return value.join('、');
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (value && typeof value === 'object') return JSON.stringify(value);
  const s = String(value);
  return s.length > 48 ? s.slice(0, 48) + '…' : s;
}

function buildFieldRows(cert) {
  if (!cert || !cert.ocrResult || !cert.ocrResult.fields) return [];
  const fields = cert.ocrResult.fields;
  const rows = [];
  Object.keys(fields).forEach(function (key) {
    const value = fields[key];
    if (value === undefined || value === null || value === '') return;
    rows.push({ label: FIELD_LABELS[key] || key, value: formatFieldValue(value) });
  });
  return rows;
}

/** 三类认证各自一行（缺失的显示「未提交」） */
function buildCertRows(certifications) {
  const list = certifications || [];
  return C.CERT_TYPES.map(function (type) {
    let latest = null;
    list.forEach(function (cert) {
      if (cert.type !== type.value) return;
      if (!latest || Number(cert.createdAtTs || 0) >= Number(latest.createdAtTs || 0)) {
        latest = cert;
      }
    });
    if (!latest) {
      return {
        type: type.value,
        typeLabel: type.label,
        submitted: false,
        statusText: '未提交',
        statusClass: 'tag tag-line',
        reviewNote: '该学生尚未提交此项认证材料。',
        createdAt: '',
        fieldRows: []
      };
    }
    return {
      type: type.value,
      typeLabel: type.label,
      submitted: true,
      statusText: C.CERT_STATUS_LABEL[latest.status] || '待提交',
      statusClass: STATUS_TEXT_CLASS[latest.status] || 'tag tag-line',
      reviewNote: latest.reviewNote || '',
      createdAt: latest.createdAt || '',
      fieldRows: buildFieldRows(latest)
    };
  });
}

Page({
  data: {
    loading: true,
    notFound: false,
    errorMsg: '',
    tutorId: '',

    tutor: {},
    avatarText: '师',
    name: '',
    genderText: '保密',
    schoolLine: '',
    distanceText: '',
    rating: 0,
    orderCount: 0,
    priceText: '',
    priceRangeText: '',
    priceSubText: '课时费',
    priceInfoText: '面议',
    creditScore: 0,
    creditPercent: '0%',
    highlights: [],

    certLevel: 0,
    certLevelText: '未认证',
    certLevelDesc: '',
    certLevelClass: 'tag tag-line',
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

    certRows: [],
    subjectsText: '',
    gradesText: '',
    tags: [],
    timesText: '',
    modesText: '',
    intro: '',
    privacyRows: [],
    privacyNotice:
      '平台不采集真实身份证号与学号；手机号 / 学号 / 邮箱均为脱敏展示，仅用于家长核验对接人身份。',
    disclaimerShort: C.DISCLAIMER.short
  },

  onLoad(options) {
    const query = options || {};
    const tutorId = query.id || '';
    if (!tutorId) {
      toast('未指定学生，已加载演示档案');
    }
    this.setData({ tutorId: tutorId || FALLBACK_TUTOR_ID });
    this.load();
  },

  load() {
    const self = this;
    this.setData({ loading: true, notFound: false });
    api.getTutorDetail(this.data.tutorId).then(function (res) {
      if (!res || res.code !== 0 || !res.data) {
        self.setData({
          loading: false,
          notFound: true,
          errorMsg: (res && res.message) || '学生档案不存在'
        });
        return;
      }
      self.render(res.data);
    });
  },

  render(tutor) {
    const level = Number(tutor.certLevel || 0);
    const levelItem = C.CERT_LEVELS[level] || C.CERT_LEVELS[0];
    const credit = Number(tutor.creditScore || 0);

    const subjectsText = (tutor.subjects || []).join('、') || '面议';
    const gradesText = (tutor.grades || []).join('、') || '面议';
    const timesText =
      (tutor.availableTimes || [])
        .map(function (v) {
          return fmt.timeRangeLabel(v);
        })
        .join('、') || '时间面议';
    const modesText =
      (tutor.teachModes || [])
        .map(function (v) {
          return fmt.teachModeLabel(v);
        })
        .join('、') || '授课方式面议';
    const priceRange = tutor.priceRange || [];
    const priceRangeText = priceRange.length === 2 ? fmt.formatBudget(priceRange[0], priceRange[1]) : '';

    this.setData({
      loading: false,
      notFound: false,
      tutor: tutor,
      avatarText: tutor.avatarText || (tutor.name ? tutor.name.slice(0, 1) : '师'),
      name: tutor.name || '学生',
      genderText: GENDER_TEXT[tutor.gender] || '保密',
      schoolLine:
        (tutor.school || '') + ' · ' + (tutor.major || '') + ' · ' + (tutor.grade || ''),
      distanceText: fmt.formatDistance(tutor.distanceKm),
      rating: Number(tutor.rating || 0),
      orderCount: Number(tutor.orderCount || 0),
      priceText: fmt.formatPrice(tutor.price),
      priceRangeText: priceRangeText,
      priceSubText: '课时费' + (priceRangeText ? '（' + priceRangeText + '）' : ''),
      priceInfoText: fmt.formatPrice(tutor.price) + (priceRangeText ? '（参考区间 ' + priceRangeText + '）' : ''),
      creditScore: credit,
      creditPercent: Math.max(0, Math.min(100, credit)) + '%',
      highlights: tutor.highlights || [],
      certLevel: level,
      certLevelText: levelItem.label,
      certLevelDesc: levelItem.desc,
      certLevelClass: level >= 3 ? 'tag tag-green' : level >= 1 ? 'tag tag-blue' : 'tag tag-line',
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
      certRows: buildCertRows(tutor.certifications),
      subjectsText: subjectsText,
      gradesText: gradesText,
      tags: tutor.tags || [],
      timesText: timesText,
      modesText: modesText,
      intro: tutor.intro || '该学生暂未填写个人简介。',
      privacyRows: [
        { label: '手机号', value: maskIfNeeded(tutor.phone, fmt.maskPhone) },
        { label: '学号', value: maskIfNeeded(tutor.studentNo, fmt.maskStudentNo) },
        { label: '校园邮箱', value: maskIfNeeded(tutor.email, fmt.maskEmail) }
      ]
    });
  },

  /**
   * 发起对接
   * MVP 不接真实聊天与支付：只提示二期能力，不做任何假的「已发送消息」。
   */
  onStartContact() {
    wx.showModal({
      title: '发起对接',
      content:
        'MVP 阶段暂不提供站内聊天与资金担保结算（TODO 二期）。确认后平台会记录本次对接意向，家长可在需求详情中看到您的申请。',
      confirmText: '确认发起',
      cancelText: '再想想',
      success: function (res) {
        if (!res.confirm) return;
        // TODO(二期)：写入 contact_intents 集合 + 站内消息通知家长；资金担保结算由平台托管。
        toast('已记录对接意向（站内沟通为二期功能）');
      }
    });
  },

  onGoBack() {
    wx.navigateBack({
      delta: 1,
      fail: function () {
        wx.switchTab({ url: '/pages/index/index' });
      }
    });
  },

  onShareAppMessage() {
    return {
      title:
        this.data.name +
        ' · ' +
        this.data.schoolLine +
        ' · ' +
        this.data.certLevelText +
        '（京师家教可信对接平台）',
      path: '/pages/tutor-detail/tutor-detail?id=' + this.data.tutorId
    };
  }
});
