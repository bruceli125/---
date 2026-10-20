/**
 * 家长发布需求
 *
 * 【UI 组件库说明】不引入 Vant Weapp / TDesign，全部用自研原生组件 + app.wxss 全局类，
 * 保证「微信开发者工具导入即可运行、无需构建 npm」。
 *
 * 主链路：培训类型（必选）→ 表单填写 → 实时双减预检（硬拦） → 提交前风险词检测（强提示）
 *        → api.createDemand 落库 → redirectTo 智能匹配结果页
 *
 * 二期新增（本次改造）：
 * 1. 「是否为学科类培训」必选项（DISCIPLINE_OPTIONS），放在「辅导科目」之前，选择后联动科目提示；
 * 2. 实时双减预检（risk.checkDoubleReduction）：命中即渲染红色阻断条 + 禁用提交按钮；
 * 3. 提交结果严格区分：
 *      code 2 = 命中高风险词，弹出 RiskAlert 强提示，用户确认后可继续发布；
 *      code 3 = 命中双减政策红线，弹出阻断弹窗（无"继续提交"选项），禁止发布，必须修改表单。
 *
 * TODO(二期+)：
 * - 真实地理位置选点（wx.chooseLocation）与逆地址解析，当前仅用区域 picker 做粗粒度匹配；
 * - 需求草稿自动保存、需求模板、需求有效期设置。
 */
const api = require('../../services/api.js');
const fmt = require('../../utils/format.js');
const riskService = require('../../services/risk.js');
const {
  SUBJECTS,
  STAGES,
  FREQUENCIES,
  TIME_RANGES,
  TEACH_MODES,
  DISTRICTS,
  RISK_LEVEL,
  ROLES,
  DISCLAIMER,
  DISCIPLINE_OPTIONS,
  POLICY_DOUBLE_REDUCTION
} = require('../../utils/constants.js');

const app = getApp();

/** 输入防抖时长（ms）：避免每次按键都跑一遍词库与政策规则 */
const RISK_CHECK_DEBOUNCE = 300;

/** 提交按钮默认文案 */
const SUBMIT_TEXT = '提交需求并开始匹配';
/** 政策红线命中后的提交按钮文案 */
const SUBMIT_BLOCKED_TEXT = '请先修改为合规时段';

