/**
 * 需求详情
 *
 * 【UI 组件库说明】不引入 Vant Weapp / TDesign（导入即可运行，无需构建 npm）。
 *
 * 入口参数：
 *   id   —— 需求 id（必填）
 *   from —— 'parent' | 'tutor'，默认 parent（决定底部操作区与履约视角）
 *
 * 一期能力：风险等级 + 命中风险词 + 避坑提示 + 合规提示（平台「风险过滤」能力的可视化出口）。
 * 二期新增（本次改造）：
 *   1. 「履约与互评」区块：已成单 -> 成单信息（成单人 + 认证徽章 + 成单时间）、上课打卡入口、
 *      最近 1 条打卡摘要、双向评价状态；
 *   2. 匹配中（家长视角）-> 可成单候选师范生列表 + 「确认成单」（二次确认，成单后不可再确认他人）；
 *   3. 页面底部平台定位声明 <platform-notice />。
 *
 * 状态 / 角色矩阵（履约区块）：
 *   status=matched｜tutor  -> 成单信息 + 上课打卡（仅当 canCheckin）+ 填写/查看小结 + 双向评价
 *   status=matched｜parent -> 成单信息 + 查看打卡与小结 + 双向评价
 *   status=matching/published｜parent -> 候选师范生列表 + 确认成单
 *   status=matching/published｜tutor  -> 不显示履约区块（还未成单）
 */
const api = require('../../services/api.js');
const fmt = require('../../utils/format.js');
const riskService = require('../../services/risk.js');
const {
  DEMAND_STATUS,
  DEMAND_STATUS_LABEL,
  RISK_LEVEL,
  RISK_LEVEL_THEME,
  DISCLAIMER,
  CHECKIN_STATUS_LABEL
} = require('../../utils/constants.js');

const app = getApp();

/** 'YYYY-MM-DD HH:mm' 兼容 iOS */
function parseTime(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  const s = String(value).replace(/-/g, '/').replace('T', ' ').replace(/\.\d+Z?$/, '');
  const t = new Date(s).getTime();
  return isNaN(t) ? 0 : t;
}

function statusClass(status) {
  if (status === DEMAND_STATUS.PUBLISHED || status === DEMAND_STATUS.MATCHED) return 'tag-green';
  if (status === DEMAND_STATUS.MATCHING) return 'tag-blue';
  if (status === DEMAND_STATUS.RISK_BLOCKED) return 'tag-red';
  return '';
}

/** 打卡状态 -> 标签配色类 */
function checkinStatusClass(status) {
  if (status === 'confirmed') return 'tag-green';
  if (status === 'finished') return 'tag-orange';
  return 'tag-blue';
}

