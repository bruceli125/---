/**
 * mock 评价（二期新增，对应云数据库集合 reviews）
 *
 * 双向盲评规则：
 * - 双方各自提交 → 单方提交时 status='pending'、visible=false，对方看不到内容，只能看到"对方已评价"；
 * - 双方都提交后 → 两条一起置为 status='revealed'、visible=true、写入 revealedAt，并各自更新信用分；
 * - 之所以由服务端（api 层）统一翻转，是为了防止"先看对方评价再改自己的"。
 *
 * 种子数据只放了**家长单方已评**的一条，正好用来演示：
 *   学生视角看到"家长已评价，待你评价后可见" → 提交自己的评价 → 双方评价同时揭晓。
 */
const { REVIEW_STATUS } = require('../utils/constants.js');

const reviews = [
  {
    id: 'review_001',
    orderId: 'demo_demand_005',
    demandId: 'demo_demand_005',
    tutorId: 'tutor_001',
    parentId: 'parent_demo_001',
    /** 评价方向：parent_to_tutor（家长评老师）/ tutor_to_parent（老师评家长） */
    direction: 'parent_to_tutor',
    reviewerRole: 'parent',
    reviewerName: '王女士',
    revieweeRole: 'tutor',
    revieweeName: '林嘉怡',
    rating: 5,
    tags: ['准时', '专业', '提分帮助'],
    comment: '老师每次提前 10 分钟到，错题复盘的资料整理得很清楚，孩子这学期数学明显有信心了。',
    status: REVIEW_STATUS.PENDING,
    visible: false,
    creditDelta: 0,
    createdAt: '2026-01-07 09:30',
    createdAtTs: 1767749400000,
    revealedAt: ''
  }
];

module.exports = {
  reviews,
  cloneReviews: function cloneReviews() {
    return JSON.parse(JSON.stringify(reviews));
  }
};
