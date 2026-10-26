/**
 * mock 学生档案数据（6 条）
 *
 * 字段对齐数据库集合 tutors：userId, name, gender, school, major, grade, subjects,
 * grades, tags, price, location, creditScore, certLevel, certBadgeNo, intro, avatar
 * 额外字段为 MVP 演示所需（距离、可排课时间、授课方式等），已在 README 中说明。
 *
 * 手机号 / 学号 / 邮箱均为脱敏后的假数据，绝不包含真实敏感信息。
 */
const tutors = [
  {
    id: 'tutor_001',

    // 三期：接单偏好（值域同 TEACH_TYPES）与性格特点（值域同 PERSONALITY_TAGS）
    preferences: ['long_term', 'weekend_focus'],
    personality: ['patient', 'guide'],    userId: 'user_demo_tutor_001',
    name: '林嘉怡',
    gender: 'female',
    school: 'XX大学',
    major: '数学与应用数学',
    grade: '大三',
    subjects: ['数学', '物理'],
    grades: ['初二', '初三', '高一'],
    tags: ['初三数学提升', '带过毕业班', '中考复习'],
    price: 130,
    priceRange: [120, 150],
    location: '北京市海淀区西三环北路105号',
    district: 'haidian',
    distanceKm: 3.2,
    teachModes: ['offline', 'online', 'campus'],
    availableTimes: ['weekend_morning', 'weekend_afternoon', 'weekday_evening'],
    creditScore: 92,
    certLevel: 3,
    certBadgeNo: 'JS-2026-000101',
    abilityTags: ['初三数学提升', '带过毕业班', '中考复习'],
    intro:
      'XX大学数学对口专业在读，带过两届初三毕业班，擅长把函数、几何压轴题拆成可复用解题模型；2025 年带的初三学生数学从 82 分提升到 108 分。上课前会先做 30 分钟学情诊断，课后提供错题本整理。',
    avatar: '/assets/avatar/tutor-01.png',
    avatarText: '林',
    rating: 4.9,
    orderCount: 46,
    verifiedAt: '2025-09-12 10:20',
    status: 'online',
    phone: '138****6621',
    studentNo: '1202****0918',
    email: 'lin****@cnu.edu.cn',
    highlights: ['两届初三毕业班', '学情诊断报告', '课后错题本']
  },
  {
    id: 'tutor_002',

    // 三期：接单偏好（值域同 TEACH_TYPES）与性格特点（值域同 PERSONALITY_TAGS）
    preferences: ['long_term', 'trial_once'],
    personality: ['humorous', 'warm'],    userId: 'user_demo_tutor_002',
    name: '陈知远',
    gender: 'male',
    school: 'XX大学',
    major: '汉语言文学',
    grade: '大四',
    subjects: ['语文', '历史'],
    grades: ['初一', '初二', '初三'],
    tags: ['作文批改', '阅读提升', '中考语文'],
    price: 120,
    priceRange: [110, 140],
    location: '北京市海淀区北洼路',
    district: 'haidian',
    distanceKm: 2.6,
    teachModes: ['offline', 'online'],
    availableTimes: ['weekend_afternoon', 'weekend_evening', 'weekday_evening'],
    creditScore: 88,
    certLevel: 3,
    certBadgeNo: 'JS-2026-000102',
    abilityTags: ['作文批改', '习惯养成', '带过毕业班'],
    intro:
      'XX大学中文对口专业，北京市学生教学技能大赛二等奖。作文批改按「结构—素材—语言」三层给反馈，每次课留 20 分钟当堂修改，帮助学生建立自己的素材库。',
    avatar: '/assets/avatar/tutor-02.png',
    avatarText: '陈',
    rating: 4.8,
    orderCount: 38,
    verifiedAt: '2025-09-20 14:05',
    status: 'online',
    phone: '139****3382',
    studentNo: '1201****4471',
    email: 'chen****@cnu.edu.cn',
    highlights: ['作文三层批改法', '教学技能大赛二等奖']
  },
  {
    id: 'tutor_003',

    // 三期：接单偏好（值域同 TEACH_TYPES）与性格特点（值域同 PERSONALITY_TAGS）
    preferences: ['trial_once', 'online_frag'],
    personality: ['patient', 'warm'],    userId: 'user_demo_tutor_003',
    name: '苏雨萌',
    gender: 'female',
    school: 'XX大学',
    major: '学前教育',
    grade: '大二',
    subjects: ['全科', '美术'],
    grades: ['小班', '中班', '大班', '幼小衔接'],
    tags: ['幼小衔接', '习惯养成', '亲子沟通'],
    price: 100,
    priceRange: [90, 120],
    location: '北京市朝阳区安贞西里',
    district: 'chaoyang',
    distanceKm: 5.4,
    teachModes: ['offline', 'online', 'campus'],
    availableTimes: ['weekend_morning', 'weekday_afternoon'],
    creditScore: 85,
    certLevel: 2,
    certBadgeNo: 'JS-2026-000103',
    abilityTags: ['幼小衔接', '习惯养成'],
    intro:
      '学前教育专业，持有幼儿教师资格证与普通话一级乙等证书。专注 5-6 岁幼小衔接，用游戏化方式训练专注力、握笔与拼音启蒙，每节课后会给家长一份 3 条可执行的家庭练习建议。',
    avatar: '/assets/avatar/tutor-03.png',
    avatarText: '苏',
    rating: 4.7,
    orderCount: 22,
    verifiedAt: '2025-10-08 09:30',
    status: 'online',
    phone: '137****9014',
    studentNo: '1203****2276',
    email: 'su****@cnu.edu.cn',
    highlights: ['幼儿教师资格证', '普通话一级乙等', '家庭练习建议']
  },
  {
    id: 'tutor_004',

    // 三期：接单偏好（值域同 TEACH_TYPES）与性格特点（值域同 PERSONALITY_TAGS）
    preferences: ['long_term', 'weekend_focus'],
    personality: ['strict', 'guide'],    userId: 'user_demo_tutor_004',
    name: '赵沐阳',
    gender: 'male',
    school: 'XX大学',
    major: '物理学',
    grade: '研一',
    subjects: ['物理', '数学'],
    grades: ['高一', '高二', '高三'],
    tags: ['高考复习', '物理实验', '强基计划'],
    price: 160,
    priceRange: [150, 200],
    location: '北京市西城区新街口外大街',
    district: 'xicheng',
    distanceKm: 6.8,
    teachModes: ['offline', 'online'],
    availableTimes: ['weekend_morning', 'weekend_afternoon', 'holiday'],
    creditScore: 95,
    certLevel: 3,
    certBadgeNo: 'JS-2026-000104',
    abilityTags: ['高考复习', '物理实验'],
    intro:
      'XX大学物理对口专业研究生，本科阶段连续三年家教，累计带过 11 名高三学生，擅长力学与电磁学建模；会用仿真实验演示抽象概念，帮助学生建立物理图像。',
    avatar: '/assets/avatar/tutor-04.png',
    avatarText: '赵',
    rating: 5.0,
    orderCount: 63,
    verifiedAt: '2025-08-15 16:40',
    status: 'online',
    phone: '186****7752',
    studentNo: '1101****8830',
    email: 'zhao****@cnu.edu.cn',
    highlights: ['11 名高三学生', '仿真实验演示', '强基计划']
  },
  {
    id: 'tutor_005',

    // 三期：接单偏好（值域同 TEACH_TYPES）与性格特点（值域同 PERSONALITY_TAGS）
    preferences: ['online_frag', 'weekend_focus'],
    personality: ['humorous', 'patient'],    userId: 'user_demo_tutor_005',
    name: '何雨桐',
    gender: 'female',
    school: 'XX大学',
    major: '英语',
    grade: '大三',
    subjects: ['英语'],
    grades: ['三年级', '四年级', '五年级', '六年级', '初一'],
    tags: ['英语口语', '自然拼读', '小学英语'],
    price: 115,
    priceRange: [100, 130],
    location: '北京市东城区和平里',
    district: 'dongcheng',
    distanceKm: 8.1,
    teachModes: ['online', 'offline', 'campus'],
    availableTimes: ['weekday_evening', 'weekend_morning', 'weekend_evening'],
    creditScore: 90,
    certLevel: 2,
    certBadgeNo: 'JS-2026-000105',
    abilityTags: ['英语口语', '习惯养成'],
    intro:
      '英语对口专业，专业四级优秀，曾在附属小学做过一学期英语助教。课上以自然拼读 + 情景对话为主，尽量减少中文翻译，帮助学生敢开口。',
    avatar: '/assets/avatar/tutor-05.png',
    avatarText: '何',
    rating: 4.8,
    orderCount: 31,
    verifiedAt: '2025-10-25 11:15',
    status: 'online',
    phone: '135****4408',
    studentNo: '1202****1163',
    email: 'he****@cnu.edu.cn',
    highlights: ['专四优秀', '附小助教经历', '自然拼读']
  },
  {
    id: 'tutor_006',

    // 三期：接单偏好（值域同 TEACH_TYPES）与性格特点（值域同 PERSONALITY_TAGS）
    preferences: ['online_frag', 'trial_once'],
    personality: ['guide', 'humorous'],    userId: 'user_demo_tutor_006',
    name: '郑一诺',
    gender: 'male',
    school: 'XX大学',
    major: '计算机科学与技术',
    grade: '大二',
    subjects: ['编程', '数学', '科学'],
    grades: ['四年级', '五年级', '六年级', '初一', '初二'],
    tags: ['少儿编程', '信息学入门', '兴趣培养'],
    price: 140,
    priceRange: [130, 170],
    location: '北京市昌平区回龙观',
    district: 'changping',
    distanceKm: 12.5,
    teachModes: ['online', 'campus'],
    availableTimes: ['weekend_afternoon', 'holiday'],
    creditScore: 78,
    certLevel: 1,
    certBadgeNo: 'JS-2026-000106',
    abilityTags: ['竞赛辅导'],
    intro:
      '计算机对口专业，带过少儿编程兴趣班，讲解 Scratch 与 Python 入门，课程以做出小项目为目标（小游戏、简易计算器），帮助孩子建立编程成就感。',
    avatar: '/assets/avatar/tutor-06.png',
    avatarText: '郑',
    rating: 4.6,
    orderCount: 14,
    verifiedAt: '2025-11-02 19:20',
    status: 'online',
    phone: '131****2277',
    studentNo: '1204****5560',
    email: 'zheng****@cnu.edu.cn',
    highlights: ['少儿编程兴趣班', '项目制教学']
  }
];

