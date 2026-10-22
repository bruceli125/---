/**
 * 对接报告 / 避坑提示页
 *
 * 内容结构：需求摘要 -> Top3 推荐 -> 风险与避坑提示 -> 下一步建议 -> 免责声明
 * 数据来源：api.getReportDetail(reportId|demandId)，失败时用 api.generateReport(demandId) 兜底现场生成。
 *
 * TODO(二期)：
 *   1. 导出 Word / Excel（当前按钮为禁用态，只提示「二期功能」）；
 *   2. 报告摘要与推荐理由改由 LLM 生成（当前 api 内为模板拼接）；
 *   3. 报告分享为图片长图 / 小程序卡片封面。
 *
 * 说明：本项目刻意不引入 Vant Weapp / TDesign，保证「导入微信开发者工具即可运行、无需构建 npm」。
 */
const api = require('../../services/api.js');
const fmt = require('../../utils/format.js');
const C = require('../../utils/constants.js');

function toast(title) {
  wx.showToast({ title: title || '', icon: 'none', duration: 2000 });
}

/** 需求摘要键值行 */
function buildDemandRows(demand) {
  if (!demand) return [];
  const timeText =
    demand.timeRangeText ||
    (demand.timeRange || [])
      .map(function (v) {
        return fmt.timeRangeLabel(v);
      })
      .join(' / ') ||
    '时间面议';
  const placeText =
    demand.teachMode === 'online'
      ? '线上授课（无需上门）'
      : (fmt.districtLabel(demand.district) + ' ' + (demand.address || '')).trim();
  return [
    { label: '学段年级', value: demand.grade || '不限' },
    { label: '辅导科目', value: fmt.subjectLabel(demand.subject) },
    { label: '上课频次', value: fmt.frequencyLabel(demand.frequency) },
    { label: '时间段', value: timeText },
    { label: '授课方式', value: fmt.teachModeLabel(demand.teachMode) },
    { label: '上课地点', value: placeText },
    { label: '预算', value: fmt.formatBudget(demand.budgetMin, demand.budgetMax) },
    { label: '特殊要求', value: demand.specialRequirements || '无' }
  ];
}