Page({
  data: {
    demandId: '',
    from: 'parent',
    loading: true,
    notFound: false,
    demand: null,

    isParent: true,
    isTutor: false,

    /* 展示字段（WXML 不做复杂表达式） */
    titleText: '',
    statusLabel: '',
    statusClass: '',
    statusValue: '',
    createdAgo: '',
    budgetText: '面议',
    timeRangeText: '时间面议',
    frequencyText: '',
    teachModeText: '',
    districtText: '',
    addressText: '',
    contactPhone: '',
    deadline: '不限',
    parentName: '',
    applyCount: 0,
    viewCount: 0,

    /* 风险 */
    riskLevel: RISK_LEVEL.LOW,
    riskLevelText: '',
    riskColor: '#17B26A',
    riskBg: '#E7F8F0',
    riskDesc: '',
    highRisk: false,
    riskHits: [],
    riskTips: [],
    commonTips: [],

    /* 合规 */
    complianceItems: [],
    disclaimerShort: DISCLAIMER.short,

    /* 操作态 */
    generating: false,
    applying: false,
    applied: false,
    applyBtnText: '申请接单',
    applyBtnClass: 'btn-green',

    /* 师范生档案 */
    tutorId: '',
    tutorName: '',
    tutorCredit: 0,
    tutorCertLevel: 0,

    /* ---------- 二期：履约与互评 ---------- */
    isMatched: false,
    isMatching: false,
    matchedTutorId: '',
    matchedTutorName: '',
    matchedTutorMajor: '',
    matchedTutorCredit: 0,
    matchedTutorCertLevel: 0,
    matchedTutorBadgeNo: '',
    hasMatchedTutorProfile: false,
    acceptedAtText: '',
    canCheckin: false,

    /* 打卡摘要 */
    checkinCount: 0,
    checkinEmpty: true,
    checkinLatestTime: '',
    checkinLatestStatus: '',
    checkinLatestStatusClass: 'tag-blue',
    checkinLatest: '',

    /* 评价状态 */
    reviewStateText: '',
    reviewCanSubmit: false,
    reviewRevealed: false,

    /* 候选师范生（匹配中，家长视角） */
    candidates: [],
    candidatesEmpty: true,
    accepting: false,
    acceptingTutorId: ''
  },

  onLoad(options) {
    const opt = options || {};
    const from = opt.from === 'tutor' ? 'tutor' : 'parent';
    const demandId = opt.id || opt.demandId || '';
    this.setData({
      demandId: demandId,
      from: from,
      isParent: from !== 'tutor',
      isTutor: from === 'tutor',
      commonTips: riskService.COMMON_TIPS.slice(0, 4),
      complianceItems: [DISCLAIMER.full[2], DISCLAIMER.full[3], DISCLAIMER.full[4]]
    });
    this.loadDetail();
  },

  onShow() {
    // 从打卡页 / 评价页返回时刷新履约摘要（首次进入由 onLoad 负责）
    if (!this._shownOnce) {
      this._shownOnce = true;
      return;
    }
    if (!this.data.loading && !this.data.notFound && this.data.demandId) {
      this.loadDetail();
    }
  },

  onShareAppMessage() {
    const d = this.data.demand || {};
    return {
      title: '京师家教｜' + (this.data.titleText || '家长家教需求') + '，' + this.data.budgetText,
      path: '/pages/demand-detail/demand-detail?id=' + this.data.demandId + '&from=tutor'
    };
  },

  /* ================================================================
   * 一、加载
   * ================================================================ */

  loadDetail() {
    const id = this.data.demandId;
    if (!id) {
      this.setData({ loading: false, notFound: true });
      return Promise.resolve();
    }
    this.setData({ loading: true });
    return api
      .getDemandDetail(id)
      .then((res) => {
        if (!res || res.code !== 0 || !res.data) {
          this.setData({ loading: false, notFound: true });
          return;
        }
        this.applyDemand(res.data);
      })
      .catch((err) => {
        console.error('[demand-detail] 加载失败：', err);
        this.setData({ loading: false, notFound: true });
        app.toast('需求加载失败');
      });
  },

  applyDemand(d) {
    const theme = RISK_LEVEL_THEME[d.riskLevel] || RISK_LEVEL_THEME.low;
    const hits = d.riskHits || [];
    const timeRangeText =
      d.timeRangeText || (d.timeRange || []).map(fmt.timeRangeLabel).filter(Boolean).join(' / ') || '时间面议';

    this.setData({
      loading: false,
      notFound: false,
      demand: d,
      titleText: (d.grade || '') + (d.subject || '') + '辅导',
      statusLabel: DEMAND_STATUS_LABEL[d.status] || d.status || '',
      statusClass: statusClass(d.status),
      statusValue: d.status || '',
      createdAgo: fmt.timeAgo(d.createdAtTs || parseTime(d.createdAt)),
      budgetText: fmt.formatBudget(d.budgetMin, d.budgetMax),
      timeRangeText: timeRangeText,
      frequencyText: fmt.frequencyLabel(d.frequency),
      teachModeText: fmt.teachModeLabel(d.teachMode),
      districtText: d.district ? fmt.districtLabel(d.district) : '区域面议',
      addressText: d.address || (d.teachMode === 'online' ? '线上授课，无需线下地址' : '待沟通'),
      contactPhone: d.contactPhone || '未提供（平台内对接）',
      deadline: d.deadline || '不限',
      parentName: d.parentName || '家长',
      applyCount: Number(d.applyCount || 0),
      viewCount: Number(d.viewCount || 0),
      riskLevel: d.riskLevel || RISK_LEVEL.LOW,
      riskLevelText: theme.text,
      riskColor: theme.color,
      riskBg: theme.bg,
      riskDesc: theme.desc,
      highRisk: d.riskLevel === RISK_LEVEL.HIGH,
      riskHits: hits,
      riskTips: riskService.buildRiskTips({ level: d.riskLevel, hits: hits }).slice(0, 6)
    });

    this.loadTutorState(d);
    this.loadFulfillment(d);
  },

  /** 师范生视角：档案信息 + 是否已申请 */
  loadTutorState(demand) {
    if (!this.data.isTutor) return;
    // TODO(真实环境)：tutorId 应从登录态（login 云函数返回的 tutorProfileId）获取；
    // MVP 演示阶段兜底为默认档案 tutor_001，避免空值导致申请失败。
    const tutorId = (app.globalData && app.globalData.tutorProfileId) || 'tutor_001';
    this.setData({ tutorId: tutorId });

    api.getMyTutorProfile(tutorId).then((res) => {
      if (res && res.code === 0 && res.data) {
        this.setData({
          tutorName: res.data.name || '师范生',
          tutorCredit: res.data.creditScore || 0,
          tutorCertLevel: res.data.certLevel || 0
        });
      }
    });

    api.getMyApplications(tutorId).then((res) => {
      if (res && res.code === 0) {
        const applied = (res.data || []).filter((a) => a.demandId === demand.id).length > 0;
        this.setData({ applied: applied });
        this.syncApplyBtn();
      }
    });
  },

  /* ================================================================
   * 二、二期：履约与互评
   * ================================================================ */

  /**
   * 按「状态 × 角色」装配履约区块
   * @param {object} d demand
   */
  loadFulfillment(d) {
    const demand = d || this.data.demand || {};
    const status = demand.status || '';
    const isMatched = status === DEMAND_STATUS.MATCHED || status === DEMAND_STATUS.CLOSED;
    const isMatching = !isMatched && (status === DEMAND_STATUS.MATCHING || status === DEMAND_STATUS.PUBLISHED);

    this.setData({
      isMatched: isMatched,
      isMatching: isMatching,
      matchedTutorId: demand.matchedTutorId || '',
      acceptedAtText: demand.acceptedAt || ''
    });

    if (isMatched) {
      this.loadMatchedTutor(demand);
      this.loadCheckinSummary(demand);
      this.loadReviewState();
      this.setData({ candidates: [], candidatesEmpty: true });
      this.syncApplyBtn();
      return;
    }

    // 未成单：清空履约数据；家长视角展示候选师范生以便确认成单
    this.setData({
      matchedTutorName: '',
      matchedTutorMajor: '',
      matchedTutorBadgeNo: '',
      hasMatchedTutorProfile: false,
      canCheckin: false,
      checkinCount: 0,
      checkinEmpty: true,
      checkinLatest: '',
      checkinLatestTime: '',
      checkinLatestStatus: '',
      reviewStateText: '',
      reviewCanSubmit: false
    });

    if (isMatching && this.data.isParent) {
      this.loadCandidates(demand);
    } else {
      this.setData({ candidates: [], candidatesEmpty: true });
    }
    this.syncApplyBtn();
  },

  /** 底部「申请接单」按钮的文案与样式（WXML 中不写嵌套三元） */
  syncApplyBtn() {
    const d = this.data;
    let text = '申请接单';
    let cls = 'btn-green';
    if (d.isMatched) {
      text = '该需求已成单，暂不接受申请';
      cls = 'btn-gray';
    } else if (d.applied) {
      text = '已申请，等待家长确认';
      cls = 'btn-gray';
    } else if (d.applying) {
      text = '提交中…';
      cls = 'btn-gray';
    }
    this.setData({ applyBtnText: text, applyBtnClass: cls });
  },

  /** 成单信息：成单人档案 + 认证徽章 + 是否可打卡 */
  loadMatchedTutor(demand) {
    const tutorId = demand.matchedTutorId || '';
    // 师范生视角用登录态档案 id 判定「是否本次成单人」；家长视角传空串（不参与该判定）
    const viewerTutorId = this.data.isTutor ? this.data.tutorId || '' : '';

    if (!tutorId) {
      this.setData({
        matchedTutorName: '待确认',
        hasMatchedTutorProfile: false,
        canCheckin: false
      });
      return;
    }

    this.setData({ canCheckin: !!api.canCheckin(demand, viewerTutorId) });

    api
      .getTutorDetail(tutorId)
      .then((res) => {
        if (res && res.code === 0 && res.data) {
          const t = res.data;
          this.setData({
            matchedTutorName: t.name || '师范生',
            matchedTutorMajor: [t.school, t.major, t.grade].filter(Boolean).join(' · '),
            matchedTutorCredit: Number(t.creditScore || 0),
            matchedTutorCertLevel: Number(t.certLevel || 0),
            matchedTutorBadgeNo: t.certBadgeNo || '',
            hasMatchedTutorProfile: true,
            canCheckin: !!api.canCheckin(demand, viewerTutorId)
          });
          return;
        }
        // 档案取不到时降级展示，不阻断页面
        this.setData({
          matchedTutorName: '师范生（档案 ' + String(tutorId).slice(-4) + '）',
          hasMatchedTutorProfile: false
        });
      })
      .catch((err) => {
        console.warn('[demand-detail] 读取成单人档案失败：', err);
        this.setData({
          matchedTutorName: '师范生（档案 ' + String(tutorId).slice(-4) + '）',
          hasMatchedTutorProfile: false
        });
      });
  },

  /** 最近 1 条打卡摘要（时间 + 时长 + 小结前 40 字 + 状态） */
  loadCheckinSummary(demand) {
    api
      .getCheckins({ demandId: demand.id || this.data.demandId })
      .then((res) => {
        if (!res || res.code !== 0) return;
        const payload = res.data || {};
        const list = payload.list || [];
        const latest = list[0] || null;
        if (!latest) {
          this.setData({ checkinCount: 0, checkinEmpty: true, checkinLatest: '' });
          return;
        }
        const duration = latest.durationMin ? ' · ' + latest.durationMin + ' 分钟' : '';
        this.setData({
          checkinCount: list.length,
          checkinEmpty: false,
          checkinLatestTime: (latest.startAt || latest.createdAt || '') + duration,
          checkinLatestStatus: CHECKIN_STATUS_LABEL[latest.status] || latest.status || '',
          checkinLatestStatusClass: checkinStatusClass(latest.status),
          checkinLatest: fmt.truncate(latest.summary || '本次授课小结待提交', 40)
        });
      })
      .catch((err) => {
        console.warn('[demand-detail] 读取打卡记录失败：', err);
        this.setData({ checkinCount: 0, checkinEmpty: true, checkinLatest: '' });
      });
  },

  /** 双向盲评状态文案 */
  loadReviewState() {
    const role = this.data.from === 'tutor' ? 'tutor' : 'parent';
    api
      .getReviewState({ demandId: this.data.demandId, role: role })
      .then((res) => {
        if (!res || res.code !== 0) return;
        const s = res.data || {};
        let text = '成单后可评价';
        if (s.revealed) text = '双方评价已揭晓';
        else if (s.myReview) text = '等待对方评价';
        else if (s.hasOtherReviewed) text = '待你评价（对方已提交）';
        else if (s.canReview) text = '待你评价';
        this.setData({
          reviewStateText: text,
          reviewCanSubmit: !!s.canReview,
          reviewRevealed: !!s.revealed
        });
      })
      .catch((err) => {
        console.warn('[demand-detail] 读取评价状态失败：', err);
      });
  },

  /**
   * 可成单候选名单（家长视角，匹配中 / 招募中）
   * 说明：二期未提供「按需求查申请列表」的接口，这里用规则匹配结果作为可成单名单
   *      （matchTutors 会顺带把需求状态由 published 推进为 matching，属预期行为）。
   */
  loadCandidates(demand) {
    const demandId = demand.id || this.data.demandId;
    api
      .matchTutors(demandId, { topN: 3 })
      .then((res) => {
        if (!res || res.code !== 0) {
          this.setData({ candidates: [], candidatesEmpty: true });
          return;
        }
        const list = (res.data && res.data.list) || [];
        const candidates = list.map((item) => {
          const t = item.tutor || {};
          const level = Number(t.certLevel || 0);
          return {
            tutorId: item.tutorId,
            name: t.name || '师范生',
            score: item.score,
            creditScore: Number(t.creditScore || 0),
            certLevel: level,
            certLevelText: level >= 3 ? '三重认证' : level ? '认证 ' + level + ' 级' : '未认证',
            reasonText: (item.reasons && item.reasons[0]) || ''
          };
        });
        this.setData({ candidates: candidates, candidatesEmpty: candidates.length === 0 });
      })
      .catch((err) => {
        console.warn('[demand-detail] 读取候选师范生失败：', err);
        this.setData({ candidates: [], candidatesEmpty: true });
      });
  },

  /** 确认成单（家长）：二次确认，成单后不可再确认其他师范生 */
  onConfirmTutor(e) {
    if (this.data.accepting) return;
    if (this.data.isMatched) {
      app.toast('该需求已成单，不能重复确认');
      return;
    }
    const tutorId = e.currentTarget.dataset.tutorid;
    const name = e.currentTarget.dataset.name || '该师范生';
    if (!tutorId) return;

    wx.showModal({
      title: '确认成单',
      content:
        '确认与「' + name + '」成单？\n成单后需求进入「已匹配」，不可再确认其他师范生，并可开始上课打卡。',
      confirmText: '确认成单',
      confirmColor: '#17B26A',
      success: (modal) => {
        if (!modal.confirm) return;
        this.setData({ accepting: true, acceptingTutorId: tutorId });
        api
          .acceptApplication({ demandId: this.data.demandId, tutorId: tutorId })
          .then((res) => {
            this.setData({ accepting: false, acceptingTutorId: '' });
            if (res && res.code === 0) {
              app.toast('已成单，可开始上课打卡', 'success');
              this.loadDetail();
              return;
            }
            app.toast((res && res.message) || '确认失败，请稍后重试');
          })
          .catch((err) => {
            console.error('[demand-detail] 确认成单失败：', err);
            this.setData({ accepting: false, acceptingTutorId: '' });
            app.toast('确认失败，请稍后重试');
          });
      }
    });
  },

  /** 履约页跳转（打卡页 / 评价页由二期并行任务提供，失败时给出可读提示） */
  goFulfillmentPage(url, failMsg) {
    wx.navigateTo({
      url: url,
      fail: () => {
        console.warn('[demand-detail] 页面跳转失败：', url);
        app.toast(failMsg || '页面暂不可用，请稍后重试');
      }
    });
  },

  /** 上课打卡 / 填写查看小结（师范生）与查看打卡（家长）共用 */
  onGoCheckin() {
    const role = this.data.from === 'tutor' ? 'tutor' : 'parent';
    this.goFulfillmentPage(
      '/pages/checkin/checkin?demandId=' + this.data.demandId + '&role=' + role,
      '打卡页暂不可用，请稍后重试'
    );
  },

  /** 双向评价 */
  onGoReview() {
    const role = this.data.from === 'tutor' ? 'tutor' : 'parent';
    this.goFulfillmentPage(
      '/pages/review/review?demandId=' + this.data.demandId + '&role=' + role,
      '评价页暂不可用，请稍后重试'
    );
  },

  /* ================================================================
   * 三、家长操作
   * ================================================================ */

  goMatch() {
    wx.navigateTo({ url: '/pages/match-result/match-result?demandId=' + this.data.demandId });
  },

  onGenerateReport() {
    if (this.data.generating) return;
    this.setData({ generating: true });
    api
      .generateReport(this.data.demandId)
      .then((res) => {
        this.setData({ generating: false });
        if (res && res.code === 0 && res.data) {
          app.toast('对接报告已生成', 'success');
          setTimeout(() => {
            wx.navigateTo({ url: '/pages/report-detail/report-detail?reportId=' + res.data.id });
          }, 600);
          return;
        }
        app.toast((res && res.message) || '生成失败，请先查看匹配结果');
      })
      .catch((err) => {
        console.error('[demand-detail] 生成报告失败：', err);
        this.setData({ generating: false });
        app.toast('生成报告失败');
      });
  },

  onCloseDemand() {
    wx.showModal({
      title: '关闭需求',
      content: '关闭后该需求不再出现在接单池，也无法继续匹配新的师范生。是否继续？',
      confirmText: '确认关闭',
      confirmColor: '#F04438',
      success: (modal) => {
        if (!modal.confirm) return;
        api.updateDemandStatus(this.data.demandId, DEMAND_STATUS.CLOSED).then((res) => {
          if (res && res.code === 0) {
            app.toast('需求已关闭', 'success');
            this.loadDetail();
          } else {
            app.toast((res && res.message) || '操作失败');
          }
        });
      }
    });
  },

  onCopyId() {
    wx.setClipboardData({
      data: this.data.demandId,
      success: () => app.toast('需求编号已复制'),
      // 剪贴板为隐私接口：拒绝隐私授权时会走 fail，避免按钮静默无响应
      fail: () => app.toast('复制失败，请确认已同意隐私授权')
    });
  },

  /* ================================================================
   * 四、师范生申请
   * ================================================================ */

  onApply() {
    if (this.data.applied) {
      app.toast('您已申请过该需求');
      return;
    }
    if (this.data.applying) return;
    if (this.data.isMatched) {
      app.toast('该需求已成单，暂不接受新的申请');
      return;
    }
    const tutorId = this.data.tutorId || (app.globalData && app.globalData.tutorProfileId) || 'tutor_001';
    this.setData({ applying: true });
    this.syncApplyBtn();
    api
      .applyDemand({
        demandId: this.data.demandId,
        tutorId: tutorId,
        tutorName: this.data.tutorName,
        message: '希望与您对接该家教需求，可先安排一次试课。'
      })
      .then((res) => {
        this.setData({ applying: false });
        if (res && res.code === 0) {
          this.setData({ applied: true });
          this.syncApplyBtn();
          app.toast(res.message || '申请已提交', 'success');
          this.loadDetail();
          return;
        }
        this.syncApplyBtn();
        app.toast((res && res.message) || '申请失败，请稍后重试');
      })
      .catch((err) => {
        console.error('[demand-detail] 申请失败：', err);
        this.setData({ applying: false });
        this.syncApplyBtn();
        app.toast('申请失败');
      });
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages && pages.length > 1) wx.navigateBack();
    else wx.switchTab({ url: '/pages/index/index' });
  }
});
