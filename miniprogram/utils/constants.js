/**
 * 全局常量：品牌、角色、业务字典、风险词库、匹配权重、免责声明
 *
 * 说明：
 * - 风险词库同时在 cloudfunctions/common/riskWords.js 里有一份服务端副本，
 *   二期建议改为「只在云数据库 risk_words 集合维护，前后端都从库里读」。
 * - 所有字典项统一 { value, label } 结构，页面直接用 picker。
 */

/** 应用级配置 */
const APP_INFO = {
  name: '京师家教可信对接平台',
  shortName: '京师家教',
  slogan: '首师大师范生 · 认证可查 · 试课不满意可换',
  version: '0.2.0',
  /** true = 走微信云开发；false = 走本地 mock + storage（默认，免配置即可演示） */
  useCloud: false,
  /** 云开发环境 ID，切换到 useCloud: true 时改成自己的环境 */
  cloudEnv: 'YOUR-CLOUD-ENV-ID',
  /** 支持的高校白名单（MVP 只做首师大，二期可扩展） */
  schoolWhitelist: ['首都师范大学']
};

/** 角色 */
const ROLES = {
  PARENT: 'parent',
  TUTOR: 'tutor'
};

const ROLE_LABEL = {
  parent: '家长 / 机构',
  tutor: '首师大师范生'
};

/** 本地缓存 key（mock 模式的数据都存在这里） */
const STORAGE_KEYS = {
  ROLE: 'js_role',
  TUTOR_PROFILE_ID: 'js_tutor_profile_id',
  // 二期：种子版本号升到 v2（新增订单状态、学科类字段、打卡与评价数据）
  SEEDED: 'js_mock_seeded_v2',
  USERS: 'js_users',
  DEMANDS: 'js_demands',
  TUTORS: 'js_tutors',
  CERTIFICATIONS: 'js_certifications',
  MATCHES: 'js_matches',
  REPORTS: 'js_reports',
  APPLICATIONS: 'js_applications',
  CHECKINS: 'js_checkins',
  REVIEWS: 'js_reviews',
  RISK_ACK: 'js_risk_ack'
};

/** 风险等级 */
const RISK_LEVEL = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high'
};

const RISK_LEVEL_LABEL = {
  low: '低风险',
  medium: '中风险',
  high: '高风险'
};

/** 风险等级配色（组件里用 class 后缀） */
const RISK_LEVEL_THEME = {
  low: { color: '#17B26A', bg: '#E7F8F0', text: '低风险', desc: '未发现明显风险词，仍建议线下首次见面选在公共场所' },
  medium: { color: '#F79009', bg: '#FFF4E5', text: '中风险', desc: '检测到收费/资质类敏感表述，请在沟通中核实清楚' },
  high: { color: '#F04438', bg: '#FEECEB', text: '高风险', desc: '检测到押金、证件、贷款等典型诈骗特征，强烈建议终止对接' }
};

/**
 * 风险词库（与数据库 risk_words 集合、云函数 common/riskWords.js 保持一致）
 * level: high = 典型诈骗特征；medium = 收费/资质敏感项
 */
const RISK_WORDS = [
  { word: '交押金', category: '收费陷阱', level: 'high', tip: '任何要求先交押金的订单都极可能是骗局，正规家教不存在押金。' },
  { word: '押金', category: '收费陷阱', level: 'high', tip: '平台禁止收取押金，遇到请立即停止沟通并举报。' },
  { word: '保证金', category: '收费陷阱', level: 'high', tip: '以保证金名义收费属于典型套路，平台绝不介入资金往来。' },
  { word: '扣押证件', category: '人身与证件安全', level: 'high', tip: '任何单位或个人无权扣押他人证件，涉嫌违法，请立即终止对接。' },
  { word: '身份证', category: '人身与证件安全', level: 'medium', tip: '平台不采集身份证信息；如对方索要身份证照片或原件，请拒绝。' },
  { word: '培训贷', category: '金融风险', level: 'high', tip: '“先培训后上岗、分期还款”是培训贷典型话术，切勿签署任何贷款协议。' },
  { word: '贷款', category: '金融风险', level: 'high', tip: '家教兼职不需要任何形式的贷款，涉及贷款一律终止。' },
  { word: '日入过千', category: '虚假宣传', level: 'high', tip: '家教收入与课时挂钩，宣称“日入过千”基本是招募话术或刷单陷阱。' },
  { word: '轻松月入过万', category: '虚假宣传', level: 'high', tip: '高薪承诺往往是引流话术，请以真实课时费和结算方式为准。' },
  { word: '刷单', category: '违法违规', level: 'high', tip: '刷单本身属于违法行为，与家教无关，请直接举报。' },
  { word: '黑中介', category: '中介风险', level: 'high', tip: '无资质中介常以老乡、学长名义拉人，建议只通过平台内认证账号对接。' },
  { word: '中介费', category: '中介风险', level: 'medium', tip: '平台不收取中介费；若第三方索要中介费，请先核实其资质。' },
  { word: '先交费', category: '收费陷阱', level: 'medium', tip: '“先交费再安排学生”是常见套路，正规流程不会要求提前付费。' },
  { word: '服装费', category: '收费陷阱', level: 'medium', tip: '以服装费、工牌费名义收费属于变相收费，请拒绝。' },
  { word: '体检费', category: '收费陷阱', level: 'medium', tip: '家教岗位无强制体检要求，涉及体检费请谨慎核实。' }
];

