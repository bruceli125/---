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

    /** 学生视图：原始订单（未筛选） */
    allDemands: [],
    /** 学生视图：筛选后用于渲染的订单 */
    displayDemands: [],
    poolTotal: 0,

    /* ---------- 多维筛选栏 ---------- */
    /** 当前展开的面板 key：'' | 'subject' | 'grade' | 'price' | 'time' */
    activeTab: '',
    /** 筛选参数：全部非空才参与过滤 */
    filterParams: { subject: '', grade: '', price: '', time: '' },
    /** 四个 Tab 的显示文案与当前选中值 */
    filterTabs: [
      { key: 'subject', label: '学科', value: '' },
      { key: 'grade', label: '年级', value: '' },
      { key: 'price', label: '价格', value: '' },
      { key: 'time', label: '时间', value: '' }
    ],
    /** 各面板的选项（第一项「全部」用空值表示不限） */
    filterOptions: {
      subject: ['全部', '语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '素质拓展'],
      grade: ['全部', '小学', '初中', '高中', '学前'],
      price: ['全部', '100元以下', '100-150元', '150-200元', '200元以上'],
      time: ['全部', '工作日晚上', '周末', '时间面议']
    },
    /** 面板里当前高亮的选项（点「确定」才写入 filterParams） */
    draftOption: '',

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
        self.setData({ loading: false, allDemands: list, poolTotal: list.length });
        self.applyFilters();
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
      viewCount: d.viewCount || 0,

      /* ---- 供前端筛选使用（不直接展示） ---- */
      subjectText: d.subject || '',
      stage: d.stage || stageFromGrade(d.grade),
      budget: Number(d.budget || 0),
      timeRaw: d.timeRangeText || '',
      isQuality: !isDiscipline
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
    const all = this.data.allDemands.slice();
    for (let i = 0; i < all.length; i++) {
      if (all[i].demandId === demandId) {
        all[i] = Object.assign({}, all[i], patch);
        break;
      }
    }
    this.setData({ allDemands: all });
    this.applyFilters();
  },

  /* ==================================================================
   * 多维筛选
   * ================================================================== */

  /** 阻止穿透滚动（配合 catchtouchmove），空实现即可 */
  noop() {},

  /** 点击 Tab：同一个再次点击收起，点其他则切换 */
  onTabClick(e) {
    const key = e.currentTarget.dataset.key;
    if (this.data.activeTab === key) {
      this.closePanel();
      return;
    }
    // 打开时把该维度已生效的值作为草稿，方便用户看到当前选中
    this.setData({ activeTab: key, draftOption: this.data.filterParams[key] || '' });
  },

  /** 点遮罩 / 关闭：收起面板 */
  closePanel() {
    this.setData({ activeTab: '', draftOption: '' });
  },
  onMaskTap() {
    this.closePanel();
  },

  /** 面板内点选项：只改草稿，不立即生效 */
  onPickOption(e) {
    const value = e.currentTarget.dataset.value || '';
    this.setData({ draftOption: value === '全部' ? '' : value });
  },

  /** 重置当前面板 */
  onResetPanel() {
    const key = this.data.activeTab;
    if (!key) return;
    const params = Object.assign({}, this.data.filterParams, { [key]: '' });
    this.setData({ filterParams: params, draftOption: '' });
    this.syncFilterTabs(params);
    this.applyFilters();
  },

  /** 确定：写入 filterParams → 关面板 → 过滤 */
  onConfirmPanel() {
    const key = this.data.activeTab;
    if (!key) return;
    const params = Object.assign({}, this.data.filterParams, { [key]: this.data.draftOption });
    this.setData({ filterParams: params, activeTab: '', draftOption: '' });
    this.syncFilterTabs(params);
    this.applyFilters();
  },

  /** 把 filterParams 反映到 Tab 文案上（选中后 Tab 显示所选值） */
  syncFilterTabs(params) {
    const tabs = this.data.filterTabs.map(function (t) {
      return Object.assign({}, t, {
        value: params[t.key] || '',
        active: !!params[t.key]
      });
    });
    this.setData({ filterTabs: tabs });
  },

  /**
   * 统一过滤：按 filterParams 非空维度叠加过滤 allDemands → displayDemands
   * 学科：标题/科目包含关键词；「素质拓展」按 isQuality 判定
   * 年级：按 stage 映射（小学/初中/高中/学前）
   * 价格：解析为数值区间比较
   * 时间：按 timeRaw 文本包含判定
   */
  applyFilters() {
    const p = this.data.filterParams;
    const all = this.data.allDemands || [];

    const list = all.filter(function (it) {
      // 学科
      if (p.subject) {
        if (p.subject === '素质拓展') {
          if (!it.isQuality) return false;
        } else if ((it.subjectText || '').indexOf(p.subject) === -1) {
          return false;
        }
      }
      // 年级
      if (p.grade && it.stage !== p.grade) return false;
      // 价格
      if (p.price) {
        const b = Number(it.budget || 0);
        if (p.price === '100元以下' && !(b > 0 && b < 100)) return false;
        if (p.price === '100-150元' && !(b >= 100 && b <= 150)) return false;
        if (p.price === '150-200元' && !(b > 150 && b <= 200)) return false;
        if (p.price === '200元以上' && !(b > 200)) return false;
      }
      // 时间
      if (p.time) {
        const t = it.timeRaw || '';
        if (p.time === '工作日晚上') {
          if (t.indexOf('工作日晚上') === -1 && t.indexOf('工作日下午') === -1) return false;
        } else if (p.time === '周末') {
          if (t.indexOf('周末') === -1) return false;
        } else if (p.time === '时间面议') {
          if (t && t.indexOf('面议') === -1) return false;
        }
      }
      return true;
    });

    this.setData({ displayDemands: list });
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

/**
 * 年级文本 → 学段枚举（与筛选栏「年级」选项一一对应）
 * 优先用数据里的 stage 字段；缺失时按年级名兜底推断。
 */
function stageFromGrade(grade) {
  const g = String(grade || '');
  if (!g) return '';
  if (/小班|中班|大班|幼小衔接|学前/.test(g)) return 'preschool';
  if (/幼儿园/.test(g)) return 'preschool';
  if (/一年级|二年级|三年级|四年级|五年级|六年级|小学/.test(g)) return 'primary';
  if (/初一|初二|初三|七年级|八年级|九年级|初中/.test(g)) return 'junior';
  if (/高一|高二|高三|高中/.test(g)) return 'senior';
  return '';
}