/** 当前登录学生（demo 角色为学生时的档案 id） */
const CURRENT_TUTOR_ID = 'tutor_001';

/** 学生三重认证记录（mock，与 certifications 集合字段一致） */
const certifications = [
  {
    id: 'cert_001',
    tutorId: 'tutor_001',
    type: 'student',
    status: 'approved',
    files: [{ name: '校园邮箱验证记录.txt', url: '' }],
    ocrResult: { verified: true, fields: { studentNo: '1202****0918', email: 'lin****@cnu.edu.cn', school: 'XX大学' } },
    reviewNote: '校园邮箱 @cnu.edu.cn 校验通过，学籍信息与院系一致。',
    createdAt: '2025-09-10 09:12'
  },
  {
    id: 'cert_002',
    tutorId: 'tutor_001',
    type: 'qualification',
    status: 'approved',
    files: [{ name: '教师资格证（mock）.jpg', url: '' }],
    ocrResult: { verified: true, fields: { certName: '高级中学教师资格证', subject: '数学', no: '2025****3312' } },
    reviewNote: '资质材料与填报学科一致（mock OCR 结果）。',
    createdAt: '2025-09-11 15:03'
  },
  {
    id: 'cert_003',
    tutorId: 'tutor_001',
    type: 'ability',
    status: 'approved',
    files: [{ name: '试讲视频链接.txt', url: 'https://example.com/mock-trial-video' }],
    ocrResult: { verified: true, fields: { tags: ['初三数学提升', '带过毕业班'], durationMin: 8 } },
    reviewNote: '试讲视频 8 分钟，讲解清晰，板书完整（mock 评审结果）。',
    createdAt: '2025-09-12 10:20'
  }
];

module.exports = {
  tutors,
  certifications,
  CURRENT_TUTOR_ID,
  /** 生成一份可写入 storage 的深拷贝，避免页面误改 mock 源数据 */
  cloneTutors: function cloneTutors() {
    return JSON.parse(JSON.stringify(tutors));
  },
  cloneCertifications: function cloneCertifications() {
    return JSON.parse(JSON.stringify(certifications));
  }
};
