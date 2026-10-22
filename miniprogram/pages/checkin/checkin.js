/**
 * 履约打卡页（二期）
 *
 * 参数：demandId（必填）、role（'tutor' | 'parent'，默认 tutor）
 *
 * 数据来源：只通过 services/api.js（内部走本地 mock + storage，二期接口由 phase2.js 挂载）。
 *   api.getDemandDetail / api.getCheckins / api.canCheckin(同步) / api.startCheckin /
 *   api.finishCheckin / api.confirmCheckin
 *
 * 闭环：学生「上课打卡」→ 下课「结束打卡 + 授课小结(≥10字)」→ 家长「确认本次履约」。
 * mock 边界：定位为 MOCK_CHECKIN_LOCATION（界面统一标注「mock 定位」），不采集真实位置；
 *           资金担保与课时费结算为二期规划，本页不涉及任何支付。
 *
 * TODO(二期+)：接入真实定位 / 校内场地信标做真实到课校验；打卡数据上云（checkins 集合）。
 */
const api = require('../../services/api.js');
const fmt = require('../../utils/format.js');
const C = require('../../utils/constants.js');

/** 授课小结字数限制（与 phase2.finishCheckin 的校验保持一致） */
const SUMMARY_MIN = 10;
const SUMMARY_MAX = 500;

const BTN_PRIMARY = 'btn btn-primary mt-16';
const BTN_GREEN = 'btn btn-green mt-16';
const BTN_DISABLED_SUFFIX = ' btn-disabled';

function toast(title, icon) {
  wx.showToast({ title: title || '', icon: icon || 'none', duration: 1800 });
}

/** 分钟 -> 「3 小时 15 分钟」 */
function minutesText(total) {
  const m = Number(total || 0);
  if (!m) return '0 分钟';
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h && rest) return h + ' 小时 ' + rest + ' 分钟';
  if (h) return h + ' 小时';
  return rest + ' 分钟';
}

/** 打卡进行中的实时计时提示 */
function elapsedText(startAt) {
  const start = fmt.toTimestamp(startAt);
  if (!start) return '已开始';
  const diff = Date.now() - start;
  if (diff < 0) return '刚刚开始';
  const totalSec = Math.floor(diff / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h) return '已进行 ' + h + ' 小时 ' + m + ' 分钟';
  if (m) return '已进行 ' + m + ' 分 ' + s + ' 秒';
  return '已进行 ' + s + ' 秒';
}

