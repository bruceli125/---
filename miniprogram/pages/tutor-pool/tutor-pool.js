/**
 * 学生接单池（tabBar 页面）—— 二期重构
 *
 * 数据来源（全部走统一接口层，页面不碰 storage）：
 *   api.getTutorPool({ tutorId, subject, teachMode, status, minMatch })
 *     -> data: { tutor, list, counts:{published,matching,matched,total}, filters, weights, maxDistanceKm }
 *   api.getMyTutorProfile(tutorId) / api.getTutorStats(tutorId)
 *   api.getMyApplications(tutorId) / api.getCredit({ role:'tutor', tutorId })
 *
 * 设计要点：
 * 1. 科目 / 授课方式 / 状态三组筛选全部交给服务端（phase2.getTutorPool），
 *    因为状态 Tab 上的角标 counts 是「科目 + 方式」筛选后的结果，本地过滤算不出来；
 * 2. 快速切换 Tab 时用请求序号丢弃过期响应，避免列表与当前 Tab 不一致；
 * 3. 排序规则文案直接用 constants.POOL_SORT_NOTE，不手写数字（权重改了文案自动跟着改）；
 * 4. 已匹配 Tab 只返回「我成单的」订单（服务端已按 matchedTutorId 过滤）。
 *
 * TODO(二期)：接单池分页 + 新订单实时推送；「今日已打卡」需接 api.getCheckins 后按 demandId 传入卡片。
 * 说明：本项目刻意不引入 Vant Weapp / TDesign，保证「导入微信开发者工具即可运行、无需构建 npm」。
 */
const api = require('../../services/api.js');
const C = require('../../utils/constants.js');

/** 兜底师范生档案 id */
const FALLBACK_TUTOR_ID = 'tutor_001';
/** 「只看匹配度」门槛 */
const MIN_MATCH_THRESHOLD = 70;

function toast(title) {
  wx.showToast({ title: title || '', icon: 'none', duration: 2000 });
}

/** 统一取 {code,data,message} 里的 data（失败返回 null） */
function pick(res) {
  return res && res.code === 0 ? res.data : null;
}

/** 普通 Tab（科目 / 授课方式）：预计算样式类，WXML 不写条件表达式 */
function buildTabs(list, activeValue) {
  return (list || []).map(function (item) {
    return {
      value: item.value,
      label: item.label,
      className: item.value === activeValue ? 'tab-item tab-item-active' : 'tab-item'
    };
  });
}

/** 状态 Tab：带 counts 角标与 desc 说明 */
function buildStatusTabs(counts, activeValue) {
  const c = counts || {};
  const all = [
    { value: 'all', label: '全部', desc: '全部可接单', count: Number(c.total || 0) }
  ].concat(
    C.ORDER_STATUS_TABS.map(function (tab) {
      return { value: tab.value, label: tab.label, desc: tab.desc, count: Number(c[tab.value] || 0) };
    })
  );
  return all.map(function (tab) {
    return {
      value: tab.value,
      label: tab.label,
      desc: tab.desc,
      count: tab.count,
      countText: tab.count > 99 ? '99+' : String(tab.count),
      className: tab.value === activeValue ? 'status-tab status-tab-active' : 'status-tab'
    };
  });
}

/** 状态 label（空状态文案用） */
function statusLabelOf(value) {
  for (let i = 0; i < C.ORDER_STATUS_TABS.length; i++) {
    if (C.ORDER_STATUS_TABS[i].value === value) return C.ORDER_STATUS_TABS[i].label;
  }
  return '该';
}

/**
 * 卡片上的订单进度提示（传给 DemandCard 的 orderHint）
 * @param {object} demand
 * @param {boolean} applied 我是否已投递
 * @param {boolean} matchedMine 是否为「我成单的」订单
 */
function buildOrderHint(demand, applied, matchedMine) {
  if (demand.status === 'matched' && matchedMine) {
    return '🎉 该订单已与你成交，可进入详情完成打卡与课后小结';
  }
  if (applied) {
    return '已投递，等待家长确认（可在详情查看进度）';
  }
  if (demand.status === 'matching') {
    return '家长正在面试 / 试课其他师范生，仍可投递';
  }
  return '';
}