/** 认证类型（三重认证） */
const CERT_TYPES = [
  {
    value: 'student',
    label: '学籍认证',
    desc: '校验在校学籍，确认首师大师范生身份',
    icon: '🎓'
  },
  {
    value: 'qualification',
    label: '资质认证',
    desc: '教师资格证 / 普通话证书 / 竞赛获奖证明',
    icon: '📜'
  },
  {
    value: 'ability',
    label: '能力认证',
    desc: '试讲视频 + 教学能力标签，人工/规则评审',
    icon: '🎯'
  }
];

const CERT_TYPE_LABEL = {
  student: '学籍认证',
  qualification: '资质认证',
  ability: '能力认证'
};

const CERT_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected'
};

const CERT_STATUS_LABEL = {
  pending: '审核中',
  approved: '已通过',
  rejected: '未通过'
};

/** 认证等级：0 未认证 / 1 学籍 / 2 学籍+资质 / 3 三重认证 */
const CERT_LEVELS = [
  { level: 0, label: '未认证', color: '#98A2B3', desc: '尚未提交认证材料' },
  { level: 1, label: '学籍已认证', color: '#2B6DE5', desc: '已通过学籍认证' },
  { level: 2, label: '双重认证', color: '#1F4FBF', desc: '学籍 + 资质认证通过' },
  { level: 3, label: '三重认证', color: '#17B26A', desc: '学籍 + 资质 + 能力认证全部通过' }
];

/** 能力标签（能力认证可多选） */
const ABILITY_TAGS = [
  '初三数学提分',
  '幼小衔接',
  '带过毕业班',
  '高考冲刺',
  '竞赛辅导',
  '作业辅导',
  '习惯养成',
  '英语口语',
  '物理实验',
  '作文批改',
  '艺考文化课',
  '一对一陪读'
];

/** 学科字典 */
const SUBJECTS = [
  { value: '语文', label: '语文' },
  { value: '数学', label: '数学' },
  { value: '英语', label: '英语' },
  { value: '物理', label: '物理' },
  { value: '化学', label: '化学' },
  { value: '生物', label: '生物' },
  { value: '历史', label: '历史' },
  { value: '地理', label: '地理' },
  { value: '政治', label: '政治' },
  { value: '科学', label: '科学' },
  { value: '编程', label: '编程' },
  { value: '美术', label: '美术' },
  { value: '音乐', label: '音乐' },
  { value: '体育', label: '体育' },
  { value: '全科', label: '全科辅导' }
];

