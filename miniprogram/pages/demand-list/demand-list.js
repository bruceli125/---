/**
 * 接单池（TabBar 第 2 个 Tab）—— 角色分流 + 报名状态全局同步
 * ---------------------------------------------------------------------------
 *   currentRole === 'tutor'  → 接单池：卡片列表 + 长按报名 / 已接单·取消接单
 *   currentRole === 'parent' → 拦截：提示"仅学生可访问"并强制回首页
 *
 * 【报名状态同步（本次修复重点）】
 * 状态来源是 utils/applied.js 维护的 appliedDemands 数组，而不是每次都等接口返回：
 *   onShow      → syncFromServer() 校正，再用 applied.has() 逐条渲染
 *   报名成功    → applied.add(id) 后立即 setData，再跳聊天室
 *   取消成功    → applied.remove(id) 后立即 setData
 * 列表页与详情页读的是同一份缓存，不会出现"列表已报名、详情还显示长按报名"。
 */
const api = require('../../services/api.js');
const applied = require('../../utils/applied.js');
const C = require('../../utils/constants.js');

const FALLBACK_TUTOR_ID = 'tutor_001';

Page({
  data: {
    role: 'parent',
    isTutor: false,
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

    /* ---------- 权限闸门 ---------- */
    if (role !== C.ROLES.TUTOR && !this._mineMode) {
      this.setData({ blocked: true, role: role, isTutor: false, pool: [], mine: [] });
      wx.showToast({ title: '仅学生可访问接单池', icon: 'none', duration: 1600 });
      setTimeout(function () {
        wx.switchTab({ url: '/pages/index/index' });
      }, 900);
      return;
    }

    this.setData({ blocked: false, role: role, isTutor: role === C.ROLES.TUTOR });

    if (role !== C.ROLES.TUTOR) {
      this.loadMine();
      return;
    }

    // 学生：先用缓存校正，再拉列表（避免回到列表还是旧状态）
    const self = this;
    applied.syncFromServer(this.resolveTutorId()).then(function () {
      self.loadPool();
    });
  },

  onPullDownRefresh() {
    const self = this;
    const task =
      this.data.isTutor
        ? applied.syncFromServer(this.resolveTutorId()).then(function () {
            return self.loadPool();
          })
        : this.loadMine();
    Promise.resolve(task).then(function () {
      wx.stopPullDownRefresh();
    });
  },

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
          return self.buildCard(it);
        });
        self.setData({ loading: false, pool: list, poolTotal: list.length });
      });
  },

  /**
   * 把服务端条目映射成卡片字段（对齐设计图的信息层级）
   * reasons 顺序：[需求匹配度, 距离, 价格说明, 信用分]
   */
  buildCard(it) {
    const d = it.demand || {};
    const reasons = it.reasons || [];
    const demandId = d.id || it.demandId;

    const distanceText =
      it.distanceKm != null ? Number(it.distanceKm).toFixed(1) + 'km' : '距离未知';
    const priceNote = reasons[2] || (d.budget ? '课时费 ' + d.budget + ' 元' : '价格待沟通');
    const overBudget = /(高于|超出|略高)/.test(priceNote);

    const isDiscipline = d.isDiscipline === 'discipline' || d.subjectGroup === 'discipline';

    // 胶囊标签：授课方式 / 时段 / 授课类型
    const tags = [];
    tags.push(
      d.teachMode === 'online' ? '线上授课' : d.teachMode === 'campus' ? '校内场地' : '线下上门'
    );
    if (d.timeRangeText) tags.push(d.timeRangeText);
    const teachTypeText = C.teachTypeLabel(d.teachType);
    if (teachTypeText) tags.push(teachTypeText);

    const status = C.normalizeDemandStatus(d.status);
    const statusLabel =
      status === C.DEMAND_STATUS.MATCHED ? '已匹配' : status === 'communicating' ? '沟通中' : '招募中';

    return {
      demandId: demandId,
      title: (d.subject || '家教') + '·' + (d.grade || ''),
      category: isDiscipline ? '学科类' : '素质类',
      categoryClass: isDiscipline ? 'cat--discipline' : 'cat--quality',
      statusLabel: statusLabel,
      statusClass: status === C.DEMAND_STATUS.MATCHED ? 'badge--dark' : 'badge--violet',

      // 报名态以全局缓存为准
      applied: applied.has(demandId),
      matchScore: Number(it.matchScore || 0).toFixed(1),
      distanceText: distanceText,
      priceNote: priceNote,
      overBudget: overBudget,
      tags: tags,

      specialRequirements: (d.specialRequirements || '').trim(),
      addressText: d.address || d.district || '',

      timeText: prettyTime(d.createdAt),
      applyCount: d.applyCount || 0,
      viewCount: d.viewCount || 0
    };
  },

  /** 长按报名（2 秒，HoldButton 内部计时） */
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

        // 关键：先写全局缓存，再更新本页（保证进详情页一定是「已报名」）
        applied.add(demandId);
        self.patchItem(demandId, { applied: true });

        wx.showToast({ title: '报名成功，进入沟通', icon: 'none' });
        const app = getApp();
        if (app && app.refreshChatBadge) app.refreshChatBadge();

        wx.navigateTo({
          url:
            '/pages/chat-room/chat-room?demandId=' +
            demandId +
            '&tutorId=' +
            self.resolveTutorId()
        });
      });
  },

  /** 取消接单：二次确认 → 删投递 → 写缓存 → 立即复位卡片 */
  onCancelSignup(e) {
    const self = this;
    const demandId = e.currentTarget.dataset.demandid;
    if (!demandId) return;

    wx.showModal({
      title: '取消报名',
      content: '确定要取消报名吗？取消后可重新报名。',
      confirmText: '取消报名',
      confirmColor: '#D92D20',
      success(res) {
        if (!res.confirm) return;
        api.cancelApplication({ demandId: demandId, tutorId: self.resolveTutorId() }).then(
          function (r) {
            if (!r || r.code !== 0) {
              wx.showToast({ title: (r && r.message) || '取消失败', icon: 'none' });
              return;
            }
            applied.remove(demandId);
            self.patchItem(demandId, { applied: false });
            wx.showToast({ title: '已取消接单', icon: 'none' });
            const app = getApp();
            if (app && app.refreshChatBadge) app.refreshChatBadge();
          }
        );
      }
    });
  },

  /** 局部更新一条卡片，避免整表重排 */
  patchItem(demandId, patch) {
    const pool = this.data.pool.slice();
    for (let i = 0; i < pool.length; i++) {
      if (pool[i].demandId === demandId) {
        pool[i] = Object.assign({}, pool[i], patch);
        break;
      }
    }
    this.setData({ pool: pool });
  },

  /** 去沟通：已报名的单子直接进对应聊天室 */
  goChat(e) {
    const demandId = e.currentTarget.dataset.demandid;
    if (!demandId) return;
    wx.navigateTo({
      url: '/pages/chat-room/chat-room?demandId=' + demandId + '&tutorId=' + this.resolveTutorId()
    });
  },

  onOpenDemand(e) {
    const id = e.currentTarget.dataset.demandid;
    if (!id) return;
    // 进详情前再刷一遍缓存，详情页 onLoad 会用同一份数据渲染
    applied.syncFromServer(this.resolveTutorId());
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

/** "2026-10-21 16:47" → "昨天 16:47" / "10-21 16:47" */
function prettyTime(text) {
  if (!text) return '';
  const m = String(text).match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}:\d{2})/);
  if (!m) return text;
  const d = new Date(m[1] + '/' + m[2] + '/' + m[3] + ' ' + m[4] + ':00');
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= dayStart) return '今天 ' + m[4];
  if (t >= dayStart - 86400000) return '昨天 ' + m[4];
  return m[2] + '-' + m[3] + ' ' + m[4];
}