Page({
  data: {
    /* ---------- 字典 ---------- */
    subjects: SUBJECTS,
    stages: [],
    gradeOptions: [],
    frequencies: FREQUENCIES,
    timeRangeOptions: [],
    teachModes: TEACH_MODES,
    districtLabels: [],

    /* ---------- 二期：培训类型（必选，默认不选中） ---------- */
    disciplineOptions: DISCIPLINE_OPTIONS,
    isDiscipline: '',
    disciplineSelected: false,
    showRestDayTip: false,
    subjectHint: '',

    /* ---------- 二期：双减预检结果 ---------- */
    policyBlocked: false,
    policyTitle: POLICY_DOUBLE_REDUCTION.title,
    policyMessage: POLICY_DOUBLE_REDUCTION.message,
    policyEvidence: [],
    policyTips: POLICY_DOUBLE_REDUCTION.tips,
    submitText: SUBMIT_TEXT,

    /* ---------- 表单值 ---------- */
    subject: '',
    stageValue: '',
    grade: '',
    frequency: 'twice_week',
    timeRange: [],
    districtIndex: -1,
    district: '',
    districtLabel: '',
    address: '',
    teachMode: '',
    budgetMin: '',
    budgetMax: '',
    specialRequirements: '',
    phone: '',

    /* ---------- 展示态 ---------- */
    budgetText: '面议',
    maskedPhone: '',
    reqLength: 0,
    addressRequired: true,
    addressTip: '线下上门 / 校内场地授课需要填写具体上课地点',
    submitting: false,
    disclaimerShort: DISCLAIMER.short,
    readTips: [
      '不交任何押金、保证金、服装费、体检费',
      '不抵押身份证、学生证等任何证件',
      '不办理培训贷、分期付款、先培训后上岗',
      '不提前支付中介费，不接受“日入过千”承诺',
      '不添加来路不明的私人联系方式'
    ],

    /* ---------- 风险检测 ---------- */
    hasRisk: false,
    riskLevel: '',
    riskLevelText: '',
    riskColor: '#17B26A',
    riskBg: '#E7F8F0',
    riskSummary: '',
    riskHits: [],
    riskTipsTop: [],
    riskTipsAll: [],
    riskTipCount: 0,
    riskVisible: false,
    riskMode: 'view',
    riskShowCancel: true,
    riskConfirmText: '继续提交',
    riskCancelText: '取消提交'
  },

  onLoad() {
    // 该页面属于家长主链路：角色不符时自动纠正并提示（不阻断演示）
    if (app.getRole() !== ROLES.PARENT) {
      app.setRole(ROLES.PARENT);
      app.toast('已切换为家长身份');
    }
    this.setData({
      stages: STAGES.map((s) => ({ value: s.value, label: s.label })),
      timeRangeOptions: TIME_RANGES.map((t) => ({ value: t.value, label: t.label, active: false })),
      districtLabels: DISTRICTS.map((d) => d.label)
    });
    this.lastPolicy = null;
    this.pendingForm = null;
    this.lastRisk = null;
  },

  onUnload() {
    if (this._riskTimer) {
      clearTimeout(this._riskTimer);
      this._riskTimer = null;
    }
  },

  /* ================================================================
   * 一、表单交互
   * ================================================================ */

  /** 二期：选择培训类型（学科类 / 非学科类），影响科目提示与双减判定 */
  onSelectDiscipline(e) {
    const value = e.currentTarget.dataset.value || '';
    if (!value) return;
    this.setData({
      isDiscipline: value,
      disciplineSelected: true,
      // 选「学科类」时在时间段区域上方显示黄色提示条
      showRestDayTip: value === 'discipline'
    });
    this.refreshSubjectHint(this.data.subject, value);
    this.scheduleRiskCheck();
  },

  /**
   * 科目提示联动（培训类型 / 科目本身都会影响提示文案）
   * @param {string} subject 科目
   * @param {string} discipline '' | 'discipline' | 'quality'
   */
  refreshSubjectHint(subject, discipline) {
    if (!subject) {
      this.setData({ subjectHint: '' });
      return;
    }
    const group = riskService.subjectGroup(subject);
    let hint = '';
    if (discipline === 'quality' && group === 'discipline') {
      hint = '注意：您选择的是「非学科类」，但「' + subject + '」属学科类科目，请调整科目或培训类型。';
    } else if (discipline === 'discipline' && group === 'quality') {
      hint = '注意：您选择的是「学科类」，但「' + subject + '」属素质拓展科目，请确认培训类型。';
    } else if (group === 'discipline') {
      hint = '「' + subject + '」属学科类，受双减约束：不得安排在周末 / 法定节假日 / 寒暑假。';
    } else if (group === 'quality') {
      hint = '「' + subject + '」属素质拓展类，不受休息日限制。';
    }
    this.setData({ subjectHint: hint });
  },

  onSelectSubject(e) {
    const subject = e.currentTarget.dataset.value;
    this.setData({ subject: subject });
    this.refreshSubjectHint(subject, this.data.isDiscipline);
    this.scheduleRiskCheck();
  },

  /** 学段选择后联动年级选项 */
  onSelectStage(e) {
    const value = e.currentTarget.dataset.value;
    let gradeOptions = [];
    for (let i = 0; i < STAGES.length; i++) {
      if (STAGES[i].value === value) {
        gradeOptions = STAGES[i].grades;
        break;
      }
    }
    this.setData({ stageValue: value, gradeOptions: gradeOptions, grade: '' });
  },

  onSelectGrade(e) {
    this.setData({ grade: e.currentTarget.dataset.value });
    this.scheduleRiskCheck();
  },

  onSelectFrequency(e) {
    this.setData({ frequency: e.currentTarget.dataset.value });
  },

  /** 时间段多选（时间段直接影响双减判定，需触发预检） */
  onToggleTimeRange(e) {
    const index = Number(e.currentTarget.dataset.index);
    const options = this.data.timeRangeOptions.slice();
    if (!options[index]) return;
    options[index].active = !options[index].active;
    const timeRange = options.filter((o) => o.active).map((o) => o.value);
    this.setData({ timeRangeOptions: options, timeRange: timeRange });
    this.scheduleRiskCheck();
  },

  onDistrictChange(e) {
    const index = Number(e.detail.value);
    const district = DISTRICTS[index] || {};
    this.setData({
      districtIndex: index,
      district: district.value || '',
      districtLabel: district.label || ''
    });
  },

  onSelectTeachMode(e) {
    const value = e.currentTarget.dataset.value;
    this.setData({
      teachMode: value,
      addressRequired: value !== 'online',
      addressTip: value === 'online' ? '线上授课无需填写地址，可填写常用上课区域便于匹配' : '请填写小区 / 学校等具体上课地点'
    });
  },

  onAddressInput(e) {
    this.setData({ address: e.detail.value });
    this.scheduleRiskCheck();
  },

  onBudgetInput(e) {
    const field = e.currentTarget.dataset.field;
    const value = String(e.detail.value || '').replace(/[^\d]/g, '');
    const patch = {};
    patch[field] = value;
    this.setData(patch);
    this.setData({ budgetText: fmt.formatBudget(this.data.budgetMin, this.data.budgetMax) });
  },

  onRequirementInput(e) {
    const value = e.detail.value || '';
    this.setData({ specialRequirements: value, reqLength: value.length });
    this.scheduleRiskCheck();
  },

  onPhoneInput(e) {
    const value = String(e.detail.value || '').replace(/[^\d]/g, '').slice(0, 11);
    this.setData({ phone: value, maskedPhone: fmt.maskPhone(value) });
  },

  /* ================================================================
   * 二、实时预检：双减政策（硬拦） + 风险词（强提示）
   * ================================================================ */

  /** 300ms 防抖：政策预检与风险词检测一起跑 */
  scheduleRiskCheck() {
    if (this._riskTimer) clearTimeout(this._riskTimer);
    this._riskTimer = setTimeout(() => {
      this._riskTimer = null;
      this.runPolicyCheck();
      this.runRiskCheck();
    }, RISK_CHECK_DEBOUNCE);
  },

  /**
   * 双减预检（同步纯函数，与云函数共用同一套规则）
   * 命中即：渲染顶部红色阻断条 + 提交按钮置灰
   * @returns {{blocked:boolean,policy:object|null,evidence:Array,ruleA:boolean,ruleB:boolean}}
   */
  runPolicyCheck() {
    const d = this.data;
    const result = riskService.checkDoubleReduction({
      subject: d.subject,
      grade: d.grade,
      timeRange: d.timeRange,
      specialRequirements: d.specialRequirements,
      address: d.address,
      isDiscipline: d.isDiscipline
    });
    const blocked = !!result.blocked;
    this.lastPolicy = result;
    this.setData({
      policyBlocked: blocked,
      policyEvidence: result.evidence || [],
      policyTips: (result.policy && result.policy.tips) || POLICY_DOUBLE_REDUCTION.tips,
      submitText: blocked ? SUBMIT_BLOCKED_TEXT : SUBMIT_TEXT
    });
    return result;
  },

  runRiskCheck() {
    // 与 api.createDemand 内部检测的字段保持一致（specialRequirements / address / subject / grade）
    return api
      .riskCheckFields([this.data.specialRequirements, this.data.address, this.data.subject, this.data.grade])
      .then((res) => {
        if (!res || res.code !== 0) return;
        this.lastRisk = res.data;
        this.applyRisk(res.data, 'view');
      })
      .catch((err) => {
        console.warn('[demand-create] 风险检测失败：', err);
      });
  },

  /** 把风险结果写入 data（供内联提示条与 RiskAlert 共用） */
  applyRisk(risk, mode) {
    const r = risk || {};
    const theme = r.levelTheme || {};
    const hits = r.hits || [];
    const tips = r.tips || [];
    this.setData({
      hasRisk: hits.length > 0,
      riskLevel: r.level || RISK_LEVEL.LOW,
      riskLevelText: theme.text || '',
      riskColor: theme.color || '#17B26A',
      riskBg: theme.bg || '#E7F8F0',
      riskSummary: r.summary || '',
      riskHits: hits,
      riskTipsTop: tips.slice(0, 3),
      riskTipsAll: tips.slice(0, 6),
      riskTipCount: tips.length,
      riskMode: mode,
      riskShowCancel: mode === 'confirm',
      riskConfirmText:
        mode === 'confirm'
          ? r.level === RISK_LEVEL.HIGH
            ? '我已知晓风险，仍要发布'
            : '继续提交'
          : '我已知晓',
      riskCancelText: '取消提交'
    });
  },

  /** 内联提示条 ->「查看全部提示」 */
  onShowRiskDetail() {
    if (!this.lastRisk) return;
    this.applyRisk(this.lastRisk, 'view');
    this.setData({ riskVisible: true });
  },

  /** RiskAlert 关闭 / 取消：确认态下表示中止本次提交 */
  onRiskCancel() {
    const isConfirmMode = this.data.riskMode === 'confirm';
    this.setData({ riskVisible: false, submitting: false });
    if (isConfirmMode) app.toast('已取消提交');
  },

  /** RiskAlert 确认：高风险强提示后用户选择继续 */
  onRiskConfirm() {
    this.setData({ riskVisible: false });
    if (this.data.riskMode !== 'confirm') return;
    const form = this.pendingForm || this.buildForm();
    this.pendingForm = null;
    this.submitDemand(form, true);
  },

  /**
   * 政策红线阻断弹窗
   * 关键：**不提供"继续提交"选项**——双减红线不可通过确认放行，与风险词强提示有本质区别。
   * @param {object} result checkDoubleReduction 结果 或 接口返回的 data(policy/evidence)
   */
  showPolicyBlockModal(result) {
    const src = result || {};
    const policy = src.policy || {};
    const evidence = [].concat(src.evidence || policy.evidence || this.data.policyEvidence || []).filter(Boolean);
    const message = policy.message || this.data.policyMessage || POLICY_DOUBLE_REDUCTION.message;

    const lines = [];
    lines.push(message);
    if (evidence.length) {
      lines.push('');
      lines.push('【命中证据】');
      evidence.forEach((item, index) => {
        lines.push(index + 1 + '. ' + item);
      });
    }
    lines.push('');
    lines.push('请修改上课时段（改为工作日），或改为「非学科类（素质拓展）」后再提交。');
    lines.push('说明：该红线为政策硬性拦截，不能通过"确认"放行。');

    wx.showModal({
      title: '触发双减政策红线',
      content: lines.join('\n'),
      showCancel: false,
      confirmText: '去修改',
      confirmColor: '#F04438'
    });
  },

  /* ================================================================
   * 三、校验与提交
   * ================================================================ */

  validate() {
    const d = this.data;
    if (!d.isDiscipline) return '请先选择「是否为学科类培训」（双减必选项）';
    if (!d.subject) return '请选择辅导科目';
    if (!d.stageValue) return '请选择学段';
    if (!d.grade) return '请选择年级';
    if (!d.teachMode) return '请选择授课方式';
    if (d.teachMode !== 'online' && !d.address) return '线下 / 校内授课请填写上课地点';
    if (d.budgetMin && d.budgetMax && Number(d.budgetMin) > Number(d.budgetMax)) {
      return '最低预算不能高于最高预算';
    }
    if (d.phone && d.phone.length !== 11) return '手机号需填写 11 位，或留空不填';
    return '';
  },

  buildForm() {
    const d = this.data;
    return {
      /* 二期：学科类标记（'discipline' | 'quality'）——接口层据此做双减判定 */
      isDiscipline: d.isDiscipline,
      subject: d.subject,
      grade: d.grade,
      stage: d.stageValue,
      frequency: d.frequency,
      timeRange: d.timeRange,
      district: d.district,
      address: d.address,
      teachMode: d.teachMode,
      budgetMin: Number(d.budgetMin || 0),
      budgetMax: Number(d.budgetMax || d.budgetMin || 0),
      budget: Number(d.budgetMax || d.budgetMin || 0),
      specialRequirements: d.specialRequirements,
      phone: d.phone,
      deadline: ''
    };
  },

  onSubmit() {
    if (this.data.submitting) return;

    // 政策红线已命中：不提交，直接给出阻断说明（按钮已置灰，这里做二次兜底）
    if (this.data.policyBlocked) {
      this.showPolicyBlockModal(this.lastPolicy || {});
      return;
    }

    const message = this.validate();
    if (message) {
      app.toast(message);
      return;
    }

    // 提交前再跑一次双减预检（硬拦，优先于风险词检测）
    const policy = this.runPolicyCheck();
    if (policy && policy.blocked) {
      this.showPolicyBlockModal(policy);
      return;
    }

    const form = this.buildForm();
    this.pendingForm = form;
    this.setData({ submitting: true });

    // 提交前再做一次风险词检测（服务端 riskCheck 为准，mock 模式用同一套词库）
    api
      .riskCheckFields([form.specialRequirements, form.address, form.subject, form.grade])
      .then((res) => {
        const risk = res && res.code === 0 ? res.data : null;
        if (risk && risk.hits && risk.hits.length) {
          this.lastRisk = risk;
          this.setData({ submitting: false });
          this.applyRisk(risk, 'confirm');
          this.setData({ riskVisible: true });
          return;
        }
        this.submitDemand(form, false);
      })
      .catch((err) => {
        console.error('[demand-create] 提交前风险检测异常：', err);
        this.setData({ submitting: false });
        app.toast('风险检测失败，请重试');
      });
  },

  /**
   * 真正落库
   * @param {object} form 表单数据
   * @param {boolean} acknowledged 用户是否已确认风险（高风险必须为 true）
   */
  submitDemand(form, acknowledged) {
    this.setData({ submitting: true });
    api
      .createDemand(form, { riskAcknowledged: acknowledged })
      .then((res) => {
        /* ---------- 成功 ---------- */
        if (res && res.code === 0) {
          const demand = (res.data && res.data.demand) || {};
          this.setData({ submitting: false });
          app.toast('需求已发布，正在为您匹配…', 'success');
          // 用 redirectTo：避免回退到已提交的表单页
          setTimeout(() => {
            wx.redirectTo({ url: '/pages/match-result/match-result?demandId=' + demand.id });
          }, 900);
          return;
        }

        /* ---------- code 3：双减政策红线（禁止发布，不可放行） ---------- */
        if (res && res.code === 3) {
          const payload = (res && res.data) || {};
          this.setData({
            submitting: false,
            policyBlocked: true,
            policyEvidence: payload.evidence || this.data.policyEvidence,
            submitText: SUBMIT_BLOCKED_TEXT
          });
          // 只弹阻断说明 + 停留在本页，绝不跳转、绝不写入
          this.showPolicyBlockModal(payload);
          return;
        }

        /* ---------- code 2：命中高风险词，需二次确认后继续 ---------- */
        if (res && res.code === 2) {
          const risk = (res.data && res.data.risk) || this.lastRisk;
          this.setData({ submitting: false });
          if (risk) {
            this.lastRisk = risk;
            this.applyRisk(risk, 'confirm');
            this.setData({ riskVisible: true });
          } else {
            app.toast('检测到高风险表述，请调整后重新提交');
          }
          return;
        }

        this.setData({ submitting: false });
        app.toast((res && res.message) || '发布失败，请稍后重试');
      })
      .catch((err) => {
        console.error('[demand-create] 发布失败：', err);
        this.setData({ submitting: false });
        app.toast('发布失败：' + ((err && err.message) || '未知错误'));
      });
  },

  /* ---------- 其它 ---------- */

  onResetForm() {
    this.setData({
      isDiscipline: '',
      disciplineSelected: false,
      showRestDayTip: false,
      subjectHint: '',
      policyBlocked: false,
      policyEvidence: [],
      submitText: SUBMIT_TEXT,
      subject: '',
      stageValue: '',
      grade: '',
      gradeOptions: [],
      frequency: 'twice_week',
      timeRangeOptions: TIME_RANGES.map((t) => ({ value: t.value, label: t.label, active: false })),
      timeRange: [],
      districtIndex: -1,
      district: '',
      districtLabel: '',
      address: '',
      teachMode: '',
      budgetMin: '',
      budgetMax: '',
      budgetText: '面议',
      specialRequirements: '',
      reqLength: 0,
      phone: '',
      maskedPhone: '',
      hasRisk: false,
      riskHits: [],
      riskTipsTop: [],
      riskTipsAll: [],
      riskSummary: '',
      riskTipCount: 0
    });
    this.lastRisk = null;
    this.lastPolicy = null;
    this.pendingForm = null;
    app.toast('表单已重置');
  },

  /** 查看完整风险词库说明 */
  onShowRiskWords() {
    const words = riskService.COMMON_TIPS;
    wx.showModal({
      title: '避坑通用提示',
      content: words.join('\n'),
      showCancel: false,
      confirmText: '我知道了'
    });
  }
});
