/* ============================================================================
 * data.js —— 演示数据集
 * 全部为脱敏假数据，字段与微信小程序端（mock/demands.js、checkins.js、
 * reviews.js）保持一致，方便二期把 Web 控制台接到真实接口时直接替换。
 * ========================================================================== */
(function (global) {
  'use strict';

  /* ---------------- 顶部 KPI ---------------- */
  var kpis = [
    {
      key: 'demands',
      label: '本周新增需求',
      value: 128,
      unit: '单',
      delta: 12.4,
      icon: 'demand',
      spark: [42, 51, 47, 62, 58, 71, 69, 78, 74, 86, 92, 88, 104, 128]
    },
    {
      key: 'pending',
      label: '待审核认证',
      value: 37,
      unit: '份',
      delta: -8.2,
      icon: 'shield',
      spark: [61, 58, 63, 57, 52, 55, 49, 46, 44, 41, 43, 39, 38, 37]
    },
    {
      key: 'blocked',
      label: '合规拦截',
      value: 14,
      unit: '次',
      delta: 21.6,
      icon: 'alert',
      spark: [3, 5, 4, 7, 6, 9, 8, 11, 9, 12, 10, 13, 12, 14]
    },
    {
      key: 'score',
      label: '平均匹配分',
      value: 86.4,
      unit: '分',
      delta: 1.8,
      icon: 'target',
      spark: [78, 79, 80, 79, 81, 82, 81, 83, 84, 83, 85, 86, 85, 86.4],
      decimals: 1
    }
  ];

  /* ---------------- 需求 / 匹配趋势（近 14 天） ---------------- */
  var trend = {
    labels: ['10-07', '10-08', '10-09', '10-10', '10-11', '10-12', '10-13', '10-14', '10-15', '10-16', '10-17', '10-18', '10-19', '10-20'],
    series: [
      { name: '新增需求', data: [8, 11, 9, 14, 17, 12, 15, 19, 16, 22, 25, 21, 27, 31], color: 'var(--accent)', type: 'area' },
      { name: '完成匹配', data: [5, 7, 8, 10, 12, 9, 13, 15, 14, 18, 21, 19, 23, 26], color: 'var(--teal)', type: 'line' }
    ]
  };

  /* ---------------- 三重认证转化漏斗 ---------------- */
  var certFunnel = [
    { label: '提交认证', value: 240 },
    { label: '学籍通过', value: 218 },
    { label: '资质通过', value: 176 },
    { label: '能力通过', value: 129 }
  ];

  /* ---------------- 风险词命中分布 ---------------- */
  var riskDistribution = {
    labels: ['交押金/押金', '中介费', '培训贷', '扣押证件', '刷单'],
    series: [{ name: '命中次数', data: [32, 18, 11, 7, 5], color: 'var(--amber)', type: 'bar' }]
  };

  /* ---------------- 双减合规分布 ---------------- */
  var policySplit = [
    { label: '通过合规校验', value: 98, color: 'var(--teal)' },
    { label: '学科类 × 休息日', value: 22, color: 'var(--danger)' },
    { label: '学龄前 × 休息日', value: 8, color: 'var(--amber)' }
  ];

  /* ---------------- 履约打卡热力（近 8 周 × 7 天，0-4 强度） ---------------- */
  var heatmap = (function () {
    var weeks = 8;
    var days = 7;
    var grid = [];
    var seed = 7;
    for (var w = 0; w < weeks; w++) {
      var row = [];
      for (var d = 0; d < days; d++) {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        var base = seed / 2147483648;
        // 工作日活跃、周末（5/6）明显偏低，符合"学科类只能工作日"的业务事实
        var weight = d >= 5 ? 0.22 : 0.92;
        row.push(Math.min(4, Math.floor(base * weight * 5)));
      }
      grid.push(row);
    }
    return grid;
  })();

  /* ---------------- 需求工单 ---------------- */
  var demands = [
    {
      id: 'DEM-0184', parent: '王女士', phone: '138****6621', subject: '数学', grade: '初三',
      mode: '线下上门', district: '海淀区', budget: '120-140', frequency: '每周 2 次',
      timeRange: '工作日晚上', discipline: 'discipline', status: 'matching',
      risk: 'low', policy: 'pass', score: 99.2, tutor: '林嘉怡', createdAt: '2026-10-19 19:24',
      requirement: '函数与几何压轴题专项突破，每周一次错题复盘；孩子偏内向，希望老师耐心。'
    },
    {
      id: 'DEM-0183', parent: '赵女士', phone: '186****7752', subject: '英语', grade: '高二',
      mode: '线上授课', district: '东城区', budget: '130-150', frequency: '每周 2 次',
      timeRange: '工作日晚上', discipline: 'discipline', status: 'published',
      risk: 'high', policy: 'pass', score: 88.5, tutor: '待匹配', createdAt: '2026-10-19 21:15',
      requirement: '需要先交费参加 3 天培训，培训后日入过千，需提供身份证复印件备案。',
      riskHits: ['先交费', '日入过千', '押金', '身份证']
    },
    {
      id: 'DEM-0182', parent: '李先生', phone: '139****3382', subject: '美术', grade: '幼小衔接',
      mode: '线下上门', district: '朝阳区', budget: '90-110', frequency: '每周 3 次',
      timeRange: '工作日下午 / 周末上午', discipline: 'quality', status: 'published',
      risk: 'medium', policy: 'pass', score: 74.0, tutor: '待匹配', createdAt: '2026-10-19 10:02',
      requirement: '美术启蒙训练专注力与手部精细动作（不涉及拼音、识字）。不接受中介费。',
      riskHits: ['中介费']
    },
    {
      id: 'DEM-0181', parent: '孙女士', phone: '135****4408', subject: '化学', grade: '初三',
      mode: '校内场地', district: '海淀区', budget: '120-130', frequency: '每周 1 次',
      timeRange: '工作日晚上', discipline: 'discipline', status: 'matched',
      risk: 'low', policy: 'pass', score: 91.6, tutor: '赵沐阳', createdAt: '2026-10-18 18:20',
      requirement: '中考化学冲刺，需要老师梳理实验题答题模板。'
    },
    {
      id: 'DEM-0180', parent: '周先生', phone: '137****9014', subject: '数学', grade: '初二',
      mode: '线上授课', district: '西城区', budget: '140-150', frequency: '每周 2 次',
      timeRange: '周末上午', discipline: 'discipline', status: 'blocked',
      risk: 'low', policy: 'blocked', score: 0, tutor: '—', createdAt: '2026-10-18 15:41',
      requirement: '希望周六周日上午补数学，集中冲刺期中考试。',
      policyEvidence: ['学科类科目：数学', '休息日/节假日时段：周末上午']
    },
    {
      id: 'DEM-0179', parent: '吴女士', phone: '131****2277', subject: '编程', grade: '五年级',
      mode: '线上授课', district: '昌平区', budget: '140-160', frequency: '仅周末',
      timeRange: '周末下午', discipline: 'quality', status: 'matching',
      risk: 'low', policy: 'pass', score: 82.3, tutor: '郑一诺', createdAt: '2026-10-18 09:05',
      requirement: 'Scratch 做一个完整的期末小项目，不涉及学科类内容。'
    },
    {
      id: 'DEM-0178', parent: '郑先生', phone: '138****0031', subject: '物理', grade: '高一',
      mode: '线上授课', district: '西城区', budget: '150-180', frequency: '每周 1 次',
      timeRange: '工作日晚上', discipline: 'discipline', status: 'matched',
      risk: 'low', policy: 'pass', score: 87.9, tutor: '赵沐阳', createdAt: '2026-10-17 20:12',
      requirement: '力学部分跟不上，希望用实验或动画帮助理解，每次课后留 3 道巩固题。'
    },
    {
      id: 'DEM-0177', parent: '何女士', phone: '135****4408', subject: '英语', grade: '六年级',
      mode: '线上线下均可', district: '东城区', budget: '100-130', frequency: '每周 3 次',
      timeRange: '工作日晚上', discipline: 'discipline', status: 'closed',
      risk: 'medium', policy: 'pass', score: 79.4, tutor: '何雨桐', createdAt: '2026-10-16 11:30',
      requirement: '自然拼读 + 情景对话，希望老师尽量少用中文翻译。',
      riskHits: ['先交费']
    },
    {
      id: 'DEM-0176', parent: '张先生', phone: '186****7752', subject: '全科', grade: '幼小衔接',
      mode: '线下上门', district: '朝阳区', budget: '100-120', frequency: '每周 3 次',
      timeRange: '周末上午', discipline: 'discipline', status: 'blocked',
      risk: 'medium', policy: 'blocked', score: 0, tutor: '—', createdAt: '2026-10-16 09:18',
      requirement: '幼小衔接拼音、识字，周六上午上门。',
      policyEvidence: ['学科类科目：全科', '学龄前/幼小衔接学段：幼小衔接', '休息日/节假日时段：周末上午']
    },
    {
      id: 'DEM-0175', parent: '陈女士', phone: '139****3382', subject: '数学', grade: '六年级',
      mode: '校内场地', district: '昌平区', budget: '100-120', frequency: '每周 1 次',
      timeRange: '工作日晚上', discipline: 'discipline', status: 'matched',
      risk: 'low', policy: 'pass', score: 93.1, tutor: '林嘉怡', createdAt: '2026-10-15 16:30',
      requirement: '小升初数学思维训练，校内认证场地授课，家长全程陪同。'
    },
    {
      id: 'DEM-0174', parent: '黄先生', phone: '137****6621', subject: '物理', grade: '高三',
      mode: '线上授课', district: '通州区', budget: '180-220', frequency: '每周 2 次',
      timeRange: '工作日晚上', discipline: 'discipline', status: 'matching',
      risk: 'low', policy: 'pass', score: 90.2, tutor: '赵沐阳', createdAt: '2026-10-15 08:44',
      requirement: '高考物理二轮复习，重点电学实验与图像法。'
    },
    {
      id: 'DEM-0173', parent: '刘女士', phone: '131****9987', subject: '音乐', grade: '三年级',
      mode: '线下上门', district: '海淀区', budget: '120-150', frequency: '每周 1 次',
      timeRange: '周末上午', discipline: 'quality', status: 'published',
      risk: 'low', policy: 'pass', score: 68.5, tutor: '待匹配', createdAt: '2026-10-14 14:20',
      requirement: '钢琴陪练，孩子学琴两年，需要纠正手型与节奏。'
    }
  ];

  /* ---------------- 学生（认证审核队列） ---------------- */
  var tutors = [
    {
      id: 'TUT-0101', name: '林嘉怡', gender: '女', school: 'XX大学', major: '数学与应用数学',
      grade: '大三', certLevel: 3, badgeNo: 'JS-2026-000101', credit: 92, price: 130,
      studentNo: '1202****0918', email: 'lin****@cnu.edu.cn', phone: '138****6621',
      subjects: ['数学', '物理'], grades: ['初二', '初三', '高一'],
      abilityTags: ['初三数学提分', '带过毕业班', '中考冲刺'],
      orderCount: 46, rating: 4.9, submittedAt: '2026-10-19 10:20',
      certs: { student: 'approved', qualification: 'approved', ability: 'approved' },
      intro: 'XX大学数学对口专业，带过两届初三毕业班，擅长把函数、几何压轴题拆成可复用解题模型。'
    },
    {
      id: 'TUT-0102', name: '陈知远', gender: '男', school: 'XX大学', major: '汉语言文学',
      grade: '大四', certLevel: 3, badgeNo: 'JS-2026-000102', credit: 88, price: 120,
      studentNo: '1201****4471', email: 'chen****@cnu.edu.cn', phone: '139****3382',
      subjects: ['语文', '历史'], grades: ['初一', '初二', '初三'],
      abilityTags: ['作文批改', '阅读提分', '带过毕业班'],
      orderCount: 38, rating: 4.8, submittedAt: '2026-10-19 09:02',
      certs: { student: 'approved', qualification: 'approved', ability: 'pending' },
      intro: '北京市学生教学技能大赛二等奖，作文批改按「结构—素材—语言」三层给反馈。'
    },
    {
      id: 'TUT-0103', name: '苏雨萌', gender: '女', school: 'XX大学', major: '学前教育',
      grade: '大二', certLevel: 2, badgeNo: 'JS-2026-000103', credit: 85, price: 100,
      studentNo: '1203****2276', email: 'su****@cnu.edu.cn', phone: '137****9014',
      subjects: ['美术', '全科'], grades: ['小班', '中班', '大班', '幼小衔接'],
      abilityTags: ['幼小衔接', '习惯养成'],
      orderCount: 22, rating: 4.7, submittedAt: '2026-10-18 16:40',
      certs: { student: 'approved', qualification: 'approved', ability: 'pending' },
      intro: '学前教育专业，持有幼儿教师资格证与普通话一级乙等，专注 5-6 岁幼小衔接（素质方向）。'
    },
    {
      id: 'TUT-0104', name: '赵沐阳', gender: '男', school: 'XX大学', major: '物理学',
      grade: '研一', certLevel: 3, badgeNo: 'JS-2026-000104', credit: 95, price: 160,
      studentNo: '1101****8830', email: 'zhao****@cnu.edu.cn', phone: '186****7752',
      subjects: ['物理', '数学'], grades: ['高一', '高二', '高三'],
      abilityTags: ['高考冲刺', '物理实验'],
      orderCount: 63, rating: 5.0, submittedAt: '2026-10-18 11:15',
      certs: { student: 'approved', qualification: 'approved', ability: 'approved' },
      intro: '物理教育研究生，累计带过 11 名高三学生，用仿真实验演示抽象概念。'
    },
    {
      id: 'TUT-0105', name: '何雨桐', gender: '女', school: 'XX大学', major: '英语',
      grade: '大三', certLevel: 2, badgeNo: 'JS-2026-000105', credit: 90, price: 115,
      studentNo: '1202****1163', email: 'he****@cnu.edu.cn', phone: '135****4408',
      subjects: ['英语'], grades: ['三年级', '四年级', '五年级', '六年级'],
      abilityTags: ['英语口语', '自然拼读'],
      orderCount: 31, rating: 4.8, submittedAt: '2026-10-17 15:08',
      certs: { student: 'approved', qualification: 'approved', ability: 'pending' },
      intro: '英语对口专业，专四优秀，曾在附属小学做过一学期英语助教。'
    },
    {
      id: 'TUT-0106', name: '郑一诺', gender: '男', school: 'XX大学', major: '计算机科学与技术',
      grade: '大二', certLevel: 1, badgeNo: 'JS-2026-000106', credit: 78, price: 140,
      studentNo: '1204****5560', email: 'zheng****@cnu.edu.cn', phone: '131****2277',
      subjects: ['编程', '科学'], grades: ['四年级', '五年级', '六年级'],
      abilityTags: ['竞赛辅导'],
      orderCount: 14, rating: 4.6, submittedAt: '2026-10-17 09:30',
      certs: { student: 'approved', qualification: 'pending', ability: 'pending' },
      intro: '计算机对口专业，带过少儿编程兴趣班，以做出小项目为目标。'
    }
  ];

  /* ---------------- 履约打卡 ---------------- */
  var checkins = [
    { id: 'CHK-0091', demandId: 'DEM-0181', tutor: '赵沐阳', parent: '孙女士', date: '2026-10-19 19:03', duration: 105, status: 'confirmed', summary: '梳理实验题答题模板，重点讲气体制备与检验，课后留 5 道同类题。' },
    { id: 'CHK-0090', demandId: 'DEM-0175', tutor: '林嘉怡', parent: '陈女士', date: '2026-10-19 18:05', duration: 98, status: 'pending', summary: '比例与工程问题专项，10 道错 2 道（单位 1 找错），下次进入圆的认识。' },
    { id: 'CHK-0089', demandId: 'DEM-0178', tutor: '赵沐阳', parent: '郑先生', date: '2026-10-18 20:11', duration: 120, status: 'confirmed', summary: '牛顿第二定律与受力分析，用仿真演示斜面模型，孩子理解明显好转。' },
    { id: 'CHK-0088', demandId: 'DEM-0175', tutor: '林嘉怡', parent: '陈女士', date: '2026-10-17 19:02', duration: 96, status: 'confirmed', summary: '分数四则运算复习，重点讲比例应用题的三种解法。' },
    { id: 'CHK-0087', demandId: 'DEM-0181', tutor: '赵沐阳', parent: '孙女士', date: '2026-10-16 19:15', duration: 88, status: 'confirmed', summary: '化学方程式配平专项，孩子已能独立完成中等难度题。' }
  ];

  /* ---------------- 双向评价（已揭晓） ---------------- */
  var reviews = [
    {
      demandId: 'DEM-0181', reveal: true,
      parent: { name: '孙女士', rating: 5, tags: ['准时', '专业', '提分帮助'], text: '每次提前 10 分钟到，实验题模板整理得很清楚，孩子这学期化学明显有信心了。' },
      tutor: { name: '赵沐阳', rating: 5, tags: ['尊重老师', '付款及时', '环境安全'], text: '家长很配合，学习材料准备齐全，课中全程在场但不干预，沟通顺畅。' }
    },
    {
      demandId: 'DEM-0175', reveal: false,
      parent: { name: '陈女士', rating: 5, tags: ['准时', '耐心'], text: '孩子偏内向，老师很有耐心，会先聊天再进入正题。' },
      tutor: null
    }
  ];

  /* ---------------- 实时动态 ---------------- */
  var feed = [
    { type: 'danger', text: '<b>DEM-0180</b> 触发双减红线（学科类 × 周末），已自动拦截', time: '2 分钟前' },
    { type: 'ok', text: '<b>赵沐阳</b> 三重认证审核通过，生成徽章 JS-2026-000104', time: '14 分钟前' },
    { type: 'info', text: '<b>DEM-0184</b> 生成对接报告，Top1 匹配度 99.2 分', time: '23 分钟前' },
    { type: 'warn', text: '<b>DEM-0183</b> 命中高风险词「日入过千 / 押金」，已强提示家长', time: '41 分钟前' },
    { type: 'ok', text: '<b>林嘉怡</b> 完成 10-19 打卡，家长已确认小结', time: '1 小时前' },
    { type: 'info', text: '<b>DEM-0175</b> 家长提交评价，等待学生评价后揭晓', time: '2 小时前' }
  ];

  /* ---------------- 匹配 Top3（DEM-0184 的实算结果） ---------------- */
  var matchTop = [
    {
      rank: 1, tutorId: 'TUT-0101', name: '林嘉怡', score: 99.2, distance: 3.2,
      school: 'XX大学 · 数学与应用数学', credit: 92, certLevel: 3,
      reasons: [
        '为XX大学数学与应用数学专业，已完成三重认证。',
        '科目完全对口（数学），带过初三毕业班，年级完全匹配。',
        '同在 haidian（海淀区），通勤方便，可排课时间段吻合。',
        '课时费 130 元在预算内，平台信用分 92，综合匹配度较高。'
      ]
    },
    {
      rank: 2, tutorId: 'TUT-0106', name: '郑一诺', score: 75.3, distance: 12.5,
      school: 'XX大学 · 计算机科学与技术', credit: 78, certLevel: 1,
      reasons: [
        '学科门类相近，可跨科辅导数学。',
        '已完成学籍认证，认证等级 1 级。',
        '距离约 12.5km，可协商上门或线上。'
      ]
    },
    {
      rank: 3, tutorId: 'TUT-0104', name: '赵沐阳', score: 74.0, distance: 6.8,
      school: 'XX大学 · 物理学', credit: 95, certLevel: 3,
      reasons: [
        '为XX大学物理学专业，已完成三重认证。',
        '学科门类相近，可跨科辅导。',
        '平台信用分 95（当前最高），但时段不完全吻合。'
      ]
    }
  ];

  /* ---------------- 元信息 ---------------- */
  var meta = {
    version: '0.2.0',
    updatedAt: '2026-10-20 14:32',
    policyMessage: '根据双减政策，严禁在休息日及节假日开展学科类培训，请勿发布违规需求',
    platformPosition: '本平台仅为个人零星家教信息撮合，非培训机构，不提供固定办学场所'
  };

  global.DATA = {
    kpis: kpis,
    trend: trend,
    certFunnel: certFunnel,
    riskDistribution: riskDistribution,
    policySplit: policySplit,
    heatmap: heatmap,
    demands: demands,
    tutors: tutors,
    checkins: checkins,
    reviews: reviews,
    feed: feed,
    matchTop: matchTop,
    meta: meta
  };
})(window);
