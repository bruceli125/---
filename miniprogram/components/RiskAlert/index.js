/**
 * RiskAlert —— 风险提示弹层（本项目自研，不依赖 Vant Weapp / TDesign）
 *
 * 用途：家长在「发布需求」提交前命中风险词时弹出，展示风险等级、命中词、避坑提示，
 *       高风险订单必须由用户显式确认后才允许继续提交（强提示）。
 *
 * 说明：弹层只负责展示与交互，真正的风险判定在 services/risk.js 与云函数 riskCheck 中完成，
 *       组件不做任何检测逻辑，保证「同一份结论只算一次」。
 *
 * 对外契约：
 *   properties: visible / level / title / hits / tips / confirmText / cancelText / showCancel
 *   events:     confirm({ level, hits }) | close()
 */
const { RISK_LEVEL_THEME, RISK_LEVEL } = require('../../utils/constants.js');

/** 各风险等级下的默认标题 */
const DEFAULT_TITLE = {
  high: '⚠️ 高风险提示：建议终止本次对接',
  medium: '⚠️ 中风险提示：请先核实再继续',
  low: '✅ 风险检测通过'
};

/** 最多渲染的提示条数，超出折叠为一行统计 */
const MAX_TIPS = 8;

Component({
  options: {
    multipleSlots: false
  },

  properties: {
    visible: { type: Boolean, value: false },
    /** low | medium | high */
    level: { type: String, value: RISK_LEVEL.MEDIUM },
    /** 不传则按等级自动生成 */
    title: { type: String, value: '' },
    /** [{ word, category, level, tip }] */
    hits: { type: Array, value: [] },
    /** 避坑提示文案数组 */
    tips: { type: Array, value: [] },
    confirmText: { type: String, value: '我已知晓，继续提交' },
    cancelText: { type: String, value: '取消' },
    showCancel: { type: Boolean, value: true }
  },

  data: {
    theme: RISK_LEVEL_THEME[RISK_LEVEL.MEDIUM],
    alertTitle: DEFAULT_TITLE.medium,
    hitList: [],
    hitCount: 0,
    tipList: [],
    tipCount: 0,
    moreTipCount: 0,
    /** 内容较少时让弹层自适应高度，避免出现大片空白 */
    bodyClass: 'ra-body'
  },

  observers: {
    'level, title, hits, tips': function () {
      this.refresh();
    }
  },

  lifetimes: {
    attached() {
      this.refresh();
    }
  },

  methods: {
    refresh() {
      const data = this.data;
      const level = data.level || RISK_LEVEL.MEDIUM;
      const theme = RISK_LEVEL_THEME[level] || RISK_LEVEL_THEME[RISK_LEVEL.MEDIUM];

      // 命中词：按自身 level 取色，让「高风险词」在弹层里也能一眼看出来
      const hitList = (data.hits || []).map((hit) => {
        const hitTheme =
          RISK_LEVEL_THEME[hit.level] || RISK_LEVEL_THEME[RISK_LEVEL.MEDIUM];
        return {
          word: hit.word,
          category: hit.category || '其他',
          tip: hit.tip || '',
          color: hitTheme.color,
          bg: hitTheme.bg
        };
      });

      const allTips = (data.tips || []).filter(Boolean);
      const tipList = allTips.slice(0, MAX_TIPS);

      this.setData({
        theme: theme,
        alertTitle: data.title || DEFAULT_TITLE[level] || DEFAULT_TITLE.medium,
        hitList: hitList,
        hitCount: hitList.length,
        tipList: tipList,
        tipCount: allTips.length,
        moreTipCount: Math.max(0, allTips.length - tipList.length),
        // 命中词 + 提示较少时用自适应高度（scroll-view 在固定高度下才稳定滚动）
        bodyClass: hitList.length + tipList.length <= 4 ? 'ra-body ra-body-auto' : 'ra-body'
      });
    },

    /** 空函数：仅用于 catchtouchmove 阻止弹层背后的页面滚动 */
    noop() {},

    onConfirm() {
      this.triggerEvent('confirm', { level: this.data.level, hits: this.data.hits });
    },

    onCancel() {
      this.triggerEvent('close', { reason: 'cancel' });
    },

    /** 点击遮罩视为取消 */
    onMaskTap() {
      this.triggerEvent('close', { reason: 'mask' });
    }
  }
});
