/**
 * CertBadge —— 认证徽章组件（本项目自研，不依赖 Vant Weapp / TDesign）
 *
 * 【为什么不用第三方组件库】
 * 本项目的最高优先级是「微信开发者工具导入后即可运行、无需 npm install / 构建 npm」。
 * 第三方组件库（Vant Weapp / TDesign MiniProgram）都需要额外的构建步骤，容易在评审现场失败，
 * 因此徽章、风险弹层、卡片全部自研；主题色统一使用 app.wxss 中定义的 CSS 变量
 * （CSS 自定义属性可以穿过组件样式隔离继承进来，因此仍然与全局主题保持一致）。
 *
 * 认证等级（与 utils/constants.js 的 CERT_LEVELS 对齐）：
 *   0 未认证 | 1 学籍已认证 | 2 双重认证 | 3 三重认证
 *
 * 对外契约：
 *   properties: level / name / school / major / grade / badgeNo / tags / abilityTags /
 *               verifiedAt / size / showDetail / clickable
 *   events:     tap -> { level }
 */
const { CERT_LEVELS } = require('../../utils/constants.js');

/** 各等级徽章的视觉主题 */
const LEVEL_META = {
  0: { label: '未认证', theme: 'gray', icon: '🛡', desc: '尚未提交认证材料' },
  1: { label: '学籍已认证', theme: 'blue', icon: '🛡', desc: '校园邮箱 / 学籍信息已校验' },
  2: { label: '双重认证', theme: 'deep', icon: '🛡', desc: '学籍认证 + 资质认证已通过' },
  3: { label: '三重认证', theme: 'green', icon: '✅', desc: '学籍 + 资质 + 能力认证全部通过' }
};

Component({
  options: {
    // 允许外部通过 class 覆盖外层样式，便于页面微调宽度
    addGlobalClass: false,
    multipleSlots: false
  },

  properties: {
    /** 0-3，0 未认证 */
    level: { type: Number, value: 0 },
    name: { type: String, value: '' },
    school: { type: String, value: '' },
    major: { type: String, value: '' },
    grade: { type: String, value: '' },
    /** 认证编号，如 JS-2026-000101 */
    badgeNo: { type: String, value: '' },
    /** 能力标签（兼容写法，优先级低于 abilityTags） */
    tags: { type: Array, value: [] },
    abilityTags: { type: Array, value: [] },
    verifiedAt: { type: String, value: '' },
    /** sm | md | lg */
    size: { type: String, value: 'md' },
    /** true 时渲染完整徽章卡片（详情页 / 报告页） */
    showDetail: { type: Boolean, value: false },
    /** true 时整卡可点并抛出 tap 事件 */
    clickable: { type: Boolean, value: false }
  },

  data: {
    meta: LEVEL_META[0],
    levelLabel: '未认证',
    levelDesc: '',
    schoolLine: '',
    tagList: [],
    verifiedText: '',
    showBadgeNo: false,
    sizeClass: 'size-md'
  },

  observers: {
    'level, name, school, major, grade, badgeNo, tags, abilityTags, verifiedAt, size, showDetail': function () {
      this.refresh();
    }
  },

  lifetimes: {
    attached() {
      // observers 在部分基础库版本下不会在初始化时触发，这里兜底刷新一次（幂等）
      this.refresh();
    }
  },

  methods: {
    /** 把所有需要在 WXML 里用到的展示字段预计算进 data（WXML 里不写复杂表达式） */
    refresh() {
      const data = this.data;
      const level = Number(data.level || 0);
      const meta = LEVEL_META[level] || LEVEL_META[0];
      const dict = CERT_LEVELS[level] || CERT_LEVELS[0];

      const schoolLine = [data.school, data.major, data.grade].filter(Boolean).join(' · ');

      const ability = data.abilityTags && data.abilityTags.length ? data.abilityTags : data.tags || [];
      const tagList = (ability || []).filter(Boolean).slice(0, 6);

      const size = data.size === 'sm' || data.size === 'lg' ? data.size : 'md';

      this.setData({
        meta: meta,
        levelLabel: dict.label || meta.label,
        levelDesc: meta.desc,
        schoolLine: schoolLine,
        tagList: tagList,
        verifiedText: data.verifiedAt ? '认证时间 ' + data.verifiedAt : '',
        // sm 尺寸下空间有限，认证编号只在 md / lg 的胶囊里直接展示
        showBadgeNo: !!data.badgeNo && size !== 'sm',
        sizeClass: 'size-' + size
      });
    },

    onTap() {
      if (!this.data.clickable) return;
      this.triggerEvent('tap', { level: this.data.level });
    },

    /** 点击认证编号复制（家长核验时可粘贴到平台核验入口） */
    onCopyBadgeNo() {
      const no = this.data.badgeNo;
      if (!no) return;
      wx.setClipboardData({
        data: no,
        success: () => {
          wx.showToast({ title: '认证编号已复制', icon: 'none' });
        },
        // 写入剪贴板属于隐私接口：用户在隐私弹窗中拒绝后会走 fail，
        // 这里必须给出可执行的提示，否则按钮点了没反应（详见 README 隐私声明一节）
        fail: () => {
          wx.showToast({ title: '复制失败，请确认已同意隐私授权', icon: 'none' });
        }
      });
    }
  }
});
