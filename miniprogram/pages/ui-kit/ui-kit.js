/**
 * LIGHTCORE PRISM · UI 设计系统（浅色模式）
 * 本页把设计规范落成"可点、可看、可验收"的页面：
 *   色彩 / 棱镜渐变 / 排版 / 图标 / 按钮六态 / 导航 / 组件 / 网页与应用模型
 * 说明：这里同时是全站视觉基准——新增页面应复用这些令牌与类名，而不是自造样式。
 */
const Icons = require('../../utils/icons.js');
const { APP_INFO } = require('../../utils/constants.js');

Page({
  data: {
    brand: { name: 'LIGHTCORE PRISM', sub: 'UI 设计系统 · 浅色模式', version: APP_INFO.version },
    tags: ['未来感', '高级感', '专注'],

    /* 色彩 */
    colors: [
      { name: '白色', hex: '#FFFFFF', note: '卡片' },
      { name: '雪色', hex: '#FAFAFC', note: '页面底' },
      { name: '板岩色', hex: '#F2F4F8', note: '分区' },
      { name: '边框色', hex: '#E6E8EF', note: '描边' },
      { name: '墨色', hex: '#0A0A0C', note: '文字' }
    ],

    /* 棱镜渐变 */
    prismStops: ['#FFB27A', '#FFD166', '#6FE3E1', '#A78BFA', '#FF9EC4'],

    /* 排版 */
    typeScale: [
      { label: 'Light', weight: 300, size: 34 },
      { label: 'Regular', weight: 400, size: 34 },
      { label: 'Medium', weight: 500, size: 34 },
      { label: 'Semibold', weight: 600, size: 34 }
    ],
    alphabet: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789',

    /* 图标（utils/icons.js 生成的 base64 SVG） */
    icons: Icons.list,

    /* 按钮 */
    primaryText: '开始使用',

    /* 导航 */
    navLinks: ['产品', '方案', '文档', '价格'],

    /* 组件 */
    tabs: ['概览', '分析', '设置'],
    activeTab: 0,
    switches: [
      { key: 'smart', label: '智能匹配', desc: '按匹配度自动排序推荐', on: true },
      { key: 'risk', label: '风险强提示', desc: '命中风险词时二次确认', on: false }
    ],
    progress: 68,
    /* 环形图：3 段（紫 / 青 / 琥珀） */
    donutLegend: [
      { label: '三重认证', value: 54, color: '#A78BFA' },
      { label: '双重认证', value: 31, color: '#6FE3E1' },
      { label: '学籍认证', value: 15, color: '#FFD166' }
    ],
    /* 7 天折线（用柱形表达，小程序内零依赖且清晰） */
    week: [
      { label: '一', value: 38 },
      { label: '二', value: 52 },
      { label: '三', value: 44 },
      { label: '四', value: 66 },
      { label: '五', value: 78 },
      { label: '六', value: 30 },
      { label: '日', value: 26 }
    ],
    barHeight: 120,

    /* 移动应用模型 */
    quickActions: [
      { icon: 'chart', label: '分析' },
      { icon: 'shield', label: '认证' },
      { icon: 'bell', label: '消息' },
      { icon: 'settings', label: '设置' }
    ],
    activities: [
      { title: '林嘉怡 · 三重认证通过', meta: '2 分钟前', tag: '认证' },
      { title: 'DEM-0184 生成对接报告', meta: '23 分钟前', tag: '匹配' },
      { title: 'DEM-0180 触发双减红线', meta: '41 分钟前', tag: '拦截' }
    ]
  },

  onLoad() {
    // 预计算柱形高度（WXML 不写复杂表达式）
    const max = Math.max.apply(
      null,
      this.data.week.map(function (d) {
        return d.value;
      })
    );
    this.setData({
      week: this.data.week.map(function (d) {
        return Object.assign({}, d, { h: Math.max(8, Math.round((d.value / max) * 120)) });
      })
    });
  },

  onTab(e) {
    this.setData({ activeTab: Number(e.currentTarget.dataset.index) });
    wx.vibrateShort && wx.vibrateShort({ type: 'light' });
  },

  onToggle(e) {
    const key = e.currentTarget.dataset.key;
    const list = this.data.switches.map(function (s) {
      return s.key === key ? Object.assign({}, s, { on: !s.on }) : s;
    });
    this.setData({ switches: list });
  },

  onDemo(e) {
    const label = e.currentTarget.dataset.label || '按钮';
    wx.showToast({ title: label + ' · 已触发', icon: 'none' });
  },

  onBack() {
    wx.navigateBack({ delta: 1 });
  },

  onShareAppMessage() {
    return {
      title: 'LIGHTCORE PRISM · 京师家教 UI 设计系统',
      path: '/pages/ui-kit/ui-kit'
    };
  }
});
