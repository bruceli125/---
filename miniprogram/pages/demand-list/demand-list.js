/**
 * 需求列表（「我的需求」）
 *
 * 【UI 组件库说明】不引入 Vant Weapp / TDesign，用自研 DemandCard + app.wxss 全局类。
 *
 * 数据来源：services/api.js → getDemandList（云开发 / mock 自动切换），
 * 页面内按 tab 做本地过滤（MVP 数据量小，二期改成分页查询）。
 */
const api = require('../../services/api.js');
const fmt = require('../../utils/format.js');
const { DEMAND_STATUS, DEMAND_STATUS_LABEL, RISK_LEVEL_THEME, ROLES } = require('../../utils/constants.js');

const app = getApp();

/** 'YYYY-MM-DD HH:mm' 在 iOS 上无法直接 new Date，统一转成 'YYYY/MM/DD HH:mm' */
function parseTime(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  const s = String(value).replace(/-/g, '/').replace('T', ' ').replace(/\.\d+Z?$/, '');
  const t = new Date(s).getTime();
  return isNaN(t) ? 0 : t;
}

function statusClass(status) {
  if (status === DEMAND_STATUS.PUBLISHED) return 'tag-green';
  if (status === DEMAND_STATUS.MATCHING) return 'tag-blue';
  if (status === DEMAND_STATUS.MATCHED) return 'tag-green';
  if (status === DEMAND_STATUS.RISK_BLOCKED) return 'tag-red';
  return '';
}

Page({
  data: {
    tabs: [
      { value: 'all', label: '全部', statuses: [], count: 0 },
      { value: 'published', label: '招募中', statuses: [DEMAND_STATUS.PUBLISHED], count: 0 },
      { value: 'matching', label: '匹配中', statuses: [DEMAND_STATUS.MATCHING, DEMAND_STATUS.MATCHED], count: 0 },
      { value: 'closed', label: '已结束', statuses: [DEMAND_STATUS.CLOSED], count: 0 }
    ],
    status: 'all',
    stat: { total: 0, published: 0, matching: 0, matched: 0, risk: 0 },
    list: [],
    loading: true,
    isParent: true
  },

  onLoad() {
    this.allList = [];
  },

  onShow() {
    // 发布完成 / 详情页操作后返回，需要看到最新数据
    this.loadList();
  },

  onPullDownRefresh() {
    this.loadList().then(() => {
      wx.stopPullDownRefresh();
      app.toast('已刷新');
    });
  },

  /** 拉取并渲染 */
  loadList() {
    const user = (app.globalData && app.globalData.userInfo) || {};
    this.setData({ loading: true });
    return api
      .getDemandList({ parentId: user.parentId || '' })
      .then((res) => {
        if (!res || res.code !== 0) {
          this.setData({ loading: false, list: [] });
          app.toast((res && res.message) || '需求加载失败');
          return;
        }
        this.allList = res.data || [];
        this.render();
      })
      .catch((err) => {
        console.error('[demand-list] 加载失败：', err);
        this.setData({ loading: false });
        app.toast('需求加载失败');
      });
  },

  /** 统计 + 过滤 + 展示字段预计算 */
  render() {
    const all = this.allList || [];
    const stat = {
      total: all.length,
      published: all.filter((d) => d.status === DEMAND_STATUS.PUBLISHED).length,
      matching: all.filter((d) => d.status === DEMAND_STATUS.MATCHING).length,
      matched: all.filter((d) => d.status === DEMAND_STATUS.MATCHED).length,
      risk: all.filter((d) => d.riskLevel && d.riskLevel !== 'low').length
    };

    const current = this.data.status;
    const tabs = this.data.tabs.map((t) => {
      let count = 0;
      if (!t.statuses.length) count = all.length;
      else count = all.filter((d) => t.statuses.indexOf(d.status) > -1).length;
      return Object.assign({}, t, { count: count });
    });

    const tab = tabs.filter((t) => t.value === current)[0] || tabs[0];
    const filtered = !tab.statuses.length ? all : all.filter((d) => tab.statuses.indexOf(d.status) > -1);

    this.setData({
      stat: stat,
      tabs: tabs,
      list: filtered.map(this.decorate),
      loading: false,
      isParent: app.getRole() !== ROLES.TUTOR
    });
  },

  /** 需求展示字段预计算（WXML 中不做复杂表达式 / 不调用工具函数） */
  decorate(demand) {
    const d = demand || {};
    const theme = RISK_LEVEL_THEME[d.riskLevel] || RISK_LEVEL_THEME.low;
    const hits = d.riskHits || [];
    const timeRangeText =
      d.timeRangeText || (d.timeRange || []).map(fmt.timeRangeLabel).filter(Boolean).join(' / ') || '时间面议';
    return Object.assign({}, d, {
      statusLabel: DEMAND_STATUS_LABEL[d.status] || d.status || '',
      statusClass: statusClass(d.status),
      riskLevelText: theme.text,
      riskColor: theme.color,
      riskBg: theme.bg,
      riskHitText: hits.map((h) => h.word).join('、'),
      riskHitCount: hits.length,
      budgetText: fmt.formatBudget(d.budgetMin, d.budgetMax),
      timeRangeText: timeRangeText,
      frequencyText: fmt.frequencyLabel(d.frequency),
      teachModeText: fmt.teachModeLabel(d.teachMode),
      districtText: d.district ? fmt.districtLabel(d.district) : '地点面议',
      addressText: d.address || '线上授课，地点待沟通',
      titleText: (d.grade || '') + (d.subject || '') + '辅导',
      createdAgo: fmt.timeAgo(d.createdAtTs || parseTime(d.createdAt)),
      applyCount: Number(d.applyCount || 0)
    });
  },

  onSelectTab(e) {
    const value = e.currentTarget.dataset.value;
    if (!value || value === this.data.status) return;
    this.setData({ status: value }, () => this.render());
  },

  onTapDemand(e) {
    const detail = e.detail || {};
    const demandId = detail.demandId || (detail.demand && detail.demand.id) || e.currentTarget.dataset.id || '';
    if (!demandId) return;
    // 组件自定义 tap 与原生 tap 可能同时到达，这里做一次去重，避免重复压栈
    const now = Date.now();
    if (this._navId === demandId && now - this._navAt < 600) return;
    this._navId = demandId;
    this._navAt = now;
    wx.navigateTo({ url: '/pages/demand-detail/demand-detail?id=' + demandId + '&from=parent' });
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/demand-create/demand-create' });
  }
});
