/**
 * PlatformNotice —— 平台定位声明组件（合规红线要求）
 *
 * 【为什么必须存在】
 * 「本平台仅为个人零星家教信息撮合，非培训机构，不提供固定办学场所」这句话
 * 是应对"是否在办学科类培训机构"质疑的核心声明，要求出现在**所有页面底部**。
 * 通过 app.json 的全局 usingComponents 注册，页面只需写一行 <platform-notice />。
 *
 * 用法：
 *   <platform-notice />                 底部紧凑版（默认）
 *   <platform-notice mode="full" />     完整版（含长文案，用于我的/报告页）
 *   <platform-notice mode="inline" />   内联在内容流中（不贴底）
 *
 * 点击可展开完整声明 + 与本平台性质相关的三条边界说明。
 * 本项目不引入 Vant / TDesign：组件全部自研，保证"导入开发者工具即可运行、无需构建 npm"。
 */
const { PLATFORM_POSITION, PLATFORM_POSITION_LONG, DISCLAIMER, APP_INFO } = require('../../utils/constants.js');

Component({
  options: {
    multipleSlots: false,
    addGlobalClass: false
  },

  properties: {
    /** compact（默认，底部一行） | full（完整段落） | inline（内容流中） */
    mode: { type: String, value: 'compact' },
    /** 是否显示「查看完整声明」入口 */
    showMore: { type: Boolean, value: true }
  },

  data: {
    position: PLATFORM_POSITION,
    positionLong: PLATFORM_POSITION_LONG,
    boundaries: [],
    brand: APP_INFO.shortName
  },

  lifetimes: {
    attached() {
      this.setData({
        boundaries: [
          '非培训机构：平台不设教室、不排课、不组织集体授课，只做信息撮合。',
          '非办学场所：平台不提供固定办学场地，授课地点由家长与学生自行约定（建议线上或校内认证场地）。',
          '非学科类培训组织者：平台不组织、不安排任何形式的学科类培训，休息日学科类需求会被直接拦截。'
        ]
      });
    }
  },

  methods: {
    onTap() {
      if (!this.data.showMore) return;
      const short = DISCLAIMER.short;
      wx.showModal({
        title: '平台性质声明',
        content:
          this.data.positionLong +
          '\n\n【边界说明】\n' +
          this.data.boundaries.join('\n') +
          '\n\n【免责】' +
          short,
        showCancel: false,
        confirmText: '我知道了'
      });
    }
  }
});
