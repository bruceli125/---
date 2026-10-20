/* ============================================================================
 * components.js —— 组件工厂（纯函数，返回 HTML 字符串）
 * 所有页面必须通过这里生成 UI，禁止在视图里手写徽章/卡片结构，
 * 这样"统一 UI 规范"才是真的统一，而不是靠自觉。
 * ========================================================================== */
(function (global) {
  'use strict';

  var Icons = global.Icons;

  /* ---------------- 基础工具 ---------------- */
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function cls() {
    return Array.prototype.slice.call(arguments).filter(Boolean).join(' ');
  }

  /* ---------------- 状态映射（单一事实来源） ---------------- */
  var STATUS = {
    published: { label: '招募中', tone: 'info' },
    matching: { label: '匹配中', tone: 'violet' },
    matched: { label: '已匹配', tone: 'ok' },
    closed: { label: '已结束', tone: 'neutral' },
    blocked: { label: '合规拦截', tone: 'danger' },
    pending: { label: '待审核', tone: 'warn' },
    approved: { label: '已通过', tone: 'ok' },
    rejected: { label: '已驳回', tone: 'danger' },
    confirmed: { label: '家长已确认', tone: 'ok' }
  };

  var RISK = {
    low: { label: '低风险', tone: 'ok' },
    medium: { label: '中风险', tone: 'warn' },
    high: { label: '高风险', tone: 'danger' }
  };

  /* ---------------- 徽章 ---------------- */
  function badge(text, tone, dot) {
    return (
      '<span class="badge badge--' + (tone || 'neutral') + (dot ? ' badge--dot' : '') + '">' + esc(text) + '</span>'
    );
  }

  function statusBadge(status) {
    var m = STATUS[status] || { label: status, tone: 'neutral' };
    return badge(m.label, m.tone, true);
  }

  function riskBadge(risk) {
    var m = RISK[risk] || RISK.low;
    return badge(m.label, m.tone);
  }

  function policyBadge(policy) {
    return policy === 'blocked'
      ? '<span class="badge badge--danger">' + Icons.svg('scale', 11) + ' 双减拦截</span>'
      : '<span class="badge badge--ok">' + Icons.svg('check', 11) + ' 合规</span>';
  }

  /** 三重认证徽章：等级决定视觉强度 */
  function certBadge(level, badgeNo) {
    var lv = Number(level || 0);
    var tone = lv >= 3 ? '' : lv === 2 ? 'cert-badge--l2' : lv === 1 ? 'cert-badge--l1' : 'cert-badge--none';
    var label = lv >= 3 ? '三重认证' : lv === 2 ? '双重认证' : lv === 1 ? '学籍认证' : '未认证';
    var icon = lv >= 3 ? Icons.svg('shield', 13) : lv >= 1 ? Icons.svg('checkCircle', 13) : Icons.svg('minus', 13);
    return (
      '<span class="cert-badge ' + tone + '" title="' + esc(badgeNo || label) + '">' + icon + esc(label) + '</span>'
    );
  }

  function stars(n, muted) {
    var out = '<span class="stars' + (muted ? ' stars--muted' : '') + '" aria-label="' + n + ' 星">';
    for (var i = 1; i <= 5; i++) out += i <= n ? '★' : '☆';
    return out + '</span>';
  }

  function avatar(name, tone, size) {
    var initial = String(name || '?').slice(0, 1);
    var sizeCls = size === 'lg' ? ' avatar--lg' : size === 'sm' ? ' avatar--sm' : '';
    var toneCls = tone === 'teal' ? ' avatar--teal' : tone === 'amber' ? ' avatar--amber' : '';
    return '<span class="avatar' + sizeCls + toneCls + '">' + esc(initial) + '</span>';
  }

  function trendPill(delta) {
    var d = Number(delta || 0);
    var isUp = d > 0;
    var isFlat = d === 0;
    var tone = isFlat ? 'flat' : isUp ? 'up' : 'down';
    var icon = isFlat ? Icons.svg('minus', 11) : isUp ? Icons.svg('arrowUp', 11) : Icons.svg('arrowDown', 11);
    return (
      '<span class="trend trend--' + tone + '">' + icon + (isUp ? '+' : '') + d.toFixed(1) + '%</span>'
    );
  }

  function legend(items) {
    return (
      '<div class="legend">' +
      items
        .map(function (it) {
          return (
            '<span class="legend__item"><span class="legend__swatch" style="background:' +
            it.color +
            '"></span>' +
            esc(it.label) +
            '</span>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  /* ---------------- 结构块 ---------------- */
  function kpiCard(k) {
    var decimals = k.decimals || 0;
    return (
      '<div class="card card--hover card--spot kpi" data-kpi="' + esc(k.key) + '">' +
      '<div class="kpi__top">' +
      '<span class="kpi__label">' + esc(k.label) + '</span>' +
      '<span class="kpi__icon">' + Icons.svg(k.icon, 14) + '</span>' +
      '</div>' +
      '<div class="kpi__value">' +
      '<span class="count" data-count="' + k.value + '" data-decimals="' + decimals + '">0</span>' +
      '<span class="kpi__unit">' + esc(k.unit) + '</span>' +
      '</div>' +
      '<div class="kpi__foot">' +
      trendPill(k.delta) +
      '<div class="kpi__spark chart" data-spark="' + esc(k.key) + '"></div>' +
      '</div>' +
      '</div>'
    );
  }

  function sectionLabel(text) {
    return '<div class="section-label">' + esc(text) + '</div>';
  }

  function kvBlock(pairs) {
    return (
      '<dl class="kv">' +
      pairs
        .map(function (p) {
          return '<dt>' + esc(p[0]) + '</dt><dd>' + (p[2] ? p[1] : esc(p[1])) + '</dd>';
        })
        .join('') +
      '</dl>'
    );
  }

  function note(text, tone) {
    return '<div class="note' + (tone ? ' note--' + tone : '') + '">' + esc(text) + '</div>';
  }

  function locked(text) {
    return (
      '<div class="locked"><span class="locked__icon">' +
      Icons.svg('lock', 15) +
      '</span><div>' +
      esc(text) +
      '</div></div>'
    );
  }

  function emptyState(title, desc, actionHtml) {
    return (
      '<div class="empty-state">' +
      '<div class="empty-state__orb"></div>' +
      '<div class="empty-state__title">' + esc(title) + '</div>' +
      '<div class="empty-state__desc">' + esc(desc) + '</div>' +
      (actionHtml ? '<div style="margin-top:16px;position:relative">' + actionHtml + '</div>' : '') +
      '</div>'
    );
  }

  function segmented(items, activeKey, name) {
    return (
      '<div class="seg" data-seg="' + esc(name || '') + '">' +
      items
        .map(function (it) {
          return (
            '<button class="seg__btn' +
            (it.key === activeKey ? ' is-active' : '') +
            '" data-seg-value="' +
            esc(it.key) +
            '">' +
            esc(it.label) +
            '</button>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function button(label, opts) {
    var o = opts || {};
    var classes = cls('btn', o.variant ? 'btn--' + o.variant : '', o.size ? 'btn--' : '', o.size === 'sm' ? 'btn--sm' : '', o.size === 'lg' ? 'btn--lg' : '', o.icon ? 'btn--icon' : '', o.className || '');
    var inner = o.icon
      ? Icons.svg(o.icon, o.size === 'sm' ? 14 : 15) + (label ? '<span class="btn__text">' + esc(label) + '</span>' : '')
      : (o.iconLeft ? Icons.svg(o.iconLeft, 15) : '') + '<span class="btn__text">' + esc(label) + '</span>';
    return (
      '<button class="' +
      classes.trim() +
      '"' +
      (o.id ? ' id="' + esc(o.id) + '"' : '') +
      (o.action ? ' data-action="' + esc(o.action) + '"' : '') +
      (o.disabled ? ' disabled' : '') +
      (o.title ? ' title="' + esc(o.title) + '"' : '') +
      '>' +
      inner +
      '</button>'
    );
  }

  function feedItem(item) {
    var dotCls =
      item.type === 'ok' ? ' feed__dot--ok' : item.type === 'warn' ? ' feed__dot--warn' : item.type === 'danger' ? ' feed__dot--danger' : '';
    return (
      '<div class="feed__item">' +
      '<div class="feed__rail"><span class="feed__dot' + dotCls + '"></span></div>' +
      '<div class="feed__body">' +
      '<div class="feed__text">' + item.text + '</div>' +
      '<div class="feed__time">' + esc(item.time) + '</div>' +
      '</div></div>'
    );
  }

  function insightCard(iconName, tone, title, desc) {
    return (
      '<div class="card card--hover" style="padding:16px">' +
      '<div class="u-row u-gap-3">' +
      '<span class="kpi__icon" style="color:var(--' + tone + ')">' + Icons.svg(iconName, 14) + '</span>' +
      '<div class="u-grow"><div style="font-size:13px;font-weight:600">' + esc(title) + '</div>' +
      '<div class="u-dim" style="font-size:11.5px;margin-top:2px;line-height:1.6">' + esc(desc) + '</div></div>' +
      '</div></div>'
    );
  }

  global.Components = {
    esc: esc,
    STATUS: STATUS,
    RISK: RISK,
    badge: badge,
    statusBadge: statusBadge,
    riskBadge: riskBadge,
    policyBadge: policyBadge,
    certBadge: certBadge,
    stars: stars,
    avatar: avatar,
    trendPill: trendPill,
    legend: legend,
    kpiCard: kpiCard,
    sectionLabel: sectionLabel,
    kvBlock: kvBlock,
    note: note,
    locked: locked,
    emptyState: emptyState,
    segmented: segmented,
    button: button,
    feedItem: feedItem,
    insightCard: insightCard
  };
})(window);
