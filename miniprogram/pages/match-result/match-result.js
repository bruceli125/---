/**
 * 智能匹配结果页（家长侧）：规则打分 -> Top3 推荐
 *
 * 数据来源：只通过 services/api.js（内部走本地 mock + storage 或云函数），页面不直接读写 storage。
 * 打分规则：services/match.js —— 科目 40 + 年级学段 20 + 时间地点 15 + 价格 10 + 信用分 10 + 认证完整度 5。
 *
 * TODO(二期)：推荐理由改由 LLM 生成（services/match.js 已预留 generateReasonsByLLM 接口，
 *            当前全部使用模板生成的理由，界面上已明确标注）。
 * 说明：本项目刻意不引入 Vant Weapp / TDesign，保证「微信开发者工具导入即可运行、无需构建 npm」。
 */
const api = require('../../services/api.js');
const fmt = require('../../utils/format.js');
const C = require('../../utils/constants.js');

/** 直接打开本页但没有带 demandId 时，用演示需求兜底，方便截图与答辩演示 */
const FALLBACK_DEMAND_ID = 'demo_demand_001';

function toast(title) {
  wx.showToast({ title: title || '', icon: 'none', duration: 1800 });
}

/** 评分规则卡片数据（与 MATCH_WEIGHTS 保持同源，避免写死数字） */
function buildWeightItems() {
  const w = C.MATCH_WEIGHTS;
  return [
    { key: 'subject', label: '科目匹配', score: w.subject },
    { key: 'grade', label: '年级学段匹配', score: w.grade },
    { key: 'timePlace', label: '时间地点匹配', score: w.timePlace },
    { key: 'price', label: '价格匹配', score: w.price },
    { key: 'credit', label: '信用分', score: w.credit },
    { key: 'cert', label: '认证完整度', score: w.cert }
  ];
}

function buildWeightsFormula() {
  const items = buildWeightItems();
  return items
    .map(function (item) {
      return item.label + ' ' + item.score + ' 分';
    })
    .join(' + ');
}

function buildDemandTitle(demand) {
  if (!demand) return '家教需求';
  const stage = fmt.getStageLabel(demand.grade);
  return (stage ? stage + ' · ' : '') + (demand.grade || '') + ' ' + fmt.subjectLabel(demand.subject);
}

