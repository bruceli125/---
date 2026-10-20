/**
 * 京师家教可信对接平台 —— 小程序入口
 *
 * 职责：
 * 1. 初始化系统信息、恢复本地角色缓存；
 * 2. 统一走 services/api.js 的 login（mock / 云函数两种模式都可用）；
 * 3. 对外暴露 ensureLogin() / setRole() / getRole()，页面直接 await 使用。
 *
 * 注意：登录失败不阻塞页面渲染（MVP 阶段 mock 数据可独立演示）。
 */
const api = require('./services/api.js');
const { STORAGE_KEYS, ROLES, APP_INFO } = require('./utils/constants.js');

App({
  globalData: {
    openid: '',
    userInfo: null,          // { id, openid, role, nickname, phone, createdAt }
    tutorProfileId: '',      // 当前师范生档案 tutors._id（mock 模式下即 tutorId）
    role: '',                // 'parent' | 'tutor'
    useCloud: APP_INFO.useCloud,
    systemInfo: null,
    launchAt: 0,
    loginError: ''
  },

  /** ensureLogin 的缓存 Promise，避免多页面并发重复登录 */
  _loginPromise: null,

  onLaunch() {
    this.globalData.launchAt = Date.now();
    this.initSystemInfo();
    this.restoreLocalState();
    // 提前发起登录，页面侧 await app.ensureLogin() 即可命中缓存
    this.ensureLogin().catch((err) => {
      console.error('[app] 预登录失败：', err);
    });
  },

  onShow() {
    // TODO(二期)：小程序回到前台时刷新需求/匹配缓存、校验认证状态是否过期
  },

  onError(msg) {
    console.error('[app onError]', msg);
  },

  /** 兼容不同基础库的窗口信息获取方式 */
  initSystemInfo() {
    try {
      if (typeof wx.getWindowInfo === 'function') {
        this.globalData.systemInfo = wx.getWindowInfo();
      } else {
        this.globalData.systemInfo = wx.getSystemInfoSync();
      }
    } catch (err) {
      console.warn('[app] 获取系统信息失败（可忽略）：', err);
      this.globalData.systemInfo = null;
    }
  },

  /** 从本地缓存恢复角色，保证冷启动后角色不丢 */
  restoreLocalState() {
    try {
      const role = wx.getStorageSync(STORAGE_KEYS.ROLE);
      if (role === ROLES.PARENT || role === ROLES.TUTOR) {
        this.globalData.role = role;
      }
      const tutorProfileId = wx.getStorageSync(STORAGE_KEYS.TUTOR_PROFILE_ID);
      if (tutorProfileId) {
        this.globalData.tutorProfileId = tutorProfileId;
      }
    } catch (err) {
      console.warn('[app] 读取本地角色失败：', err);
    }
  },

  /**
   * 确保登录完成
   * @returns {Promise<{openid:string,user:object}>}
   */
  ensureLogin(force) {
    if (this._loginPromise && !force) {
      return this._loginPromise;
    }
    const cachedRole = this.globalData.role || wx.getStorageSync(STORAGE_KEYS.ROLE) || ROLES.PARENT;
    this._loginPromise = api
      .login({ role: cachedRole })
      .then((res) => {
        if (!res || res.code !== 0 || !res.data) {
          throw new Error((res && res.message) || '登录返回数据异常');
        }
        this.globalData.openid = res.data.openid;
        this.globalData.userInfo = res.data.user;
        if (res.data.user && res.data.user.role) {
          this.globalData.role = res.data.user.role;
        }
        if (res.data.tutorProfileId) {
          this.globalData.tutorProfileId = res.data.tutorProfileId;
          wx.setStorageSync(STORAGE_KEYS.TUTOR_PROFILE_ID, res.data.tutorProfileId);
        }
        return res.data;
      })
      .catch((err) => {
        this.globalData.loginError = err && err.message ? err.message : String(err);
        this._loginPromise = null; // 允许后续重试
        throw err;
      });
    return this._loginPromise;
  },

  /** 获取当前角色（同步，用于页面 onLoad 快速判断） */
  getRole() {
    if (this.globalData.role) return this.globalData.role;
    try {
      const role = wx.getStorageSync(STORAGE_KEYS.ROLE);
      if (role) {
        this.globalData.role = role;
        return role;
      }
    } catch (err) {
      console.warn('[app] getRole 读取缓存失败：', err);
    }
    return '';
  },

  /**
   * 设置当前角色（首页角色选择调用）
   * @param {'parent'|'tutor'} role
   */
  setRole(role) {
    const next = role === ROLES.TUTOR ? ROLES.TUTOR : ROLES.PARENT;
    this.globalData.role = next;
    try {
      wx.setStorageSync(STORAGE_KEYS.ROLE, next);
    } catch (err) {
      console.warn('[app] 写入角色缓存失败：', err);
    }
    if (this.globalData.userInfo) {
      this.globalData.userInfo.role = next;
    }
    return next;
  },

  /** 统一 toast，减少各页面重复代码 */
  toast(title, icon) {
    wx.showToast({
      title: title || '',
      icon: icon || 'none',
      duration: 1800
    });
  }
});
