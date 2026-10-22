/**
 * 双向盲评页（二期）
 *
 * 参数：demandId（必填）、role（'parent' | 'tutor'，默认 tutor）
 *
 * 数据来源：只通过 services/api.js（二期接口由 phase2.js 挂载）
 *   api.getDemandDetail / api.getTutorDetail / api.getReviewState / api.submitReview /
 *   api.getReviews / api.getCredit
 *
 * 【四种状态判定】完全以 phase2.getReviewState 的真实返回为准：
 *   1) revealed === true                        → 已揭晓：双方评价都可见 + 信用分更新提示
 *   2) myReview 存在 && !revealed               → 我已评价、等待对方（对方内容不可见）
 *   3) canReview === true && hasOtherReviewed   → 我未评、对方已评：可评 + 「对方已评价」提示
 *   4) canReview === true && !hasOtherReviewed  → 双方都未评：直接展示表单
 *   （!canReview && !myReview && !revealed      → 订单未成单/已结束，不可评价）
 *
 * 为什么 otherReview 在未揭晓时是 null：phase2.getReviewState 只在
 *   myReview && otherRaw.status === 'revealed' && otherRaw.visible 时才返回对方内容，
 *   否则只暴露 hasOtherReviewed 这一事实（防止"先看对方评价再改自己的"）。
 *   因此页面绝不能自己从 getReviews 里捞对方评价来展示——getReviews 本身也只返回已揭晓记录。
 *
 * mock 边界：信用分由规则（constants.CREDIT_RULES）计算，非人工评审；评价提交后不可修改。
 * TODO(二期+)：评价上云 + 申诉/删除流程；信用分变动流水与仲裁。
 */
const api = require('../../services/api.js');
const fmt = require('../../utils/format.js');
const C = require('../../utils/constants.js');

const COMMENT_MAX = 200;
const BTN_PRIMARY = 'btn btn-primary mt-24';
const BTN_DISABLED_SUFFIX = ' btn-disabled';

function toast(title, icon) {
  wx.showToast({ title: title || '', icon: icon || 'none', duration: 1800 });
}

/** 星符串：4 -> ★★★★☆ */
function starText(rating) {
  const n = Math.max(0, Math.min(5, Number(rating || 0)));
  let s = '';
  for (let i = 1; i <= 5; i++) s += i <= n ? '★' : '☆';
  return s;
}

/** 星级选择器的 5 个格子（class 预计算，WXML 里不做判断） */
function buildStarList(rating) {
  const n = Number(rating || 0);
  const list = [];
  for (let i = 1; i <= 5; i++) {
    const filled = i <= n;
    list.push({
      value: i,
      filled: filled,
      char: filled ? '★' : '☆',
      cls: filled ? 'star star-on' : 'star'
    });
  }
  return list;
}

/** 单条评价 -> 视图模型 */
function buildReviewView(review) {
  if (!review) return null;
  const rating = Number(review.rating || 0);
  const comment = String(review.comment || '');
  return {
    id: review.id || review._id || '',
    rating: rating,
    starText: starText(rating),
    ratingText: rating + ' 星',
    tags: review.tags || [],
    hasTags: !!(review.tags && review.tags.length),
    comment: comment,
    hasComment: !!comment.trim(),
    reviewerName: review.reviewerName || '',
    revieweeName: review.revieweeName || '',
    directionLabel: C.REVIEW_DIRECTION_LABEL[review.direction] || '',
    timeText: review.createdAt || '',
    revealedText: review.revealedAt ? '于 ' + review.revealedAt + ' 揭晓' : ''
  };
}

/** 信用分规则说明（从 CREDIT_RULES 生成，禁止写死数字） */
function buildCreditRuleText() {
  const r = C.CREDIT_RULES;
  const byRating = r.byRating || {};
  const parts = [];
  [1, 2, 3, 4, 5].forEach(function (star) {
    const v = byRating[star];
    if (v === undefined) return;
    parts.push(star + ' 星 ' + (v >= 0 ? '+' : '') + v);
  });
  return (
    '信用分规则：' +
    parts.join('，') +
    '；每命中 1 个正向标签额外 +' +
    r.tagBonus +
    '（最多计 ' +
    r.maxTagBonusCount +
    ' 个），区间 ' +
    r.min +
    '~' +
    r.max +
    '。分数由平台规则自动计算，非人工评审。'
  );
}