Page({
  data: {
    loading: true,
    isTutor: true,

    /* ---------- 我的状态 ---------- */
    tutorId: '',
    myName: '师范生',
    myAvatarText: '师',
    mySchoolLine: '',
    creditScore: 0,
    creditLevelText: '',
    creditRangeText: '',
    reviewCount: 0,
    certLevel: 0,
    certLevelText: '未认证',
    certBadgeNo: '',
    certified: false,
    orderCount: 0,
    rating: 0,
    applyCount: 0,
    pendingCount: 0,

    /* ---------- 筛选 ---------- */
    subjectTabs: buildTabs(C.POOL_SUBJECT_TABS, 'all'),
    modeTabs: buildTabs(C.POOL_MODE_TABS, 'all'),
    statusTabs: buildStatusTabs(null, 'all'),
    activeSubject: 'all',
    activeMode: 'all',
    activeStatus: 'all',
    onlyHighMatch: false,
    minMatch: 0,
    minMatchLabel: '只看匹配度 ≥ ' + MIN_MATCH_THRESHOLD,
    matchHintText: '过滤掉明显不匹配的订单',

    /* ---------- 列表 ---------- */
    list: [],
    totalCount: 0,
    counts: { published: 0, matching: 0, matched: 0, total: 0 },
    countsText: '',
    sortNote: C.POOL_SORT_NOTE,
    emptyIcon: '📭',
    emptyText: '暂无可接订单，稍后再来看看',
    showResetFilter: false
  },

  onLoad() {
    const app = getApp();
    const role = app.getRole();
    this.setData({
      isTutor: role === C.ROLES.TUTOR,
      creditRangeText: C.CREDIT_RULES.min + ' - ' + C.CREDIT_RULES.max
    });
  },

  onShow() {
    // 需求状态可能被其它页面改变（申请 / 成单 / 关闭），每次进入都刷新
    const silent = !!this._shownOnce;
    this._shownOnce = true;
    this.loadAll(silent);
  },

  onPullDownRefresh() {
    this.loadAll(true).then(function () {
      wx.stopPullDownRefresh();
      toast('已刷新接单池');
    });
  },

  /** 解析当前师范生档案 id */
  resolveTutorId() {
    if (this.data.tutorId) return this.data.tutorId;
    const app = getApp();
    const cached = app && app.globalData ? app.globalData.tutorProfileId : '';
    // TODO(二期+)：真实环境应由登录态（openid -> users -> tutors）取档案 id，这里兜底到演示档案
    return cached || FALLBACK_TUTOR_ID;
  },

  /**
   * 加载我的状态 + 接单池
   * @param {boolean} silent 静默刷新（不显示全屏 loading）
   */
  loadAll(silent) {
    const self = this;
    const tutorId = this.resolveTutorId();
    if (!silent) this.setData({ loading: true });

    return Promise.all([
      api.getMyTutorProfile(tutorId),
      api.getTutorStats(tutorId),
      api.getMyApplications(tutorId),
      api.getCredit({ role: 'tutor', tutorId: tutorId })
    ])
      .then(function (results) {
        self.applyProfile(
          pick(results[0]) || {},
          pick(results[1]) || {},
          pick(results[2]) || [],
          pick(results[3]) || {},
          tutorId
        );
        return self.requestPool(silent);
      })
      .catch(function (err) {
        console.error('[tutor-pool] 加载失败：', err);
        self.setData({
          loading: false,
          list: [],
          totalCount: 0,
          emptyIcon: '⚠️',
          emptyText: '接单池加载失败，请下拉刷新重试',
          showResetFilter: false
        });
      });
  },

  /** 写入「我的状态卡」数据 */
  applyProfile(profile, stats, applications, credit, fallbackId) {
    const tutor = profile || {};
    const level = Number(tutor.certLevel || stats.certLevel || 0);
    const levelItem = C.CERT_LEVELS[level] || C.CERT_LEVELS[0];

    /* 已投递的需求集合（用于卡片的 applied 状态） */
    const appliedMap = {};
    (applications || []).forEach(function (app) {
      appliedMap[app.demandId] = true;
    });
    this._appliedMap = appliedMap;

    const schoolLine = [tutor.school, tutor.major, tutor.grade].filter(Boolean).join(' · ');

    this.setData({
      tutorId: tutor.id || fallbackId,
      myName: tutor.name || '师范生',
      myAvatarText: tutor.avatarText || (tutor.name ? tutor.name.slice(0, 1) : '师'),
      mySchoolLine: schoolLine,
      /* 信用分以 getCredit 为准（评价后会动态变化） */
      creditScore: Number(credit.creditScore || stats.creditScore || tutor.creditScore || 0),
      creditLevelText: Number(credit.creditScore || 0) >= 90 ? '信用优秀' : Number(credit.creditScore || 0) >= 80 ? '信用良好' : '信用一般',
      reviewCount: Number(credit.reviewCount || 0),
      certLevel: level,
      certLevelText: levelItem.label,
      certBadgeNo: tutor.certBadgeNo || stats.certBadgeNo || '',
      certified: level >= 3,
      orderCount: Number(stats.orderCount || tutor.orderCount || 0),
      rating: Number(stats.rating || tutor.rating || 0),
      applyCount: Number(stats.applyCount || (applications || []).length),
      pendingCount: Number(stats.pendingCount || 0)
    });
  },

  /** 按当前筛选条件请求接单池 */
  requestPool(silent) {
    const self = this;
    const seq = (this._seq || 0) + 1;
    this._seq = seq;
    if (!silent) this.setData({ loading: true });

    const tutorId = this.data.tutorId || this.resolveTutorId();
    const params = {
      tutorId: tutorId,
      subject: this.data.activeSubject,
      teachMode: this.data.activeMode,
      status: this.data.activeStatus,
      minMatch: this.data.minMatch
    };

    return api.getTutorPool(params).then(function (res) {
      /* 过期响应直接丢弃（用户快速切换 Tab 时会出现） */
      if (seq !== self._seq) return;

      if (!res || res.code !== 0 || !res.data) {
        self.setData({
          loading: false,
          list: [],
          totalCount: 0,
          emptyIcon: '⚠️',
          emptyText: (res && res.message) || '接单池加载失败，请重试',
          showResetFilter: false
        });
        return;
      }

      const pool = res.data;
      const counts = pool.counts || {};
      const appliedMap = self._appliedMap || {};

      const list = (pool.list || []).map(function (item) {
        const demand = item.demand || {};
        const applied = !!appliedMap[item.demandId];
        const matchedMine = demand.status === 'matched' && demand.matchedTutorId === tutorId;
        return {
          demandId: item.demandId,
          demand: demand,
          matchScore: item.matchScore,
          score: item.score,
          distanceKm: item.distanceKm,
          reasons: item.reasons || [],
          applied: applied,
          /* TODO(二期)：接 api.getCheckins 后按 demandId 判断「今日已打卡」 */
          showCheckin: false,
          orderHint: buildOrderHint(demand, applied, matchedMine)
        };
      });

      const empty = self.buildEmptyState(list);
      self.setData({
        loading: false,
        tutorId: tutorId,
        list: list,
        totalCount: list.length,
        counts: counts,
        countsText:
          '招募中 ' +
          Number(counts.published || 0) +
          ' · 匹配中 ' +
          Number(counts.matching || 0) +
          ' · 已成单 ' +
          Number(counts.matched || 0),
        statusTabs: buildStatusTabs(counts, self.data.activeStatus),
        matchHintText: self.data.minMatch ? '当前筛出 ' + list.length + ' 条' : '过滤掉明显不匹配的订单',
        emptyIcon: empty.icon,
        emptyText: empty.text,
        showResetFilter: empty.reset
      });
    });
  },

  /** 空状态文案：按当前筛选条件给出可执行的下一步 */
  buildEmptyState(list) {
    if (list && list.length) return { icon: '', text: '', reset: false };

    const minMatch = Number(this.data.minMatch || 0);
    const status = this.data.activeStatus;

    if (minMatch > 0) {
      return {
        icon: '🎯',
        text: '「只看匹配度 ≥ ' + minMatch + '」过滤后没有订单，关闭该开关即可看到更多可接订单',
        reset: true
      };
    }
    if (status && status !== 'all') {
      return {
        icon: '🗂',
        text: '「' + statusLabelOf(status) + '」状态下暂无订单，切换到其它状态看看',
        reset: true
      };
    }
    if (this.data.activeSubject !== 'all' || this.data.activeMode !== 'all') {
      return {
        icon: '🔍',
        text: '当前科目 / 授课方式筛选下没有订单，试试放宽筛选条件',
        reset: true
      };
    }
    return { icon: '📭', text: '暂无可接订单，稍后再来看看', reset: false };
  },

  /* ================= 筛选交互（全部重新请求，保证 counts 准确） ================= */

  onSubjectTap(e) {
    const value = e.currentTarget.dataset.value || 'all';
    if (value === this.data.activeSubject) return;
    this.setData({
      activeSubject: value,
      subjectTabs: buildTabs(C.POOL_SUBJECT_TABS, value)
    });
    this.requestPool(true);
  },

  onModeTap(e) {
    const value = e.currentTarget.dataset.value || 'all';
    if (value === this.data.activeMode) return;
    this.setData({
      activeMode: value,
      modeTabs: buildTabs(C.POOL_MODE_TABS, value)
    });
    this.requestPool(true);
  },

  onStatusTap(e) {
    const value = e.currentTarget.dataset.value || 'all';
    if (value === this.data.activeStatus) return;
    this.setData({
      activeStatus: value,
      statusTabs: buildStatusTabs(this.data.counts, value)
    });
    this.requestPool(true);
  },

  onToggleHighMatch(e) {
    const checked = !!e.detail.value;
    this.setData({
      onlyHighMatch: checked,
      minMatch: checked ? MIN_MATCH_THRESHOLD : 0
    });
    this.requestPool(true);
  },

  /** 重置全部筛选条件 */
  onResetFilter() {
    this.setData({
      activeSubject: 'all',
      activeMode: 'all',
      activeStatus: 'all',
      onlyHighMatch: false,
      minMatch: 0,
      subjectTabs: buildTabs(C.POOL_SUBJECT_TABS, 'all'),
      modeTabs: buildTabs(C.POOL_MODE_TABS, 'all'),
      statusTabs: buildStatusTabs(this.data.counts, 'all')
    });
    toast('已重置筛选条件');
    this.requestPool(true);
  },

  /* ================= 列表交互 ================= */

  onDemandTap(e) {
    const detail = e.detail || {};
    const demand = detail.demand || {};
    const demandId = detail.demandId || demand.id;
    if (!demandId) return;
    wx.navigateTo({ url: '/pages/demand-detail/demand-detail?from=tutor&id=' + demandId });
  },

  onApply(e) {
    const self = this;
    if (!this.data.isTutor) {
      toast('请先切换到师范生身份');
      return;
    }
    const detail = e.detail || {};
    const demand = detail.demand || {};
    const demandId = detail.demandId || demand.id;
    if (!demandId) return;

    api
      .applyDemand({
        demandId: demandId,
        tutorId: this.data.tutorId || this.resolveTutorId(),
        tutorName: this.data.myName
      })
      .then(function (res) {
        if (!res || res.code !== 0) {
          toast((res && res.message) || '申请失败，请重试');
          return;
        }
        /* 本地先置为已申请，再重新拉取一次与 storage 对齐 */
        const list = self.data.list.slice();
        for (let i = 0; i < list.length; i++) {
          if (list[i].demandId === demandId) {
            list[i].applied = true;
            list[i].orderHint = buildOrderHint(list[i].demand, true, false);
          }
        }
        self.setData({ list: list });
        toast('申请已提交，等待家长确认');
        self.loadAll(true);
      });
  },

  /* ================= 角色与认证 ================= */

  onSwitchRole() {
    const app = getApp();
    app.setRole(C.ROLES.TUTOR);
    app.ensureLogin(true).catch(function () {});
    this.setData({ isTutor: true });
    toast('已切换为师范生身份');
    this.loadAll(true);
  },

  onGoVerify() {
    wx.navigateTo({ url: '/pages/tutor-verify/tutor-verify' });
  },

  onShareAppMessage() {
    return {
      title: '京师家教接单池：' + (this.data.totalCount || 0) + ' 条家教需求，认证师范生优先',
      path: '/pages/tutor-pool/tutor-pool'
    };
  }
});