Page({
  data: {
    loading: true,
    notFound: false,
    errorMsg: '',

    reportId: '',
    demandId: '',
    report: null,

    /* 报告头 */
    reportNo: '',
    createdAt: '',
    demandNo: '',
    parentName: '',
    riskLevel: 'low',
    riskTheme: C.RISK_LEVEL_THEME.low,
    riskHitWords: '',
    highRisk: false,
    showRiskBanner: false,

    /* 正文 */
    demandRows: [],
    summaryLines: [],
    matchList: [],
    riskTips: [],
    nextSteps: [],
    disclaimer: [],
    disclaimerShort: C.DISCLAIMER.short
  },

  onLoad(options) {
    const query = options || {};
    this.setData({
      reportId: query.reportId || '',
      demandId: query.demandId || ''
    });
    this.load();
  },

  load() {
    const reportId = this.data.reportId;
    const demandId = this.data.demandId;
    const key = reportId || demandId;
    if (!key) {
      this.setData({ loading: false, notFound: true, errorMsg: '缺少报告参数，请从匹配结果页进入' });
      return;
    }
    this.setData({ loading: true, notFound: false, errorMsg: '' });

    api.getReportDetail(key).then((res) => {
      if (res && res.code === 0 && res.data) {
        this.render(res.data);
        return;
      }
      // 兜底：带着 demandId 进来但报告还没生成过 -> 现场生成一份
      const fallbackDemandId = demandId || reportId;
      api.generateReport(fallbackDemandId).then((gen) => {
        if (gen && gen.code === 0 && gen.data) {
          this.render(gen.data);
          return;
        }
        this.setData({
          loading: false,
          notFound: true,
          errorMsg: (gen && gen.message) || (res && res.message) || '报告不存在，请先生成'
        });
      });
    });
  },

  render(report) {
    const demand = report.demand || {};
    const matchList = (report.topMatches || []).map(function (m) {
      const t = m.tutor || {};
      const level = Number(t.certLevel || 0);
      const levelItem = C.CERT_LEVELS[level] || C.CERT_LEVELS[0];
      return {
        tutorId: m.tutorId,
        rank: m.rank,
        score: m.score,
        scoreText: m.score + ' 分',
        name: t.name || '学生',
        school: t.school || '',
        major: t.major || '',
        grade: t.grade || '',
        schoolLine: [t.school || '', t.major || '', t.grade || ''].filter(Boolean).join(' · '),
        certLevel: level,
        certLevelText: levelItem.label,
        certBadgeNo: t.certBadgeNo || '未生成编号',
        priceText: fmt.formatPrice(t.price),
        creditScore: t.creditScore || 0,
        distanceText: fmt.formatDistance(m.distanceKm),
        reasons: m.reasons || [],
        avatarText: t.avatarText || (t.name ? t.name.slice(0, 1) : '师')
      };
    });

    const level = report.riskLevel || C.RISK_LEVEL.LOW;
    const theme = C.RISK_LEVEL_THEME[level] || C.RISK_LEVEL_THEME.low;

    // 生成报告时保留的原始对象，供复制 / 再生成使用
    this._report = report;

    this.setData({
      loading: false,
      notFound: false,
      report: report,
      reportNo: report.id || '未生成',
      createdAt: report.createdAt || '',
      demandNo: report.demandId || '',
      parentName: demand.parentName || report.parentName || '演示家长',
      riskLevel: level,
      riskTheme: theme,
      riskHitWords: (report.riskHits || [])
        .map(function (h) {
          return h.word;
        })
        .join('、'),
      highRisk: level === C.RISK_LEVEL.HIGH,
      showRiskBanner: level !== C.RISK_LEVEL.LOW,
      demandRows: buildDemandRows(demand),
      summaryLines: String(report.summary || '')
        .split('\n')
        .filter(function (line) {
          return !!line;
        }),
      matchList: matchList,
      riskTips: report.riskTips || [],
      nextSteps: report.nextSteps || [],
      disclaimer: Array.isArray(report.disclaimer)
        ? report.disclaimer
        : report.disclaimer
        ? [report.disclaimer]
        : C.DISCLAIMER.full
    });
  },

  /** 复制整份报告纯文本到剪贴板 */
  onCopyReport() {
    const text = api.buildReportText(this._report || this.data.report);
    if (!text) {
      toast('暂无可复制的报告内容');
      return;
    }
    wx.setClipboardData({
      data: text,
      success: function () {
        wx.showToast({ title: '报告已复制，可粘贴到微信/备忘录', icon: 'none', duration: 2000 });
      },
      fail: function () {
        wx.showToast({ title: '复制失败，请重试', icon: 'none' });
      }
    });
  },

  /**
   * 导出 Word / Excel —— 二期功能
   * TODO(二期)：云函数 generateReport 增加 export 动作，用 docx / exceljs 生成文件后上传云存储，
   *            前端用 wx.cloud.downloadFile + wx.openDocument 打开。
   */
  onExport() {
    toast('导出 Word / Excel 为二期功能（TODO）');
  },

  /** 用同一需求重新生成一份报告 */
  onRegenerate() {
    const demandId = this.data.demandId || (this.data.report && this.data.report.demandId) || '';
    if (!demandId) {
      toast('缺少需求编号，无法重新生成');
      return;
    }
    this.setData({ loading: true });
    api.generateReport(demandId).then((res) => {
      if (!res || res.code !== 0) {
        this.setData({ loading: false });
        toast((res && res.message) || '重新生成失败');
        return;
      }
      this.render(res.data);
      toast('已重新生成对接报告');
    });
  },

  onTutorTap(e) {
    const tutorId = e.currentTarget.dataset.tutorId;
    if (!tutorId) return;
    wx.navigateTo({ url: '/pages/tutor-detail/tutor-detail?id=' + tutorId });
  },

  onGoCreate() {
    wx.navigateTo({ url: '/pages/demand-create/demand-create' });
  },

  onShareAppMessage() {
    const demand = (this.data.report && this.data.report.demand) || {};
    return {
      title: '京师家教对接报告：' + (demand.grade || '') + (demand.subject || '') + ' Top' + this.data.matchList.length,
      path: '/pages/report-detail/report-detail?demandId=' + (this.data.demandId || '')
    };
  }
});
