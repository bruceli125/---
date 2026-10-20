/**
 * DemandCard —— 家教需求卡片（二期升级：右上角状态角标 / 五项标签 / 学科类标记 / 已成单与打卡）
 *
 * 用途：需求列表页、我的需求、以及师范生「接单池」（此时传 score + reasons + showApply）。
 *
 * 对外契约（一期属性全部保留，向后兼容，只新增两个可选属性）：
 *   properties: demand / showRisk / showStatus / score / reasons / showApply / applyText /
 *               applied / showMeta
 *   新增：showCheckinBadge(Boolean) —— 由父组件传入「今日是否已打卡」，组件内不请求接口
 *         orderHint(String)        —— 订单进度提示文案（如「已投递，等待家长确认」）
 *   events:     tap({ demandId, demand }) | apply({ demandId, demand })
 *
 * 实现要点：
 * 1. 状态改为右上角绝对定位角标（招募中=绿 / 匹配中=蓝 / 已匹配=紫），标题行预留右内边距避免被遮挡；
 * 2. 根节点用 catchtap 而非 bindtap —— 原生 tap 会穿过自定义组件边界冒泡到页面，
 *    与组件 triggerEvent('tap') 一起导致页面重复压栈（一期在需求列表页出现过），catchtap 可阻止原生冒泡，
 *    页面只收到一次自定义 tap 事件；
 * 3. 组件样式隔离，app.wxss 的 .ellipsis-2 等全局类在组件内不生效，所以文本截断全部写在本文件 wxss 里；
 * 4. 本项目不引入 Vant / TDesign，保证「导入开发者工具即可运行、无需构建 npm」。
 */
const {
  DEMAND_STATUS_LABEL,
  RISK_LEVEL,
  TEACH_MODES
} = require('../../utils/constants.js');
const {
  formatBudget,
  timeRangeLabel,
  frequencyLabel,
  teachModeLabel,
  districtLabel,
  formatDistance,
  timeAgo,
  truncate,
  round
} = require('../../utils/format.js');

/** 需求状态 -> 右上角角标配色（招募中=绿 / 匹配中=蓝 / 已匹配=紫） */
const CORNER_CLASS = {
  draft: 'cn-gray',
  published: 'cn-green',
  matching: 'cn-blue',
  matched: 'cn-purple',
  closed: 'cn-gray',
  risk_blocked: 'cn-red'
};

/** 学科类 / 素质拓展 标记（双减合规提示：学科类受休息日限制） */
const GROUP_TAG = {
  discipline: { text: '学科类', className: 'dc-group-discipline' },
  quality: { text: '素质拓展', className: 'dc-group-quality' }
};

/** 授课方式图标（优先取字典里的 icon） */
function modeIcon(mode) {
  for (let i = 0; i < TEACH_MODES.length; i++) {
    if (TEACH_MODES[i].value === mode) return TEACH_MODES[i].icon;
  }
  return '📍';
}