/** 学段与年级 */
const STAGES = [
  { value: 'kindergarten', label: '幼儿', grades: ['小班', '中班', '大班', '幼小衔接'] },
  { value: 'primary', label: '小学', grades: ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级'] },
  { value: 'junior', label: '初中', grades: ['初一', '初二', '初三'] },
  { value: 'senior', label: '高中', grades: ['高一', '高二', '高三'] }
];

/** 扁平年级列表，供 picker 使用 */
const GRADES = STAGES.reduce((acc, stage) => acc.concat(stage.grades), []);

/** 授课方式 */
const TEACH_MODES = [
  { value: 'online', label: '线上授课', icon: '💻' },
  { value: 'offline', label: '线下上门', icon: '🏠' },
  { value: 'campus', label: '校内认证场地', icon: '🏫' }
];

/** 上课频次 */
const FREQUENCIES = [
  { value: 'once_week', label: '每周 1 次' },
  { value: 'twice_week', label: '每周 2 次' },
  { value: 'three_week', label: '每周 3 次' },
  { value: 'weekend_only', label: '仅周末' },
  { value: 'daily', label: '每天（寒暑假）' },
  { value: 'negotiable', label: '面议' }
];

/** 时间段 */
const TIME_RANGES = [
  { value: 'weekday_evening', label: '工作日晚上' },
  { value: 'weekday_afternoon', label: '工作日下午' },
  { value: 'weekend_morning', label: '周末上午' },
  { value: 'weekend_afternoon', label: '周末下午' },
  { value: 'weekend_evening', label: '周末晚上' },
  { value: 'holiday', label: '寒暑假全天' }
];

/** 北京主要城区（mock 距离计算用） */
const DISTRICTS = [
  { value: 'haidian', label: '海淀区', center: { lat: 39.959, lng: 116.298 } },
  { value: 'chaoyang', label: '朝阳区', center: { lat: 39.921, lng: 116.486 } },
  { value: 'xicheng', label: '西城区', center: { lat: 39.912, lng: 116.366 } },
  { value: 'dongcheng', label: '东城区', center: { lat: 39.928, lng: 116.416 } },
  { value: 'fengtai', label: '丰台区', center: { lat: 39.858, lng: 116.286 } },
  { value: 'shijingshan', label: '石景山区', center: { lat: 39.906, lng: 116.223 } },
  { value: 'changping', label: '昌平区', center: { lat: 40.220, lng: 116.231 } },
  { value: 'tongzhou', label: '通州区', center: { lat: 39.909, lng: 116.657 } }
];

/** 需求状态 */
const DEMAND_STATUS = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  MATCHING: 'matching',
  MATCHED: 'matched',
  CLOSED: 'closed',
  RISK_BLOCKED: 'risk_blocked'
};

const DEMAND_STATUS_LABEL = {
  draft: '草稿',
  published: '招募中',
  matching: '匹配中',
  matched: '已匹配',
  closed: '已结束',
  risk_blocked: '风险拦截'
};

/** 申请状态 */
const APPLY_STATUS = {
  APPLIED: 'applied',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected'
};

const APPLY_STATUS_LABEL = {
  applied: '待家长确认',
  accepted: '家长已同意',
  rejected: '未通过'
};

/**
 * 匹配打分权重（总分 100）
 * 科目 40 + 年级 20 + 时间地点 15 + 价格 10 + 信用分 10 + 认证完整度 5
 */
const MATCH_WEIGHTS = {
  subject: 40,
  grade: 20,
  timePlace: 15,
  price: 10,
  credit: 10,
  cert: 5
};

/** 接单池排序权重（匹配度 + 距离 + 价格 + 信用分） */
const POOL_WEIGHTS = {
  match: 0.5,
  distance: 0.2,
  price: 0.15,
  credit: 0.15
};

/** 默认搜索/匹配半径（km） */
const MATCH_CONFIG = {
  topN: 3,
  maxDistanceKm: 20,
  /** 价格超出预算的容忍比例，用于价格分梯度 */
  priceTolerance: 0.2
};

/** 免责声明（多处复用，必须展示） */
const DISCLAIMER = {
  short: '平台仅提供可信对接与能力认证服务，非学历培训、非办学资质、非医疗建议。',
  full: [
    '本平台由高校学生团队运营，仅提供家长与师范生之间的可信对接与能力认证展示服务。',
    '平台非学历培训机构、非办学资质主体、非医疗或心理咨询机构，不提供任何形式的学科培训办学服务。',
    '平台不参与资金往来，不提供支付、担保、结算功能，任何收费要求请谨慎核实（资金担保结算为二期规划）。',
    '认证信息由学生自主提交、平台按规则校验，平台不采集真实身份证号、学号等敏感信息，展示内容已做脱敏处理。',
    '未成年人线下上课需监护人全程知情并同意，平台建议优先选择线上授课或校内认证场地。',
    '对接过程中如遇押金、扣押证件、培训贷、刷单等情形，请立即终止并保留证据报警。'
  ]
};

/** 平台信任文案（首页展示） */
const TRUST_POINTS = [
  { icon: '✅', title: '认证可查', desc: '三重认证编号可核验' },
  { icon: '🔁', title: '试课可换', desc: '试课不满意可换人' },
  { icon: '🛡️', title: '学生零押金', desc: '平台不收任何押金' }
];

/** 页码/数量限制 */
const PAGE_SIZE = 20;

/* ================================================================
 * 二期：双减合规 / 履约打卡 / 双向盲评 / 信用分
 * ================================================================ */

/**
 * 平台定位声明（合规红线：所有页面底部必须展示）
 * 与免责声明不同，这句是「业务性质声明」，用于回应"是否在办培训机构"的质疑。
 */
