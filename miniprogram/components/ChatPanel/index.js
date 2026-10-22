/**
 * ChatPanel —— 沟通面板 + 协商确认（三期）
 * ---------------------------------------------------------------------------
 * 双方共用一个组件，靠 role 决定：
 *   - 气泡方向：自己发的靠右，对方靠左，system 居中；
 *   - 确认按钮：【确认接单】(学生) / 【同意雇佣】(家长)。
 *
 * 【状态机在这里怎么体现】
 * 组件不自己判断"能不能成交"，只显示服务端返回的 negotiation 快照：
 *   status: recruiting / communicating / matched
 *   studentConfirmed / parentConfirmed / bothConfirmed
 * 点击确认后重新拉一次 getChatThread，用返回值驱动 UI —— 单一事实来源在 services/phase2.js，
 * 组件只做展示与转发，避免"前端自己算一套状态"导致与后端不一致。
 */
const api = require('../../services/api.js');
const C = require('../../utils/constants.js');

Component({
  properties: {
    visible: { type: Boolean, value: false },
    demandId: { type: String, value: '' },
    tutorId: { type: String, value: '' },
    /** 'tutor' | 'parent' —— 当前查看者的角色，决定气泡方向与确认按钮文案 */
    role: { type: String, value: 'tutor' },
    peerName: { type: String, value: '对方' },
    demandTitle: { type: String, value: '' }
  },

  data: {
    loading: true,
    sending: false,
    messages: [],
    draft: '',
    scrollTop: 0,
    negotiation: {
      status: 'recruiting',
      statusLabel: '招募中',
      studentConfirmed: false,
      parentConfirmed: false,
      bothConfirmed: false,
      tip: ''
    },
    maxLen: C.NEGOTIATION.maxMessageLen,
    safetyTip: C.NEGOTIATION.templates.safetyTip
  },

  observers: {
    'visible, demandId, tutorId': function (visible) {
      if (visible && this.data.demandId) this.load();
    }
  },

  methods: {
    /** 拉取会话（消息 + 协商状态） */
    load() {
      const self = this;
      if (!this.data.demandId || !this.data.tutorId) return;
      this.setData({ loading: true });
      api
        .getChatThread({ demandId: this.data.demandId, tutorId: this.data.tutorId })
        .then(function (res) {
          if (!res || res.code !== 0) {
            self.setData({ loading: false });
            wx.showToast({ title: (res && res.message) || '会话加载失败', icon: 'none' });
            return;
          }
          self.applyState(res.data);
        });
    },

    /** 把服务端返回渲染成视图数据（含气泡方向） */
    applyState(data) {
      const mySender = this.data.role === 'parent' ? C.CHAT_SENDER.PARENT : C.CHAT_SENDER.STUDENT;
      const messages = (data.messages || []).map(function (m) {
        return Object.assign({}, m, {
          mine: m.sender === mySender,
          isSystem: m.sender === C.CHAT_SENDER.SYSTEM
        });
      });
      this.setData({
        loading: false,
        messages: messages,
        negotiation: data.negotiation || this.data.negotiation,
        // 新消息进来后滚到底部
        scrollTop: messages.length * 400
      });
    },

    onInput(e) {
      this.setData({ draft: e.detail.value });
    },

    /** 发送文字消息 */
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
          sender: this.data.role === 'parent' ? C.CHAT_SENDER.PARENT : C.CHAT_SENDER.STUDENT,
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
          self.triggerEvent('updated', { reason: 'message' });
        });
    },

    /**
     * 确认按钮：学生=确认接单，家长=同意雇佣
     * 两者都确认后服务端才置 matched，组件只负责刷新展示。
     */
    onConfirm() {
      const self = this;
      const isParent = this.data.role === 'parent';
      if (this.data.negotiation.bothConfirmed) return;

      const already = isParent
        ? this.data.negotiation.parentConfirmed
        : this.data.negotiation.studentConfirmed;
      if (already) {
        wx.showToast({ title: '你已确认，等待对方', icon: 'none' });
        return;
      }

      wx.showModal({
        title: isParent ? '同意雇佣' : '确认接单',
        content: isParent
          ? '确认后若对方也已确认，订单将正式匹配。匹配后可在履约页打卡。'
          : '确认后若家长也同意，订单将正式匹配。请确保已沟通清楚课时与时间。',
        confirmText: isParent ? '同意雇佣' : '确认接单',
        success(res) {
          if (!res.confirm) return;
          const payload = { demandId: self.data.demandId, tutorId: self.data.tutorId };
          const call = isParent ? api.confirmByParent(payload) : api.confirmByStudent(payload);
          call.then(function (r) {
            if (!r || (r.code !== 0 && r.code !== 3)) {
              wx.showToast({ title: (r && r.message) || '操作失败', icon: 'none' });
              return;
            }
            wx.showToast({ title: r.message || '已确认', icon: 'none' });
            if (wx.vibrateShort) wx.vibrateShort({ type: 'light' });
            self.load();
            self.triggerEvent('updated', { reason: 'confirm', matched: !!(r.data && r.data.matched) });
          });
        }
      });
    },

    onClose() {
      this.triggerEvent('close');
    },

    /** 阻止穿透（面板固定定位，点遮罩关闭） */
    noop() {}
  }
});
