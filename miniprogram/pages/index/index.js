/**
 * 首页 / 角色选择
 *
 * 【UI 组件库说明】本项目刻意不引入 Vant Weapp / TDesign：
 * MVP 验收要求「用微信开发者工具导入后即可运行、无需构建 npm」，
 * 因此全部界面由自研原生组件（components/*）+ app.wxss 全局类实现。
 * TODO(二期)：若确需更丰富的交互组件（Calendar / Uploader / Steps 等），
 *            可切换 TDesign MiniProgram：npm i tdesign-miniprogram + 工具「构建 npm」。
 *
 * 页面职责：
 * 1. 展示平台定位（首师大师范生 · 认证可查 · 试课不满意可换）与信任点；
 * 2. 角色选择：家长 / 师范生，写入 app.setRole 并缓存到本地；
 * 3. 按角色给出功能入口（接单池、我的均为 tabBar 页面，必须用 wx.switchTab）；
 * 4. 底部固定展示免责声明（合规硬性要求）。
 */
const api = require('../../services/api.js');
const { APP_INFO, ROLES, TRUST_POINTS, DISCLAIMER } = require('../../utils/constants.js');

const app = getApp();

Page({
  data: {
    brand: {
      name: APP_INFO.name,
      slogan: APP_INFO.slogan,
      desc: '高校主导的家教可信对接平台，连接家长 / 机构与首师大师范生',
      version: APP_INFO.version
    },
    coreAbility: '核心能力：可靠度认证 · 智能匹配 · 风险过滤',
    trustPoints: TRUST_POINTS,
    roleCards: [
      {
        value: ROLES.PARENT,
        icon: '👨‍👩‍👧',
        title: '我是家长',
        sub: '我要找家教',
        desc: '发布需求 · 智能匹配 Top3 · 对接报告'
      },
      {
        value: ROLES.TUTOR,
        icon: '🎓',
        title: '我是师范生',
        sub: '我要接单',
        desc: '三重认证 · 认证徽章 · 接单池'
      }
    ],
    role: '',
    roleLabel: '未选择',
    isCloud: false,
    stats: { demandCount: 0, publishedCount: 0, reportCount: 0, riskCount: 0 },
    disclaimerShort: DISCLAIMER.short,
    disclaimerItems: ['非学历培训', '非办学资质', '非医疗建议'],
    minorTip: '未成年人线下上课需监护人知情，建议优先线上授课或校内认证场地。',
    loading: true
  },

  onLoad() {
    this.setData({ isCloud: api.isCloud() });
    this.refresh();
  },

  onShow() {
    // 从其它页面返回时同步角色与统计
    this.refresh();
  },

  onShareAppMessage() {
    return {
      title: APP_INFO.name + '｜' + APP_INFO.slogan,
      path: '/pages/index/index'
    };
  },

  /** 同步角色 + 登录 + 统计 */
  refresh() {
    const role = app.getRole();
    this.setData({
      role: role,
      roleLabel: role === ROLES.TUTOR ? '首师大师范生' : role === ROLES.PARENT ? '家长 / 机构' : '未选择'
    });
    return app
      .ensureLogin()
      .catch((err) => {
        // 登录失败不阻塞演示：mock 模式下数据仍可读写
        console.warn('[index] 登录失败（不影响 mock 演示）：', err);
      })
      .then(() => this.loadStats());
  },

  /** 家长侧统计（需求 / 报告 / 风险需求） */
  loadStats() {
    const user = (app.globalData && app.globalData.userInfo) || {};
    return api.getParentStats(user.parentId || '').then((res) => {
      if (res && res.code === 0 && res.data) {
        this.setData({ stats: res.data, loading: false });
      } else {
        this.setData({ loading: false });
      }
    });
  },

  /** 选择角色 */
  onSelectRole(e) {
    const role = e.currentTarget.dataset.role;
    if (!role || role === this.data.role) return;
    const next = app.setRole(role);
    this.setData({
      role: next,
      roleLabel: next === ROLES.TUTOR ? '首师大师范生' : '家长 / 机构'
    });
    app.toast(next === ROLES.TUTOR ? '已选择：我是师范生' : '已选择：我是家长', 'success');
    this.loadStats();
  },

  /* ---------- 家长入口 ---------- */

  goCreateDemand() {
    wx.navigateTo({ url: '/pages/demand-create/demand-create' });
  },

  goDemandList() {
    wx.navigateTo({ url: '/pages/demand-list/demand-list' });
  },

  /** LIGHTCORE PRISM 设计系统说明页 */
  goUiKit() {
    wx.navigateTo({ url: '/pages/ui-kit/ui-kit' });
  },

  /* ---------- 师范生入口 ---------- */

  goTutorVerify() {
    wx.navigateTo({ url: '/pages/tutor-verify/tutor-verify' });
  },

  /** 接单池是 tabBar 页面，必须用 switchTab；navigateTo 会直接失败 */
  goTutorPool() {
    wx.switchTab({ url: '/pages/tutor-pool/tutor-pool' });
  },

  /* ---------- 演示数据 ---------- */

  onResetMock() {
    wx.showModal({
      title: '重置演示数据',
      content: '将清空本地发布的需求、匹配结果、对接报告与认证记录，并恢复初始 mock 数据。是否继续？',
      confirmText: '重置',
      confirmColor: '#F04438',
      success: (res) => {
        if (!res.confirm) return;
        // api.resetMockData 与其它接口一致返回 Promise
        api.resetMockData().then((result) => {
          app.toast(
            (result && result.message) || '演示数据已重置',
            result && result.code === 0 ? 'success' : 'none'
          );
          this.refresh();
        });
      }
    });
  }
});