const PLATFORM_POSITION = '本平台仅为个人零星家教信息撮合，非培训机构，不提供固定办学场所';
const PLATFORM_POSITION_LONG =
  '本平台仅为个人零星家教信息撮合平台：非培训机构、非办学主体，不提供固定办学场所，不组织、不安排、不代收任何形式的培训费用，亦不开展学科类培训业务。平台仅提供信息展示、身份与能力认证、风险提示等技术服务。';

/** 学科类科目（双减监管范围：语数外理化生 + 政史地） */
const DISCIPLINE_SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理'];

/** 素质拓展科目（不受休息日限制） */
const QUALITY_SUBJECTS = ['美术', '音乐', '体育', '编程', '科学'];

/** 休息日 / 节假日 / 寒暑假时段（双减禁止开展学科类培训的时间） */
const REST_DAY_TIME_RANGES = ['weekend_morning', 'weekend_afternoon', 'weekend_evening', 'holiday'];
const REST_DAY_KEYWORDS = [
  '周末', '周六', '周日', '双休', '节假日', '法定节假日',
  '寒暑假', '寒假', '暑假', '假期', '小长假'
];

/** 学龄前 / 幼小衔接学段（学科类培训一律受限，休息日更属明确违规） */
const EARLY_CHILDHOOD_GRADES = ['小班', '中班', '大班', '幼小衔接', '学前班'];
const EARLY_CHILDHOOD_KEYWORDS = ['幼小衔接', '学前班'];

/**
 * 双减红线（前端弹窗、云函数、数据库 riskHits 共用同一套文案，不可各自表述）
 * TODO(二期+)：政策口径如需更新，只改这一处 + cloudfunctions/common/riskWords.js
 */
const POLICY_DOUBLE_REDUCTION = {
  code: 'DOUBLE_REDUCTION',
  level: 'high',
  title: '⚠️ 触发双减政策红线',
  message: '根据双减政策，严禁在休息日及节假日开展学科类培训，请勿发布违规需求',
  tips: [
    '学科类（语文、数学、英语、物理、化学、生物等）不得在周末、法定节假日、寒暑假开展培训。',
    '学龄前儿童（含幼小衔接、学前班）不得开展学科类培训。',
    '如需在休息日安排，可改为素质拓展类（美术、音乐、体育、编程、科学等），或改到工作日晚上。',
    '本平台仅为个人零星家教信息撮合，不提供固定办学场所，也不组织任何形式的学科类培训。'
  ]
};

/** 发布需求表单：是否学科类（新增必选项） */
const DISCIPLINE_OPTIONS = [
  {
    value: 'discipline',
    label: '学科类',
    sub: '语文 / 数学 / 英语 / 物理 / 化学 / 生物等',
    desc: '受双减约束：不得在周末、法定节假日、寒暑假开展'
  },
  {
    value: 'quality',
    label: '非学科类（素质拓展）',
    sub: '美术 / 音乐 / 体育 / 编程 / 科学',
    desc: '素质拓展不受休息日限制'
  }
];

/** 接单池：科目 Tab（「素质拓展」聚合所有非学科类科目） */
const POOL_SUBJECT_TABS = [
  { value: 'all', label: '全部' },
  { value: '语文', label: '语文' },
  { value: '数学', label: '数学' },
  { value: '英语', label: '英语' },
  { value: '物理', label: '物理' },
  { value: '化学', label: '化学' },
  { value: 'quality', label: '素质拓展' }
];

/** 接单池：授课方式 Tab */
const POOL_MODE_TABS = [
  { value: 'all', label: '全部' },
  { value: 'online', label: '线上' },
  { value: 'offline', label: '线下' },
  { value: 'campus', label: '校内场地' }
];

/** 订单状态（接单池状态 Tabs 与详情页角标共用） */
const ORDER_STATUS_TABS = [
  { value: 'published', label: '招募中', desc: '可投递' },
  { value: 'matching', label: '匹配中', desc: '面试/试课中' },
  { value: 'matched', label: '已匹配', desc: '已成单' }
];

/** 接单池排序规则说明（与 POOL_WEIGHTS 一致，禁止写死数字） */
const POOL_SORT_NOTE = '排序规则：匹配度50% + 距离20% + 价格15% + 信用分15%';

/** 打卡状态 */
const CHECKIN_STATUS = {
  CHECKED_IN: 'checked_in', // 已打卡，进行中
  FINISHED: 'finished',     // 已结束打卡，待家长确认小结
  CONFIRMED: 'confirmed'    // 家长已确认
};

