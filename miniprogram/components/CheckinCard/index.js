/**
 * CheckinCard —— 履约打卡记录卡片（二期）
 *
 * 展示一条打卡记录：打卡日期与时间段、时长、状态徽章、mock 定位、授课小结、家长确认状态。
 * 本组件只做展示与事件抛出，不做任何业务判断（确认/结束打卡都由页面调 api 完成）。
 *
 * 对外契约：
 *   properties: checkin(Object 必传) / role('parent'|'tutor') / showConfirm(Boolean) / showSummary(Boolean, 默认 true)
 *   events:     tap({checkinId}) / confirm({checkinId}) / finish({checkinId})
 *
 * mock 边界：定位一律来自记录里的 location（mock 定位），组件统一打「mock 定位」标签，
 *          不申请 scope.userLocation，也不假装做了真实到课校验。
 * 说明：本项目不引入 Vant / TDesign，组件自研，保证「导入开发者工具即可运行、无需构建 npm」。
 */
const { CHECKIN_STATUS_LABEL, CHECKIN_STATUS_THEME } = require('../../utils/constants.js');

/** 分钟 -> 「1 小时 45 分钟」/「45 分钟」；0 表示尚未结束 */
function toDurationText(min) {
  const m = Number(min || 0);
  if (!m || m < 0) return '';
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h && rest) return h + ' 小时 ' + rest + ' 分钟';
  if (h) return h + ' 小时';
  return rest + ' 分钟';
}

/** '2026-01-06 19:03' -> { date: '2026-01-06', time: '19:03' } */
function splitDateTime(value) {
  const str = String(value || '');
  if (str.length >= 16) {
    return { date: str.slice(0, 10), time: str.slice(11, 16) };
  }
  return { date: str, time: '' };
}

Component({
  options: {
    multipleSlots: false
  },

  properties: {
    /** 打卡记录（必传） */
    checkin: { type: Object, value: {} },
    /** 当前查看者身份：'parent' | 'tutor' */
    role: { type: String, value: 'tutor' },
    /** 是否显示「确认本次履约」按钮（还需 role==='parent' 且状态为待确认） */
    showConfirm: { type: Boolean, value: false },
    /** 是否展示授课小结 */
    showSummary: { type: Boolean, value: true }
  },

  data: {
    dateText: '',
    timeRangeText: '',
    durationText: '',
    statusLabel: '',
    statusColor: '#2B6DE5',
    statusBg: '#EAF1FF',
    locationName: '',
    locationAddress: '',
    isMockLocation: false,
    hasSummary: false,
    summaryText: '',
    confirmText: '',
    canConfirm: false,
    canFinish: false
  },

  observers: {
    'checkin, role, showConfirm, showSummary': function () {
      this.refresh();
    }
  },

  lifetimes: {
    attached() {
      // observers 在部分基础库下不会在初始化时触发，这里兜底刷新一次（幂等）
      this.refresh();
    }
  },

  methods: {
    /** 所有展示字段预计算进 data，WXML 里不写复杂表达式 */
    refresh() {
      const c = this.data.checkin || {};
      const status = c.status || 'checked_in';
      const theme = CHECKIN_STATUS_THEME[status] || CHECKIN_STATUS_THEME.checked_in;

      const start = splitDateTime(c.startAt);
      const end = splitDateTime(c.endAt);
      const timeRangeText = start.time
        ? start.time + ' — ' + (end.time || '进行中')
        : start.date + ' — ' + (end.time || '进行中');

      const loc = c.location || {};
      let locName = String(loc.name || '');
      if (locName && !/mock/.test(locName)) locName += '（mock 定位）';
      if (!locName) locName = '校内认证场地（mock 定位）';

      const summary = String(c.summary || '');
      const isParent = this.data.role === 'parent';
      const canConfirm = !!(this.data.showConfirm && isParent && status === 'finished');
      const canFinish = this.data.role === 'tutor' && status === 'checked_in';

      let confirmText = '';
      if (status === 'confirmed') {
        confirmText = '家长已确认履约' + (c.confirmedAt ? ' · ' + c.confirmedAt : '');
      } else if (status === 'finished') {
        confirmText = '小结已提交，等待家长确认';
      } else {
        confirmText = '打卡进行中，结束后请填写授课小结';
      }

      this.setData({
        dateText: start.date || '时间未知',
        timeRangeText: timeRangeText,
        durationText: toDurationText(c.durationMin),
        statusLabel: CHECKIN_STATUS_LABEL[status] || status,
        statusColor: theme.color,
        statusBg: theme.bg,
        locationName: locName,
        locationAddress: String(loc.address || ''),
        isMockLocation: loc.mock !== false,
        hasSummary: !!summary.trim(),
        summaryText: summary,
        confirmText: confirmText,
        canConfirm: canConfirm,
        canFinish: canFinish
      });
    },

    /** 点击卡片主体（页面可用于展开完整小结） */
    onTap() {
      const c = this.data.checkin || {};
      this.triggerEvent('tap', { checkinId: c.id || c._id || '' });
    },

    /** 家长确认本次履约（catchtap 防冒泡到 onTap） */
    onConfirm() {
      const c = this.data.checkin || {};
      this.triggerEvent('confirm', { checkinId: c.id || c._id || '' });
    },

    /** 学生结束打卡的快捷入口（页面负责聚焦小结输入框） */
    onFinish() {
      const c = this.data.checkin || {};
      this.triggerEvent('finish', { checkinId: c.id || c._id || '' });
    }
  }
});