/** 带符号的数字：3 -> '+3'，-2 -> '-2' */
function signed(value) {
  const n = Number(value || 0);
  return (n >= 0 ? '+' : '') + n;
}

Page({
  data: {
    /* 参数 */
    demandId: '',
    role: 'tutor',
    isTutor: true,
    isParent: false,

    /* 状态 */
    loading: true,
    notFound: false,
    errorMsg: '',
    submitting: false,

    /* 订单摘要 */
    demand: null,
    orderTitle: '',
    directionLabel: '',
    counterpartText: '',
    orderStatusLabel: '',

    /* 盲评状态 */
    viewMode: 'form',
    revealed: false,
    hasOtherReviewed: false,
    canReview: false,
    blockedReason: '',
    blindTip: C.FULFILLMENT.reviewBlindTip,
    otherSubmittedText: '',

    /* 表单 */
    tags: [],
    tagTitle: '',
    selectedTags: [],
    rating: 0,
    starList: [],
    ratingText: '未评分',
    comment: '',
    commentLen: 0,
    commentMax: COMMENT_MAX,
    commentPlaceholder: '',
    creditRuleText: '',

    /* 已提交 / 已揭晓 */
    myReviewView: null,
    otherReviewView: null,
    waitingText: '',
    otherLockText: '',

    /* 信用分 */
    creditLines: [],
    creditVisible: false,

    /* 全部已揭晓评价 */
    allReviews: [],
    showAll: false,
    allToggleText: '查看',

    /* 按钮（预计算） */
    submitBtnText: '提交评价',
    submitBtnClass: BTN_PRIMARY + BTN_DISABLED_SUFFIX
  },

  onLoad(options) {
    const query = options || {};
    const demandId = query.demandId || '';
    const role = query.role === 'parent' ? 'parent' : 'tutor';

    this.setData({
      demandId: demandId,
      role: role,
      isTutor: role === 'tutor',
      isParent: role === 'parent',
      starList: buildStarList(0),
      creditRuleText: buildCreditRuleText()
    });

    if (!demandId) {
      this.setData({
        loading: false,
        notFound: true,
        errorMsg: '缺少订单参数（demandId），请从订单详情页进入。'
      });
      return;
    }
    this.load();
  },

  onShow() {
    if (this._shownOnce && this.data.demandId) this.load();
    this._shownOnce = true;
  },

  onShareAppMessage() {
    return {
      title: '双向盲评 · 双方评价后才互相可见',
      path: '/pages/review/review?demandId=' + this.data.demandId + '&role=' + this.data.role
    };
  },

  /* ================================================================
   * 一、加载
   * ================================================================ */

  load() {
    const self = this;
    if (!this._loadedOnce) this.setData({ loading: true });

    return api
      .getDemandDetail(this.data.demandId)
      .then(function (res) {
        if (!res || res.code !== 0) {
          self.setData({
            loading: false,
            notFound: true,
            errorMsg: (res && res.message) || '订单不存在或已删除'
          });
          return null;
        }
        self.applyDemand(res.data);

        const tutorId = res.data.matchedTutorId || '';
        const parentName = res.data.parentName || '家长';
        // 对手姓名用于展示与提交时留痕（评价列表里便于辨认）
        const tutorTask = tutorId ? api.getTutorDetail(tutorId) : Promise.resolve(null);

        return tutorTask.then(function (tRes) {
          self._tutor = tRes && tRes.code === 0 && tRes.data ? tRes.data : {};
          self._tutorName = self._tutor.name || '';
          self.setData({
            counterpartText: self.data.isParent
              ? '评价对象：' + (self._tutorName || '本次授课的学生')
              : '评价对象：家长 ' + parentName
          });
          return api.getReviewState({ demandId: self.data.demandId, role: self.data.role });
        });
      })
      .then(function (stateRes) {
        if (!stateRes) return null; // 上一步已处理错误
        if (stateRes.code !== 0) {
          self.setData({ loading: false });
          toast(stateRes.message || '评价状态加载失败');
          return null;
        }
        self.applyState(stateRes.data);
        self._loadedOnce = true;
        self.setData({ loading: false });
        return stateRes.data;
      })
      .catch(function (err) {
        console.error('[review] 加载失败：', err);
        self.setData({ loading: false, notFound: true, errorMsg: '加载失败，请返回重试' });
      });
  },

  applyDemand(demand) {
    const d = demand || {};
    const isParent = this.data.role === 'parent';
    this.setData({
      demand: d,
      orderTitle: (d.grade || '') + fmt.subjectLabel(d.subject) + ' · 履约评价',
      orderStatusLabel: C.DEMAND_STATUS_LABEL[d.status] || '状态未知',
      counterpartText: isParent ? '评价对象：本次授课的学生' : '评价对象：家长 ' + (d.parentName || ''),
      tagTitle: isParent ? '这位老师给你的印象（可多选）' : '这位家长给你的印象（可多选）',
      commentPlaceholder: isParent
        ? '可以写写孩子的进步、老师授课方式是否合适（选填，200 字以内）'
        : '可以写写家长的配合度、上课环境与沟通情况（选填，200 字以内）'
    });
  },

  /**
   * 应用 getReviewState 的结果（四态判定的唯一入口）
   * @param {object} state phase2.getReviewState 的 data
   */
  applyState(state) {
    const s = state || {};
    const myReview = s.myReview || null;
    const otherReview = s.otherReview || null;
    const revealed = !!s.revealed;
    const hasOther = !!s.hasOtherReviewed;
    const canReview = !!s.canReview;

    let viewMode = 'blocked';
    let blockedReason = '';
    if (revealed) {
      viewMode = 'revealed';
    } else if (myReview) {
      viewMode = 'waiting';
    } else if (canReview) {
      viewMode = 'form';
    } else {
      viewMode = 'blocked';
      blockedReason =
        '该订单尚未成单或已结束，暂不能评价。成单并完成履约后，双方可对本次合作进行双向评价。';
    }

    this.setData({
      viewMode: viewMode,
      blockedReason: blockedReason,
      revealed: revealed,
      hasOtherReviewed: hasOther,
      canReview: canReview,
      tags: s.tags || [],
      blindTip: s.blindTip || C.FULFILLMENT.reviewBlindTip,
      directionLabel: C.REVIEW_DIRECTION_LABEL[s.direction] || '',
      otherSubmittedText: s.otherSubmittedAt ? '对方提交于 ' + s.otherSubmittedAt : '',
      myReviewView: buildReviewView(myReview),
      otherReviewView: buildReviewView(otherReview),
      waitingText: '评价已提交，等待对方评价',
      otherLockText: hasOther
        ? '对方已评价，待你评价后可见'
        : '对方尚未提交评价，双方都提交后才能互相查看内容'
    });
  },

  /* ================================================================
   * 二、表单交互
   * ================================================================ */

  onStarTap(e) {
    const value = Number(e.currentTarget.dataset.value || 0);
    if (!value) return;
    this.setData({
      rating: value,
      starList: buildStarList(value),
      ratingText: value + ' 星'
    });
    this.refreshSubmitBtn();
  },

  onTagsChange(e) {
    const selected = (e && e.detail && e.detail.selected) || [];
    this.setData({ selectedTags: selected });
  },

  onCommentInput(e) {
    const value = (e && e.detail && e.detail.value) || '';
    this.setData({ comment: value, commentLen: value.length });
  },

  refreshSubmitBtn() {
    const enabled = this.data.rating > 0 && !this.data.submitting;
    let text = '提交评价';
    if (this.data.submitting) text = '提交中…';
    else if (!this.data.rating) text = '提交评价（请先选择星级）';
    this.setData({
      submitBtnText: text,
      submitBtnClass: BTN_PRIMARY + (enabled ? '' : BTN_DISABLED_SUFFIX)
    });
  },

  /* ================================================================
   * 三、提交评价
   * ================================================================ */

  onSubmit() {
    const self = this;
    if (this.data.submitting) return;
    if (!this.data.rating) {
      toast('请先选择 1~5 星评分');
      return;
    }
    if (this.data.comment.length > COMMENT_MAX) {
      toast('评价内容请控制在 ' + COMMENT_MAX + ' 字以内');
      return;
    }

    const d = this.data.demand || {};
    const isParent = this.data.role === 'parent';
    const tutorId = d.matchedTutorId || (this._tutor && this._tutor.id) || '';
    const parentId = d.parentId || '';
    const tutorName = this._tutorName || (this._tutor && this._tutor.name) || '学生';
    const parentName = d.parentName || '家长';

    const payload = {
      demandId: this.data.demandId,
      role: this.data.role,
      rating: this.data.rating,
      tags: this.data.selectedTags,
      comment: this.data.comment,
      tutorId: tutorId,
      parentId: parentId,
      reviewerName: isParent ? parentName : tutorName,
      revieweeName: isParent ? tutorName : parentName
    };

    this.setData({ submitting: true });
    this.refreshSubmitBtn();

    api
      .submitReview(payload)
      .then(function (res) {
        self.setData({ submitting: false });
        if (!res || res.code !== 0) {
          self.refreshSubmitBtn();
          toast((res && res.message) || '评价提交失败，请重试');
          return;
        }

        const data = res.data || {};
        if (data.revealed) {
          self.showCredit(data);
          toast('双方评价已揭晓，信用分已更新', 'success');
        } else {
          toast(res.message || '评价已提交，等待对方评价');
        }

        // 原地刷新：重置表单并重新拉取状态（不跳转）
        self.setData({
          rating: 0,
          starList: buildStarList(0),
          ratingText: '未评分',
          selectedTags: [],
          comment: '',
          commentLen: 0
        });
        self.refreshSubmitBtn();
        self.load();
      })
      .catch(function (err) {
        console.error('[review] 提交失败：', err);
        self.setData({ submitting: false });
        self.refreshSubmitBtn();
        toast('评价提交失败，请重试');
      });
  },

  /**
   * 信用分结算展示（仅双盲揭晓时调用）
   * @param {object} data submitReview 返回的 data
   */
  showCredit(data) {
    const d = data || {};
    const lines = [];
    const myDelta = Number(d.creditDelta || 0);

    if (d.counterpartCredit) {
      const c = d.counterpartCredit;
      lines.push('本次评价使对方信用分 ' + c.before + ' → ' + c.after + '（' + signed(myDelta) + '）');
    }
    if (d.myCredit) {
      const m = d.myCredit;
      lines.push('对方评价使你信用分 ' + m.before + ' → ' + m.after);
    }

    this.setData({ creditLines: lines, creditVisible: lines.length > 0 });

    // 再拉一次最新信用分（以规则结算结果为准）
    const self = this;
    const demand = this.data.demand || {};
    api
      .getCredit({
        role: this.data.role,
        tutorId: demand.matchedTutorId || '',
        parentId: demand.parentId || ''
      })
      .then(function (res) {
        if (!res || res.code !== 0 || !res.data) return;
        const next = (self.data.creditLines || []).slice();
        next.push('你的当前信用分：' + res.data.creditScore);
        self.setData({ creditLines: next, creditVisible: true });
      });
  },

  /* ================================================================
   * 四、全部已揭晓评价
   * ================================================================ */

  onToggleAllReviews() {
    const self = this;
    if (this.data.showAll) {
      this.setData({ showAll: false, allToggleText: '查看' });
      return;
    }
    api.getReviews({ demandId: this.data.demandId }).then(function (res) {
      if (!res || res.code !== 0) {
        toast((res && res.message) || '评价列表加载失败');
        return;
      }
      const list = res.data || [];
      self.setData({
        allReviews: list.map(function (r) {
          return buildReviewView(r);
        }),
        showAll: true,
        allToggleText: '收起'
      });
      if (!list.length) toast('本订单暂无已揭晓的评价');
    });
  },

  onBack() {
    const pages = getCurrentPages();
    if (pages && pages.length > 1) {
      wx.navigateBack();
      return;
    }
    wx.switchTab({ url: '/pages/index/index' });
  }
});
