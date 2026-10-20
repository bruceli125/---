/**
 * mock 打卡记录（二期新增，对应云数据库集合 checkins）
 *
 * 模型说明：
 * - MVP 阶段「一个需求 = 一个订单」，因此 orderId 直接复用 demandId；
 *   二期若支持一需求多订单，再引入独立 orders 集合，checkins.orderId 指向 orders._id。
 * - 一条打卡记录的生命周期：
 *     checked_in（已打卡，进行中） → finished（已结束、待家长确认小结） → confirmed（家长已确认）
 * - 定位为 mock（MOCK_CHECKIN_LOCATION），**不采集真实位置**，也不申请 scope.userLocation。
 */
const { CHECKIN_STATUS } = require('../utils/constants.js');

const checkins = [
  {
    id: 'checkin_001',
    orderId: 'demo_demand_005',
    demandId: 'demo_demand_005',
    tutorId: 'tutor_001',
    tutorName: '林嘉怡',
    parentId: 'parent_demo_001',
    status: CHECKIN_STATUS.CONFIRMED,
    /** 家长已确认的小结 */
    summaryStatus: 'confirmed',
    startAt: '2026-01-06 19:03',
    endAt: '2026-01-06 20:48',
    durationMin: 105,
    location: {
      name: '校内认证场地（mock 定位）',
      address: '北京市昌平区回龙观龙泽苑东区活动中心',
      latitude: 40.074,
      longitude: 116.337,
      mock: true
    },
    summary:
      '本次课复习分数的四则运算，重点讲比例应用题的三种解法；孩子对"单位 1 的判断"还不稳，下次课做 10 道专项题巩固。作业：练习册 P32-P34。',
    confirmedAt: '2026-01-06 21:10',
    createdAt: '2026-01-06 19:03',
    createdAtTs: 1767697380000
  },
  {
    id: 'checkin_002',
    orderId: 'demo_demand_005',
    demandId: 'demo_demand_005',
    tutorId: 'tutor_001',
    tutorName: '林嘉怡',
    parentId: 'parent_demo_001',
    status: CHECKIN_STATUS.FINISHED,
    /** 已写小结，等待家长确认（用于演示"待家长确认"状态） */
    summaryStatus: 'pending',
    startAt: '2026-01-13 19:05',
    endAt: '2026-01-13 20:43',
    durationMin: 98,
    location: {
      name: '校内认证场地（mock 定位）',
      address: '北京市昌平区回龙观龙泽苑东区活动中心',
      latitude: 40.074,
      longitude: 116.337,
      mock: true
    },
    summary:
      '本次课做比例与工程问题专项，10 道题错 2 道（都是单位 1 找错）。已带孩子各讲一遍并重做。下次课进入圆的认识，请家长准备圆规。',
    confirmedAt: '',
    createdAt: '2026-01-13 19:05',
    createdAtTs: 1768302300000
  }
];

module.exports = {
  checkins,
  cloneCheckins: function cloneCheckins() {
    return JSON.parse(JSON.stringify(checkins));
  }
};