/** 需求摘要卡片的键值行 */
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
  let placeText = '线上授课（无需上门）';
  if (demand.teachMode !== 'online') {
    placeText = (fmt.districtLabel(demand.district) + ' ' + (demand.address || '')).trim();
  }
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
    generating: false,
    from: 'parent',
    showApply: false,

    demandId: '',
    demand: null,
    demandTitle: '',
    demandRows: [],
    statusLabel: '',

    riskLevel: 'low',
    riskTheme: C.RISK_LEVEL_THEME.low,
    riskHitWords: '',
    highRisk: false,
    showRiskBanner: false,

    weightItems: [],
    weightsFormula: '',

    list: [],
    totalMatches: 0,
    reportBtnText: '生成对接报告',
    errorMsg: ''
  },

  onLoad(options) {
    const query = options || {};
    const demandId = query.demandId || '';
    const from = query.from || 'parent';
    if (!demandId) {
      toast('未指定需求，已加载演示需求');
    }
    this.setData({
      demandId: demandId || FALLBACK_DEMAND_ID,
      from: from,
      showApply: from === 'tutor',
      weightItems: buildWeightItems(),
      weightsFormula: buildWeightsFormula()
    });
    this.loadMatches();
  },

  onShow() {
    // 从师范生详情页返回时不需要重算，仅保持页面数据不变；
    // 若需求被别的页面改动（例如关闭），下拉刷新式的重算交给「重新匹配」按钮。
  },

  /** 调用规则引擎做 TopN 匹配 */
  loadMatches() {
    const demandId = this.data.demandId;
    this.setData({ loading: true, errorMsg: '' });
    api.matchTutors(demandId, { topN: C.MATCH_CONFIG.topN }).then((res) => {
      if (!res || res.code !== 0) {
        const msg = (res && res.message) || '匹配失败，请稍后重试';
        this.rawList = [];
        this.setData({ loading: false, list: [], totalMatches: 0, demand: null, errorMsg: msg });
        toast(msg);
        return;
      }
      const data = res.data || {};
      const demand = data.demand || null;
      const rawList = data.list || [];
      // 原始结果保留在实例上，生成报告时直接复用，避免二次计算
      this.rawList = rawList;

      const level = (demand && demand.riskLevel) || C.RISK_LEVEL.LOW;
      const theme = C.RISK_LEVEL_THEME[level] || C.RISK_LEVEL_THEME.low;
      const hits = (demand && demand.riskHits) || [];

      this.setData({
        loading: false,
        demand: demand,
        demandTitle: buildDemandTitle(demand),
        demandRows: buildDemandRows(demand),
        statusLabel: C.DEMAND_STATUS_LABEL[(demand && demand.status) || ''] || '招募中',
        riskLevel: level,
        riskTheme: theme,
        riskHitWords: hits
          .map(function (h) {
            return h.word;
          })
          .join('、'),
        highRisk: level === C.RISK_LEVEL.HIGH,
        showRiskBanner: level !== C.RISK_LEVEL.LOW,
        list: rawList.map(function (item) {
          return {
            tutorId: item.tutorId,
            rank: item.rank,
            score: item.score,
            reasons: item.reasons || [],
            distanceKm: item.distanceKm,
            tutor: item.tutor || {},
            applied: false
          };
        }),
        totalMatches: rawList.length
      });
    });
  },

  /** 重新匹配 */
  onRematch() {
    if (this.data.loading) return;
    this.loadMatches();
    toast('已重新计算匹配结果');
  },

  /** 生成对接报告 -> 报告详情页 */
  onGenerateReport() {
    if (this.data.generating) return;
    if (!this.rawList || !this.rawList.length) {
      toast('暂无可生成报告的匹配结果');
      return;
    }
    this.setData({ generating: true, reportBtnText: '生成中…' });
    api.generateReport(this.data.demandId, { topMatches: this.rawList }).then((res) => {
      this.setData({ generating: false, reportBtnText: '生成对接报告' });
      if (!res || res.code !== 0) {
        toast((res && res.message) || '报告生成失败');
        return;
      }
      const report = res.data || {};
      wx.navigateTo({
        url:
          '/pages/report-detail/report-detail?reportId=' +
          report.id +
          '&demandId=' +
          this.data.demandId
      });
    });
  },

  /** 风险提示入口：先生成含避坑提示的报告，再跳过去查看 */
  onViewRiskTips() {
    if (this.data.generating) return;
    this.setData({ generating: true, reportBtnText: '生成中…' });
    api.generateReport(this.data.demandId, { topMatches: this.rawList || [] }).then((res) => {
      this.setData({ generating: false, reportBtnText: '生成对接报告' });
      if (!res || res.code !== 0) {
        toast((res && res.message) || '避坑提示生成失败');
        return;
      }
      const report = res.data || {};
      wx.navigateTo({
        url:
          '/pages/report-detail/report-detail?reportId=' +
          report.id +
          '&demandId=' +
          this.data.demandId
      });
    });
  },

  /** 卡片点击 -> 师范生详情 */
  onTutorTap(e) {
    const detail = e.detail || {};
    const tutor = detail.tutor || {};
    const tutorId = detail.tutorId || tutor.id;
    if (!tutorId) return;
    wx.navigateTo({ url: '/pages/tutor-detail/tutor-detail?id=' + tutorId });
  },

  /** 申请接单（仅 from=tutor 时展示按钮） */
  onTutorApply(e) {
    if (!this.data.showApply) return;
    const detail = e.detail || {};
    const tutor = detail.tutor || {};
    const tutorId = detail.tutorId || tutor.id;
    if (!tutorId) return;
    const list = this.data.list.slice();
    let index = -1;
    for (let i = 0; i < list.length; i++) {
      if (list[i].tutorId === tutorId) {
        index = i;
        break;
      }
    }
    if (index < 0) return;
    if (list[index].applied) {
      toast('您已申请过该需求');
      return;
    }
    api
      .applyDemand({
        demandId: this.data.demandId,
        tutorId: tutorId,
        tutorName: tutor.name || ''
      })
      .then((res) => {
        if (!res || res.code !== 0) {
          toast((res && res.message) || '申请失败，请重试');
          return;
        }
        list[index].applied = true;
        this.setData({ list: list });
        toast(res.message || '申请已提交，等待家长确认');
      });
  },

  onGoDemandList() {
    wx.navigateTo({ url: '/pages/demand-list/demand-list' });
  },

  onShareAppMessage() {
    const demand = this.data.demand || {};
    const title =
      '京师家教推荐：' +
      (demand.grade || '') +
      (demand.subject || '') +
      ' Top' +
      (this.data.totalMatches || 0) +
      ' 师范生';
    return {
      title: title,
      path: '/pages/match-result/match-result?demandId=' + this.data.demandId
    };
  }
});
