/**
 * 我的（tabBar 页面）
 *
 * 家长视角：我的需求 / 发布中 / 对接报告 / 风险提示 -> 需求列表、发布需求、报告列表
 * 学生视角：信用分 / 认证等级 / 累计接单 / 我的认证 / 我的接单 / 认证徽章
 *
 * 数据来源：api.getProfile / getParentStats / getReportList / getMyTutorProfile /
 *          getCertifications / getTutorStats / getMyApplications / getDemandDetail
 *
 * TODO(二期)：用户资料编辑（昵称、手机号绑定）、消息中心、认证到期提醒、资金担保结算记录。
 * 说明：本项目刻意不引入 Vant Weapp / TDesign，保证「导入微信开发者工具即可运行、无需构建 npm」。
 */
const api = require('../../services/api.js');
const fmt = require('../../utils/format.js');
const C = require('../../utils/constants.js');
/* 演示用 id（真实环境由云函数按 openid 返回 parentId / tutorProfileId） */
const mockDemands = require('../../mock/demands.js');
const mockTutors = require('../../mock/tutors.js');

const CERT_STATUS_CLASS = {
  approved: 'tag tag-green',
  pending: 'tag tag-orange',
  rejected: 'tag tag-red',
  none: 'tag tag-line'
};

function toast(title) {
  wx.showToast({ title: title || '', icon: 'none', duration: 2000 });
}

function buildCertRows(certs) {
  const list = certs || [];
  return C.CERT_TYPES.map(function (type) {
    let latest = null;
    list.forEach(function (cert) {
      if (cert.type !== type.value) return;
      if (!latest || Number(cert.createdAtTs || 0) >= Number(latest.createdAtTs || 0)) {
        latest = cert;
      }
    });
    const status = latest ? latest.status : 'none';
    return {
      type: type.value,
      typeLabel: type.label,
      statusText: latest ? C.CERT_STATUS_LABEL[status] || '待提交' : '未提交',
      statusClass: CERT_STATUS_CLASS[status] || 'tag tag-line',
      createdAt: latest ? latest.createdAt || '' : '',
      reviewNote: latest ? latest.reviewNote || '' : '',
      done: status === 'approved',
      needVerify: status !== 'approved'
    };
  });
}

function riskClassOf(level) {
  if (level === C.RISK_LEVEL.HIGH) return 'tag tag-red';
  if (level === C.RISK_LEVEL.MEDIUM) return 'tag tag-orange';
  return 'tag tag-green';
}

