/**
 * 接单池（TabBar 第 2 个 Tab）—— 角色分流
 * ---------------------------------------------------------------------------
 * 本次重构的关键页，承担两种身份、两种视图：
 *
 *   currentRole === 'tutor'  → 接单池：可接订单 + 每行「长按报名」（2 秒）
 *   currentRole === 'parent' → 拦截：提示"仅学生可访问"并强制回首页
 *
 * 【为什么有 mineMode】
 * 家长自己的需求列表（我的需求）也需要入口，但 Tab 只能指向一个页面，
 * 且需求要求「家长点接单池 Tab 必须被拦截」。所以约定：
 *   - Tab 进入（无参数）      → 家长一律拦截；
 *   - 显式入口 ?mine=1（首页/我的）→ 家长可看自己的需求。
 * 既满足权限隔离，又不把家长的需求管理功能堵死。
 */
const api = require('../../services/api.js');
const C = require('../../utils/constants.js');

const FALLBACK_TUTOR_ID = 'tutor_001';

Page({
  data: {
    role: 'parent',
    isTutor: false,
    /** 是否被权限拦截（家长从 Tab 进来） */
    blocked: false,
    loading: true,

    /** 学生视图：可接订单 */
    pool: [],
    poolTotal: 0,

    /** 家长视图：我的需求 */
    mine: [],
    mineTotal: 0
  },

  onLoad(options) {
    const opt = options || {};
    this._mineMode = opt.mine === '1';
  },

  onShow() {
    const app = getApp();
    const role = app.getRole() || C.ROLES.PARENT;

    /* ---------- 权限闸门（六.1 / 六.2） ---------- */
    if (role !== C.ROLES.TUTOR && !this._mineMode) {
      this.setData({ blocked: true, role: role, isTutor: false, pool: [], mine: [] });
      wx.showToast({ title: '仅学生可访问接单池', icon: 'none', duration: 1600 });
      setTimeout(function () {
        wx.switchTab({ url: '/pages/index/index' });
      }, 900);
      return;
    }

    this.setData({ blocked: false, role: role, isTutor: role === C.ROLES.TUTOR });
    if (role === C.ROLES.TUTOR) {
      this.loadPool();
    } else {
      this.loadMine();
    }
  },

  onPullDownRefresh() {
    const task = this.data.isTutor ? this.loadPool() : this.loadMine();
    Promise.resolve(task).then(function () {
      wx.stopPullDownRefresh();
    });
  },

  /** 当前学生档案 id */
  resolveTutorId() {
    const app = getApp();
    return (app && app.globalData ? app.globalData.tutorProfileId : '') || FALLBACK_TUTOR_ID;
  },

  /* ================= 学生视图 ================= */

  loadPool() {
    const self = this;
    this.setData({ loading: true });
    return api
      .getTutorPool({ tutorId: this.resolveTutorId(), pageSize: 50 })
      .then(function (res) {
        if (!res || res.code !== 0) {
          self.setData({ loading: false });
          return;
        }
        const list = (res.data.list || []).map(function (it) {
          const d = it.demand || {};
          return {
            demandId: d.id || it.demandId,
            title: (d.subject || '') + ' · ' + (d.grade || ''),
            budgetText: d.budget ? '¥' + d.budget + '/小时' : '面议',
            timeText: d.timeRangeText || '时间面议',
            modeText: d.teachMode === 'online' ? '线上' : d.teachMode === 'campus' ? '校内' : '线下',
            teachTypeText: C.teachTypeLabel(d.teachType),
            statusLabel: C.DEMAND_STATUS_LABEL[C.normalizeDemandStatus(d.status)] || '',
            matchScore: it.matchScore || 0,
            applied: !!it.applied,
            riskLevel: d.riskLevel || 'low',
            personText: d.parentName || '家长'
          };
        });
        self.setData({ loading: false, pool: list, poolTotal: list.length });
      });
  },

  /**
   * 长按报名（2 秒，由 HoldButton 组件计时）
   * 成功后：订单进入沟通中 → 该学生出现在家长详情页的申请列表 → 直接进聊天室（五.1）
   */
  onSignup(e) {
    const self = this;
    const demandId = (e.detail && e.detail.demandId) || e.currentTarget.dataset.demandid;
    if (!demandId) return;

    api
      .signupByHold({ demandId: demandId, tutorId: this.resolveTutorId(), tutorName: '' })
      .then(function (res) {
        if (!res || (res.code !== 0 && res.code !== 3)) {
          wx.showToast({ title: (res && res.message) || '报名失败', icon: 'none' });
          return;
        }
        if (res.code === 3) {
          wx.showToast({ title: res.message, icon: 'none' });
          return;
        }
        wx.showToast({ title: '报名成功，进入沟通', icon: 'none' });
        self.loadPool();
        wx.navigateTo({
          url: '/pages/chat-room/chat-room?demandId=' + demandId + '&tutorId=' + self.resolveTutorId()
        });
      });
  },

  onOpenDemand(e) {
    const id = e.currentTarget.dataset.demandid;
    if (!id) return;
    wx.navigateTo({ url: '/pages/demand-detail/demand-detail?id=' + id + '&from=tutor' });
  },

  /* ================= 家长视图（我的需求） ================= */

  loadMine() {
    const self = this;
    this.setData({ loading: true });
    return api.getDemandList({ onlyMine: true }).then(function (res) {
      if (!res || res.code !== 0) {
        self.setData({ loading: false });
        return;
      }
      const raw = (res.data && res.data.list) || res.data || [];
      const list = raw.map(function (d) {
        const status = C.normalizeDemandStatus(d.status);
        return {
          id: d.id,
          title: (d.subject || '') + ' · ' + (d.grade || ''),
          statusLabel: C.DEMAND_STATUS_LABEL[status] || status,
          applyCount: d.applyCount || 0,
          createdAt: d.createdAt || '',
          budgetText: d.budget ? '¥' + d.budget + '/小时' : '面议'
        };
      });
      self.setData({ loading: false, mine: list, mineTotal: list.length });
    });
  },

  onOpenMine(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/demand-detail/demand-detail?id=' + id + '&from=parent' });
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/demand-create/demand-create' });
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' });
  }
});
