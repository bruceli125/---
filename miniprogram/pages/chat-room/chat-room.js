/**
 * 聊天室（学生 / 家长共用）
 * ---------------------------------------------------------------------------
 * 页面职责：
 *   1. 顶部显示「协商中 - 需求标题」；
 *   2. 中间是消息记录（文字 + 预设话术）；
 *   3. 底部固定【确认匹配】按钮：学生显示「确认接单」，家长显示「确认雇佣」。
 *
 * 【状态机：双向确认才成单】
 *   studentConfirmed && parentConfirmed 都为 true 时，服务端把 demands.status 置为 matched，
 *   并写入系统消息「双方已达成共识，正式匹配成功！」。
 *   本页不自己判断成交，只调用 api.confirmByStudent / confirmByParent 并刷新快照。
 */
const api = require('../../services/api.js');
const C = require('../../utils/constants.js');

const FALLBACK_TUTOR_ID = 'tutor_001';

Page({
  data: {
    demandId: '',
    tutorId: '',
    peerName: '',
    demandTitle: '',
    role: 'tutor',
    isParent: false,

    loading: true,
    sending: false,
    messages: [],
    draft: '',
    scrollTop: 0,
    maxLen: C.NEGOTIATION.maxMessageLen,

    negotiation: {
      status: 'recruiting',
      statusLabel: '招募中',
      studentConfirmed: false,
      parentConfirmed: false,
      bothConfirmed: false,
      tip: ''
    },

    /**
     * 预设话术：按角色区分（在 onLoad 里根据 currentRole 注入）
     * 学生端 = 自我介绍与时间确认；家长端 = 资历询问与试课请求。
     * 之前两端共用一套「我已通过认证」的文案，导致家长端出现学生的自我介绍。
     */
    presets: []
  },

  onLoad(options) {
    const opt = options || {};
    const app = getApp();
    const role = app.getRole() || C.ROLES.PARENT;

    let tutorId = opt.tutorId || '';
    // 学生进自己的会话：没带 tutorId 时用登录档案兜底
    if (!tutorId && role === C.ROLES.TUTOR) {
      tutorId = (app.globalData && app.globalData.tutorProfileId) || FALLBACK_TUTOR_ID;
    }

    const isParent = role === C.ROLES.PARENT;

    this.setData({
      demandId: opt.demandId || '',
      tutorId: tutorId,
      peerName: opt.peerName ? decodeURIComponent(opt.peerName) : '',
      role: role,
      isParent: isParent,
      // 学生：自我介绍 + 时间确认；家长：资历询问 + 试课请求
      presets: isParent
        ? ['您好，请问您带过几届毕业班？', '可以先试课一次看看效果吗？', '孩子目前的基础一般，您会怎么安排第一节课？']
        : ['您好，我已通过认证，想了解一下孩子的学习情况。', '请问上课时间可以安排在周末吗？', '课时费可以按 ¥120 / 小时 吗？']
    });

    this.load();
  },

  onShow() {
    // 从别处返回时刷新（对方可能刚确认或发了消息）
    if (this._loadedOnce) this.load();
  },

  /** 拉取会话 + 协商状态 */
  load() {
    const self = this;
    if (!this.data.demandId || !this.data.tutorId) {
      this.setData({ loading: false });
      wx.showToast({ title: '缺少会话参数', icon: 'none' });
      return;
    }

    return api
      .getChatThread({ demandId: this.data.demandId, tutorId: this.data.tutorId })
      .then(function (res) {
        if (!res || res.code !== 0) {
          self.setData({ loading: false });
          wx.showToast({ title: (res && res.message) || '会话加载失败', icon: 'none' });
          return;
        }
        self._loadedOnce = true;

        const data = res.data;
        const demand = data.demand || {};
        const mySender = self.data.isParent ? C.CHAT_SENDER.PARENT : C.CHAT_SENDER.STUDENT;
        const messages = (data.messages || []).map(function (m) {
          return Object.assign({}, m, {
            mine: m.sender === mySender,
            isSystem: m.sender === C.CHAT_SENDER.SYSTEM
          });
        });

        self.setData({
          loading: false,
          messages: messages,
          negotiation: data.negotiation || self.data.negotiation,
          demandTitle:
            (demand.subject || '') + (demand.grade ? ' / ' + demand.grade : '') ||
            (data.thread && data.thread.demandTitle) ||
            '家教需求',
          peerName:
            self.data.peerName ||
            (self.data.isParent ? (data.thread && data.thread.tutorName) || '学生' : demand.parentName || '家长'),
          scrollTop: messages.length * 500
        });

        wx.setNavigationBarTitle({ title: '协商中 - ' + (self.data.demandTitle || '家教需求') });

        // 进入聊天室即视为已读：清掉这个会话的未读，并刷新 TabBar 角标
        api
          .markThreadRead({
            demandId: self.data.demandId,
            tutorId: self.data.tutorId,
            role: self.data.isParent ? 'parent' : 'tutor'
          })
          .then(function () {
            const app = getApp();
            if (app && app.refreshChatBadge) app.refreshChatBadge();
          });
      });
  },

  onInput(e) {
    this.setData({ draft: e.detail.value });
  },

  /** 点预设话术：直接填入输入框，让用户可以改完再发 */
  onPreset(e) {
    const text = e.currentTarget.dataset.text || '';
    this.setData({ draft: text });
  },

  /** 发送文字 */
  send() {
    const self = this;
    const text = String(this.data.draft || '').trim();
    if (!text) {
      wx.showToast({ title: '说点什么再发送', icon: 'none' });
      return;
    }
    if (this.data.sending) return;

    this.setData({ sending: true });
    api
      .sendChatMessage({
        demandId: this.data.demandId,
        tutorId: this.data.tutorId,
        sender: this.data.isParent ? C.CHAT_SENDER.PARENT : C.CHAT_SENDER.STUDENT,
        text: text
      })
      .then(function (res) {
        self.setData({ sending: false });
        if (!res || res.code !== 0) {
          wx.showToast({ title: (res && res.message) || '发送失败', icon: 'none' });
          return;
        }
        self.setData({ draft: '' });
        self.load();
        const app2 = getApp();
        if (app2 && app2.refreshChatBadge) app2.refreshChatBadge();
      });
  },

  /**
   * 确认匹配
   * 学生 → api.confirmByStudent；家长 → api.confirmByParent。
   * 只有双方都确认，服务端才会把订单置为 matched。
   */
  onConfirm() {
    const self = this;
    const n = this.data.negotiation;
    if (n.bothConfirmed) return;

    const already = this.data.isParent ? n.parentConfirmed : n.studentConfirmed;
    if (already) {
      wx.showToast({ title: '您已确认，等待对方', icon: 'none' });
      return;
    }

    const isParent = this.data.isParent;
    wx.showModal({
      title: isParent ? '确认雇佣' : '确认接单',
      content: isParent
        ? '确认后若学生也已确认，订单将正式匹配，可进入打卡与评价流程。'
        : '确认后若家长也已确认，订单将正式匹配。请确认已沟通清楚课时与时间。',
      confirmText: isParent ? '确认雇佣' : '确认接单',
      success(res) {
        if (!res.confirm) return;
        const payload = { demandId: self.data.demandId, tutorId: self.data.tutorId };
        const call = isParent ? api.confirmByParent(payload) : api.confirmByStudent(payload);

        call.then(function (r) {
          if (!r || (r.code !== 0 && r.code !== 3)) {
            wx.showToast({ title: (r && r.message) || '操作失败', icon: 'none' });
            return;
          }
          if (wx.vibrateShort) wx.vibrateShort({ type: 'light' });
          wx.showToast({ title: r.message || '已确认', icon: 'none' });
          self.load();
        });
      }
    });
  },

  /** 点击顶部需求条 → 看需求详情 */
  onOpenDemand() {
    wx.navigateTo({
      url:
        '/pages/demand-detail/demand-detail?id=' +
        this.data.demandId +
        '&from=' +
        (this.data.isParent ? 'parent' : 'tutor')
    });
  }
});