Page({
  data: {
    loading: true,
    role: '',
    roleLabel: '未选择身份',
    isParent: false,
    isTutor: false,

    /* 用户卡 */
    nickname: '',
    /** 自定义头像（chooseAvatar 返回的路径） */
    avatarUrl: '',
    phoneText: '',
    openidShort: '',
    avatarText: '京',

    /* 家长视角 */
    parentStats: { demandCount: 0, publishedCount: 0, reportCount: 0, riskCount: 0 },
    showReports: false,
    reportToggleText: '展开',
    reports: [],

    /* 学生视角 */
    tutorId: '',
    /* 三期：接单偏好 / 性格特点（学生端可编辑） */
    prefOptions: [],
    personaOptions: [],
    savingTags: false,
    badge: {
      level: 0,
      name: '',
      school: '',
      major: '',
      grade: '',
      badgeNo: '',
      tags: [],
      abilityTags: [],
      verifiedAt: ''
    },
    creditScore: 0,
    certLevel: 0,
    certLevelText: '未认证',
    certBadgeNo: '',
    orderCount: 0,
    rating: 0,
    applyCount: 0,
    pendingCount: 0,
    certRows: [],
    applications: [],
    appEmptyText: '还没有接单申请，去接单池看看吧',

    /* 通用 */
    about: {
      name: C.APP_INFO.name,
      shortName: C.APP_INFO.shortName,
      version: C.APP_INFO.version,
      slogan: C.APP_INFO.slogan,
      sourceText: ''
    },
    disclaimerFull: C.DISCLAIMER.full,

    /* 隐私与授权：信息类型与用途必须与微信后台《用户隐私保护指引》中声明的内容一致 */
    privacyItems: [
      { type: '剪切板', purpose: '用于把对接报告、认证编号复制到剪贴板，方便您保存或转发' },
      { type: '你选中的照片或视频信息', purpose: '用于上传教师资格证等认证材料及试讲视频，用于资质与能力审核' },
      { type: '摄像头', purpose: '用于现场拍摄认证材料照片或试讲视频' }
    ],
    privacyNote:
      '本平台不向任何第三方共享、转让上述信息；MVP 阶段所有数据仅保存在你的设备本地，不上传服务器。'
  },

  onLoad() {
    this.load();
  },

  onShow() {
    // 三期：同步接单标签（可能刚在本页保存过，或从认证页改过档案）
    this.loadTags();
    // 身份可能在首页 / 认证页被切换，回到本页时静默刷新（首次进入不重复请求）
    if (!this._shownOnce) {
      this._shownOnce = true;
      return;
    }
    this.load(true);
  },

  /* ==================================================================
   * 四期：头像与昵称自定义
   * ================================================================== */

  /** 选择头像（button open-type="chooseAvatar" 的回调） */
  onChooseAvatar(e) {
    const url = (e.detail && e.detail.avatarUrl) || '';
    if (!url) return;
    const app = getApp();
    // 存全局 + 本地存储，冷启动也能恢复
    if (app && app.setLocalProfile) app.setLocalProfile({ avatarUrl: url });
    this.setData({ avatarUrl: url });
    toast('头像已更新');
  },

  /** 昵称输入中：实时同步到本地（不每次都写盘，交给 blur 落盘） */
  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value || '' });
  },

  /** 昵称失焦：落盘 + 同步全局 */
  onNicknameBlur(e) {
    const name = String((e.detail && e.detail.value) || this.data.nickname || '').trim();
    if (!name) {
      toast('昵称不能为空');
      this.setData({ nickname: this.data.nickname });
      return;
    }
    const app = getApp();
    if (app && app.setLocalProfile) app.setLocalProfile({ nickname: name });
    this.setData({
      nickname: name,
      avatarText: name.slice(0, 1) || this.data.avatarText
    });
    toast('昵称已保存');
  },

  /* ==================================================================
   * 四期：自定义标签（追加到数组末尾并自动选中）
   * ================================================================== */

  /**
   * 弹输入框添加自定义标签
   * @param {'pref'|'persona'} kind
   */
  addCustomTag(kind) {
    const self = this;
    const isPref = kind === 'pref';
    const key = isPref ? 'prefOptions' : 'personaOptions';

    wx.showModal({
      title: isPref ? '自定义接单偏好' : '自定义性格特点',
      editable: true,
      placeholderText: isPref ? '例如：只接初三复习' : '例如：擅长鼓励式教学',
      confirmText: '添加',
      success(res) {
        if (!res.confirm) return;
        const text = String(res.content || '').trim();
        if (!text) {
          toast('请输入内容');
          return;
        }
        if (text.length > 12) {
          toast('最多 12 个字');
          return;
        }

        const options = (self.data[key] || []).slice();
        // 去重：同名标签直接选中，不再追加
        for (let i = 0; i < options.length; i++) {
          if (options[i].label === text) {
            options[i] = Object.assign({}, options[i], { active: true });
            self.setData({ [key]: options });
            toast('已选中该标签');
            return;
          }
        }

        options.push({
          value: 'custom:' + text,
          label: text,
          active: true,
          custom: true
        });
        self.setData({ [key]: options });
        toast('已添加并选中');
      }
    });
  },

  onAddPref() {
    this.addCustomTag('pref');
  },

  onAddPersona() {
    this.addCustomTag('persona');
  },

  /* ==================================================================
   * 三期：接单标签（偏好 / 性格）
   * ================================================================== */

  /** 解析当前学生 id（本页 data 未就绪时回落到全局登录态） */
  resolveTutorId() {
    const app = getApp();
    return this.data.tutorId || (app && app.globalData ? app.globalData.tutorProfileId : '') || '';
  },

  /** 拉取标签并转成 chip 选项 */
  loadTags() {
    const self = this;
    const app = getApp();

    // 顺带恢复自定义头像与昵称
    if (app && app.getLocalProfile) {
      const local = app.getLocalProfile();
      if (local.avatarUrl || local.nickname) {
        const patch = {};
        if (local.avatarUrl) patch.avatarUrl = local.avatarUrl;
        if (local.nickname) {
          patch.nickname = local.nickname;
          patch.avatarText = local.nickname.slice(0, 1);
        }
        this.setData(patch);
      }
    }

    if (app.getRole() !== C.ROLES.TUTOR) return;
    const tutorId = this.resolveTutorId();
    if (!tutorId) return;

    api.getTutorTags(tutorId).then(function (res) {
      if (!res || res.code !== 0) return;
      const prefs = res.data.preferences || [];
      const persona = res.data.personality || [];
      self.setData({
        prefOptions: C.TUTOR_PREFERENCES.map(function (o) {
          return { value: o.value, label: o.label, active: prefs.indexOf(o.value) > -1 };
        }),
        personaOptions: C.PERSONALITY_TAGS.map(function (o) {
          return { value: o.value, label: o.label, active: persona.indexOf(o.value) > -1 };
        })
      });
    });
  },

  onTogglePref(e) {
    const index = Number(e.currentTarget.dataset.index);
    const options = this.data.prefOptions.slice();
    if (!options[index]) return;
    options[index] = Object.assign({}, options[index], { active: !options[index].active });
    this.setData({ prefOptions: options });
  },

  onTogglePersona(e) {
    const index = Number(e.currentTarget.dataset.index);
    const options = this.data.personaOptions.slice();
    if (!options[index]) return;
    options[index] = Object.assign({}, options[index], { active: !options[index].active });
    this.setData({ personaOptions: options });
  },

  /** 保存标签：直接写回档案，匹配算法下次打分立刻生效 */
  onSaveTags() {
    const self = this;
    if (this.data.savingTags) return;
    const tutorId = this.resolveTutorId();
    if (!tutorId) {
      toast('请先完成学生认证');
      return;
    }

    const prefs = this.data.prefOptions
      .filter(function (o) {
        return o.active;
      })
      .map(function (o) {
        return o.value;
      });
    const persona = this.data.personaOptions
      .filter(function (o) {
        return o.active;
      })
      .map(function (o) {
        return o.value;
      });

    if (!prefs.length) {
      toast('至少选择一个接单偏好');
      return;
    }

    this.setData({ savingTags: true });
    api.updateTutorTags({ tutorId: tutorId, preferences: prefs, personality: persona }).then(function (res) {
      self.setData({ savingTags: false });
      if (!res || res.code !== 0) {
        toast((res && res.message) || '保存失败');
        return;
      }
      toast('接单标签已保存');
    });
  },

  onPullDownRefresh() {
    this.load(true).then(function () {
      wx.stopPullDownRefresh();
      toast('已刷新');
    });
  },

  /**
   * @param {boolean} silent 静默刷新
   */
  load(silent) {
    const self = this;
    const app = getApp();
    if (!silent) this.setData({ loading: true });

    return app
      .ensureLogin()
      .then(function () {
        return api.getProfile();
      })
      .then(function (res) {
        const data = (res && res.code === 0 && res.data) || {};
        const user = data.user || {};
        const role = app.getRole() || user.role || C.ROLES.PARENT;
        const openid = data.openid || user.openid || '';
        const nickname = user.nickname || (role === C.ROLES.TUTOR ? '演示学生' : '演示家长');

        self.setData({
          loading: false,
          role: role,
          roleLabel: C.ROLE_LABEL[role] || '未选择身份',
          isParent: role === C.ROLES.PARENT,
          isTutor: role === C.ROLES.TUTOR,
          nickname: nickname,
          avatarText: nickname.slice(0, 1) || (role === C.ROLES.TUTOR ? '师' : '家'),
          phoneText: user.phone ? fmt.maskPhone(user.phone) : '未绑定（演示环境不采集真实手机号）',
          openidShort: openid ? openid.slice(-6) : '------',
          about: {
            name: C.APP_INFO.name,
            shortName: C.APP_INFO.shortName,
            version: C.APP_INFO.version,
            slogan: C.APP_INFO.slogan,
            sourceText: api.isCloud() ? '微信云开发（云函数 + 云数据库）' : '本地 mock 演示（storage 持久化）'
          }
        });

        if (role === C.ROLES.TUTOR) return self.loadTutor(user);
        return self.loadParent(user);
      })
      .catch(function (err) {
        self.setData({ loading: false });
        toast((err && err.message) || '数据加载失败，请下拉刷新重试');
      });
  },

  /* ================= 家长视角 ================= */

  loadParent(user) {
    const self = this;
    const parentId = user.parentId || mockDemands.CURRENT_PARENT_ID;
    return Promise.all([api.getParentStats(parentId), api.getReportList({ parentId: parentId })]).then(
      function (results) {
        const statsRes = results[0] || {};
        const reportRes = results[1] || {};
        const stats = (statsRes.code === 0 && statsRes.data) || {};
        const reports = (reportRes.code === 0 && reportRes.data) || [];

        self.setData({
          parentStats: {
            demandCount: Number(stats.demandCount || 0),
            publishedCount: Number(stats.publishedCount || 0),
            reportCount: Number(stats.reportCount || 0),
            riskCount: Number(stats.riskCount || 0)
          },
          reports: reports.map(function (report) {
            const demand = report.demand || {};
            const first = (report.topMatches || [])[0] || {};
            const tutor = first.tutor || {};
            return {
              id: report.id,
              demandId: report.demandId,
              title: (demand.grade || '') + (demand.subject || '') || '家教需求',
              createdAt: report.createdAt || '',
              topName: tutor.name ? tutor.name + ' 等 ' + (report.topMatches || []).length + ' 位' : '暂无推荐结果',
              riskText: (C.RISK_LEVEL_THEME[report.riskLevel] || C.RISK_LEVEL_THEME.low).text,
              riskClass: riskClassOf(report.riskLevel)
            };
          })
        });
      }
    );
  },

  /* ================= 学生视角 ================= */

  loadTutor(user) {
    const self = this;
    const tutorId = user.tutorProfileId || mockTutors.CURRENT_TUTOR_ID;

    return Promise.all([
      api.getMyTutorProfile(tutorId),
      api.getCertifications(tutorId),
      api.getTutorStats(tutorId),
      api.getMyApplications(tutorId)
    ]).then(function (results) {
      const tutorRes = results[0] || {};
      const certRes = results[1] || {};
      const statsRes = results[2] || {};
      const appRes = results[3] || {};

      const tutor = (tutorRes.code === 0 && tutorRes.data) || {};
      const certs = (certRes.code === 0 && certRes.data) || [];
      const stats = (statsRes.code === 0 && statsRes.data) || {};
      const applications = (appRes.code === 0 && appRes.data) || [];
      const level = Number(tutor.certLevel || stats.certLevel || 0);

      self.setData({
        tutorId: tutor.id || tutorId,
        creditScore: Number(tutor.creditScore || stats.creditScore || 0),
        certLevel: level,
        certLevelText: (C.CERT_LEVELS[level] || C.CERT_LEVELS[0]).label,
        certBadgeNo: tutor.certBadgeNo || stats.certBadgeNo || '',
        orderCount: Number(stats.orderCount || tutor.orderCount || 0),
        rating: Number(stats.rating || tutor.rating || 0),
        applyCount: Number(stats.applyCount || applications.length),
        pendingCount: Number(stats.pendingCount || 0),
        badge: {
          level: level,
          name: tutor.name || '',
          school: tutor.school || '',
          major: tutor.major || '',
          grade: tutor.grade || '',
          badgeNo: tutor.certBadgeNo || '',
          tags: tutor.tags || [],
          abilityTags: tutor.abilityTags || [],
          verifiedAt: tutor.verifiedAt || ''
        },
        certRows: buildCertRows(certs)
      });

      /* 申请列表需要需求标题与状态，逐个取需求详情（数量很小，MVP 可接受） */
      if (!applications.length) {
        self.setData({ applications: [] });
        return null;
      }
      const demandIds = [];
      applications.forEach(function (app) {
        if (demandIds.indexOf(app.demandId) === -1) demandIds.push(app.demandId);
      });

      return Promise.all(
        demandIds.map(function (id) {
          return api.getDemandDetail(id);
        })
      ).then(function (demandResults) {
        const demandMap = {};
        demandResults.forEach(function (res) {
          if (res && res.code === 0 && res.data) demandMap[res.data.id] = res.data;
        });

        self.setData({
          applications: applications.map(function (app) {
            const demand = demandMap[app.demandId] || {};
            return {
              id: app.id,
              demandId: app.demandId,
              title: (demand.grade || '') + (demand.subject || '') || '需求已删除',
              createdAt: app.createdAt || '',
              statusText: C.APPLY_STATUS_LABEL[app.status] || app.status,
              statusClass:
                app.status === 'accepted'
                  ? 'tag tag-green'
                  : app.status === 'rejected'
                  ? 'tag tag-red'
                  : 'tag tag-orange',
              demandStatusText: C.DEMAND_STATUS_LABEL[demand.status] || '状态未知'
            };
          })
        });
        return null;
      });
    });
  },

  /* ================= 交互 ================= */

  onSwitchRole() {
    const self = this;
    const app = getApp();
    wx.showActionSheet({
      itemList: ['我是家长 / 机构', '我是XX大学学生'],
      success: function (res) {
        const role = res.tapIndex === 1 ? C.ROLES.TUTOR : C.ROLES.PARENT;
        app.setRole(role);
        app.ensureLogin(true).catch(function () {});
        self.load();
        toast('已切换为' + (C.ROLE_LABEL[role] || ''));
      },
      fail: function () {}
    });
  },

  onGoDemandList() {
    getApp().globalData.demandListMine = true;
    wx.switchTab({ url: '/pages/demand-list/demand-list' });
  },

  onGoCreate() {
    wx.navigateTo({ url: '/pages/demand-create/demand-create' });
  },

  onToggleReports() {
    const show = !this.data.showReports;
    this.setData({ showReports: show, reportToggleText: show ? '收起' : '展开' });
  },

  onReportTap(e) {
    const reportId = e.currentTarget.dataset.reportId;
    if (!reportId) return;
    wx.navigateTo({ url: '/pages/report-detail/report-detail?reportId=' + reportId });
  },

  onGoVerify() {
    wx.navigateTo({ url: '/pages/tutor-verify/tutor-verify' });
  },

  onGoPool() {
    // 接单池是 tabBar 页面，必须用 switchTab
    wx.switchTab({ url: '/pages/demand-list/demand-list' });
  },

  onApplicationTap(e) {
    const demandId = e.currentTarget.dataset.demandId;
    if (!demandId) return;
    wx.navigateTo({ url: '/pages/demand-detail/demand-detail?from=tutor&id=' + demandId });
  },

  onResetMock() {
    const self = this;
    wx.showModal({
      title: '重置演示数据',
      content: '将清空本地 mock 的需求、匹配、报告、认证与申请记录，并恢复初始演示数据。确认继续？',
      confirmText: '确认重置',
      success: function (res) {
        if (!res.confirm) return;
        api.resetMockData().then(function (result) {
          if (!result || result.code !== 0) {
            toast((result && result.message) || '重置失败');
            return;
          }
          self.load();
          toast('演示数据已重置');
        });
      }
    });
  },

  /** 说明如何管理微信侧授权（对应隐私指引中的「撤回方式」说明） */
  onPrivacySettingTip() {
    wx.showModal({
      title: '如何管理微信授权',
      content:
        '在小程序右上角「…」→「设置」中，可查看并关闭已授权给本平台的信息（如相册、摄像头）。关闭后对应功能将不可用，但不影响浏览需求与对接报告。',
      showCancel: false,
      confirmText: '我知道了'
    });
  },

  /** 清除本地全部数据：对应《用户隐私保护指引》中「撤回授权 / 删除我的信息」 */
  onClearLocalData() {
    const self = this;
    wx.showModal({
      title: '清除本地全部数据',
      content:
        '将删除您在本平台产生的全部数据（需求 / 匹配 / 报告 / 认证 / 接单申请）与身份偏好，并恢复出厂演示数据。该操作不可撤销，确认继续？',
      confirmText: '确认清除',
      confirmColor: '#F04438',
      success: function (res) {
        if (!res.confirm) return;
        api.clearLocalData().then(function (result) {
          if (!result || result.code !== 0) {
            toast((result && result.message) || '清除失败');
            return;
          }
          self.load();
          toast('本地数据已清除');
        });
      }
    });
  },

  onShareAppMessage() {
    return {
      title: '青拾对接：XX大学学生 · 认证可查 · 试错不满意可换',
      path: '/pages/index/index'
    };
  }
});
