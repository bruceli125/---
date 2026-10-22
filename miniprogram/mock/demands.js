/**
 * mock 家教需求（二期：7 条）
 *
 * 二期变化：
 * 1. 新增 isDiscipline（学科类 / 素质拓展）与 subjectGroup 字段，供双减规则与接单池科目 Tab 使用；
 * 2. 所有「已发布 / 已匹配」的种子需求都改为**合规**时段——避免种子数据本身违反双减红线
 *    （学科类不得在周末、法定节假日、寒暑假开展）；
 * 3. 新增 demo_demand_005（已匹配订单，用于履约打卡与双向盲评演示）与
 *    demo_demand_006（素质拓展 + 周末，用于证明素质类不受休息日限制）；
 * 4. 新增 matchedTutorId / acceptedAt 字段，标记成单关系（MVP：一个需求对应一个订单）。
 *
 * 字段对齐数据库集合 demands；时间字段为字符串，便于前端直接展示。
 */
const { RISK_LEVEL, DEMAND_STATUS } = require('../utils/constants.js');

/** 当前登录家长（demo 角色为家长时的用户 id） */
const CURRENT_PARENT_ID = 'parent_demo_001';

const demands = [
  {
    id: 'demo_demand_001',

    // 三期：授课类型 + 期望性格 + 双向确认标记
    teachType: 'long_term',
    expectedPersonality: ['patient'],
    studentConfirmed: false,
    parentConfirmed: false,    parentId: 'parent_demo_001',
    parentName: '王女士',
    contactPhone: '138****6621',
    subject: '数学',
    subjectGroup: 'discipline',
    isDiscipline: 'discipline',
    grade: '初三',
    stage: 'junior',
    frequency: 'twice_week',
    // 合规：学科类安排在工作日晚上（不得放在周末/节假日）
    timeRange: ['weekday_evening'],
    timeRangeText: '工作日晚上 19:00-21:00',
    address: '北京市海淀区西三环北路 105 号院 3 号楼',
    district: 'haidian',
    teachMode: 'offline',
    budget: 140,
    budgetMin: 120,
    budgetMax: 140,
    specialRequirements:
      '孩子初三，函数和几何压轴题比较薄弱，希望老师能带着做专项突破；每周需要一次错题复盘。孩子性格偏内向，希望老师耐心一些。上课时间只能安排在工作日晚上，周末孩子有其他安排。',
    riskLevel: RISK_LEVEL.LOW,
    riskHits: [],
    policyChecked: true,
    riskAcknowledged: true,
    status: DEMAND_STATUS.PUBLISHED,
    createdAt: '2026-01-08 19:24',
    applyCount: 2,
    viewCount: 37,
    deadline: '2026-02-28',
    matchedTutorId: ''
  },
  {
    id: 'demo_demand_002',

    // 三期：授课类型 + 期望性格 + 双向确认标记
    teachType: 'weekend_focus',
    expectedPersonality: ['humorous'],
    studentConfirmed: false,
    parentConfirmed: false,    parentId: 'parent_demo_002',
    parentName: '李先生',
    contactPhone: '139****3382',
    // 合规：素质拓展类（美术），不受休息日限制，作为"周末 + 非学科类"的正面样例
    subject: '美术',
    subjectGroup: 'quality',
    isDiscipline: 'quality',
    grade: '幼小衔接',
    stage: 'kindergarten',
    frequency: 'three_week',
    timeRange: ['weekday_afternoon', 'weekend_morning'],
    timeRangeText: '工作日下午 / 周末上午',
    address: '北京市朝阳区安贞西里 2 区 12 号楼',
    district: 'chaoyang',
    teachMode: 'offline',
    budget: 110,
    budgetMin: 90,
    budgetMax: 110,
    specialRequirements:
      '孩子 5 岁半，明年上小学，想通过美术启蒙训练专注力和手部精细动作（不涉及拼音、识字等学科内容）。另外说明：不接受任何中介费，请直接联系家长本人。',
    riskLevel: RISK_LEVEL.MEDIUM,
    riskHits: [
      { word: '中介费', category: '中介风险', level: 'medium', tip: '平台不收取中介费；若第三方索要中介费，请先核实其资质。' }
    ],
    policyChecked: true,
    riskAcknowledged: true,
    status: DEMAND_STATUS.PUBLISHED,
    createdAt: '2026-01-09 10:02',
    applyCount: 1,
    viewCount: 21,
    deadline: '2026-03-15',
    matchedTutorId: ''
  },
  {
    id: 'demo_demand_003',

    // 三期：授课类型 + 期望性格 + 双向确认标记
    teachType: 'trial_once',
    expectedPersonality: ['warm'],
    studentConfirmed: false,
    parentConfirmed: false,    parentId: 'parent_demo_003',
    parentName: '张先生',
    contactPhone: '137****9014',
    subject: '物理',
    subjectGroup: 'discipline',
    isDiscipline: 'discipline',
    grade: '高一',
    stage: 'senior',
    frequency: 'once_week',
    // 合规：学科类放在工作日晚上
    timeRange: ['weekday_evening'],
    timeRangeText: '工作日晚上',
    address: '北京市西城区新街口外大街 12 号',
    district: 'xicheng',
    teachMode: 'online',
    budget: 180,
    budgetMin: 150,
    budgetMax: 180,
    specialRequirements:
      '孩子刚上高一，力学部分跟不上，希望老师用实验或动画帮助理解，每次课后留 3 道巩固题。',
    riskLevel: RISK_LEVEL.LOW,
    riskHits: [],
    policyChecked: true,
    riskAcknowledged: true,
    status: DEMAND_STATUS.MATCHING,
    createdAt: '2026-01-10 08:41',
    applyCount: 2,
    viewCount: 12,
    deadline: '2026-02-20',
    matchedTutorId: ''
  },
  {
    id: 'demo_demand_004',

    // 三期：授课类型 + 期望性格 + 双向确认标记
    teachType: 'long_term',
    expectedPersonality: ['strict'],
    studentConfirmed: false,
    parentConfirmed: false,    parentId: 'parent_demo_004',
    parentName: '赵女士',
    contactPhone: '186****7752',
    subject: '英语',
    subjectGroup: 'discipline',
    isDiscipline: 'discipline',
    grade: '高二',
    stage: 'senior',
    frequency: 'twice_week',
    timeRange: ['weekday_evening'],
    timeRangeText: '工作日晚上',
    address: '北京市东城区和平里七区',
    district: 'dongcheng',
    teachMode: 'online',
    budget: 150,
    budgetMin: 130,
    budgetMax: 150,
    // 高风险词样例：用于演示"强提示"（收费/证件类），与双减无关
    specialRequirements:
      '需要老师带高二英语阅读与写作。特别说明：我们是正规机构，上岗前需要先交费参加 3 天培训，培训后日入过千，培训期间不收取押金但需要提供身份证复印件备案。',
    riskLevel: RISK_LEVEL.HIGH,
    riskHits: [
      { word: '先交费', category: '收费陷阱', level: 'medium', tip: '“先交费再安排学生”是常见套路，正规流程不会要求提前付费。' },
      { word: '日入过千', category: '虚假宣传', level: 'high', tip: '家教收入与课时挂钩，宣称“日入过千”基本是招募话术或刷单陷阱。' },
      { word: '押金', category: '收费陷阱', level: 'high', tip: '平台禁止收取押金，遇到请立即停止沟通并举报。' },
      { word: '身份证', category: '人身与证件安全', level: 'medium', tip: '平台不采集身份证信息；如对方索要身份证照片或原件，请拒绝。' }
    ],
    policyChecked: true,
    riskAcknowledged: true,
    status: DEMAND_STATUS.PUBLISHED,
    createdAt: '2026-01-11 21:15',
    applyCount: 0,
    viewCount: 9,
    deadline: '2026-02-10',
    matchedTutorId: ''
  },
  {
    id: 'demo_demand_005',

    // 三期：授课类型 + 期望性格 + 双向确认标记
    teachType: 'long_term',
    expectedPersonality: ['patient'],
    studentConfirmed: false,
    parentConfirmed: false,    parentId: 'parent_demo_001',
    parentName: '王女士',
    contactPhone: '138****6621',
    subject: '数学',
    subjectGroup: 'discipline',
    isDiscipline: 'discipline',
    grade: '六年级',
    stage: 'primary',
    frequency: 'once_week',
    // 合规：学科类在工作日晚上；该单已匹配，用于履约打卡 + 双向盲评演示
    timeRange: ['weekday_evening'],
    timeRangeText: '工作日晚上',
    address: '北京市昌平区回龙观龙泽苑东区',
    district: 'changping',
    teachMode: 'campus',
    budget: 120,
    budgetMin: 100,
    budgetMax: 120,
    specialRequirements: '小升初数学思维训练，希望在校内认证场地授课，家长全程陪同。',
    riskLevel: RISK_LEVEL.LOW,
    riskHits: [],
    policyChecked: true,
    riskAcknowledged: true,
    status: DEMAND_STATUS.MATCHED,
    createdAt: '2025-12-28 16:30',
    applyCount: 3,
    viewCount: 54,
    deadline: '2026-01-31',
    matchedTutorId: 'tutor_001',
    acceptedAt: '2026-01-03 20:12'
  },
  {
    id: 'demo_demand_006',

    // 三期：授课类型 + 期望性格 + 双向确认标记
    teachType: 'weekend_focus',
    expectedPersonality: ['guide'],
    studentConfirmed: false,
    parentConfirmed: false,    parentId: 'parent_demo_003',
    parentName: '张先生',
    contactPhone: '137****9014',
    // 素质拓展 + 周末：用于证明"非学科类不受休息日限制"
    subject: '编程',
    subjectGroup: 'quality',
    isDiscipline: 'quality',
    grade: '五年级',
    stage: 'primary',
    frequency: 'weekend_only',
    timeRange: ['weekend_afternoon'],
    timeRangeText: '周末下午',
    address: '北京市西城区新街口外大街 12 号',
    district: 'xicheng',
    teachMode: 'online',
    budget: 160,
    budgetMin: 140,
    budgetMax: 160,
    specialRequirements: '孩子对 Scratch 感兴趣，希望用周末时间做一个完整的期末小项目，不涉及学科类内容。',
    riskLevel: RISK_LEVEL.LOW,
    riskHits: [],
    policyChecked: true,
    riskAcknowledged: true,
    status: DEMAND_STATUS.PUBLISHED,
    createdAt: '2026-01-12 09:05',
    applyCount: 0,
    viewCount: 6,
    deadline: '2026-03-01',
    matchedTutorId: ''
  },
  {
    id: 'demo_demand_007',

    // 三期：授课类型 + 期望性格 + 双向确认标记
    teachType: 'online_frag',
    expectedPersonality: ['guide'],
    studentConfirmed: false,
    parentConfirmed: false,    parentId: 'parent_demo_005',
    parentName: '孙女士',
    contactPhone: '135****4408',
    subject: '化学',
    subjectGroup: 'discipline',
    isDiscipline: 'discipline',
    grade: '初三',
    stage: 'junior',
    frequency: 'once_week',
    timeRange: ['weekday_evening'],
    timeRangeText: '工作日晚上',
    address: '北京市海淀区万寿路',
    district: 'haidian',
    teachMode: 'campus',
    budget: 130,
    budgetMin: 120,
    budgetMax: 130,
    specialRequirements: '中考化学冲刺，需要老师梳理实验题答题模板。',
    riskLevel: RISK_LEVEL.LOW,
    riskHits: [],
    policyChecked: true,
    riskAcknowledged: true,
    status: DEMAND_STATUS.CLOSED,
    createdAt: '2025-11-20 18:20',
    applyCount: 4,
    viewCount: 88,
    deadline: '2025-12-31',
    matchedTutorId: 'tutor_004',
    acceptedAt: '2025-11-25 10:00'
  }
];

module.exports = {
  demands,
  CURRENT_PARENT_ID,
  cloneDemands: function cloneDemands() {
    return JSON.parse(JSON.stringify(demands));
  }
};
