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
    /**
     * 当前角色（唯一事实来源）
     * 三期修正：一期只有 role 一个字段，页面各自从 storage 读，出现过"首页已切换成家长、
     * 但接单池仍按学生身份渲染"的越权 Bug。现在统一以 currentRole 为准，
     * role 仅作为兼容别名同步维护，禁止页面再直接读写 storage 判断身份。
     */
    currentRole: '',
    role: '',                // @deprecated 兼容别名，始终与 currentRole 保持一致
    useCloud: APP_INFO.useCloud,
    systemInfo: null,
    launchAt: 0,
    loginError: ''
  },

  /** 角色变更监听器（页面 onShow 里订阅，避免手动到处刷新） */
  _roleListeners: [],

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
        // 两个字段同时写，避免别名与主字段不一致（越权 Bug 的根源之一）
        this.globalData.currentRole = role;
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
          this.globalData.currentRole = res.data.user.role;
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

  /**
   * 获取当前角色（同步，用于页面 onLoad / onShow 快速判断）
   * 以 globalData.currentRole 为准；缺失时回落到 storage 并**补齐两个字段**。
   */
  getRole() {
    if (this.globalData.currentRole) return this.globalData.currentRole;
    try {
      const role = wx.getStorageSync(STORAGE_KEYS.ROLE);
      if (role === ROLES.PARENT || role === ROLES.TUTOR) {
        this.globalData.currentRole = role;
        this.globalData.role = role;
        return role;
      }
    } catch (err) {
      console.warn('[app] getRole 读取缓存失败：', err);
    }
    return '';
  },

  /** 当前是否师范生 */
  isTutor() {
    return this.getRole() === ROLES.TUTOR;
  },

  /** 当前是否家长 / 机构 */
  isParent() {
    return this.getRole() === ROLES.PARENT;
  },

  /**
   * 订阅角色变更（页面 onLoad 里订阅、onUnload 里取消）
   * @param {(role:string, prevRole:string) => void} fn
   * @returns {Function} 取消订阅
   */
  onRoleChange(fn) {
    if (typeof fn !== 'function') return function () {};
    if (this._roleListeners.indexOf(fn) > -1) return function () {};
    this._roleListeners.push(fn);
    const self = this;
    return function () {
      const i = self._roleListeners.indexOf(fn);
      if (i > -1) self._roleListeners.splice(i, 1);
    };
  },

  /**
   * 设置当前角色（首页角色选择调用）
   * 一次做三件事：更新 globalData（含兼容别名）→ 落盘 → 通知订阅者。
   * 任何页面都不应再直接 wx.setStorageSync(ROLE) 绕开这里。
   * @param {'parent'|'tutor'} role
   */
  setRole(role) {
    const prev = this.getRole();
    const next = role === ROLES.TUTOR ? ROLES.TUTOR : ROLES.PARENT;
    this.globalData.currentRole = next;
    this.globalData.role = next;
    try {
      wx.setStorageSync(STORAGE_KEYS.ROLE, next);
    } catch (err) {
      console.warn('[app] 写入角色缓存失败：', err);
    }
    if (this.globalData.userInfo) {
      this.globalData.userInfo.role = next;
    }
    if (prev !== next) {
      this._roleListeners.slice().forEach(function (fn) {
        try {
          fn(next, prev);
        } catch (err) {
          console.error('[app] 角色监听器执行失败：', err);
        }
      });
    }
    return next;
  },

  /**
   * 角色守卫（越权拦截的唯一实现，页面统一调用它）
   * ------------------------------------------------------------------
   * 返回 false 表示已拦截：这里会 toast 提示并在 900ms 后自动劝返，
   * 延迟是为了让提示语可见（立即跳转会闪一下就没了）。
   *
   * @param {'parent'|'tutor'} required 进入该页所需的角色
   * @param {{redirect?: 'home'|'back', tip?: string}} [options]
   * @returns {boolean} true = 放行
   */
  guardRole(required, options) {
    const opts = options || {};
    const current = this.getRole();
    // 角色尚未选择时不拦（首次冷启动用户还没在首页选身份）
    if (!current) return true;
    if (current === required) return true;

    const tip =
      opts.tip ||
      (required === ROLES.TUTOR ? '仅师范生可进入接单池' : '该功能仅家长可用');
    wx.showToast({ title: tip, icon: 'none', duration: 1600 });

    const mode = opts.redirect || 'home';
    setTimeout(function () {
      if (mode === 'back') {
        const pages = getCurrentPages();
        if (pages && pages.length > 1) {
          wx.navigateBack({ delta: 1 });
          return;
        }
      }
      wx.switchTab({ url: '/pages/index/index' });
    }, 900);
    return false;
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
