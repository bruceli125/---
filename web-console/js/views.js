/* ============================================================================
 * views.js —— 六个视图的模板 + 图表挂载
 * 约定：每个 view 返回 HTML 字符串；对应 Views.after[view] 在插入 DOM 后执行，
 *       用于初始化 Canvas 图表（必须在 DOM 可见后测量尺寸）。
 * ========================================================================== */
(function (global) {
  'use strict';

  var C = global.Components;
  var I = global.Icons;
  var D = global.DATA;
  var esc = C.esc;

  var MODE_ICON = { 线上授课: 'monitor', 线下上门: 'location', 校内场地: 'building', 线上线下均可: 'layers' };

  /* ==========================================================================
   * 1. 运营总览
   * ====================================================================== */
  function overview() {
    var kpis = D.kpis
      .map(function (k) {
        return '<div class="col-3">' + C.kpiCard(k) + '</div>';
      })
      .join('');

    var blockedList = D.demands
      .filter(function (d) {
        return d.policy === 'blocked' || d.risk === 'high';
      })
      .map(function (d) {
        var isPolicy = d.policy === 'blocked';
        return (
          '<div class="row-item" data-open-demand="' + esc(d.id) + '">' +
          '<span class="compliance__icon" style="' +
          (isPolicy ? '' : 'background:rgba(245,165,36,.16);color:#FFCE7A') +
          '">' + I.svg(isPolicy ? 'scale' : 'alert', 14) + '</span>' +
          '<div class="row-item__main">' +
          '<div class="row-item__title">' + esc(d.id) + ' · ' + esc(d.subject) + ' ' + esc(d.grade) +
          ' ' + C.statusBadge(d.status) + '</div>' +
          '<div class="row-item__meta">' + esc(isPolicy ? '双减红线：' + (d.policyEvidence || []).join(' / ') : '风险词：' + (d.riskHits || []).join('、')) + '</div>' +
          '</div>' +
          '<div class="row-item__side">' + (isPolicy ? C.badge('已拦截', 'danger') : C.badge('强提示', 'warn')) + '</div>' +
          '</div>'
        );
      })
      .join('');

    return (
      '<section class="view" data-view="overview">' +
      /* 页头 */
      '<div class="page-head">' +
      '<div>' +
      '<div class="page-head__title">平台运行概览</div>' +
      '<div class="page-head__desc">实时掌握需求流转、合规拦截、认证审核与履约质量。数据每 60 秒自动刷新。</div>' +
      '</div>' +
      '<div class="page-head__actions">' +
      C.button('导出周报', { variant: 'ghost', iconLeft: 'download', action: 'export' }) +
      C.button('新建需求', { variant: 'primary', iconLeft: 'plus', action: 'new-demand' }) +
      '</div>' +
      '</div>' +

      /* 合规横幅：双减红线常驻可见 */
      '<div class="compliance reveal">' +
      '<span class="compliance__icon">' + I.svg('scale', 15) + '</span>' +
      '<div class="compliance__text u-grow"><b>双减合规已启用：</b>' + esc(D.meta.policyMessage) +
      '　近 7 天已自动拦截 <b>14</b> 单。</div>' +
      '<button class="btn btn--ghost btn--sm" data-action="goto-policy">查看明细</button>' +
      '</div>' +

      /* KPI 行 */
      '<div class="grid stagger reveal" data-reveal="stagger">' + kpis + '</div>' +

      /* 趋势 + 洞察 */
      '<div class="split">' +
      '<div class="card card--spot card--fill reveal">' +
      '<div class="chart-head">' +
      '<div class="chart-head__meta u-grow">' +
      '<div class="u-row u-gap-2"><span class="card__title">需求与匹配趋势</span>' +
      C.badge('近 14 天', 'neutral') + '</div>' +
      '<div class="chart-head__value"><span class="count" data-count="31">0</span>' +
      '<span style="font-size:12px;color:var(--text-3);font-weight:500">单 / 今日</span>' +
      C.trendPill(12.4) + '</div>' +
      '</div>' +
      '<div class="chart-head__actions">' +
      C.segmented([{ key: '7', label: '7 天' }, { key: '14', label: '14 天' }, { key: '30', label: '30 天' }], '14', 'trend-range') +
      '</div>' +
      '</div>' +
      '<div class="card__body" style="padding-top:0">' +
      '<div class="chart chart--h240" data-chart="trend"></div>' +
      '</div>' +
      '</div>' +

      '<div class="card reveal" style="display:flex;flex-direction:column">' +
      '<div class="card__head"><div class="card__title">智能洞察</div>' +
      '<div class="card__head-actions">' + C.badge('规则引擎', 'violet') + '</div></div>' +
      '<div class="card__body" style="display:flex;flex-direction:column;gap:10px;flex:1">' +
      C.insightCard('alert', 'danger', '学科类 × 休息日仍是拦截主力', '占全部拦截的 73%，建议在发布页把时段前置到第一步。') +
      C.insightCard('clock', 'amber', '匹配中订单平均滞留 2.4 天', '超过 48h 的 6 单已自动提醒家长确认成单。') +
      C.insightCard('shield', 'teal', '三重认证率提升到 53.8%', '较上周 +4.2pp，认证完整的学生匹配分平均高 9.6 分。') +
      '</div>' +
      '</div>' +
      '</div>' +

      /* 认证漏斗 / 风险词 / 热力 */
      '<div class="grid">' +
      '<div class="col-4">' +
      '<div class="card card--fill reveal" style="height:100%">' +
      '<div class="card__head"><div class="card__title">认证转化漏斗</div>' +
      '<div class="card__head-actions">' + C.badge('本期', 'neutral') + '</div></div>' +
      '<div class="card__body"><div class="chart chart--h200" data-chart="funnel"></div></div>' +
      '<div class="card__foot"><span>三重认证率</span><b style="color:var(--teal)">53.8%</b></div>' +
      '</div></div>' +
      '<div class="col-4">' +
      '<div class="card card--fill reveal" style="height:100%">' +
      '<div class="card__head"><div class="card__title">风险词命中分布</div>' +
      '<div class="card__head-actions">' + C.badge('近 14 天', 'neutral') + '</div></div>' +
      '<div class="card__body"><div class="chart chart--h200" data-chart="risk"></div></div>' +
      '<div class="card__foot"><span>累计命中</span><b>73 次</b></div>' +
      '</div></div>' +
      '<div class="col-4">' +
      '<div class="card card--fill reveal" style="height:100%">' +
      '<div class="card__head"><div class="card__title">履约打卡热力</div>' +
      '<div class="card__head-actions">' + C.badge('8 周', 'neutral') + '</div></div>' +
      '<div class="card__body"><div class="chart chart--h200" data-chart="heat"></div></div>' +
      '<div class="card__foot"><span>打卡完成率</span><b style="color:var(--teal)">96.2%</b></div>' +
      '</div></div>' +
      '</div>' +

      /* 动态 + 拦截明细 */
      '<div class="split">' +
      '<div class="card reveal">' +
      '<div class="card__head"><div class="card__title">合规拦截与风险工单</div>' +
      '<div class="card__head-actions">' + C.button('全部工单', { variant: 'ghost', size: 'sm', action: 'goto-demands' }) + '</div></div>' +
      '<div class="card__body card__body--flush">' + '<div class="rows">' + blockedList + '</div>' + '</div>' +
      '</div>' +
      '<div class="card reveal">' +
      '<div class="card__head"><div class="card__title">实时动态</div>' +
      '<div class="card__head-actions"><span class="status-dot">实时</span></div></div>' +
      '<div class="card__body"><div class="feed">' + D.feed.map(C.feedItem).join('') + '</div></div>' +
      '</div>' +
      '</div>' +

      '</section>'
    );
  }

  /* ==========================================================================
   * 2. 需求工单
   * ====================================================================== */
  function demandRow(d) {
    var deviceIcon = d.mode === '线上授课' ? 'monitor' : d.mode === '校内场地' ? 'building' : 'location';
    return (
      '<tr data-open-demand="' + esc(d.id) + '">' +
      '<td class="cell-strong u-mono">' + esc(d.id) + '</td>' +
      '<td><div class="u-row u-gap-2">' + C.avatar(d.parent, 'default', 'sm') +
      '<div><div class="cell-strong">' + esc(d.parent) + '</div>' +
      '<div class="u-dim" style="font-size:10.5px">' + esc(d.phone) + '</div></div></div></td>' +
      '<td><div class="cell-strong">' + esc(d.subject) + ' · ' + esc(d.grade) + '</div>' +
      '<div class="u-dim" style="font-size:10.5px">' + esc(d.frequency) + ' · ' + esc(d.timeRange) + '</div></td>' +
      '<td>' + esc(d.mode) + '</td>' +
      '<td class="cell-num">¥' + esc(d.budget) + '</td>' +
      '<td>' + C.statusBadge(d.status) + '</td>' +
      '<td>' + C.riskBadge(d.risk) + '</td>' +
      '<td>' + C.policyBadge(d.policy) + '</td>' +
      '<td class="cell-num" style="color:' + (d.score >= 90 ? 'var(--teal)' : d.score >= 70 ? 'var(--text-1)' : 'var(--text-3)') + '">' +
      (d.score ? d.score.toFixed(1) : '—') + '</td>' +
      '<td class="cell-actions">' +
      '<button class="btn btn--ghost btn--icon btn--sm tip" data-tip="查看详情" data-open-demand="' + esc(d.id) + '">' + I.svg('chevronRight', 14) + '</button>' +
      '</td>' +
      '</tr>'
    );
  }

  function demands() {
    return (
      '<section class="view" data-view="demands">' +
      '<div class="page-head">' +
      '<div><div class="page-head__title">需求工单</div>' +
      '<div class="page-head__desc">共 ' + D.demands.length + ' 条需求，其中 ' +
      D.demands.filter(function (d) { return d.policy === 'blocked'; }).length + ' 条因双减红线被拦截。</div></div>' +
      '<div class="page-head__actions">' +
      C.button('批量导出', { variant: 'ghost', iconLeft: 'download', action: 'export' }) +
      C.button('新建需求', { variant: 'primary', iconLeft: 'plus', action: 'new-demand' }) +
      '</div>' +
      '</div>' +

      '<div class="card reveal">' +
      '<div class="card__head" style="gap:12px">' +
      '<div class="toolbar u-grow">' +
      '<div class="search">' + I.svg('search', 14) +
      '<input class="input" id="demand-search" placeholder="搜索编号 / 家长 / 科目" autocomplete="off" /></div>' +
      '<div class="toolbar__sep"></div>' +
      C.segmented([
        { key: 'all', label: '全部' },
        { key: 'published', label: '招募中' },
        { key: 'matching', label: '匹配中' },
        { key: 'matched', label: '已匹配' },
        { key: 'blocked', label: '已拦截' }
      ], 'all', 'demand-status') +
      '<div class="toolbar__spacer"></div>' +
      '<label class="check"><input type="checkbox" id="only-risk" /><span class="check__box">' + I.svg('check', 11) + '</span>只看风险单</label>' +
      '</div>' +
      '<button class="btn btn--ghost btn--icon btn--sm tip" data-tip="筛选条件" data-action="filter">' + I.svg('filter', 14) + '</button>' +
      '</div>' +

      '<div class="table-wrap">' +
      '<table class="table" id="demand-table">' +
      '<thead><tr>' +
      '<th class="is-sortable" data-sort="id">编号<span class="sort-ind">▾</span></th>' +
      '<th>家长</th>' +
      '<th>科目 / 年级</th>' +
      '<th>授课方式</th>' +
      '<th class="is-sortable" data-sort="budget">预算<span class="sort-ind">▾</span></th>' +
      '<th>状态</th>' +
      '<th>风险</th>' +
      '<th>双减</th>' +
      '<th class="is-sortable" data-sort="score">匹配分<span class="sort-ind">▾</span></th>' +
      '<th></th>' +
      '</tr></thead>' +
      '<tbody id="demand-tbody">' + D.demands.map(demandRow).join('') + '</tbody>' +
      '</table>' +
      '</div>' +

      '<div class="card__foot">' +
      '<span id="demand-count">显示 ' + D.demands.length + ' / ' + D.demands.length + ' 条</span>' +
      '<div class="pager">' +
      '<span class="pager__info">第 1 / 1 页</span>' +
      C.button('上一页', { variant: 'ghost', size: 'sm', disabled: true }) +
      C.button('下一页', { variant: 'ghost', size: 'sm', disabled: true }) +
      '</div>' +
      '</div>' +
      '</div>' +
      '</section>'
    );
  }

  /* ==========================================================================
   * 3. 智能匹配与报告
   * ====================================================================== */
  function matching() {
    var d = D.demands[0];
    var list = D.matchTop
      .map(function (m) {
        return (
          '<div class="card card--hover card--spot reveal" style="padding:0">' +
          '<div class="card__head" style="border-bottom:0;padding-bottom:8px">' +
          '<span class="avatar' + (m.rank === 1 ? '' : ' avatar--muted') + '">' + (m.rank === 1 ? '★' : m.rank) + '</span>' +
          '<div class="u-grow">' +
          '<div class="u-row u-gap-2"><span class="cell-strong" style="font-size:14px">' + esc(m.name) + '</span>' +
          C.certBadge(m.certLevel) +
          (m.rank === 1 ? C.badge('TOP1 最优', 'ok') : '') + '</div>' +
          '<div class="u-dim" style="font-size:11px;margin-top:2px">' + esc(m.school) + '</div>' +
          '</div>' +
          '<div style="text-align:right">' +
          '<div style="font-size:20px;font-weight:680;letter-spacing:-.02em;color:' +
          (m.rank === 1 ? 'var(--teal)' : 'var(--text-1)') + '">' + m.score.toFixed(1) + '</div>' +
          '<div class="u-dim" style="font-size:10px">匹配度</div>' +
          '</div>' +
          '</div>' +
          '<div class="card__body" style="padding-top:0">' +
          '<div class="u-row u-gap-4" style="font-size:11.5px;color:var(--text-3);margin-bottom:10px">' +
          '<span>' + I.svg('location', 12) + ' ' + m.distance + 'km</span>' +
          '<span>' + I.svg('star', 12) + ' 信用 ' + m.credit + '</span>' +
          '</div>' +
          '<div class="reasons">' +
          m.reasons
            .map(function (r, i) {
              return '<div class="reason"><span class="reason__idx">' + (i + 1) + '</span><span>' + esc(r) + '</span></div>';
            })
            .join('') +
          '</div>' +
          '</div>' +
          '</div>'
        );
      })
      .join('');

    return (
      '<section class="view" data-view="matching">' +
      '<div class="page-head">' +
      '<div><div class="page-head__title">智能匹配与对接报告</div>' +
      '<div class="page-head__desc">规则引擎按「科目 40 + 年级 20 + 时间地点 15 + 价格 10 + 信用分 10 + 认证 5」打分，输出 Top3。</div></div>' +
      '<div class="page-head__actions">' +
      C.button('重新匹配', { variant: 'ghost', iconLeft: 'matching', action: 'rematch' }) +
      C.button('生成报告', { variant: 'primary', iconLeft: 'book', action: 'gen-report' }) +
      '</div>' +
      '</div>' +

      '<div class="card reveal" style="padding:0">' +
      '<div class="card__head">' +
      '<div class="u-grow">' +
      '<div class="u-row u-gap-2"><span class="card__title">' + esc(d.subject) + ' ' + esc(d.grade) +
      '</span>' + C.statusBadge(d.status) + C.policyBadge(d.policy) + '</div>' +
      '<div class="u-dim" style="font-size:11.5px;margin-top:3px">' + esc(d.id) + ' · ' + esc(d.parent) +
      ' · ' + esc(d.mode) + ' · 每周 ' + esc(d.frequency.replace('每周 ', '')) + ' · ' + esc(d.timeRange) + '</div>' +
      '</div>' +
      '<div class="card__head-actions">' +
      C.badge('预算 ¥' + d.budget + '/时', 'info') +
      '</div>' +
      '</div>' +
      '</div>' +

      '<div class="split">' +
      '<div style="display:flex;flex-direction:column;gap:12px">' +
      '<div class="u-row u-between"><span class="section-label">推荐学生 Top3</span>' +
      '<span class="u-dim" style="font-size:11px">按匹配度降序</span></div>' +
      list +
      '</div>' +

      '<div class="card reveal" style="height:fit-content;position:sticky;top:0">' +
      '<div class="card__head"><div class="card__title">对接报告</div>' +
      '<div class="card__head-actions">' +
      C.button('复制', { variant: 'ghost', size: 'sm', iconLeft: 'copy', action: 'copy-report' }) +
      '</div></div>' +
      '<div class="card__body">' +
      '<div class="doc">' +
      '<div><div class="doc__h">一、需求摘要</div>' +
      '<div class="doc__p">' + esc(d.grade + d.subject) + ' ｜ 每周 2 次 ｜ ' + esc(d.mode) + ' ｜ 海淀区\n预算 ¥' + esc(d.budget) + '/时 ｜ 时间：' + esc(d.timeRange) + '</div></div>' +
      '<div><div class="doc__h">二、试课建议</div>' +
      '<div class="doc__p">建议先通过线上或在校内认证场地进行首次试课，需监护人知情。</div></div>' +
      '<div><div class="doc__h">三、匹配结论</div>' +
      '<div class="doc__p">Top1 <b>林嘉怡</b>（99.2 分）：三重认证 JS-2026-000101，带过两届初三毕业班，距离 3.2km，课时费 130 元在预算内。</div></div>' +
      '<div><div class="doc__h">四、平台性质</div>' +
      '<div class="doc__p">' + esc(D.meta.platformPosition) + '。</div></div>' +
      '</div>' +
      '</div>' +
      '<div class="card__foot"><span>生成于 ' + esc(D.meta.updatedAt) + '</span>' +
      C.badge('含避坑提示', 'ok') + '</div>' +
      '</div>' +
      '</div>' +
      '</section>'
    );
  }

  /* ==========================================================================
   * 4. 认证审核
   * ====================================================================== */
  function verifyRow(t) {
    return (
      '<tr data-open-tutor="' + esc(t.id) + '">' +
      '<td><div class="u-row u-gap-3">' + C.avatar(t.name, t.certLevel >= 3 ? 'teal' : 'default', 'sm') +
      '<div><div class="cell-strong">' + esc(t.name) + '</div>' +
      '<div class="u-dim" style="font-size:10.5px">' + esc(t.id) + '</div></div></div></td>' +
      '<td>' + esc(t.major) + '<div class="u-dim" style="font-size:10.5px">' + esc(t.school) + ' · ' + esc(t.grade) + '</div></td>' +
      '<td>' + C.certBadge(t.certLevel, t.badgeNo) + '</td>' +
      '<td>' + C.badge(t.certs.student === 'approved' ? '已通过' : '待审核', t.certs.student === 'approved' ? 'ok' : 'warn') + '</td>' +
      '<td>' + C.badge(t.certs.qualification === 'approved' ? '已通过' : '待审核', t.certs.qualification === 'approved' ? 'ok' : 'warn') + '</td>' +
      '<td>' + C.badge(t.certs.ability === 'approved' ? '已通过' : '待审核', t.certs.ability === 'approved' ? 'ok' : 'warn') + '</td>' +
      '<td class="cell-num">' + t.credit + '</td>' +
      '<td class="cell-actions">' +
      (t.certs.ability === 'pending'
        ? '<button class="btn btn--ok btn--sm" data-action="approve" data-id="' + esc(t.id) + '">通过</button>'
        : C.badge('已完成', 'neutral')) +
      '</td>' +
      '</tr>'
    );
  }

  function verify() {
    var pending = D.tutors.filter(function (t) { return t.certs.ability === 'pending' || t.certs.qualification === 'pending'; });
    return (
      '<section class="view" data-view="verify">' +
      '<div class="page-head">' +
      '<div><div class="page-head__title">学生三重认证审核</div>' +
      '<div class="page-head__desc">学籍 → 资质 → 能力三关。任一类通过即提升认证等级，三关全过生成唯一认证编号。</div></div>' +
      '<div class="page-head__actions">' +
      C.button('导出名单', { variant: 'ghost', iconLeft: 'download', action: 'export' }) +
      C.button('批量通过', { variant: 'primary', iconLeft: 'checkCircle', action: 'batch-approve' }) +
      '</div>' +
      '</div>' +

      '<div class="grid">' +
      '<div class="col-3"><div class="card kpi reveal"><div class="kpi__top"><span class="kpi__label">待审核</span>' +
      '<span class="kpi__icon">' + I.svg('clock', 14) + '</span></div>' +
      '<div class="kpi__value"><span class="count" data-count="' + pending.length + '">0</span><span class="kpi__unit">份</span></div></div></div>' +
      '<div class="col-3"><div class="card kpi reveal"><div class="kpi__top"><span class="kpi__label">三重认证</span>' +
      '<span class="kpi__icon">' + I.svg('shield', 14) + '</span></div>' +
      '<div class="kpi__value"><span class="count" data-count="' + D.tutors.filter(function (t) { return t.certLevel >= 3; }).length + '">0</span><span class="kpi__unit">人</span></div></div></div>' +
      '<div class="col-3"><div class="card kpi reveal"><div class="kpi__top"><span class="kpi__label">平均信用分</span>' +
      '<span class="kpi__icon">' + I.svg('star', 14) + '</span></div>' +
      '<div class="kpi__value"><span class="count" data-count="88" data-decimals="0">0</span><span class="kpi__unit">分</span></div></div></div>' +
      '<div class="col-3"><div class="card kpi reveal"><div class="kpi__top"><span class="kpi__label">审核时效</span>' +
      '<span class="kpi__icon">' + I.svg('clock', 14) + '</span></div>' +
      '<div class="kpi__value"><span class="count" data-count="4.2" data-decimals="1">0</span><span class="kpi__unit">小时</span></div></div></div>' +
      '</div>' +

      '<div class="card reveal">' +
      '<div class="card__head">' +
      '<div class="u-grow"><div class="card__title">认证队列</div></div>' +
      C.segmented([{ key: 'pending', label: '待审核' }, { key: 'all', label: '全部' }], 'all', 'cert-filter') +
      '</div>' +
      '<div class="table-wrap"><table class="table">' +
      '<thead><tr><th>学生</th><th>专业 / 年级</th><th>认证等级</th><th>学籍</th><th>资质</th><th>能力</th><th>信用分</th><th></th></tr></thead>' +
      '<tbody>' + D.tutors.map(verifyRow).join('') + '</tbody>' +
      '</table></div>' +
      '<div class="card__foot"><span>共 ' + D.tutors.length + ' 位学生</span>' +
      '<span>认证编号格式 <code class="u-mono">JS-YYYY-NNNNNN</code></span></div>' +
      '</div>' +
      '</section>'
    );
  }

  /* ==========================================================================
   * 5. 履约与评价
   * ====================================================================== */
  function checkinRow(c) {
    var tone = c.status === 'confirmed' ? 'ok' : 'warn';
    return (
      '<tr data-open-checkin="' + esc(c.id) + '">' +
      '<td class="cell-strong u-mono">' + esc(c.id) + '</td>' +
      '<td class="u-mono">' + esc(c.demandId) + '</td>' +
      '<td>' + esc(c.tutor) + '<div class="u-dim" style="font-size:10.5px">家长 ' + esc(c.parent) + '</div></td>' +
      '<td class="cell-num">' + esc(c.date) + '</td>' +
      '<td class="cell-num">' + Math.floor(c.duration / 60) + 'h ' + (c.duration % 60) + 'm</td>' +
      '<td>' + C.badge(c.status === 'confirmed' ? '家长已确认' : '待确认', tone, true) + '</td>' +
      '<td class="cell-actions">' +
      (c.status === 'pending'
        ? '<button class="btn btn--ok btn--sm" data-action="confirm-checkin" data-id="' + esc(c.id) + '">确认履约</button>'
        : '<button class="btn btn--ghost btn--sm" data-open-checkin="' + esc(c.id) + '">查看</button>') +
      '</td>' +
      '</tr>'
    );
  }

  function reviewBlock(r) {
    var p = r.parent;
    var head =
      '<div class="u-row u-between" style="margin-bottom:10px">' +
      '<span class="section-label" style="margin:0">' + esc(r.demandId) + '</span>' +
      (r.reveal ? C.badge('双方已揭晓', 'ok') : C.badge('等待对方评价', 'warn')) +
      '</div>';

    var parentCard =
      '<div class="review-card">' +
      '<div class="review-card__head">' + C.avatar(p.name, 'default', 'sm') +
      '<span class="review-card__who">' + esc(p.name) + ' · 家长评老师</span>' +
      '<span style="margin-left:auto">' + C.stars(p.rating) + '</span></div>' +
      '<div class="doc__p">' + esc(p.text) + '</div>' +
      '<div class="review-card__tags">' + p.tags.map(function (t) { return C.badge(t, 'ok'); }).join('') + '</div>' +
      '</div>';

    var tutorCard = r.tutor
      ? '<div class="review-card">' +
        '<div class="review-card__head">' + C.avatar(r.tutor.name, 'teal', 'sm') +
        '<span class="review-card__who">' + esc(r.tutor.name) + ' · 老师评家长</span>' +
        '<span style="margin-left:auto">' + C.stars(r.tutor.rating) + '</span></div>' +
        '<div class="doc__p">' + esc(r.tutor.text) + '</div>' +
        '<div class="review-card__tags">' + r.tutor.tags.map(function (t) { return C.badge(t, 'info'); }).join('') + '</div>' +
        '</div>'
      : C.locked('对方评价在双方都提交后才可见（双向盲评）');

    return '<div style="margin-bottom:18px">' + head + parentCard + tutorCard + '</div>';
  }

  function fulfillment() {
    var avgMinutes = D.checkins.reduce(function (s, c) { return s + c.duration; }, 0) / D.checkins.length;
    return (
      '<section class="view" data-view="fulfillment">' +
      '<div class="page-head">' +
      '<div><div class="page-head__title">履约与互评</div>' +
      '<div class="page-head__desc">打卡记录作为履约凭证；双方都提交评价后才互相可见，信用分随之动态更新。</div></div>' +
      '<div class="page-head__actions">' +
      C.button('导出履约记录', { variant: 'ghost', iconLeft: 'download', action: 'export' }) +
      '</div>' +
      '</div>' +

      '<div class="grid">' +
      '<div class="col-3"><div class="card kpi reveal"><div class="kpi__top"><span class="kpi__label">本期打卡</span>' +
      '<span class="kpi__icon">' + I.svg('clock', 14) + '</span></div>' +
      '<div class="kpi__value"><span class="count" data-count="' + D.checkins.length + '">0</span><span class="kpi__unit">次</span></div></div></div>' +
      '<div class="col-3"><div class="card kpi reveal"><div class="kpi__top"><span class="kpi__label">平均课时</span>' +
      '<span class="kpi__icon">' + I.svg('chart', 14) + '</span></div>' +
      '<div class="kpi__value"><span class="count" data-count="' + Math.round(avgMinutes) + '">0</span><span class="kpi__unit">分钟</span></div></div></div>' +
      '<div class="col-3"><div class="card kpi reveal"><div class="kpi__top"><span class="kpi__label">待家长确认</span>' +
      '<span class="kpi__icon">' + I.svg('alert', 14) + '</span></div>' +
      '<div class="kpi__value"><span class="count" data-count="' + D.checkins.filter(function (c) { return c.status === 'pending'; }).length + '">0</span><span class="kpi__unit">条</span></div></div></div>' +
      '<div class="col-3"><div class="card kpi reveal"><div class="kpi__top"><span class="kpi__label">评价揭晓率</span>' +
      '<span class="kpi__icon">' + I.svg('star', 14) + '</span></div>' +
      '<div class="kpi__value"><span class="count" data-count="50">0</span><span class="kpi__unit">%</span></div></div></div>' +
      '</div>' +

      '<div class="card reveal">' +
      '<div class="card__head"><div class="card__title">上课打卡记录</div>' +
      '<div class="card__head-actions">' + C.badge('定位为 mock', 'neutral') + '</div></div>' +
      '<div class="table-wrap"><table class="table">' +
      '<thead><tr><th>记录号</th><th>订单</th><th>学生</th><th>开始时间</th><th>时长</th><th>状态</th><th></th></tr></thead>' +
      '<tbody>' + D.checkins.map(checkinRow).join('') + '</tbody>' +
      '</table></div>' +
      '</div>' +

      '<div class="card reveal">' +
      '<div class="card__head"><div class="card__title">双向盲评</div>' +
      '<div class="card__head-actions">' + C.badge('信用分规则：5★ +3 / 4★ +1.5 / 1★ -4', 'violet') + '</div></div>' +
      '<div class="card__body">' + D.reviews.map(reviewBlock).join('') + '</div>' +
      '</div>' +
      '</section>'
    );
  }

  /* ==========================================================================
   * 6. 设计规范（把"统一 UI 规范"可视化，便于团队对齐与验收）
   * ====================================================================== */
  function design() {
    var swatches = [
      ['--accent', '#5B8CFF'], ['--violet', '#8B6CFF'], ['--teal', '#22D3A6'],
      ['--amber', '#F5A524'], ['--danger', '#FF6B6B'], ['--text-1', '#EDF2FF'],
      ['--text-2', '#A9B5D0'], ['--text-3', '#6C7896'], ['--stroke-1', 'rgba(255,255,255,.075)']
    ]
      .map(function (s) {
        return (
          '<div class="swatch"><div class="swatch__chip" style="background:var(' + s[0] + ')"></div>' +
          '<div class="swatch__meta">' + s[0] + '</div></div>'
        );
      })
      .join('');

    return (
      '<section class="view" data-view="design">' +
      '<div class="page-head">' +
      '<div><div class="page-head__title">设计规范与组件状态</div>' +
      '<div class="page-head__desc">所有页面共用同一套令牌与控件状态，新增页面禁止自造样式。</div></div>' +
      '</div>' +

      '<div class="grid">' +
      '<div class="col-6"><div class="card reveal"><div class="card__head"><div class="card__title">色板</div></div>' +
      '<div class="card__body"><div class="swatches">' + swatches + '</div></div></div></div>' +

      '<div class="col-6"><div class="card reveal"><div class="card__head"><div class="card__title">按钮 · 六态齐全</div></div>' +
      '<div class="card__body"><div class="spec-grid">' +
      '<div class="spec-cell"><div class="spec-cell__label">Primary</div>' +
      '<div class="u-row u-gap-2" style="flex-wrap:wrap">' +
      C.button('默认', { variant: 'primary' }) +
      C.button('加载中', { variant: 'primary', className: 'is-loading' }) +
      C.button('禁用', { variant: 'primary', disabled: true }) + '</div></div>' +
      '<div class="spec-cell"><div class="spec-cell__label">Secondary / Ghost</div>' +
      '<div class="u-row u-gap-2" style="flex-wrap:wrap">' + C.button('默认') +
      C.button('幽灵', { variant: 'ghost' }) + C.button('图标', { variant: 'ghost', icon: 'settings' }) + '</div></div>' +
      '<div class="spec-cell"><div class="spec-cell__label">语义</div>' +
      '<div class="u-row u-gap-2" style="flex-wrap:wrap">' + C.button('通过', { variant: 'ok' }) +
      C.button('驳回', { variant: 'danger' }) + '</div></div>' +
      '<div class="spec-cell"><div class="spec-cell__label">输入 / 分段 / 开关</div>' +
      '<input class="input" placeholder="搜索…" style="margin-bottom:8px" />' +
      C.segmented([{ key: 'a', label: '全部' }, { key: 'b', label: '待办' }], 'a', 'demo') +
      '<div class="u-row u-gap-3" style="margin-top:10px"><span class="switch is-on"></span><span class="u-dim" style="font-size:12px">只看风险单</span></div>' +
      '</div>' +
      '</div></div></div>' +
      '</div>' +

      '<div class="col-12"><div class="card reveal"><div class="card__head"><div class="card__title">徽章与认证等级</div></div>' +
      '<div class="card__body"><div class="u-row u-gap-3" style="flex-wrap:wrap">' +
      C.badge('招募中', 'info', true) + C.badge('匹配中', 'violet', true) + C.badge('已匹配', 'ok', true) +
      C.badge('高风险', 'danger') + C.badge('中风险', 'warn') + C.badge('低风险', 'ok') +
      C.certBadge(3, 'JS-2026-000101') + C.certBadge(2) + C.certBadge(1) + C.certBadge(0) +
      '</div></div></div></div>' +
      '</div>' +

      '<div class="card reveal"><div class="card__head"><div class="card__title">动效与无障碍</div></div>' +
      '<div class="card__body"><div class="doc">' +
      '<div class="doc__p">入场：视图切换 420ms ease-out；卡片组 55ms 递增错峰（IntersectionObserver 触发）。' +
      '\n交互：按钮 active scale .972；卡片 hover 位移 -2px + 边框提亮；侧栏折叠 320ms 弹簧曲线。' +
      '\n氛围：粒子场 800~1400 点、漂浮线框几何体 3~4 个、鼠标视差阻尼跟随；叠加 4 层背景（网格/细线/颗粒/渐晕）。' +
      '\n无障碍：全部图标按钮有 aria-label；键盘焦点环仅 :focus-visible 显示；prefers-reduced-motion 下关闭所有动画与 3D 渲染。</div>' +
      '</div></div></div>' +
      '</section>'
    );
  }

  /* ==========================================================================
   * 抽屉内容
   * ====================================================================== */
  function drawerDemand(d) {
    var hits = (d.riskHits || []).length
      ? '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
        d.riskHits.map(function (h) { return C.badge(h, 'danger'); }).join('') + '</div>'
      : '<span class="u-dim" style="font-size:12px">未命中风险词</span>';

    var policyBlock =
      d.policy === 'blocked'
        ? '<div class="compliance alert-pulse">' +
          '<span class="compliance__icon">' + I.svg('scale', 15) + '</span>' +
          '<div class="compliance__text u-grow"><b>已触发双减红线，禁止发布</b><br>' +
          esc(D.meta.policyMessage) + '<br>命中证据：' + esc((d.policyEvidence || []).join('；')) + '</div></div>'
        : '<div class="compliance" style="background:linear-gradient(90deg,rgba(34,211,166,.12),rgba(34,211,166,.03));border-color:rgba(34,211,166,.24)">' +
          '<span class="compliance__icon" style="background:rgba(34,211,166,.16);color:#7BEBC8">' + I.svg('check', 15) + '</span>' +
          '<div class="compliance__text u-grow" style="color:#9CF0D8"><b style="color:#fff">合规通过</b>　学科类不得安排在休息日，本单时段与学科属性匹配。</div></div>';

    return {
      title: d.id + ' · ' + d.subject + ' ' + d.grade,
      sub: d.parent + ' · ' + d.phone + ' · 提交于 ' + d.createdAt,
      body:
        '<div>' +
        '<div class="u-row u-gap-2" style="margin-bottom:12px">' + C.statusBadge(d.status) + C.riskBadge(d.risk) + C.policyBadge(d.policy) + '</div>' +
        C.kvBlock([
          ['授课方式', d.mode],
          ['频次', d.frequency],
          ['时间段', d.timeRange],
          ['区域', d.district],
          ['预算', '¥' + d.budget + ' / 小时'],
          ['匹配分', d.score ? d.score.toFixed(1) + ' 分' : '—'],
          ['推荐学生', d.tutor]
        ]) +
        '</div>' +
        '<div>' + C.sectionLabel('特殊要求') + C.note(d.requirement) + '</div>' +
        '<div>' + C.sectionLabel('双减合规校验') + policyBlock + '</div>' +
        '<div>' + C.sectionLabel('风险词检测') + hits + '</div>' +
        '<div>' + C.sectionLabel('平台性质') + '<div class="u-dim" style="font-size:12px;line-height:1.7">' + esc(D.meta.platformPosition) + '</div></div>',
      foot:
        (d.policy === 'blocked'
          ? C.button('通知家长修改', { variant: 'ghost' }) +
            C.button('删除工单', { variant: 'danger' })
          : C.button('查看匹配', { variant: 'ghost' }) +
            C.button('生成对接报告', { variant: 'primary' })) +
        ''
    };
  }

  function drawerTutor(t) {
    var certLine = function (key, label) {
      var st = t.certs[key];
      var tone = st === 'approved' ? 'ok' : st === 'pending' ? 'warn' : 'danger';
      var text = st === 'approved' ? '已通过' : st === 'pending' ? '待审核' : '已驳回';
      return (
        '<div class="row-item" style="padding:10px 0;border:0">' +
        '<span class="row-item__main"><span class="row-item__title">' + label + '</span></span>' +
        C.badge(text, tone, true) +
        '</div>'
      );
    };
    return {
      title: t.name + ' · ' + (t.certLevel >= 3 ? '三重认证' : t.certLevel + ' 级认证'),
      sub: t.id + ' · ' + t.school + ' · ' + t.major + ' · ' + t.grade,
      body:
        '<div class="u-row u-gap-3">' + C.avatar(t.name, t.certLevel >= 3 ? 'teal' : 'default', 'lg') +
        '<div class="u-grow"><div class="u-row u-gap-2" style="flex-wrap:wrap">' + C.certBadge(t.certLevel, t.badgeNo) +
        C.badge('信用分 ' + t.credit, 'info') + C.badge('¥' + t.price + '/时', 'neutral') + '</div>' +
        '<div class="u-dim" style="font-size:11.5px;margin-top:4px">' + esc(t.intro) + '</div></div></div>' +

        '<div>' + C.sectionLabel('三重认证进度') +
        certLine('student', '学籍认证') + certLine('qualification', '资质认证') + certLine('ability', '能力认证') + '</div>' +

        '<div>' + C.sectionLabel('能力标签') +
        '<div style="display:flex;gap:6px;flex-wrap:wrap">' + t.abilityTags.map(function (x) { return C.badge(x, 'violet'); }).join('') + '</div></div>' +

        '<div>' + C.sectionLabel('脱敏信息') +
        C.kvBlock([
          ['学号', t.studentNo],
          ['校园邮箱', t.email],
          ['手机号', t.phone],
          ['可授科目', t.subjects.join(' / ')],
          ['可带年级', t.grades.join(' / ')],
          ['认证编号', t.badgeNo]
        ]) + '</div>' +

        '<div class="u-dim" style="font-size:11.5px;line-height:1.7">平台不采集真实身份证与学号，OCR 与学籍校验均为 mock；审核通过后由规则引擎重算认证等级与信用分。</div>',
      foot: C.button('驳回', { variant: 'danger' }) + C.button('通过并生成徽章', { variant: 'primary' })
    };
  }

  function drawerCheckin(c) {
    return {
      title: c.id + ' · 打卡记录',
      sub: c.tutor + ' → ' + c.parent + ' · ' + c.demandId,
      body:
        '<div>' + C.kvBlock([
          ['开始时间', c.date],
          ['时长', Math.floor(c.duration / 60) + ' 小时 ' + (c.duration % 60) + ' 分钟'],
          ['状态', c.status === 'confirmed' ? '家长已确认' : '待家长确认'],
          ['定位', '校内认证场地（mock）']
        ]) + '</div>' +
        '<div>' + C.sectionLabel('课后小结') + C.note(c.summary) + '</div>' +
        '<div class="u-dim" style="font-size:11.5px;line-height:1.7">打卡定位为 mock 数据，不采集真实位置；打卡记录可作为课时费争议凭证，资金结算为二期规划。</div>',
      foot: c.status === 'pending' ? C.button('确认履约', { variant: 'primary' }) : C.button('关闭', { variant: 'ghost' })
    };
  }

  /* ==========================================================================
   * 图表挂载（DOM 可见后执行）
   * ====================================================================== */
  var after = {
    overview: function (root) {
      if (!global.Charts) return;
      var noAnim = !!global.__STATIC_RENDER__;
      var trendEl = root.querySelector('[data-chart="trend"]');
      if (trendEl) {
        global.Charts.line(trendEl, {
          labels: D.trend.labels,
          series: D.trend.series,
          yTicks: 4,
          animate: !noAnim,
          valueFormat: function (v) { return v + ' 单'; }
        });
      }
      var funnelEl = root.querySelector('[data-chart="funnel"]');
      if (funnelEl) {
        // 图表引擎的 funnel 契约是 items:[{name,value}]，此处做一层适配
        global.Charts.funnel(funnelEl, {
          items: D.certFunnel.map(function (x) {
            return { name: x.label, value: x.value };
          }),
          animate: !noAnim
        });
      }

      var riskEl = root.querySelector('[data-chart="risk"]');
      if (riskEl) global.Charts.bar(riskEl, { labels: D.riskDistribution.labels, series: D.riskDistribution.series, animate: !noAnim });

      var heatEl = root.querySelector('[data-chart="heat"]');
      if (heatEl) {
        // heatmap 契约为 rows:[[...]]（行优先），把"周 × 天"转置成"天 × 周"
        var dayLabels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
        var rows = dayLabels.map(function (_, di) {
          return D.heatmap.map(function (week) {
            return week[di];
          });
        });
        global.Charts.heatmap(heatEl, {
          rows: rows,
          rowLabels: dayLabels,
          labels: D.heatmap.map(function (_, wi) {
            return 'W' + (wi + 1);
          }),
          animate: !noAnim
        });
      }

      // KPI 迷你趋势线
      D.kpis.forEach(function (k) {
        var el = root.querySelector('[data-spark="' + k.key + '"]');
        if (el) global.Charts.sparkline(el, { data: k.spark, color: k.delta >= 0 ? 'var(--accent)' : 'var(--danger)', animate: !noAnim });
      });
    }
  };

  global.Views = {
    overview: overview,
    demands: demands,
    matching: matching,
    verify: verify,
    fulfillment: fulfillment,
    design: design,
    drawerDemand: drawerDemand,
    drawerTutor: drawerTutor,
    drawerCheckin: drawerCheckin,
    after: after,
    demandRow: demandRow
  };
})(window);
