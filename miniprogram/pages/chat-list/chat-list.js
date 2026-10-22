/**
 * 沟通列表（TabBar 第 3 个 Tab）
 * ---------------------------------------------------------------------------
 * 学生看到「我与各位家长」的会话，家长看到「我名下需求的所有学生」会话。
 * 数据来自 api.getChatList，服务端已按角色过滤并按最后消息时间倒序。
 */
const api = require('../../services/api.js');
const C = require('../../utils/constants.js');

const FALLBACK_TUTOR_ID = 'tutor_001';

Page({
  data: {
    role: 'tutor',
    isTutor: true,
    list: [],
    unreadTotal: 0,
    loading: true,
    emptyTip: ''
  },

  onShow() {
    const app = getApp();
    const role = app.getRole() || C.ROLES.PARENT;
    this.setData({ role: role, isTutor: role === C.ROLES.TUTOR });
    this.load(role);

    // 进入「沟通」Tab 即清掉底部角标；具体会话的未读红点仍保留，直到点进去
    if (app && app.clearChatBadge) app.clearChatBadge();
  },

  onPullDownRefresh() {
    const self = this;
    this.load(this.data.role).then(function () {
      wx.stopPullDownRefresh();
    });
  },

  /** 解析当前学生档案 id（mock 阶段用全局 tutorProfileId 兜底） */
  resolveTutorId() {
    const app = getApp();
    return (app && app.globalData ? app.globalData.tutorProfileId : '') || FALLBACK_TUTOR_ID;
  },

  load(role) {
    const self = this;
    this.setData({ loading: true });

    const query = { role: role };
    if (role === C.ROLES.TUTOR) query.tutorId = this.resolveTutorId();

    return api
      .getChatList(query)
      .then(function (res) {
        if (!res || res.code !== 0) {
          self.setData({ loading: false });
          wx.showToast({ title: (res && res.message) || '加载失败', icon: 'none' });
          return;
        }
        const list = res.data.list || [];
        const unreadTotal = list.reduce(function (n, it) {
          return n + (it.unread || 0);
        }, 0);
        self.setData({
          loading: false,
          list: list,
          unreadTotal: unreadTotal,
          emptyTip:
            role === C.ROLES.TUTOR
              ? '还没有沟通中的家长。去「接单池」长按报名，即可开启沟通。'
              : '还没有学生报名。学生长按报名后会自动出现在这里。'
        });
      })
      .catch(function () {
        self.setData({ loading: false });
      });
  },

  /** 进入聊天室：带上需求 id 与学生 id，聊天室据此定位唯一会话 */
  onOpenChat(e) {
    const ds = e.currentTarget.dataset || {};
    if (!ds.demandid || !ds.tutorid) return;

    // 先标记已读，保证从聊天室返回时这条记录的红点已消失
    api
      .markThreadRead({
        demandId: ds.demandid,
        tutorId: ds.tutorid,
        role: this.data.role === C.ROLES.PARENT ? 'parent' : 'tutor'
      })
      .then(function () {
        // 本地先清零，避免等待刷新造成"点进去还有红点"的错觉
      });
    wx.navigateTo({
      url:
        '/pages/chat-room/chat-room?demandId=' +
        ds.demandid +
        '&tutorId=' +
        ds.tutorid +
        '&peerName=' +
        encodeURIComponent(ds.peername || '')
    });
  }
});