Page({
  data: {
    /* 参数 */
    demandId: '',
    role: 'tutor',
    isTutor: true,
    isParent: false,

    /* 状态 */
    loading: true,
    notFound: false,
    errorMsg: '',
    starting: false,
    submitting: false,

    /* 订单摘要 */
    demand: null,
    orderTitle: '',
    orderRows: [],
    statusLabel: '',

    /* 记录与统计 */
    list: [],
    statsCards: [],
    emptyText: '',

    /* 打卡入口 */
    canCheckin: false,
    canStart: false,
    blockedReason: '',
    activeCheckin: null,
    activeStartText: '',
    activeLocationText: '',
    activeElapsedText: '',

    /* 小结 */
    summary: '',
    summaryLen: 0,
    summaryMin: SUMMARY_MIN,
    summaryMax: SUMMARY_MAX,
    summaryPlaceholder: C.FULFILLMENT.summaryPlaceholder,
    canSubmitSummary: false,
    summaryFocus: false,

    /* 按钮（文案与样式预计算，WXML 里不写表达式） */
    startBtnText: C.FULFILLMENT.checkinTitle,
    startBtnClass: BTN_PRIMARY,
    submitBtnText: '结束打卡并提交小结',
    submitBtnClass: BTN_GREEN + BTN_DISABLED_SUFFIX,

    /* 文案 */
    checkinTitle: C.FULFILLMENT.checkinTitle,
    checkinDesc: C.FULFILLMENT.checkinDesc,
    evidenceNote:
      '打卡记录是履约凭证，可作为课时费争议时的证据留存（资金担保与结算为二期规划，本页不涉及任何支付）。'
  },

  onLoad(options) {
    const query = options || {};
    const demandId = query.demandId || '';
    const role = query.role === 'parent' ? 'parent' : 'tutor';

    this.setData({
      demandId: demandId,
      role: role,
      isTutor: role === 'tutor',
      isParent: role === 'parent'
    });

    if (!demandId) {
      this.setData({
        loading: false,
        notFound: true,
        errorMsg: '缺少订单参数（demandId），请从订单详情页进入。'
      });
      return;
    }
    this.load();
  },

  onShow() {
    // 首次进入由 onLoad 负责加载；从其它页面返回时刷新
    if (this._shownOnce && this.data.demandId) this.load();
    this._shownOnce = true;
  },

  onHide() {
    this.stopTimer();
  },

  onUnload() {
    this.stopTimer();
  },

  onShareAppMessage() {
    return {
      title: '履约打卡 · 上课记录可追溯',
      path: '/pages/checkin/checkin?demandId=' + this.data.demandId + '&role=' + this.data.role
    };
  },

  /* ================================================================
   * 一、加载
   * ================================================================ */

  load() {
    const self = this;
    if (!this._loadedOnce) this.setData({ loading: true });

    return api
      .getDemandDetail(this.data.demandId)
      .then(function (res) {
        if (!res || res.code !== 0) {
          self.stopTimer();
          self.setData({
            loading: false,
            notFound: true,
            errorMsg: (res && res.message) || '订单不存在或已删除'
          });
          return null;
        }
        self.applyDemand(res.data);
        return api.getCheckins({ demandId: self.data.demandId }).then(function (cRes) {
          if (!cRes || cRes.code !== 0) {
            self.setData({ loading: false });
            toast((cRes && cRes.message) || '打卡记录加载失败');
            return null;
          }
          self.applyCheckins(cRes.data);
          self._loadedOnce = true;
          self.setData({ loading: false });
          return cRes.data;
        });
      })
      .catch(function (err) {
        console.error('[checkin] 加载失败：', err);
        self.stopTimer();
        self.setData({ loading: false, notFound: true, errorMsg: '加载失败，请返回重试' });
      });
  },

  /** 订单摘要（全部展示字段在此预计算） */
  applyDemand(demand) {
    const d = demand || {};
    const placeText =
      (d.teachMode === 'online'
        ? '线上授课（无需上门）'
        : (fmt.districtLabel(d.district) + ' ' + (d.address || '')).trim()) || '地点面议';

    const rows = [
      { label: '辅导科目', value: fmt.subjectLabel(d.subject) + ' · ' + (d.grade || '年级面议') },
      { label: '家长', value: d.parentName || '家长' },
      { label: '上课时间', value: d.timeRangeText || '时间面议' },
      { label: '授课方式', value: fmt.teachModeLabel(d.teachMode) },
      { label: '上课地点', value: placeText },
      { label: '课时费', value: fmt.formatBudget(d.budgetMin, d.budgetMax) }
    ];

    this.setData({
      demand: d,
      orderTitle: (d.grade || '') + (fmt.subjectLabel(d.subject) || '家教需求'),
      statusLabel: C.DEMAND_STATUS_LABEL[d.status] || '状态未知',
      orderRows: rows
    });
  },

  /** 打卡记录 + 统计 + 进行中状态 */
  applyCheckins(data) {
    const payload = data || {};
    const list = payload.list || [];
    const stats = payload.stats || {};
    const demand = this.data.demand || {};

    const active =
      list.filter(function (c) {
        return c.status === C.CHECKIN_STATUS.CHECKED_IN;
      })[0] || null;

    const tutorId = this.resolveTutorId();
    const canCheckin = !!api.canCheckin(demand, tutorId);

    // 区分两种「不能打卡」：未成单 / 已成单但不是本人
    const hasMatched = demand.status === C.DEMAND_STATUS.MATCHED && !!demand.matchedTutorId;
    const isMatchedTutor = !tutorId || demand.matchedTutorId === tutorId;
    let blockedReason = '';
    if (!hasMatched) {
      blockedReason = '该订单尚未成单。家长确认成单后，你才能开始上课打卡。';
    } else if (!isMatchedTutor) {
      blockedReason = '该订单已由其他学生接单，你无法为其打卡。';
    } else {
      blockedReason = '当前订单状态不支持打卡。';
    }

    const statsCards = [
      { label: '累计打卡', value: String(stats.count || 0) + ' 次' },
      { label: '累计时长', value: minutesText(stats.totalMinutes) },
      { label: '待家长确认', value: String(stats.pendingCount || 0) + ' 次' },
      { label: '已确认', value: String(stats.confirmedCount || 0) + ' 次' }
    ];

    let activeStartText = '';
    let activeLocationText = '';
    if (active) {
      const loc = active.location || {};
      activeStartText = active.startAt || '';
      activeLocationText =
        (loc.name || '校内认证场地') + (loc.address ? '（' + loc.address + '）' : '') + ' · mock 定位';
    }

    this.setData({
      list: list,
      statsCards: statsCards,
      canCheckin: canCheckin,
      canStart: this.data.isTutor && canCheckin && !active,
      blockedReason: blockedReason,
      activeCheckin: active,
      activeStartText: activeStartText,
      activeLocationText: activeLocationText,
      emptyText: this.data.isParent
        ? '学生还没有提交打卡记录，待其打卡后在此查看履约凭证。'
        : '还没有打卡记录，上课后点「上课打卡」开始记录。'
    });

    if (active) {
      this.startTimer(active.startAt);
    } else {
      this.stopTimer();
      this.setData({ activeElapsedText: '' });
    }
    this.refreshSubmitBtn();
  },

  /** 当前学生 id：优先登录态，其次订单成单人（演示环境兜底） */
  resolveTutorId() {
    const app = getApp();
    const fromApp = (app && app.globalData && app.globalData.tutorProfileId) || '';
    const demand = this.data.demand || {};
    return fromApp || demand.matchedTutorId || 'tutor_001';
  },

  /** 小结提交按钮的可用态与样式（预计算，避免 WXML 里写条件表达式） */
  refreshSubmitBtn() {
    const enabled = !!this.data.canSubmitSummary && !this.data.submitting;
    let text = '结束打卡并提交小结';
    if (this.data.submitting) text = '提交中…';
    else if (!this.data.canSubmitSummary) {
      text = '结束打卡并提交小结（至少 ' + SUMMARY_MIN + ' 字）';
    }
    this.setData({
      submitBtnText: text,
      submitBtnClass: BTN_GREEN + (enabled ? '' : BTN_DISABLED_SUFFIX)
    });
  },

  /* ================================================================
   * 二、计时器（打卡进行中时每秒刷新）
   * ================================================================ */

  startTimer(startAt) {
    const self = this;
    this.stopTimer();
    const tick = function () {
      self.setData({ activeElapsedText: elapsedText(startAt) });
    };
    tick();
    this._timer = setInterval(tick, 1000);
  },

  stopTimer() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  },

  /* ================================================================
   * 三、交互
   * ================================================================ */

  /** 上课打卡 */
  onStartCheckin() {
    const self = this;
    if (this.data.starting) return;
    if (!this.data.canStart) {
      toast(this.data.blockedReason || '当前不可打卡');
      return;
    }
    this.setData({ starting: true, startBtnText: '打卡中…', startBtnClass: BTN_PRIMARY + BTN_DISABLED_SUFFIX });

    api
      .startCheckin({ demandId: this.data.demandId, tutorId: this.resolveTutorId() })
      .then(function (res) {
        self.setData({ starting: false, startBtnText: C.FULFILLMENT.checkinTitle, startBtnClass: BTN_PRIMARY });
        if (!res || res.code !== 0) {
          toast((res && res.message) || '打卡失败，请重试');
          return;
        }
        const duplicated = !!(res.data && res.data.duplicated);
        toast(
          duplicated ? '本次打卡已在进行中' : '打卡成功，下课时请填写授课小结',
          duplicated ? 'none' : 'success'
        );
        self.load();
      })
      .catch(function (err) {
        console.error('[checkin] 打卡失败：', err);
        self.setData({ starting: false, startBtnText: C.FULFILLMENT.checkinTitle, startBtnClass: BTN_PRIMARY });
        toast('打卡失败，请重试');
      });
  },

  onSummaryInput(e) {
    const value = (e && e.detail && e.detail.value) || '';
    this.setData(
      {
        summary: value,
        summaryLen: value.length,
        canSubmitSummary: value.trim().length >= SUMMARY_MIN
      },
      this.refreshSubmitBtn
    );
  },

  /** 结束打卡并提交小结 */
  onFinishCheckin() {
    const self = this;
    if (this.data.submitting) return;
    const active = this.data.activeCheckin;
    if (!active) {
      toast('当前没有进行中的打卡');
      return;
    }
    const summary = String(this.data.summary || '').trim();
    if (summary.length < SUMMARY_MIN) {
      toast('授课小结请至少填写 ' + SUMMARY_MIN + ' 个字，家长需要据此确认');
      return;
    }
    if (summary.length > SUMMARY_MAX) {
      toast('授课小结请控制在 ' + SUMMARY_MAX + ' 字以内');
      return;
    }

    this.setData({ submitting: true });
    this.refreshSubmitBtn();

    api
      .finishCheckin({ checkinId: active.id || active._id, summary: summary })
      .then(function (res) {
        self.setData({
          submitting: false,
          summary: '',
          summaryLen: 0,
          canSubmitSummary: false,
          summaryFocus: false
        });
        self.refreshSubmitBtn();
        if (!res || res.code !== 0) {
          toast((res && res.message) || '提交失败，请重试');
          return;
        }
        toast('小结已提交，等待家长确认', 'success');
        self.load();
      })
      .catch(function (err) {
        console.error('[checkin] 提交小结失败：', err);
        self.setData({ submitting: false });
        self.refreshSubmitBtn();
        toast('提交失败，请重试');
      });
  },

  /** 家长确认本次履约 */
  onConfirmCheckin(e) {
    const self = this;
    const checkinId = (e && e.detail && e.detail.checkinId) || '';
    if (!checkinId) return;

    wx.showModal({
      title: '确认本次履约',
      content: '确认后该次打卡将标记为「家长已确认」，作为课时费结算的履约凭证。是否确认？',
      confirmText: '确认履约',
      success: function (res) {
        if (!res.confirm) return;
        api.confirmCheckin({ checkinId: checkinId }).then(function (r) {
          if (!r || r.code !== 0) {
            toast((r && r.message) || '确认失败，请重试');
            return;
          }
          toast('已确认本次履约', 'success');
          self.load();
        });
      }
    });
  },

  /** 卡片上的「结束打卡并填写小结」快捷入口：聚焦小结输入框 */
  onFinishShortcut() {
    const self = this;
    this.setData({ summaryFocus: true });
    toast('请在下方填写授课小结');
    setTimeout(function () {
      self.setData({ summaryFocus: false });
    }, 500);
  },

  /** 点击记录卡片：查看完整小结 */
  onCheckinTap(e) {
    const checkinId = (e && e.detail && e.detail.checkinId) || '';
    const list = this.data.list || [];
    const record =
      list.filter(function (c) {
        return c.id === checkinId || c._id === checkinId;
      })[0] || null;
    if (!record) return;
    if (!record.summary) {
      toast('该次打卡还没有填写授课小结');
      return;
    }
    wx.showModal({
      title: '授课小结 · ' + (record.startAt || ''),
      content: record.summary,
      showCancel: false,
      confirmText: '我知道了'
    });
  },

  onBack() {
    const pages = getCurrentPages();
    if (pages && pages.length > 1) {
      wx.navigateBack();
      return;
    }
    wx.switchTab({ url: '/pages/index/index' });
  }
});
