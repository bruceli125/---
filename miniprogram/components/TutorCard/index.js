/**
 * TutorCard —— 家教（学生）卡片（本项目自研，不依赖 Vant Weapp / TDesign）
 *
 * 用途：接单池以外的所有「展示学生」场景：智能匹配 Top3、学生列表、我的接单。
 *
 * 关于头像：
 * MVP 阶段还没有对象存储 / 真实头像上传，mock 数据里的 avatar 指向不存在的本地文件，
 * 直接渲染会 404 破图。因此这里优先使用「文字头像」（tutor.avatarText 或姓名首字 + CSS 渐变底），
 * 只有文字头像不可用时才回退到 <image>，并依然绑定 binderror 做二次降级。
 * TODO(二期)：接入云存储后，改为「有 avatar 就渲染图片 + 缩略图」，并移除文字头像优先策略。
 *
 * 对外契约：
 *   properties: tutor / rank / score / reasons / distanceKm / showApply / applyText / applied / showCertBadge
 *   events:     tap({ tutorId, tutor }) | apply({ tutorId, tutor })
 */
const { formatDistance, truncate, round } = require('../../utils/format.js');

Component({
  properties: {
    tutor: { type: Object, value: null },
    /** 0 或未传 = 不显示排名角标 */
    rank: { type: Number, value: 0 },
    /** 0 或未传 = 不显示匹配度进度条 */
    score: { type: Number, value: 0 },
    reasons: { type: Array, value: [] },
    /** 传 >=0 时覆盖 tutor.distanceKm；-1 表示未传 */
    distanceKm: { type: Number, value: -1 },
    showApply: { type: Boolean, value: false },
    applyText: { type: String, value: '申请接单' },
    applied: { type: Boolean, value: false },
    showCertBadge: { type: Boolean, value: true }
  },

  data: {
    avatarText: '师',
    useImage: false,
    avatarError: false,
    nameText: '待完善姓名',
    schoolLine: '',
    certLevel: 0,
    certBadgeNo: '',
    tagList: [],
    priceText: '面议',
    creditText: '0',
    distanceText: '距离未知',
    ratingText: '暂无',
    orderText: '0 单',
    introText: '',
    rankText: '',
    rankClass: '',
    hasScore: false,
    scoreText: '',
    scorePercent: 0,
    reasonList: [],
    applyBtnText: '申请接单',
    applyDisabled: false
  },

  observers: {
    'tutor, rank, score, reasons, distanceKm, applied, applyText': function () {
      this.refresh();
    }
  },

  lifetimes: {
    attached() {
      this.refresh();
    }
  },

  methods: {
    refresh() {
      const data = this.data;
      const tutor = data.tutor || {};

      const nameText = tutor.name || '待完善姓名';
      const avatarText = tutor.avatarText || String(nameText).slice(0, 1) || '师';

      const subjects = (tutor.subjects || []).slice(0, 3);
      const grades = (tutor.grades || []).slice(0, 3);
      const abilities = (
        (tutor.abilityTags && tutor.abilityTags.length ? tutor.abilityTags : tutor.tags) || []
      ).slice(0, 2);

      const tagList = [];
      subjects.forEach(function (t) {
        tagList.push({ text: t, type: 'subject' });
      });
      grades.forEach(function (t) {
        tagList.push({ text: t, type: 'grade' });
      });
      abilities.forEach(function (t) {
        tagList.push({ text: t, type: 'ability' });
      });

      const rank = Number(data.rank || 0);
      const score = Number(data.score || 0);
      const dist =
        data.distanceKm !== null && data.distanceKm !== undefined && data.distanceKm >= 0
          ? data.distanceKm
          : tutor.distanceKm;

      const scoreValue = round(score, 1);
      const reasons = Array.isArray(data.reasons) ? data.reasons.filter(Boolean) : [];
      const applied = !!data.applied;

      this.setData({
        avatarText: avatarText,
        // 文字头像优先：mock 数据里的 avatar 指向不存在的本地文件，
        // 只有「既没有 avatarText 也没有姓名」时才尝试渲染图片，并保留 binderror 二次降级
        useImage: !!tutor.avatar && !data.avatarError && !tutor.avatarText && !tutor.name,
        nameText: nameText,
        schoolLine: [tutor.school, tutor.major, tutor.grade].filter(Boolean).join(' · '),
        certLevel: Number(tutor.certLevel || 0),
        certBadgeNo: tutor.certBadgeNo || '',
        tagList: tagList,
        priceText: tutor.price ? tutor.price + ' 元/时' : '面议',
        creditText: String(tutor.creditScore === 0 || tutor.creditScore ? tutor.creditScore : 0),
        distanceText: formatDistance(dist),
        ratingText: tutor.rating ? Number(tutor.rating).toFixed(1) : '暂无',
        orderText: String(tutor.orderCount || 0) + ' 单',
        introText: truncate(tutor.intro || '', 64),
        rankText: rank >= 1 && rank <= 3 ? 'TOP' + rank : rank > 3 ? 'NO.' + rank : '',
        rankClass: rank >= 1 && rank <= 3 ? 'rank-' + rank : 'rank-n',
        hasScore: score > 0,
        scoreText: '匹配度 ' + scoreValue + ' 分',
        scorePercent: Math.max(0, Math.min(100, score)),
        reasonList: reasons.slice(0, 3),
        applyBtnText: applied ? '已申请' : data.applyText || '申请接单',
        applyDisabled: applied
      });
    },

    onTap() {
      this.triggerEvent('tap', { tutorId: this.data.tutor && this.data.tutor.id, tutor: this.data.tutor });
    },

    onApply() {
      if (this.data.applyDisabled) return;
      this.triggerEvent('apply', { tutorId: this.data.tutor && this.data.tutor.id, tutor: this.data.tutor });
    },

    /** 取消接单：仅已投递状态下可见，具体确认与撤回由页面处理 */
    onCancel() {
      if (!this.data.applied) return;
      this.triggerEvent('cancel', { tutorId: this.data.tutor && this.data.tutor.id, tutor: this.data.tutor });
    },

    /** 图片头像加载失败时降级为文字头像 */
    onAvatarError() {
      this.setData({ avatarError: true, useImage: false });
    }
  }
});