const CHECKIN_STATUS_LABEL = {
  checked_in: '已打卡（进行中）',
  finished: '待家长确认',
  confirmed: '家长已确认'
};

const CHECKIN_STATUS_THEME = {
  checked_in: { color: '#2B6DE5', bg: '#EAF1FF' },
  finished: { color: '#F79009', bg: '#FFF4E5' },
  confirmed: { color: '#17B26A', bg: '#E7F8F0' }
};

/** 打卡 mock 定位（MVP 不采集真实定位，不申请 scope.userLocation） */
const MOCK_CHECKIN_LOCATION = {
  name: '校内认证场地（mock 定位）',
  address: '北京市海淀区西三环北路 105 号',
  latitude: 39.959,
  longitude: 116.298,
  mock: true
};

/** 双向盲评标签 */
const REVIEW_TAGS = {
  parent_to_tutor: ['准时', '专业', '耐心', '提分帮助', '沟通顺畅'],
  tutor_to_parent: ['尊重老师', '付款及时', '环境安全', '诉求合理']
};

const REVIEW_DIRECTION_LABEL = {
  parent_to_tutor: '家长评老师',
  tutor_to_parent: '老师评家长'
};

const REVIEW_STATUS = {
  PENDING: 'pending',   // 已提交，等待对方评价（内容不可见）
  REVEALED: 'revealed'  // 双方均已评价，互相可见
};

/**
 * 信用分规则（评价后动态更新）
 * rating 5 分 +3、1 分 -4；每命中 1 个正向标签 +0.5（最多计 3 个）；上下限 60~100
 */
const CREDIT_RULES = {
  base: 80,
  min: 60,
  max: 100,
  byRating: { 5: 3, 4: 1.5, 3: 0, 2: -2, 1: -4 },
  tagBonus: 0.5,
  maxTagBonusCount: 3
};

/** 试课建议（对接报告、匹配页、报告文本统一文案） */
const TRIAL_ADVICE =
  '试课建议：建议先通过线上或在校内认证场地进行首次试课，需监护人知情。';

/** 履约相关固定文案 */
const FULFILLMENT = {
  checkinTitle: '上课打卡',
  checkinDesc:
    '打卡会记录本次上课的开始时间与定位，作为履约凭证，防止克扣课时费（MVP 为 mock 定位，不采集真实位置）。',
  summaryPlaceholder: '今日授课小结：本次课讲了什么、孩子掌握情况、下次课计划（家长可见）',
  reviewBlindTip:
    '双向盲评：双方都提交评价后才能看到对方的评价内容，避免互相影响判断。'
};

module.exports = {
  APP_INFO,
  ROLES,
  ROLE_LABEL,
  STORAGE_KEYS,
  RISK_LEVEL,
  RISK_LEVEL_LABEL,
  RISK_LEVEL_THEME,
  RISK_WORDS,
  CERT_TYPES,
  CERT_TYPE_LABEL,
  CERT_STATUS,
  CERT_STATUS_LABEL,
  CERT_LEVELS,
  ABILITY_TAGS,
  SUBJECTS,
  STAGES,
  GRADES,
  TEACH_MODES,
  FREQUENCIES,
  TIME_RANGES,
  DISTRICTS,
  DEMAND_STATUS,
  DEMAND_STATUS_LABEL,
  APPLY_STATUS,
  APPLY_STATUS_LABEL,
  MATCH_WEIGHTS,
  POOL_WEIGHTS,
  MATCH_CONFIG,
  DISCLAIMER,
  TRUST_POINTS,
  PAGE_SIZE,

  /* 二期 */
  PLATFORM_POSITION,
  PLATFORM_POSITION_LONG,
  DISCIPLINE_SUBJECTS,
  QUALITY_SUBJECTS,
  REST_DAY_TIME_RANGES,
  REST_DAY_KEYWORDS,
  EARLY_CHILDHOOD_GRADES,
  EARLY_CHILDHOOD_KEYWORDS,
  POLICY_DOUBLE_REDUCTION,
  DISCIPLINE_OPTIONS,
  POOL_SUBJECT_TABS,
  POOL_MODE_TABS,
  ORDER_STATUS_TABS,
  POOL_SORT_NOTE,
  CHECKIN_STATUS,
  CHECKIN_STATUS_LABEL,
  CHECKIN_STATUS_THEME,
  MOCK_CHECKIN_LOCATION,
  REVIEW_TAGS,
  REVIEW_DIRECTION_LABEL,
  REVIEW_STATUS,
  CREDIT_RULES,
  TRIAL_ADVICE,
  FULFILLMENT
};