Component({
  properties: {
    demand: { type: Object, value: null },
    showRisk: { type: Boolean, value: true },
    showStatus: { type: Boolean, value: true },
    /** 传 >0 时显示「匹配度 N 分」 */
    score: { type: Number, value: 0 },
    reasons: { type: Array, value: [] },
    showApply: { type: Boolean, value: false },
    applyText: { type: String, value: '申请接单' },
    applied: { type: Boolean, value: false },
    /** 是否显示「N 人已申请 / N 次浏览」 */
    showMeta: { type: Boolean, value: true },
    /** 新增：今日是否已打卡（父组件传入，组件不请求接口） */
    showCheckinBadge: { type: Boolean, value: false },
    /** 新增：订单进度提示（非空时展示一行浅蓝提示） */
    orderHint: { type: String, value: '' }
  },

  data: {
    titleText: '待完善需求',
    statusText: '',
    cornerClass: 'cn-gray',
    groupTag: { text: '', className: '' },
    showMatchedLine: false,
    matchedText: '',
    showCheckin: false,
    checkinText: '今日已打卡',
    hintText: '',
    tagList: [],
    addressText: '',
    specialText: '',
    showRiskTag: false,
    riskText: '',
    riskClass: '',
    riskWordList: [],
    createdAtText: '',
    metaText: '',
    hasScore: false,
    scoreText: '',
    reasonList: [],
    applyBtnText: '申请接单',
    applyDisabled: false,
    showApplyBtn: false,
    distanceText: ''
  },

  observers: {
    'demand, showRisk, showStatus, score, reasons, applied, applyText, showMeta, showCheckinBadge, orderHint': function () {
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
      const demand = data.demand || {};

      const status = demand.status || 'published';
      const riskLevel = demand.riskLevel || RISK_LEVEL.LOW;

      /* 时间段：优先用已有文案，否则用字典拼接数组 */
      let timeText = demand.timeRangeText || '';
      if (!timeText && demand.timeRange && demand.timeRange.length) {
        timeText = demand.timeRange
          .map(function (v) {
            return timeRangeLabel(v);
          })
          .join(' / ');
      }

      /* 五项标签：每周频次 / 时间段 / 授课方式 / 区域 / 薪资（薪资橙色加粗，不写「价格」） */
      const salaryText = formatBudget(demand.budgetMin, demand.budgetMax || demand.budget);
      const tagList = [
        { key: 'frequency', icon: '🔁', text: frequencyLabel(demand.frequency), className: '' },
        { key: 'time', icon: '🕘', text: timeText || '时间面议', className: '' },
        { key: 'mode', icon: modeIcon(demand.teachMode), text: teachModeLabel(demand.teachMode), className: '' },
        { key: 'district', icon: '🗺', text: districtLabel(demand.district), className: '' },
        { key: 'salary', icon: '💰', text: '薪资 ' + salaryText, className: 'dc-tag-salary' }
      ].filter(function (t) {
        return !!t.text;
      });

      const hits = demand.riskHits || [];
      const showRiskTag = !!data.showRisk && riskLevel !== RISK_LEVEL.LOW;
      const isHigh = riskLevel === RISK_LEVEL.HIGH;

      const reasons = Array.isArray(data.reasons) ? data.reasons.filter(Boolean) : [];
      const score = Number(data.score || 0);
      const applied = !!data.applied;
      const isMatched = status === 'matched';

      /* 已成单提示行 + 成交时间 */
      let matchedText = '';
      if (isMatched) {
        matchedText = demand.acceptedAt
          ? '已成单 · 成交时间 ' + demand.acceptedAt
          : '已成单 · 家长已确认该订单';
      }

      const group = GROUP_TAG[demand.isDiscipline] || GROUP_TAG[demand.subjectGroup] || { text: '', className: '' };

      this.setData({
        titleText: (demand.grade || '') + (demand.subject || '') || '待完善需求',
        statusText: DEMAND_STATUS_LABEL[status] || '招募中',
        cornerClass: CORNER_CLASS[status] || 'cn-gray',
        groupTag: group,
        showMatchedLine: isMatched,
        matchedText: matchedText,
        showCheckin: !!data.showCheckinBadge,
        checkinText: '今日已打卡',
        hintText: String(data.orderHint || '').trim(),
        tagList: tagList,
        addressText: demand.address || '地点面议',
        specialText: truncate(demand.specialRequirements || '', 60) || '家长未填写特殊要求',
        showRiskTag: showRiskTag,
        riskText: isHigh ? '⚠️ 高风险需求' : '⚠️ 中风险需求',
        riskClass: isHigh ? 'risk-high' : 'risk-medium',
        /* 高风险需求额外展示命中的风险词前 3 个，帮助师范生快速识别 */
        riskWordList: showRiskTag
          ? hits.slice(0, 3).map(function (h) {
              return h.word;
            })
          : [],
        createdAtText: timeAgo(demand.createdAt),
        metaText:
          String(demand.applyCount || 0) + ' 人已申请 · ' + String(demand.viewCount || 0) + ' 次浏览',
        hasScore: score > 0,
        scoreText: '匹配度 ' + round(score, 1) + ' 分',
        reasonList: reasons.slice(0, 3),
        applyBtnText: applied ? '已申请' : data.applyText || '申请接单',
        applyDisabled: applied,
        /* 已成单的订单不再展示申请按钮（避免对已成交订单重复投递） */
        showApplyBtn: !!data.showApply && !isMatched,
        distanceText: typeof demand.distanceKm === 'number' ? formatDistance(demand.distanceKm) : ''
      });
    },

    onTap() {
      this.triggerEvent('tap', {
        demandId: this.data.demand && this.data.demand.id,
        demand: this.data.demand
      });
    },

    onApply() {
      if (this.data.applyDisabled) return;
      this.triggerEvent('apply', {
        demandId: this.data.demand && this.data.demand.id,
        demand: this.data.demand
      });
    }
  }
});
