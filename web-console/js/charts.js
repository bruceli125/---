/* ============================================================================
 * 京师家教 · 运营控制台 —— Canvas 图表引擎 charts.js
 * ----------------------------------------------------------------------------
 * 纯 Canvas 2D、零依赖、ES5 语法（IIFE 只暴露 window.Charts）。
 *
 * 设计基调：Vercel / Linear / Grafana 式克制风
 *   · 颜色全部取自 css/tokens.css 的 CSS 变量，读不到时用硬编码 fallback
 *   · 网格 rgba(255,255,255,.05) 1px，轴线不画，折线 1.75px
 *   · 刻度数字等宽（SF Mono / ui-monospace），数据点只在 hover 时出现
 *   · 入场动画 620ms easeOutCubic，从左到右生长
 *
 * 对外 API（严格签名）：
 *   Charts.line(el, cfg) / bar / donut / sparkline / heatmap / funnel / destroy(el)
 *
 * 重要：本文件在 require 时不触碰任何浏览器 API（document/window 尺寸等），
 *       所有浏览器访问都发生在方法调用内部，便于主程序做静态校验。
 * ========================================================================== */
(function (global) {
  'use strict';

  /* ==========================================================================
   * 0. 常量
   * ======================================================================== */

  var DURATION = 620;                              // 入场动画时长（ms）
  var TAU = Math.PI * 2;
  var MONO = '"SF Mono", ui-monospace, monospace'; // 与 base.css .num/.tabular 一致
  var SANS = '-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

  var GRID_STROKE = 'rgba(255, 255, 255, 0.05)';   // 网格线（极淡）
  var AXIS_STRONG = 'rgba(255, 255, 255, 0.09)';   // 0 基线略强一点
  var GUIDE_STROKE = 'rgba(255, 255, 255, 0.16)';  // hover 垂直指示线
  var BAND_FILL = 'rgba(255, 255, 255, 0.035)';    // hover 柱状高亮带
  var EMPTY_CELL = 'rgba(255, 255, 255, 0.04)';    // 热力图空格子

  // 系列默认取色顺序（全部来自 tokens.css）
  var SERIES_VARS = ['--accent', '--violet', '--teal', '--amber', '--danger'];

  // 每个 CSS 变量的硬编码 fallback：getComputedStyle 读不到时兜底
  var FALLBACKS = {
    '--accent': '#5B8CFF',
    '--accent-soft': 'rgba(91, 140, 255, 0.16)',
    '--violet': '#8B6CFF',
    '--violet-soft': 'rgba(139, 108, 255, 0.16)',
    '--teal': '#22D3A6',
    '--teal-soft': 'rgba(34, 211, 166, 0.15)',
    '--amber': '#F5A524',
    '--amber-soft': 'rgba(245, 165, 36, 0.15)',
    '--danger': '#FF6B6B',
    '--danger-soft': 'rgba(255, 107, 107, 0.15)',
    '--text-1': '#EDF2FF',
    '--text-2': '#A9B5D0',
    '--text-3': '#6C7896',
    '--text-4': '#4B5470',
    '--text-on-accent': '#05070D',
    '--stroke-1': 'rgba(255, 255, 255, 0.075)',
    '--stroke-2': 'rgba(255, 255, 255, 0.13)',
    '--bg-raise': '#0B1019',
    '--bg-overlay': '#0E1420'
  };

  // 实例注册表：[{ el, st }]，同一容器重复初始化时先销毁旧的
  var registry = [];

  /* ==========================================================================
   * 1. 基础工具
   * ======================================================================== */

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function clamp01(v) {
    return v < 0 ? 0 : (v > 1 ? 1 : v);
  }

  /** easeOutCubic：入场缓动，末段收敛，不浮夸 */
  function easeOutCubic(t) {
    var u = 1 - clamp01(t);
    return 1 - u * u * u;
  }

  function nowMs() {
    if (global && global.performance && typeof global.performance.now === 'function') {
      return global.performance.now();
    }
    return Date.now();
  }

  function raf(cb) {
    if (global && typeof global.requestAnimationFrame === 'function') {
      return global.requestAnimationFrame(cb);
    }
    if (typeof setTimeout === 'function') {
      return setTimeout(function () { cb(nowMs()); }, 16);
    }
    return 0;
  }

  function caf(id) {
    if (!id) return;
    if (global && typeof global.cancelAnimationFrame === 'function') {
      try { global.cancelAnimationFrame(id); return; } catch (e) { /* ignore */ }
    }
    if (typeof clearTimeout === 'function') {
      try { clearTimeout(id); } catch (e2) { /* ignore */ }
    }
  }

  /** HTML 转义：tooltip 用 innerHTML，标签/系列名必须转义 */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      if (c === '&') return '&amp;';
      if (c === '<') return '&lt;';
      if (c === '>') return '&gt;';
      if (c === '"') return '&quot;';
      return '&#39;';
    });
  }

  function toNum(v) {
    if (v && typeof v === 'object') {
      v = v.value !== undefined ? v.value : v.y;
    }
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function cleanNum(v) {
    if (!isFinite(v)) return 0;
    var r = Math.round(v * 1e6) / 1e6;
    return Object.is && Object.is(r, -0) ? 0 : r;
  }

  function groupInt(v) {
    return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /** 数值 → 紧凑文本（千分位 / 万），用于刻度与 tooltip */
  function fmtNum(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    var neg = v < 0;
    var a = Math.abs(v);
    var s;
    if (a >= 100000000) s = cleanNum(a / 100000000) + '亿';
    else if (a >= 10000) s = cleanNum(a / 10000) + '万';
    else if (a >= 1000) s = groupInt(Math.round(a));
    else if (a >= 10) s = String(cleanNum(Math.round(a * 10) / 10));
    else s = String(Math.round(a * 100) / 100);
    return (neg ? '-' : '') + s;
  }

  /** 刻度标签：更短，避免挤占绘图区 */
  function fmtTick(v) {
    if (!isFinite(v)) return '';
    var a = Math.abs(v);
    if (a >= 10000) return cleanNum(v / 10000) + '万';
    if (a >= 1000) return groupInt(Math.round(v));
    return String(cleanNum(v));
  }

  /** tooltip / 中心文案：优先使用 cfg.valueFormat */
  function fmtValue(st, v) {
    var f = st && st.cfg ? st.cfg.valueFormat : null;
    if (typeof f === 'function') {
      try {
        var out = f(v);
        if (out !== undefined && out !== null && out !== '') return String(out);
      } catch (e) { /* 用户回调异常不能拖垮图表 */ }
    }
    var s = fmtNum(v);
    var u = st && st.cfg ? st.cfg.unit : '';
    return u ? s + ' ' + u : s;
  }

  /* ---------------------------------- 颜色 --------------------------------- */

  function parseColor(input) {
    if (typeof input !== 'string') return null;
    var s = input.replace(/^\s+|\s+$/g, '');
    if (!s) return null;
    if (s.charAt(0) === '#') {
      var h = s.slice(1);
      if (h.length === 3 || h.length === 4) {
        var r3 = parseInt(h.charAt(0) + h.charAt(0), 16);
        var g3 = parseInt(h.charAt(1) + h.charAt(1), 16);
        var b3 = parseInt(h.charAt(2) + h.charAt(2), 16);
        if (isNaN(r3) || isNaN(g3) || isNaN(b3)) return null;
        return { r: r3, g: g3, b: b3, a: h.length === 4 ? parseInt(h.charAt(3) + h.charAt(3), 16) / 255 : 1 };
      }
      if (h.length === 6 || h.length === 8) {
        var r6 = parseInt(h.substring(0, 2), 16);
        var g6 = parseInt(h.substring(2, 4), 16);
        var b6 = parseInt(h.substring(4, 6), 16);
        if (isNaN(r6) || isNaN(g6) || isNaN(b6)) return null;
        return { r: r6, g: g6, b: b6, a: h.length === 8 ? parseInt(h.substring(6, 8), 16) / 255 : 1 };
      }
      return null;
    }
    var m = /^rgba?\(([^)]*)\)$/i.exec(s);
    if (!m) return null;
    var raw = m[1].split(/[\s,\/]+/);
    var parts = [];
    for (var i = 0; i < raw.length; i++) {
      if (raw[i]) parts.push(raw[i]);
    }
    if (parts.length < 3) return null;
    var conv = function (p, max) {
      if (/%$/.test(p)) return Math.round(parseFloat(p) / 100 * max);
      return Math.round(parseFloat(p));
    };
    var r = conv(parts[0], 255), g = conv(parts[1], 255), b = conv(parts[2], 255);
    var a = parts.length > 3 ? clamp01(parseFloat(parts[3])) : 1;
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return { r: r, g: g, b: b, a: isNaN(a) ? 1 : a };
  }

  /** 给任意颜色字符串加透明度；解析失败时原样返回（交给 Canvas 兜底） */
  function withAlpha(color, alpha) {
    var c = parseColor(color);
    if (!c) return color;
    var a = alpha === undefined || alpha === null ? c.a : clamp01(alpha);
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + (Math.round(a * 1000) / 1000) + ')';
  }

  function mixColor(a, b, t) {
    var ca = parseColor(a) || { r: 91, g: 140, b: 255 };
    var cb = parseColor(b) || { r: 255, g: 107, b: 107 };
    var k = clamp01(t);
    return 'rgb(' + Math.round(ca.r + (cb.r - ca.r) * k) + ',' +
      Math.round(ca.g + (cb.g - ca.g) * k) + ',' +
      Math.round(ca.b + (cb.b - ca.b) * k) + ')';
  }

  /**
   * 读 tokens.css 的 CSS 变量（每个都带 fallback）。
   * 只在渲染时调用一次，避免每帧 getComputedStyle 造成布局抖动。
   */
  function palette() {
    var out = {};
    var cs = null;
    try {
      if (global && global.document && global.document.documentElement &&
        typeof global.getComputedStyle === 'function') {
        cs = global.getComputedStyle(global.document.documentElement);
      }
    } catch (e) { cs = null; }

    for (var k in FALLBACKS) {
      if (!Object.prototype.hasOwnProperty.call(FALLBACKS, k)) continue;
      var v = '';
      if (cs && typeof cs.getPropertyValue === 'function') {
        try { v = cs.getPropertyValue(k); } catch (e2) { v = ''; }
      }
      v = typeof v === 'string' ? v.replace(/^\s+|\s+$/g, '') : '';
      out[k] = v || FALLBACKS[k];
    }
    return out;
  }

  /** 解析 'var(--accent)' 这类字符串；已是具体颜色则原样返回 */
  function resolveColor(input, pal) {
    if (typeof input !== 'string') return '';
    var s = input.replace(/^\s+|\s+$/g, '');
    if (!s) return '';
    if (s.indexOf('var(') !== -1) {
      var accent = (pal && pal['--accent']) || FALLBACKS['--accent'];
      var replaced = s.replace(/var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,[^)]*)?\)/g, function (all, name) {
        var v = (pal && pal[name]) || FALLBACKS[name];
        if (!v) v = accent;     // 不存在的变量名也要兜底，不能把 'var(...)' 交给 Canvas
        return v || accent;
      });
      return replaced.indexOf('var(') !== -1 ? accent : replaced;
    }
    return s;
  }

  function paletteColor(pal, i) {
    var name = SERIES_VARS[i % SERIES_VARS.length];
    return pal[name] || FALLBACKS[name];
  }

  /** 系列取色：显式色 > tokens 顺序色 */
  function seriesColor(st, series, i) {
    if (series && series.colorRaw) return resolveColor(series.colorRaw, st.pal);
    return paletteColor(st.pal, i);
  }

  /* ==========================================================================
   * 2. 容器尺寸 / Canvas 装配（DPR 上限 2）
   * ======================================================================== */

  function sizeOf(el) {
    if (!el) return null;
    var w = el.clientWidth || 0;
    var h = el.clientHeight || 0;
    if ((!w || !h) && typeof el.getBoundingClientRect === 'function') {
      try {
        var r = el.getBoundingClientRect();
        if (!w) w = r.width || 0;
        if (!h) h = r.height || 0;
      } catch (e) { /* ignore */ }
    }
    w = Math.floor(w);
    h = Math.floor(h);
    if (!(w > 0) || !(h > 0)) return null; // 容器不可见：直接跳过
    return { w: w, h: h };
  }

  function cssPosition(el) {
    try {
      if (!global || typeof global.getComputedStyle !== 'function') return '';
      var cs = global.getComputedStyle(el);
      return cs && cs.position ? cs.position : '';
    } catch (e) {
      return '';
    }
  }

  /* ==========================================================================
   * 3. HTML Tooltip（模块自建，样式内联，不依赖外部 CSS）
   * ======================================================================== */

  function ensureTip(st) {
    if (st.tip) return st.tip;
    if (!global || !global.document || typeof global.document.createElement !== 'function') return null;
    var tip = global.document.createElement('div');
    tip.className = 'chart-tip';
    var s = tip.style;
    s.position = 'fixed';
    s.left = '0px';
    s.top = '0px';
    s.zIndex = '9999';
    s.pointerEvents = 'none';
    s.opacity = '0';
    s.visibility = 'hidden';
    s.transition = 'opacity 120ms ease';
    s.padding = '8px 10px';
    s.borderRadius = '10px';
    s.background = 'rgba(11, 16, 25, 0.94)';
    s.border = '1px solid rgba(255, 255, 255, 0.12)';
    s.boxShadow = '0 16px 40px -18px rgba(0, 0, 0, 0.9), inset 0 1px 0 rgba(255, 255, 255, 0.05)';
    s.backdropFilter = 'blur(14px) saturate(140%)';
    s.webkitBackdropFilter = 'blur(14px) saturate(140%)';
    s.color = '#EDF2FF';
    s.fontFamily = SANS;
    s.fontSize = '12px';
    s.lineHeight = '1.5';
    s.letterSpacing = '0.01em';
    s.fontVariantNumeric = 'tabular-nums';
    s.maxWidth = '280px';
    s.minWidth = '104px';
    s.whiteSpace = 'nowrap';
    s.borderRadius = '10px';

    var host = global.document.body || global.document.documentElement;
    if (host && typeof host.appendChild === 'function') {
      try { host.appendChild(tip); } catch (e) { return null; }
    } else {
      return null;
    }
    st.tip = tip;
    return tip;
  }

  /** 单条数据行：色点 + 系列名 + 等宽数值 */
  function tipRow(color, name, value) {
    var dot = '<span style="flex:0 0 auto;width:6px;height:6px;border-radius:50%;background:' +
      esc(color) + ';box-shadow:0 0 0 2px ' + esc(withAlpha(color, 0.18)) + '"></span>';
    var nm = '<span style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;' +
      'color:#A9B5D0;font-size:12px">' + esc(name) + '</span>';
    var val = '<span style="flex:0 0 auto;margin-left:12px;color:#EDF2FF;font-size:12px;font-weight:600;' +
      'font-family:' + MONO + ';font-variant-numeric:tabular-nums;letter-spacing:0">' + esc(value) + '</span>';
    return '<div style="display:flex;align-items:center;gap:8px;line-height:1.6">' + dot + nm + val + '</div>';
  }

  function tipHTML(st, title, rows) {
    var pal = st.pal || {};
    var html = '';
    if (title) {
      html += '<div style="font-size:10px;line-height:1.4;letter-spacing:0.08em;text-transform:uppercase;' +
        'color:' + (pal['--text-3'] || FALLBACKS['--text-3']) + ';font-weight:600;margin-bottom:5px">' +
        esc(title) + '</div>';
    }
    var list = rows && rows.length ? rows : [];
    for (var i = 0; i < list.length; i++) {
      if (!list[i]) continue;
      html += tipRow(list[i].color || (pal['--accent'] || FALLBACKS['--accent']), list[i].name, list[i].value);
    }
    return html;
  }

  function showTip(st, cx, cy, info) {
    if (!st || !info) return;
    var tip = ensureTip(st);
    if (!tip) return;
    var html = tipHTML(st, info.title, info.rows);
    if (!html) { hideTip(st); return; }
    tip.innerHTML = html;
    tip.style.visibility = 'visible';
    tip.style.opacity = '1';

    var box = null;
    try { box = tip.getBoundingClientRect ? tip.getBoundingClientRect() : null; } catch (e) { box = null; }
    var tw = box && box.width ? box.width : 160;
    var th = box && box.height ? box.height : 60;
    var vw = (global && global.innerWidth) || 1024;
    var vh = (global && global.innerHeight) || 768;
    var vwDoc = global && global.document && global.document.documentElement
      ? (global.document.documentElement.clientWidth || vw) : vw;
    var vhDoc = global && global.document && global.document.documentElement
      ? (global.document.documentElement.clientHeight || vh) : vh;
    vw = vwDoc || vw;
    vh = vhDoc || vh;

    var ox = 16, oy = 14;
    var left = cx + ox;
    var top = cy + oy;
    if (left + tw > vw - 8) left = cx - tw - ox;   // 右侧放不下 → 翻到左侧
    if (top + th > vh - 8) top = cy - th - oy;     // 下方放不下 → 翻到上方
    if (left < 8) left = 8;
    if (top < 8) top = 8;
    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(top) + 'px';
  }

  function hideTip(st) {
    if (!st || !st.tip) return;
    st.tip.style.opacity = '0';
    st.tip.style.visibility = 'hidden';
  }

  function removeTip(st) {
    if (!st || !st.tip) return;
    var tip = st.tip;
    st.tip = null;
    if (tip.parentNode) {
      try { tip.parentNode.removeChild(tip); } catch (e) { /* ignore */ }
    }
  }

  /* ==========================================================================
   * 4. 坐标系 / 图形基元
   * ======================================================================== */

  /** 1/2/2.5/5/10 取整，得到"好看"的间距与刻度 */
  function niceScale(min, max, count) {
    var c = Math.max(1, count || 4);
    var raw = (max - min) / c;
    if (!(raw > 0) || !isFinite(raw)) raw = 1;
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag;
    var mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
    var step = mult * mag;
    var ticks = [], start = min, end = max;

    for (var attempt = 0; attempt < 5; attempt++) {
      start = Math.floor(min / step + 1e-9) * step;
      end = Math.ceil(max / step - 1e-9) * step;
      if (!(end > start)) end = start + step;
      ticks = [];
      var guard = 0;
      for (var v = start; v <= end + step * 1e-6 && guard < 64; v += step, guard++) {
        ticks.push(cleanNum(v));
      }
      if (ticks.length <= 8) break;    // 网格线过多会显脏
      step *= 2;
    }
    return { min: cleanNum(start), max: cleanNum(end), step: cleanNum(step), ticks: ticks };
  }

  /**
   * 统一 Y 轴刻度：支持 cfg.min / cfg.max 锁定。
   * 全值相同、只有 1 个点、空数据都不会产生 NaN 坐标。
   */
  function makeScale(cfg, lo, hi, tickCount) {
    var count = tickCount > 0 ? Math.min(8, Math.floor(tickCount)) : 4;
    if (!isFinite(lo)) lo = 0;
    if (!isFinite(hi)) hi = 1;
    if (lo > hi) { var tmp = lo; lo = hi; hi = tmp; }

    var lockMin = cfg && typeof cfg.min === 'number' && isFinite(cfg.min);
    var lockMax = cfg && typeof cfg.max === 'number' && isFinite(cfg.max);
    var min = lockMin ? cfg.min : lo;
    var max = lockMax ? cfg.max : hi;

    if (max === min) {
      if (max === 0) {
        max = lockMax ? 1 : 1;
      } else if (max > 0) {
        max = max + Math.abs(max) * 0.25;
        if (!lockMin) min = Math.min(min, 0);
      } else {
        min = min - Math.abs(min) * 0.25;
        if (!lockMax) max = 0;
      }
    }

    var ns = niceScale(min, max, count);
    if (lockMin || lockMax) {
      var a = lockMin ? min : ns.min;
      var b = lockMax ? max : ns.max;
      if (!(b > a)) b = a + 1;
      var ticks = [];
      for (var i = 0; i <= count; i++) ticks.push(cleanNum(a + (b - a) * i / count));
      return { min: a, max: b, ticks: ticks };
    }
    return { min: ns.min, max: ns.max, ticks: ns.ticks };
  }

  /** 圆角矩形（四角同半径） */
  function rrect(ctx, x, y, w, h, r) {
    var rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    var hh = h < 0 ? -h : h;
    if (!(hh > 0.2) || !(Math.abs(w) > 0.2)) return;
    x = w < 0 ? x + w : x;
    y = h < 0 ? y + h : y;
    var aw = Math.abs(w);
    if (rr <= 0.2) { ctx.rect(x, y, aw, hh); return; }
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + aw, y, x + aw, y + hh, rr);
    ctx.arcTo(x + aw, y + hh, x, y + hh, rr);
    ctx.arcTo(x, y + hh, x, y, rr);
    ctx.arcTo(x, y, x + aw, y, rr);
    ctx.closePath();
  }

  /** 只有顶部圆角的柱子 */
  function rrectTop(ctx, x, y, w, h, r) {
    if (!(h > 0.2) || !(w > 0.2)) return;
    var rr = Math.min(r, w / 2, h);
    if (rr <= 0.2) { ctx.rect(x, y, w, h); return; }
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
  }

  /** 只有底部圆角的柱子（负值） */
  function rrectBottom(ctx, x, y, w, h, r) {
    if (!(h > 0.2) || !(w > 0.2)) return;
    var rr = Math.min(r, w / 2, h);
    if (rr <= 0.2) { ctx.rect(x, y, w, h); return; }
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.closePath();
  }

  /** 折线路径（不做平滑，保持"精确"的工业感） */
  function strokePath(ctx, xs, data, yOf, color, width) {
    var len = Math.min(data.length, xs.length);
    if (!len) return false;
    ctx.beginPath();
    ctx.moveTo(xs[0], yOf(data[0]));
    for (var i = 1; i < len; i++) {
      ctx.lineTo(xs[i], yOf(data[i]));
    }
    ctx.lineWidth = width || 1.75;
    ctx.strokeStyle = color;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
    return true;
  }

  /** 面积：从 series 颜色 0.22 → 0.02 的线性渐变 */
  function fillArea(ctx, xs, data, yOf, color, baseY) {
    var len = Math.min(data.length, xs.length);
    if (!len) return false;
    var top = yOf(data[0]);
    for (var k = 1; k < len; k++) {
      var y = yOf(data[k]);
      if (y < top) top = y;
    }
    var g = null;
    try {
      g = ctx.createLinearGradient(0, top, 0, baseY);
      g.addColorStop(0, withAlpha(color, 0.22));
      g.addColorStop(1, withAlpha(color, 0.02));
    } catch (e) { g = withAlpha(color, 0.12); }

    ctx.beginPath();
    ctx.moveTo(xs[0], yOf(data[0]));
    for (var i = 1; i < len; i++) ctx.lineTo(xs[i], yOf(data[i]));
    ctx.lineTo(xs[len - 1], baseY);
    ctx.lineTo(xs[0], baseY);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
    return true;
  }

  /** 柱体渐变：用实色（混入底色压暗），避免网格线透过柱身形成"接缝" */
  function barGradient(ctx, color, bg, yTop, yBottom) {
    var top = mixColor(color, bg, 0.04);
    var bot = mixColor(color, bg, 0.36);
    try {
      var g = ctx.createLinearGradient(0, yTop, 0, yBottom || yTop + 1);
      g.addColorStop(0, top);
      g.addColorStop(1, bot);
      return g;
    } catch (e) {
      return top;
    }
  }

  /** hover 数据点：3.5px 实心 + 外圈光晕 + 深色隔离环 */
  function drawDot(ctx, x, y, color, bg) {
    if (!isFinite(x) || !isFinite(y)) return;
    if (bg) {
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, TAU);
      ctx.fillStyle = withAlpha(color, 0.16);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, 5.6, 0, TAU);
    ctx.fillStyle = bg || 'rgba(11,16,25,0.96)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, TAU);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, TAU);
    ctx.lineWidth = 1;
    ctx.strokeStyle = withAlpha('#ffffff', 0.55);
    ctx.stroke();
  }

  /**
   * 图例（多系列时才有）：右上角一行，色点 + 名称。
   * 返回 { items, w, h, y }，measure 阶段用它预留顶部空间。
   */
  function buildLegend(st, ctx, w) {
    var series = st.series || [];
    if (series.length < 2) return null;
    ctx.font = '11px ' + SANS;
    var items = [], total = 0;
    for (var i = 0; i < series.length; i++) {
      var label = series[i].name || ('系列 ' + (i + 1));
      var tw = 0;
      try { tw = ctx.measureText(label).width; } catch (e) { tw = label.length * 11; }
      var iw = tw + 20;
      items.push({
        label: label,
        w: iw,
        color: seriesColor(st, series[i], i)
      });
      total += iw;
    }
    var maxW = Math.max(48, w - 16);
    var kept = [], used = 0;
    for (i = 0; i < items.length; i++) {
      if (used + items[i].w > maxW) {
        if (kept.length) break;
        if (items[i].w > maxW) items[i].w = maxW;
      }
      kept.push(items[i]);
      used += items[i].w;
    }
    return { items: kept, w: used, h: 15, y: 8 };
  }

  function drawLegend(st, ctx, m) {
    var lg = m && m.legend;
    if (!lg || !lg.items.length) return;
    var x = m.w - 8 - lg.w;
    var y = lg.y + lg.h / 2;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '11px ' + SANS;
    for (var i = 0; i < lg.items.length; i++) {
      var it = lg.items[i];
      ctx.beginPath();
      ctx.arc(x + 3, y, 2.75, 0, TAU);
      ctx.fillStyle = it.color;
      ctx.fill();
      ctx.fillStyle = st.pal['--text-3'] || FALLBACKS['--text-3'];
      ctx.fillText(it.label, x + 10, y + 0.5);
      x += it.w;
    }
  }

  /* ==========================================================================
   * 5. 数据规范化（容错核心：任何脏数据都退化成可绘制结构）
   * ======================================================================== */

  function normalizeSeries(cfg, defaultType) {
    if (!cfg) return [];
    var dft = defaultType === 'bar' ? 'bar' : 'line';
    var raw = cfg.series;
    if (!raw || !raw.length) {
      if (cfg.data && cfg.data.length) {
        // 容错：sparkline 常直接传 { data: [...], color: 'var(--accent)' }
        raw = [{ name: cfg.name || '数值', data: cfg.data, color: cfg.color, type: cfg.type }];
      } else {
        return [];
      }
    }
    if (raw.length && (typeof raw[0] === 'number' || typeof raw[0] === 'string')) {
      raw = [{ name: cfg.name || '数值', data: raw }]; // 容错：直接传数字数组
    }
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var s = raw[i];
      if (!s || typeof s !== 'object') continue;
      var d = s.data;
      if (!d || !d.length || typeof d.length !== 'number') continue;
      var vals = [];
      var has = false;
      for (var j = 0; j < d.length; j++) {
        var v = toNum(d[j]);
        if (v === null) v = 0;
        vals.push(v);
        if (v !== 0) has = true;
      }
      if (!vals.length) continue;
      // 未声明 type 时按图表类型取默认：bar() → 柱，line() → 线
      var type = s.type === 'area' || s.type === 'bar' || s.type === 'line' ? s.type : dft;
      out.push({
        name: s.name !== undefined && s.name !== null ? String(s.name) : ('系列 ' + (out.length + 1)),
        data: vals,
        colorRaw: typeof s.color === 'string' ? s.color : '',
        type: type,
        value: s.value !== undefined && s.value !== null ? toNum(s.value) : null,
        hasValue: has
      });
    }
    return out;
  }

  function seriesSpan(st) {
    var n = 0, series = st.series || [];
    for (var i = 0; i < series.length; i++) {
      if (series[i].data.length > n) n = series[i].data.length;
    }
    var labels = st.cfg && st.cfg.labels;
    if (labels && labels.length > n) n = labels.length;
    return n;
  }

  function extentOf(st) {
    var lo = Infinity, hi = -Infinity;
    var series = st.series || [];
    for (var i = 0; i < series.length; i++) {
      var d = series[i].data;
      for (var j = 0; j < d.length; j++) {
        if (d[j] < lo) lo = d[j];
        if (d[j] > hi) hi = d[j];
      }
    }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    return { lo: lo, hi: hi };
  }

  function labelAt(st, i) {
    var labels = st.cfg && st.cfg.labels;
    if (labels && labels.length && labels[i] !== undefined && labels[i] !== null && labels[i] !== '') {
      return String(labels[i]);
    }
    return '#' + (i + 1);
  }

  /** 环形图 / 漏斗图的条目：支持 labels+单系列，也支持每系列一项 */
  function stageItems(st) {
    var cfg = st.cfg || {};
    var series = st.series || [];
    var items = [];
    var i;

    if (cfg.items && cfg.items.length) {
      for (i = 0; i < cfg.items.length; i++) {
        var it = cfg.items[i] || {};
        var iv = toNum(it.value);
        items.push({
          name: it.name !== undefined ? String(it.name) : ('阶段 ' + (i + 1)),
          value: iv === null || iv < 0 ? 0 : iv,
          colorRaw: typeof it.color === 'string' ? it.color : ''
        });
      }
      return items;
    }

    // 形态 A：labels + 单一系列的 data（最常见：labels=['已认证','审核中'], series=[{data:[60,25]}]
    if (series.length === 1 && cfg.labels && cfg.labels.length > 1 && series[0].data.length > 1) {
      var len = Math.min(cfg.labels.length, series[0].data.length);
      for (i = 0; i < len; i++) {
        var v = series[0].data[i];
        items.push({
          name: cfg.labels[i] !== undefined ? String(cfg.labels[i]) : ('项 ' + (i + 1)),
          value: v > 0 ? v : 0,
          colorRaw: ''
        });
      }
      return items;
    }

    // 形态 B：每个系列一段（value 或 data 求和）
    for (i = 0; i < series.length; i++) {
      var s = series[i];
      var val = s.value;
      if (val === null) {
        if (!s.data.length) val = 0;
        else if (s.data.length === 1) val = s.data[0];
        else {
          val = 0;
          for (var j = 0; j < s.data.length; j++) val += s.data[j];
        }
      }
      items.push({ name: s.name, value: val > 0 ? val : 0, colorRaw: s.colorRaw });
    }
    return items;
  }

  function itemColor(st, item, i) {
    if (item && item.colorRaw) return resolveColor(item.colorRaw, st.pal);
    var cs = st.cfg && st.cfg.colors;
    if (cs && cs.length && cs[i]) return resolveColor(cs[i], st.pal);
    return paletteColor(st.pal, i);
  }

  /** 漏斗取色：未显式指定时在 accent → violet 之间等距插值，保持同族色 */
  function funnelColor(st, i, n) {
    var it = st.items && st.items[i];
    if (it && it.colorRaw) return resolveColor(it.colorRaw, st.pal);
    var cs = st.cfg && st.cfg.colors;
    if (cs && cs.length && cs[i]) return resolveColor(cs[i], st.pal);
    var k = n > 1 ? i / (n - 1) : 0;
    return mixColor(st.pal['--accent'], st.pal['--violet'], k * 0.85);
  }

  function isStacked(cfg) {
    return !!(cfg && (cfg.stacked === true || cfg.stack === true));
  }

  /* ==========================================================================
   * 6. line —— 折线 / 面积（含 type:'bar' 的组合图）
   * ======================================================================== */

  var LINE = {
    measure: function (st, w, h, ctx) {
      var series = st.series || [];
      if (!series.length) return null;
      var n = seriesSpan(st);
      if (n < 1) return null;

      var cfg = st.cfg || {};
      var ext = extentOf(st);
      var tiny = w < 110 || h < 60;
      var tickCount = cfg.yTicks !== undefined ? cfg.yTicks : 4;
      var scale = makeScale(cfg, ext.lo, ext.hi, tickCount);

      ctx.font = '11px ' + MONO;
      var maxLabelW = 0;
      for (var i = 0; i < scale.ticks.length; i++) {
        var tw = 0;
        try { tw = ctx.measureText(fmtTick(scale.ticks[i])).width; } catch (e) { tw = 24; }
        if (tw > maxLabelW) maxLabelW = tw;
      }

      var hasX = !!(cfg.labels && cfg.labels.length);
      var showY = !tiny && cfg.yLabels !== false;
      var padL = showY ? Math.ceil(maxLabelW) + 12 : 8;
      var padR = tiny ? 6 : 12;
      var padT = tiny ? 6 : 12;
      var padB = tiny ? 6 : (hasX ? 24 : 10);

      var legend = (!tiny && series.length > 1 && cfg.legend !== false) ? buildLegend(st, ctx, w) : null;
      if (legend) padT += legend.h;

      if (padL + padR > w - 10) { padL = 6; padR = 6; }
      if (padT + padB > h - 10) { padT = 5; padB = 5; }

      var plotX = padL, plotY = padT;
      var plotW = Math.max(1, w - padL - padR);
      var plotH = Math.max(1, h - padT - padB);
      var span = (scale.max - scale.min) || 1;

      var yOf = function (v) {
        return plotY + plotH * (1 - (v - scale.min) / span);
      };
      var xs = [];
      for (i = 0; i < n; i++) {
        xs.push(n === 1 ? plotX + plotW / 2 : plotX + plotW * i / (n - 1));
      }

      return {
        w: w, h: h, tiny: tiny, n: n,
        plotX: plotX, plotY: plotY, plotW: plotW, plotH: plotH,
        scale: scale, xs: xs, yOf: yOf,
        showY: showY, hasX: hasX && !tiny, legend: legend,
        bandW: n > 1 ? plotW / (n - 1) : plotW
      };
    },

    draw: function (st, ctx, t, m) {
      var pal = st.pal;
      var series = st.series;
      var p = easeOutCubic(t);
      var i;

      // —— 网格与刻度（不参与生长动画）——
      if (m.showY) {
        ctx.font = '11px ' + MONO;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 1;
        for (i = 0; i < m.scale.ticks.length; i++) {
          var tv = m.scale.ticks[i];
          var y = m.yOf(tv);
          if (y < m.plotY - 0.5 || y > m.plotY + m.plotH + 0.5) continue;
          var py = Math.round(y) + 0.5;
          if (st.cfg.grid !== false) {
            ctx.beginPath();
            ctx.strokeStyle = Math.abs(tv) < 1e-9 ? AXIS_STRONG : GRID_STROKE;
            ctx.moveTo(m.plotX, py);
            ctx.lineTo(m.plotX + m.plotW, py);
            ctx.stroke();
          }
          // 有 X 轴标签时省略最低刻度文案，避免与 X 轴首标签相撞
          if (m.hasX && i === 0) continue;
          ctx.fillStyle = pal['--text-3'] || FALLBACKS['--text-3'];
          ctx.fillText(fmtTick(tv), m.plotX - 8, Math.round(y) + 0.5);
        }
      }
      if (m.hasX) drawXLabels(st, ctx, m);
      if (m.legend) drawLegend(st, ctx, m);

      // —— 生长裁剪：从左到右 ——
      var clip = t < 1 && m.n > 1;
      if (clip) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(m.plotX - 2, 0, m.plotW * p + 2, m.h);
        ctx.clip();
      }

      var baseY = m.plotY + m.plotH;
      var bars = [], areas = [], lines = [];
      for (i = 0; i < series.length; i++) {
        if (series[i].type === 'bar') bars.push(i);
        else if (series[i].type === 'area') areas.push(i);
        else lines.push(i);
      }

      // 柱（组合图中的 bar 系列）
      if (bars.length) {
        var bw = Math.max(2, Math.min(m.bandW * 0.52, 22));
        if (m.n === 1) bw = Math.min(28, bw);
        for (i = 0; i < bars.length; i++) {
          var bi = bars[i];
          var bs = series[bi];
          var col = seriesColor(st, bs, bi);
          ctx.fillStyle = barGradient(ctx, col, st.pal['--bg-raise'] || FALLBACKS['--bg-raise'], m.plotY, baseY);
          for (var k = 0; k < bs.data.length && k < m.xs.length; k++) {
            var by = m.yOf(bs.data[k]);
            var bx = m.xs[k] - bw / 2;
            if (bs.data[k] >= 0) {
              ctx.beginPath();
              rrectTop(ctx, bx, by, bw, baseY - by, 3);
              ctx.fill();
            } else {
              ctx.beginPath();
              rrectBottom(ctx, bx, by, bw, baseY - by, 3);
              ctx.fill();
            }
          }
        }
      }

      // 面积
      for (i = 0; i < areas.length; i++) {
        var ai = areas[i];
        fillArea(ctx, m.xs, series[ai].data, m.yOf, seriesColor(st, series[ai], ai), baseY);
      }

      // 折线
      for (i = 0; i < lines.length; i++) {
        var li = lines[i];
        var ls = series[li];
        var lc = seriesColor(st, ls, li);
        if (ls.data.length === 1) {
          // 只有一个点：用点代替线，避免"看不见数据"
          var solox = m.xs[0], soloy = m.yOf(ls.data[0]);
          ctx.beginPath();
          ctx.arc(solox, soloy, 3 * (0.4 + 0.6 * p), 0, TAU);
          ctx.fillStyle = lc;
          ctx.fill();
        } else {
          strokePath(ctx, m.xs, ls.data, m.yOf, lc, 1.75);
        }
      }

      if (clip) ctx.restore();

      // —— hover：垂直指示线 + 数据点 ——
      if (!st.hover || st.hover.idx === undefined || st.hover.idx === null) return;
      var idx = st.hover.idx;
      if (idx < 0 || idx >= m.n) return;
      var hx = m.xs[idx];
      ctx.save();
      ctx.strokeStyle = GUIDE_STROKE;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(hx) + 0.5, m.plotY);
      ctx.lineTo(Math.round(hx) + 0.5, m.plotY + m.plotH);
      ctx.stroke();
      for (i = 0; i < series.length; i++) {
        if (idx >= series[i].data.length) continue;
        drawDot(ctx, hx, m.yOf(series[i].data[idx]), seriesColor(st, series[i], i),
          pal['--bg-raise'] || FALLBACKS['--bg-raise']);
      }
      ctx.restore();
    },

    hit: function (st, mx, my) {
      var m = st.m;
      if (!m || !m.n) return null;
      if (mx < m.plotX - 10 || mx > m.plotX + m.plotW + 10) return null;
      var idx;
      if (m.n === 1) idx = 0;
      else {
        idx = Math.round((mx - m.plotX) / (m.plotW / (m.n - 1)));
        idx = clamp(idx, 0, m.n - 1);
      }
      var rows = [];
      for (var i = 0; i < st.series.length; i++) {
        var s = st.series[i];
        if (idx >= s.data.length) continue;
        rows.push({ name: s.name, value: fmtValue(st, s.data[idx]), color: seriesColor(st, s, i) });
      }
      if (!rows.length) return null;
      return {
        title: labelAt(st, idx),
        rows: rows,
        hover: { idx: idx }
      };
    }
  };

  /** 柱状图的类目标签：保证每根柱子都有名字，过长用省略号压缩（不走抽稀） */
  function drawBarLabels(st, ctx, m) {
    var labels = st.cfg.labels;
    if (!labels || !labels.length) return;
    ctx.font = '11px ' + MONO;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = st.pal['--text-4'] || FALLBACKS['--text-4'];
    var maxW = Math.max(8, m.band - 6);
    var step = m.band < 26 ? Math.max(1, Math.ceil(26 / m.band)) : 1; // 极窄才抽稀
    var y = m.plotY + m.plotH + 8;
    for (var i = 0; i < labels.length && i < m.xs.length; i += step) {
      var text = labels[i];
      if (text === undefined || text === null || text === '') continue;
      var s = ellipsis(ctx, String(text), maxW);
      if (!s) continue;
      ctx.fillText(s, Math.round(m.xs[i]), Math.round(y));
    }
  }

  /** X 轴标签：按可用宽度自动抽稀，居中于数据点 */
  function drawXLabels(st, ctx, m) {
    var labels = st.cfg.labels;
    if (!labels || !labels.length) return;
    ctx.font = '11px ' + MONO;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = st.pal['--text-4'] || FALLBACKS['--text-4'];

    var step = 1, maxW = 0, i;
    for (i = 0; i < labels.length && i < m.xs.length; i++) {
      var tw = 0;
      try { tw = ctx.measureText(String(labels[i])).width; } catch (e) { tw = 20; }
      if (tw > maxW) maxW = tw;
    }
    var gap = m.n > 1 ? Math.abs(m.xs[1] - m.xs[0]) : m.plotW;
    if (gap > 0) step = Math.max(1, Math.ceil((maxW + 16) / gap));

    var y = m.plotY + m.plotH + 8;
    for (i = 0; i < labels.length && i < m.xs.length; i += step) {
      var text = labels[i];
      if (text === undefined || text === null || text === '') continue;
      text = String(text);
      var w = 0;
      try { w = ctx.measureText(text).width; } catch (e) { w = text.length * 6; }
      var x = clamp(m.xs[i], w / 2 + 2, m.w - w / 2 - 2);
      ctx.fillText(text, Math.round(x), Math.round(y));
    }
  }

  /* ==========================================================================
   * 7. bar —— 柱状图（支持堆叠 / 分组 / 折线叠加）
   * ======================================================================== */

  var BAR = {
    measure: function (st, w, h, ctx) {
      var series = st.series || [];
      if (!series.length) return null;
      var n = seriesSpan(st);
      if (n < 1) return null;

      var cfg = st.cfg || {};
      var tiny = w < 110 || h < 60;
      var stacked = isStacked(cfg);
      var tickCount = cfg.yTicks !== undefined ? cfg.yTicks : 4;

      // Y 范围：柱状图基线强制为 0（堆叠时按堆高计算）
      var lo = 0, hi = 0, i, j;
      if (stacked) {
        for (i = 0; i < n; i++) {
          var pos = 0, neg = 0;
          for (j = 0; j < series.length; j++) {
            var v = series[j].data[i];
            if (v === undefined) continue;
            if (v >= 0) pos += v; else neg += v;
          }
          if (pos > hi) hi = pos;
          if (neg < lo) lo = neg;
        }
      } else {
        for (j = 0; j < series.length; j++) {
          var d = series[j].data;
          for (i = 0; i < d.length; i++) {
            if (d[i] > hi) hi = d[i];
            if (d[i] < lo) lo = d[i];
          }
        }
      }
      if (hi === lo) hi = lo + 1;
      var scale = makeScale(cfg, lo, hi, tickCount);

      ctx.font = '11px ' + MONO;
      var maxLabelW = 0;
      for (i = 0; i < scale.ticks.length; i++) {
        var tw = 0;
        try { tw = ctx.measureText(fmtTick(scale.ticks[i])).width; } catch (e) { tw = 24; }
        if (tw > maxLabelW) maxLabelW = tw;
      }

      var hasX = !!(cfg.labels && cfg.labels.length);
      var showY = !tiny && cfg.yLabels !== false;
      var padL = showY ? Math.ceil(maxLabelW) + 12 : 8;
      var padR = tiny ? 6 : 12;
      var padT = tiny ? 6 : 12;
      var padB = tiny ? 6 : (hasX ? 24 : 10);
      var legend = (!tiny && series.length > 1 && cfg.legend !== false) ? buildLegend(st, ctx, w) : null;
      if (legend) padT += legend.h;

      if (padL + padR > w - 10) { padL = 6; padR = 6; }
      if (padT + padB > h - 10) { padT = 5; padB = 5; }

      var plotX = padL, plotY = padT;
      var plotW = Math.max(1, w - padL - padR);
      var plotH = Math.max(1, h - padT - padB);
      var spanV = (scale.max - scale.min) || 1;
      var yOf = function (vv) {
        return plotY + plotH * (1 - (vv - scale.min) / spanV);
      };

      var band = plotW / n;
      var xs = [];
      for (i = 0; i < n; i++) xs.push(plotX + band * (i + 0.5));

      // 参与"柱"的系列（line/area 作为叠加层）
      var barIdx = [], lineIdx = [];
      for (i = 0; i < series.length; i++) {
        if (series[i].type === 'line' || series[i].type === 'area') lineIdx.push(i);
        else barIdx.push(i);
      }
      var count = Math.max(1, barIdx.length);
      var innerGap = count > 1 ? 3 : 0;
      var barW, groupW;
      if (stacked) {
        barW = Math.min(band * 0.56, 40);
        groupW = barW;
      } else {
        barW = Math.min((band * 0.72 - innerGap * (count - 1)) / count, 26);
        if (barW < 1) barW = 1;
        groupW = barW * count + innerGap * (count - 1);
        if (groupW > band) {
          barW = Math.max(1, (band - innerGap * (count - 1)) / count);
          groupW = barW * count + innerGap * (count - 1);
        }
      }

      return {
        w: w, h: h, tiny: tiny, n: n, band: band, xs: xs,
        plotX: plotX, plotY: plotY, plotW: plotW, plotH: plotH,
        scale: scale, yOf: yOf, showY: showY, hasX: hasX && !tiny,
        legend: legend, stacked: stacked, barIdx: barIdx, lineIdx: lineIdx,
        barW: barW, groupW: groupW, innerGap: innerGap
      };
    },

    draw: function (st, ctx, t, m) {
      var pal = st.pal;
      var series = st.series;
      var p = easeOutCubic(t);
      var i, j;

      if (m.showY) {
        ctx.font = '11px ' + MONO;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 1;
        for (i = 0; i < m.scale.ticks.length; i++) {
          var tv = m.scale.ticks[i];
          var y = m.yOf(tv);
          if (y < m.plotY - 0.5 || y > m.plotY + m.plotH + 0.5) continue;
          var py = Math.round(y) + 0.5;
          if (st.cfg.grid !== false) {
            ctx.beginPath();
            ctx.strokeStyle = Math.abs(tv) < 1e-9 ? AXIS_STRONG : GRID_STROKE;
            ctx.moveTo(m.plotX, py);
            ctx.lineTo(m.plotX + m.plotW, py);
            ctx.stroke();
          }
          if (m.hasX && i === 0 && Math.abs(tv) < 1e-9) continue;
          ctx.fillStyle = pal['--text-3'] || FALLBACKS['--text-3'];
          ctx.fillText(fmtTick(tv), m.plotX - 8, Math.round(y) + 0.5);
        }
      }
      if (m.hasX) drawBarLabels(st, ctx, m);
      if (m.legend) drawLegend(st, ctx, m);

      var baseY = clamp(m.yOf(0), m.plotY, m.plotY + m.plotH);

      // hover 高亮带（画在柱子下面）
      if (st.hover && st.hover.idx !== undefined && st.hover.idx !== null && st.hover.idx >= 0) {
        var hb = clamp(st.hover.idx, 0, m.n - 1);
        ctx.fillStyle = BAND_FILL;
        ctx.beginPath();
        rrect(ctx, m.plotX + hb * m.band, m.plotY, m.band, m.plotH, 4);
        ctx.fill();
      }

      var n2 = Math.max(1, m.n);
      for (i = 0; i < m.n; i++) {
        // 逐根生长：左侧先起，右侧稍延迟
        var delay = (i / n2) * 0.28;
        var local = easeOutCubic(clamp01((t - delay) / (1 - 0.28)));
        if (local <= 0) continue;

        if (m.stacked) {
          var accPos = 0, accNeg = 0;
          var cx = m.xs[i] - m.barW / 2;
          for (j = 0; j < m.barIdx.length; j++) {
            var si = m.barIdx[j];
            var v = series[si].data[i];
            if (v === undefined) continue;
            v = v * local; // 高度随动画插值增长
            var col = seriesColor(st, series[si], j);
            var y0, y1;
            if (v >= 0) {
              y0 = m.yOf(accPos);
              y1 = m.yOf(accPos + v);
              accPos += v;
            } else {
              y0 = m.yOf(accNeg);
              y1 = m.yOf(accNeg + v);
              accNeg += v;
            }
            var top = Math.min(y0, y1);
            var hgt = Math.abs(y1 - y0);
            if (hgt < 0.4) continue;
            // 段间留 1.5px 缝隙，读数更清晰
            var gapH = hgt > 3 ? 1.5 : 0;
            ctx.beginPath();
            rrect(ctx, cx, top + (v >= 0 ? 0 : gapH), m.barW, hgt - gapH, 2);
            ctx.fillStyle = mixColor(col, st.pal['--bg-raise'] || FALLBACKS['--bg-raise'], v >= 0 ? 0.14 : 0.34);
            ctx.fill();
          }
        } else {
          var gx = m.xs[i] - m.groupW / 2;
          for (j = 0; j < m.barIdx.length; j++) {
            var sj = m.barIdx[j];
            var val = series[sj].data[i];
            if (val === undefined) continue;
            var bv = val * local;
            var bx = gx + j * (m.barW + m.innerGap);
            var by = m.yOf(bv);
            var bc = seriesColor(st, series[sj], sj);
            ctx.fillStyle = barGradient(ctx, bc, st.pal['--bg-raise'] || FALLBACKS['--bg-raise'],
              Math.min(by, baseY), Math.max(by, baseY));
            ctx.beginPath();
            if (bv >= 0) rrectTop(ctx, bx, by, m.barW, baseY - by, 3);
            else rrectBottom(ctx, bx, by, m.barW, baseY - by, 3);
            ctx.fill();
          }
        }
      }

      // 叠加折线 / 面积（柱状图上的转化率等）
      if (m.lineIdx.length) {
        var clip = t < 1 && m.n > 1;
        if (clip) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(m.plotX - 2, 0, m.plotW * p + 2, m.h);
          ctx.clip();
        }
        for (j = 0; j < m.lineIdx.length; j++) {
          var k = m.lineIdx[j];
          var ls = series[k];
          var lcol = seriesColor(st, ls, k);
          if (ls.type === 'area') fillArea(ctx, m.xs, ls.data, m.yOf, lcol, m.plotY + m.plotH);
          if (ls.data.length === 1) {
            ctx.beginPath();
            ctx.arc(m.xs[0], m.yOf(ls.data[0]), 3, 0, TAU);
            ctx.fillStyle = lcol;
            ctx.fill();
          } else {
            strokePath(ctx, m.xs, ls.data, m.yOf, lcol, 1.75);
          }
        }
        if (clip) ctx.restore();
      }

      // hover：柱顶高亮描边，强调"当前这一列"
      if (st.hover && st.hover.idx !== undefined && st.hover.idx !== null) {
        var hi2 = clamp(st.hover.idx, 0, m.n - 1);
        ctx.save();
        ctx.strokeStyle = withAlpha('#ffffff', 0.22);
        ctx.lineWidth = 1;
        var hw = Math.max(m.groupW, m.stacked ? m.barW : m.groupW);
        var hx = m.xs[hi2] - hw / 2;
        ctx.beginPath();
        rrect(ctx, hx, m.plotY, hw, m.plotH, 3);
        ctx.stroke();
        ctx.restore();
      }
    },

    hit: function (st, mx, my) {
      var m = st.m;
      if (!m || !m.n) return null;
      if (mx < m.plotX || mx > m.plotX + m.plotW) return null;
      var idx = clamp(Math.floor((mx - m.plotX) / m.band), 0, m.n - 1);
      var rows = [], total = 0, hasTotal = false;
      for (var i = 0; i < st.series.length; i++) {
        var s = st.series[i];
        var v = s.data[idx];
        if (v === undefined) continue;
        total += v;
        hasTotal = true;
        rows.push({ name: s.name, value: fmtValue(st, v), color: seriesColor(st, s, i) });
      }
      if (!rows.length) return null;
      if (m.stacked && rows.length > 1 && hasTotal) {
        rows.push({
          name: '合计',
          value: fmtValue(st, total),
          color: st.pal['--text-2'] || FALLBACKS['--text-2']
        });
      }
      return { title: labelAt(st, idx), rows: rows, hover: { idx: idx } };
    }
  };

  /* ==========================================================================
   * 8. donut —— 环形图（带中心文案，环宽约 14%，段间 2px 缝隙）
   * ======================================================================== */

  var DONUT = {
    measure: function (st, w, h, ctx) {
      var items = stageItems(st);
      st.items = items;
      var total = 0, i;
      for (i = 0; i < items.length; i++) total += items[i].value;
      if (!items.length) return null;

      var box = Math.min(w, h);
      var outerR = Math.max(6, box / 2 - Math.min(10, box * 0.08));
      var innerR = outerR * 0.86;                       // 环宽 ≈ 14%
      var cx = w / 2, cy = h / 2;
      var midR = (outerR + innerR) / 2;
      var lw = outerR - innerR;

      // 中心文案：优先用 cfg.centerValue / centerLabel
      var cfg = st.cfg || {};
      var cv = cfg.centerValue !== undefined && cfg.centerValue !== null && cfg.centerValue !== ''
        ? String(cfg.centerValue) : fmtValue(st, total);
      var cl = cfg.centerLabel !== undefined && cfg.centerLabel !== null ? String(cfg.centerLabel) : '';

      var maxTextW = innerR * 2 * 0.78;
      var big = clamp(Math.round(innerR * 0.50), 11, 26);
      ctx.font = '600 ' + big + 'px ' + MONO;
      var mw = 0;
      try { mw = ctx.measureText(cv).width; } catch (e) { mw = cv.length * big * 0.6; }
      if (mw > maxTextW && mw > 0) {
        big = Math.max(10, Math.floor(big * maxTextW / mw));
        ctx.font = '600 ' + big + 'px ' + MONO;
      }

      return {
        w: w, h: h, items: items, total: total,
        cx: cx, cy: cy, outerR: outerR, innerR: innerR, midR: midR, lw: lw,
        centerValue: cv, centerLabel: cl, centerSize: big,
        maxTextW: maxTextW
      };
    },

    draw: function (st, ctx, t, m) {
      var pal = st.pal;
      var items = m.items;
      var p = easeOutCubic(t);
      var sweepTotal = TAU * p;

      // 轨道：让空白区域读起来是"环"
      ctx.beginPath();
      ctx.arc(m.cx, m.cy, m.midR, 0, TAU);
      ctx.lineWidth = m.lw;
      ctx.strokeStyle = 'rgba(255,255,255,0.045)';
      ctx.stroke();

      var hovIdx = st.hover && st.hover.idx !== undefined ? st.hover.idx : -1;

      if (m.total > 0) {
        var start = -Math.PI / 2;
        var acc = 0;
        for (var i = 0; i < items.length; i++) {
          var frac = items[i].value / m.total;
          var a0 = start + acc * TAU;
          acc += frac;
          var a1 = start + acc * TAU;
          var drawnEnd = start + sweepTotal;
          if (a0 >= drawnEnd) break;

          var end = Math.min(a1, drawnEnd);
          // 段间 2px 缝隙（换算成弧度）
          var gapRad = items.length > 1 ? Math.min((a1 - a0) * 0.4, 2 / Math.max(1, m.midR)) : 0;
          var s0 = a0 + gapRad / 2;
          var s1 = end - gapRad / 2;
          if (s1 - s0 < 0.004) continue;

          var col = itemColor(st, items[i], i);
          var hov = hovIdx === i;
          ctx.save();
          ctx.beginPath();
          ctx.arc(m.cx, m.cy, m.midR, s0, s1);
          ctx.lineWidth = hov ? m.lw + 3 : m.lw;
          ctx.strokeStyle = hov ? withAlpha(col, 1) : withAlpha(col, 0.88);
          ctx.lineCap = 'butt';
          if (hov) {
            ctx.shadowColor = withAlpha(col, 0.45);
            ctx.shadowBlur = 12;
          }
          ctx.stroke();
          ctx.restore();
        }
      }

      // 中心文案
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var cy = m.centerLabel ? m.cy - m.centerSize * 0.28 : m.cy;
      ctx.font = '600 ' + m.centerSize + 'px ' + MONO;
      ctx.fillStyle = pal['--text-1'] || FALLBACKS['--text-1'];
      var shown = m.centerValue;
      if (m.centerSize <= 12 && shown.length > 9) shown = shown.slice(0, 9) + '…';
      ctx.fillText(shown, m.cx, Math.round(cy) + 0.5);
      if (m.centerLabel) {
        ctx.font = '11px ' + SANS;
        ctx.fillStyle = pal['--text-3'] || FALLBACKS['--text-3'];
        var ly = m.cy + m.centerSize * 0.62;
        ctx.fillText(m.centerLabel, m.cx, Math.round(ly) + 0.5);
      }
    },

    hit: function (st, mx, my) {
      var m = st.m;
      if (!m || !m.total) return null;
      var dx = mx - m.cx, dy = my - m.cy;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < m.innerR - 8 || dist > m.outerR + 8) return null;
      var ang = Math.atan2(dy, dx) + Math.PI / 2;   // 以 12 点为 0
      while (ang < 0) ang += TAU;
      while (ang >= TAU) ang -= TAU;
      var acc = 0, found = -1;
      for (var i = 0; i < m.items.length; i++) {
        var frac = m.items[i].value / m.total;
        if (ang >= acc * TAU && ang < (acc + frac) * TAU) { found = i; break; }
        acc += frac;
      }
      if (found < 0) return null;
      var it = m.items[found];
      var pct = m.total > 0 ? (it.value / m.total * 100) : 0;
      return {
        title: (st.cfg && st.cfg.centerLabel) ? String(st.cfg.centerLabel) : '占比',
        rows: [{
          name: it.name,
          value: fmtValue(st, it.value) + ' · ' + (Math.round(pct * 10) / 10) + '%',
          color: itemColor(st, it, found)
        }],
        hover: { idx: found }
      };
    }
  };

  /* ==========================================================================
   * 9. sparkline —— 迷你趋势线（无坐标轴、无网格）
   * ======================================================================== */

  var SPARK = {
    measure: function (st, w, h, ctx) {
      var series = st.series || [];
      if (!series.length || !series[0].data.length) return null;
      var n = series[0].data.length;
      var padX = n > 1 ? 3 : 0;
      var padY = 4;
      var ext = extentOf(st);
      var lo = ext.lo, hi = ext.hi;
      if (!(hi > lo)) { hi = lo + 1; lo = lo - 0.5; }
      var plotX = padX, plotY = padY;
      var plotW = Math.max(1, w - padX * 2);
      var plotH = Math.max(1, h - padY * 2);
      var span = hi - lo;
      var yOf = function (v) {
        return plotY + plotH * (1 - (v - lo) / span);
      };
      var xs = [];
      for (var i = 0; i < n; i++) {
        xs.push(n === 1 ? plotX + plotW / 2 : plotX + plotW * i / (n - 1));
      }
      return {
        w: w, h: h, n: n, xs: xs, yOf: yOf,
        plotX: plotX, plotY: plotY, plotW: plotW, plotH: plotH,
        lo: lo, hi: hi
      };
    },

    draw: function (st, ctx, t, m) {
      var s = st.series[0];
      var col = seriesColor(st, s, 0);
      var p = easeOutCubic(t);
      var baseY = m.plotY + m.plotH;

      var clip = t < 1 && m.n > 1;
      if (clip) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(m.plotX - 1, 0, m.plotW * p + 1, m.h);
        ctx.clip();
      }
      if (st.cfg.fill !== false) {
        fillArea(ctx, m.xs, s.data, m.yOf, col, baseY);
      }
      if (s.data.length === 1) {
        ctx.beginPath();
        ctx.arc(m.xs[0], m.yOf(s.data[0]), 2.5, 0, TAU);
        ctx.fillStyle = col;
        ctx.fill();
      } else {
        strokePath(ctx, m.xs, s.data, m.yOf, col, 1.5);
      }
      if (clip) ctx.restore();

      // 末点：给趋势一个"当前值"的落点
      var lastX = m.xs[m.n - 1], lastY = m.yOf(s.data[m.n - 1]);
      if (p > 0.55) {
        var alpha = clamp01((p - 0.55) / 0.45);
        ctx.beginPath();
        ctx.arc(lastX, lastY, 5.5, 0, TAU);
        ctx.fillStyle = withAlpha(col, 0.16 * alpha);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(lastX, lastY, 2.4, 0, TAU);
        ctx.fillStyle = withAlpha(col, alpha);
        ctx.fill();
      }

      if (st.hover && st.hover.idx !== undefined && st.hover.idx !== null) {
        var idx = clamp(st.hover.idx, 0, m.n - 1);
        ctx.save();
        ctx.strokeStyle = GUIDE_STROKE;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.round(m.xs[idx]) + 0.5, m.plotY - 2);
        ctx.lineTo(Math.round(m.xs[idx]) + 0.5, m.plotY + m.plotH + 2);
        ctx.stroke();
        drawDot(ctx, m.xs[idx], m.yOf(s.data[idx]), col, st.pal['--bg-raise'] || FALLBACKS['--bg-raise']);
        ctx.restore();
      }
    },

    hit: function (st, mx, my) {
      var m = st.m;
      if (!m || !m.n) return null;
      if (mx < m.plotX - 6 || mx > m.plotX + m.plotW + 6) return null;
      var idx = m.n === 1 ? 0 : clamp(Math.round((mx - m.plotX) / (m.plotW / (m.n - 1))), 0, m.n - 1);
      var s = st.series[0];
      if (idx >= s.data.length) return null;
      return {
        title: labelAt(st, idx),
        rows: [{ name: s.name, value: fmtValue(st, s.data[idx]), color: seriesColor(st, s, 0) }],
        hover: { idx: idx }
      };
    }
  };

  /* ==========================================================================
   * 10. heatmap —— 热力图（如"近 8 周履约打卡"）
   * ======================================================================== */

  function heatRows(st) {
    var cfg = st.cfg || {};
    var series = st.series || [];
    var rows = [], rowLabels = [], i, j;

    var toRow = function (arr) {
      var out = [];
      if (!arr || !arr.length) return out;
      for (var k = 0; k < arr.length; k++) {
        var v = toNum(arr[k]);
        out.push(v === null ? null : v);
      }
      return out;
    };

    if (cfg.rows && cfg.rows.length) {
      for (i = 0; i < cfg.rows.length; i++) {
        rows.push(toRow(cfg.rows[i]));
        rowLabels.push(cfg.rowLabels && cfg.rowLabels[i] !== undefined ? String(cfg.rowLabels[i]) : '');
      }
      return { rows: rows, rowLabels: rowLabels, cols: cfg.cols || null };
    }

    if (!series.length) return { rows: [], rowLabels: [], cols: null };

    // 形态 A：单系列的 data 是二维数组
    var d0 = series[0].data;
    if (series.length === 1 && d0 && d0.length && d0[0] && typeof d0[0] === 'object' && d0[0].length !== undefined) {
      for (i = 0; i < d0.length; i++) {
        rows.push(toRow(d0[i]));
        rowLabels.push(cfg.rowLabels && cfg.rowLabels[i] !== undefined ? String(cfg.rowLabels[i]) : '');
      }
      return { rows: rows, rowLabels: rowLabels, cols: cfg.cols || null };
    }

    // 形态 B：每个系列一行
    for (i = 0; i < series.length; i++) {
      var row = [];
      for (j = 0; j < series[i].data.length; j++) row.push(series[i].data[j]);
      rows.push(row);
      rowLabels.push(series[i].name || '');
    }
    return { rows: rows, rowLabels: rowLabels, cols: cfg.cols || null };
  }

  /** 值 → 颜色：teal（低）→ amber（中）→ danger（高）；返回不透明 rgb */
  function heatColor(pal, ratio) {
    var t = clamp01(ratio);
    var c = t <= 0.5
      ? mixColor(pal['--teal'], pal['--amber'], t / 0.5)
      : mixColor(pal['--amber'], pal['--danger'], (t - 0.5) / 0.5);
    // 向底面压一点饱和度：整片热力图才不会"满屏红"
    return mixColor(c, pal['--bg-raise'] || FALLBACKS['--bg-raise'], 0.18);
  }

  /** 值 → 透明度：低值淡、高值实，整体保持低对比 */
  function heatAlpha(ratio) {
    return 0.16 + 0.60 * clamp01(ratio);
  }

  var HEAT = {
    measure: function (st, w, h, ctx) {
      var data = heatRows(st);
      st.rows = data.rows;
      st.rowLabels = data.rowLabels;
      var rows = data.rows;
      if (!rows.length) return null;

      var cols = 0, i, j;
      for (i = 0; i < rows.length; i++) if (rows[i].length > cols) cols = rows[i].length;
      if (!cols) return null;

      var lo = Infinity, hi = -Infinity;
      for (i = 0; i < rows.length; i++) {
        for (j = 0; j < rows[i].length; j++) {
          var v = rows[i][j];
          if (v === null) continue;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      if (!isFinite(lo)) { lo = 0; hi = 1; }

      var colLabels = (st.cfg.labels && st.cfg.labels.length) ? st.cfg.labels : (data.cols || null);
      var rowLabels = st.rowLabels;
      var hasRow = false;
      for (i = 0; i < rowLabels.length; i++) if (rowLabels[i]) { hasRow = true; break; }

      var gap = 3;
      var padT = 2, padR = 2;
      ctx.font = '10px ' + MONO;
      var rowLabelW = 0;
      if (hasRow && w >= 200) {
        for (i = 0; i < rowLabels.length; i++) {
          var tw = 0;
          try { tw = ctx.measureText(rowLabels[i]).width; } catch (e) { tw = rowLabels[i].length * 6; }
          if (tw > rowLabelW) rowLabelW = tw;
        }
        rowLabelW = Math.ceil(rowLabelW) + 10;
      } else {
        hasRow = false;
      }
      var padB = (colLabels && colLabels.length && h >= 90) ? 17 : 2;
      var padL = hasRow ? rowLabelW : 2;

      var availW = Math.max(1, w - padL - padR);
      var availH = Math.max(1, h - padT - padB);
      var rawCellW = (availW - gap * (cols - 1)) / cols;
      var cellH = (availH - gap * (rows.length - 1)) / rows.length;
      cellH = Math.max(1, cellH);
      // 不为正方形：列数少时也铺满宽度，但宽高比上限 2.2，避免变成"糖葫芦"
      var cellW = Math.max(1, Math.min(rawCellW, cellH * 2.2));
      var gridW = cellW * cols + gap * (cols - 1);
      var gridH = cellH * rows.length + gap * (rows.length - 1);
      var offX = padL + (availW - gridW) / 2;
      var offY = padT + (availH - gridH) / 2;

      // 列标签抽稀
      var stride = 1;
      if (colLabels && colLabels.length) {
        var widest = 0;
        for (i = 0; i < colLabels.length && i < cols; i++) {
          var cw = 0;
          try { cw = ctx.measureText(String(colLabels[i])).width; } catch (e) { cw = String(colLabels[i]).length * 6; }
          if (cw > widest) widest = cw;
        }
        stride = Math.max(1, Math.ceil((widest + 8) / (cellW + gap)));
      }

      return {
        w: w, h: h, rows: rows, cols: cols, rowLabels: rowLabels,
        hasRow: hasRow, rowLabelW: rowLabelW,
        colLabels: colLabels && colLabels.length ? colLabels : null,
        stride: stride, padB: padB,
        gap: gap, cellW: cellW, cellH: cellH, gridW: gridW, gridH: gridH,
        offX: offX, offY: offY,
        lo: lo, hi: hi,
        radius: Math.min(3, cellH * 0.32),
        colLabelY: offY + gridH + 8
      };
    },

    draw: function (st, ctx, t, m) {
      var pal = st.pal;
      var range = m.hi - m.lo;
      var i, j;

      // 列标签
      if (m.colLabels && m.padB > 4) {
        ctx.font = '10px ' + MONO;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = pal['--text-4'] || FALLBACKS['--text-4'];
        for (j = 0; j < m.cols && j < m.colLabels.length; j += m.stride) {
          var text = m.colLabels[j];
          if (text === undefined || text === null || text === '') continue;
          ctx.fillText(String(text), Math.round(m.offX + j * (m.cellW + m.gap) + m.cellW / 2),
            Math.round(m.colLabelY));
        }
      }
      // 行标签
      if (m.hasRow) {
        ctx.font = '10px ' + MONO;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = pal['--text-4'] || FALLBACKS['--text-4'];
        for (i = 0; i < m.rows.length; i++) {
          var rl = m.rowLabels[i];
          if (!rl) continue;
          ctx.fillText(String(rl), Math.round(m.offX - 8),
            Math.round(m.offY + i * (m.cellH + m.gap) + m.cellH / 2));
        }
      }

      var hover = st.hover && st.hover.r !== undefined ? st.hover : null;
      var cells = Math.max(1, m.rows.length + m.cols);
      for (i = 0; i < m.rows.length; i++) {
        for (j = 0; j < m.rows[i].length; j++) {
          var v = m.rows[i][j];
          // 逐格入场：左上先亮，右下稍后
          var delay = ((i + j) / cells) * 0.45;
          var local = clamp01((t - delay) / 0.55);
          if (local <= 0) continue;
          var x = m.offX + j * (m.cellW + m.gap);
          var y = m.offY + i * (m.cellH + m.gap);
          var inset = (1 - local) * Math.min(3, Math.min(m.cellW, m.cellH) * 0.2);

          ctx.beginPath();
          rrect(ctx, x + inset, y + inset, m.cellW - inset * 2, m.cellH - inset * 2, m.radius);
          if (v === null) {
            ctx.fillStyle = withAlpha(EMPTY_CELL, local);
          } else {
            var ratio = range > 0 ? (v - m.lo) / range : 0.45;
            ctx.fillStyle = withAlpha(heatColor(pal, ratio), heatAlpha(ratio) * local);
          }
          ctx.fill();

          if (hover && hover.r === i && hover.c === j) {
            ctx.lineWidth = 1;
            ctx.strokeStyle = withAlpha('#ffffff', 0.55);
            ctx.stroke();
          }
        }
      }
    },

    hit: function (st, mx, my) {
      var m = st.m;
      if (!m) return null;
      if (mx < m.offX - 1 || my < m.offY - 1) return null;
      var c = Math.floor((mx - m.offX) / (m.cellW + m.gap));
      var r = Math.floor((my - m.offY) / (m.cellH + m.gap));
      if (r < 0 || c < 0 || r >= m.rows.length || c >= m.rows[r].length) return null;
      // 落在格缝里也吸附到最近格子，交互更宽容
      var v = m.rows[r][c];
      var colLabel = m.colLabels && m.colLabels[c] !== undefined ? String(m.colLabels[c]) : ('第 ' + (c + 1) + ' 列');
      var rowLabel = m.rowLabels[r] ? String(m.rowLabels[r]) : ('第 ' + (r + 1) + ' 行');
      var title = colLabel;
      var rows = [{
        name: rowLabel,
        value: v === null ? '无记录' : fmtValue(st, v),
        color: v === null ? (st.pal['--text-4'] || FALLBACKS['--text-4']) : heatColor(st.pal, m.hi > m.lo ? (v - m.lo) / (m.hi - m.lo) : 0.45)
      }];
      return { title: title, rows: rows, hover: { r: r, c: c } };
    }
  };

  /* ==========================================================================
   * 11. funnel —— 漏斗图（逐段缩短 + 右侧数值与转化率）
   * ======================================================================== */

  var FUNNEL = {
    measure: function (st, w, h, ctx) {
      var items = stageItems(st);
      st.items = items;
      var n = items.length;
      if (!n) return null;

      var i;
      var maxV = 0;
      for (i = 0; i < n; i++) if (items[i].value > maxV) maxV = items[i].value;
      if (!(maxV > 0)) maxV = 1;

      var gapY = 6;
      // 左槽（阶段名）与右槽（数值 + 转化率）按真实文本宽度计算，避免浪费绘图区
      var showName = w >= 262;
      ctx.font = '11px ' + SANS;
      var maxNameW = 0;
      for (i = 0; i < n; i++) {
        var nw = 0;
        try { nw = ctx.measureText(items[i].name).width; } catch (e) { nw = items[i].name.length * 11; }
        if (nw > maxNameW) maxNameW = nw;
      }
      var gutterL = showName ? Math.min(Math.max(maxNameW + 22, 48), w * 0.32) : 0;

      ctx.font = '11px ' + MONO;
      var maxValW = 0;
      for (i = 0; i < n; i++) {
        var vw = 0;
        try { vw = ctx.measureText(fmtValue(st, items[i].value)).width; } catch (e) { vw = 30; }
        if (vw > maxValW) maxValW = vw;
      }
      var pctW = 0;
      try { pctW = ctx.measureText('100.0%').width; } catch (e) { pctW = 32; }
      var gutterR = Math.min(Math.max(maxValW + pctW + 20, 56), w * 0.42);

      if (!(gutterL + gutterR <= w - 44)) {   // 空间不足：阶段名改为压在条内
        showName = false;
        gutterL = 0;
        gutterR = Math.min(gutterR, w * 0.46);
      }

      var barArea = Math.max(12, w - gutterL - gutterR - 4);
      var barH = (h - gapY * (n - 1)) / n;
      if (barH > 46) barH = 46;
      if (barH < 6) barH = Math.max(3, (h - gapY * (n - 1)) / n);
      var used = barH * n + gapY * (n - 1);
      var top = Math.max(0, (h - used) / 2);

      // 左侧阶段名可能很长：Gutter 内做省略
      var nameW = Math.max(0, gutterL - 12);

      return {
        w: w, h: h, items: items, n: n, maxV: maxV,
        gapY: gapY, barH: barH, top: top, barArea: barArea,
        gutterL: gutterL, gutterR: gutterR, showName: showName, nameW: nameW,
        radius: 4
      };
    },

    draw: function (st, ctx, t, m) {
      var pal = st.pal;
      var items = m.items;
      var n = m.n;
      var i;

      var baseX = m.gutterL;
      for (i = 0; i < n; i++) {
        var it = items[i];
        var delay = (i / Math.max(1, n)) * 0.3;
        var local = easeOutCubic(clamp01((t - delay) / 0.7));
        var y = m.top + i * (m.barH + m.gapY);
        var frac = it.value / m.maxV;
        var bw = Math.max(m.barH > 8 ? 8 : 3, m.barArea * frac) * local;
        var col = funnelColor(st, i, n);
        var hov = st.hover && st.hover.idx === i;

        // 背景槽：让"缩短"这件事有参照
        ctx.beginPath();
        rrect(ctx, baseX, y, m.barArea, m.barH, m.radius);
        ctx.fillStyle = 'rgba(255,255,255,0.032)';
        ctx.fill();

        // 渐变填充（accent → violet 逐段偏移，保持同族色）
        var grad = null;
        try {
          grad = ctx.createLinearGradient(baseX, y, baseX + Math.max(bw, 1), y + m.barH);
          grad.addColorStop(0, withAlpha(col, hov ? 1 : 0.92));
          grad.addColorStop(1, withAlpha(mixColor(col, pal['--violet'], 0.28), hov ? 0.85 : 0.42));
        } catch (e) { grad = withAlpha(col, 0.8); }
        if (bw > 0.6) {
          ctx.beginPath();
          rrect(ctx, baseX, y, bw, m.barH, Math.min(m.radius, bw / 2));
          ctx.fillStyle = grad;
          ctx.fill();
          if (hov) {
            ctx.lineWidth = 1;
            ctx.strokeStyle = withAlpha('#ffffff', 0.35);
            ctx.stroke();
          }
        }

        // 阶段名：容器够宽放左侧，否则压在条内
        ctx.textBaseline = 'middle';
        if (m.showName) {
          ctx.font = '11px ' + SANS;
          ctx.textAlign = 'right';
          ctx.fillStyle = pal['--text-2'] || FALLBACKS['--text-2'];
          ctx.fillText(ellipsis(ctx, it.name, m.nameW), baseX - 10, Math.round(y + m.barH / 2) + 0.5);
        } else if (bw > 46) {
          ctx.font = '10px ' + SANS;
          ctx.textAlign = 'left';
          ctx.fillStyle = withAlpha(pal['--text-on-accent'] || FALLBACKS['--text-on-accent'], 0.86);
          ctx.fillText(ellipsis(ctx, it.name, bw - 14), baseX + 8, Math.round(y + m.barH / 2) + 0.5);
        }

        // 右侧：数值 + 转化率（相对上一段）
        var textAlpha = clamp01((t - 0.35) * 2.2);
        if (textAlpha <= 0) continue;
        var valX = baseX + m.barArea + 10;
        ctx.font = '11px ' + MONO;
        ctx.textAlign = 'left';
        ctx.fillStyle = withAlpha(pal['--text-1'] || FALLBACKS['--text-1'], textAlpha);
        ctx.fillText(fmtValue(st, it.value), valX, Math.round(y + m.barH / 2) + 0.5);

        var pct;
        if (i === 0) pct = 100;
        else {
          var prev = items[i - 1].value;
          pct = prev > 0 ? (it.value / prev * 100) : 0;
        }
        var pctText = (Math.round(pct * 10) / 10) + '%';
        ctx.font = '11px ' + MONO;
        ctx.textAlign = 'right';
        ctx.fillStyle = withAlpha(pal['--text-3'] || FALLBACKS['--text-3'], textAlpha);
        ctx.fillText(pctText, m.w - 2, Math.round(y + m.barH / 2) + 0.5);
      }
    },

    hit: function (st, mx, my) {
      var m = st.m;
      if (!m || !m.n) return null;
      var idx = Math.floor((my - m.top) / (m.barH + m.gapY));
      if (idx < 0 || idx >= m.n) return null;
      var y = m.top + idx * (m.barH + m.gapY);
      if (my < y || my > y + m.barH) return null;   // 段间缝隙不算命中
      var it = m.items[idx];
      var pct = idx === 0 ? 100 : (m.items[idx - 1].value > 0 ? it.value / m.items[idx - 1].value * 100 : 0);
      return {
        title: '第 ' + (idx + 1) + ' 阶段',
        rows: [
          { name: it.name, value: fmtValue(st, it.value), color: funnelColor(st, idx, m.n) },
          { name: '转化率', value: (Math.round(pct * 10) / 10) + '%', color: st.pal['--text-3'] || FALLBACKS['--text-3'] }
        ],
        hover: { idx: idx }
      };
    }
  };

  /** Canvas 没有 ellipsis：按宽度逐字裁剪 */
  function ellipsis(ctx, text, maxW) {
    var s = String(text === undefined || text === null ? '' : text);
    if (!(maxW > 8)) return '';
    var w = 0;
    try { w = ctx.measureText(s).width; } catch (e) { w = s.length * 11; }
    if (w <= maxW) return s;
    var out = '';
    var dotsW = 0;
    try { dotsW = ctx.measureText('…').width; } catch (e) { dotsW = 10; }
    for (var i = 0; i < s.length; i++) {
      var next = out + s.charAt(i);
      var nw = 0;
      try { nw = ctx.measureText(next).width; } catch (e) { nw = next.length * 11; }
      if (nw + dotsW > maxW) break;
      out = next;
    }
    return out ? out + '…' : '';
  }

  /* ==========================================================================
   * 12. 渲染引擎：DPR / ResizeObserver / 动画 / hover / tooltip / destroy
   * ======================================================================== */

  var CHARTS = {
    line: LINE,
    bar: BAR,
    donut: DONUT,
    sparkline: SPARK,
    heatmap: HEAT,
    funnel: FUNNEL
  };

  function stopAnim(st) {
    if (st.rafId) { caf(st.rafId); st.rafId = 0; }
    st.animating = false;
  }

  /** 量尺寸 + 按 DPR 上限 2 铺画布；返回 false 表示容器不可见 */
  function measureChart(st) {
    var canvas = st.canvas;
    if (!canvas) return false;
    var box = sizeOf(st.el);
    if (!box) {
      st.m = null;
      try {
        if (canvas.width) { canvas.width = 0; canvas.height = 0; }
      } catch (e) { /* ignore */ }
      return false;
    }
    var dpr = global && global.devicePixelRatio ? global.devicePixelRatio : 1;
    if (!(dpr > 0)) dpr = 1;
    if (dpr > 2) dpr = 2;                      // 上限 2：Retina 清晰但不过度耗显存

    var cw = Math.round(box.w * dpr);
    var ch = Math.round(box.h * dpr);
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    canvas.style.width = box.w + 'px';
    canvas.style.height = box.h + 'px';

    var ctx = null;
    try { ctx = canvas.getContext('2d'); } catch (e) { ctx = null; }
    if (!ctx) return false;
    st.ctx = ctx;
    try {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // 之后一律用 CSS 像素作图
      ctx.clearRect(0, 0, box.w, box.h);
    } catch (e2) { /* ignore */ }

    var m = null;
    try {
      m = CHARTS[st.kind].measure(st, box.w, box.h, ctx) || null;
    } catch (e3) {
      m = null;
    }
    st.m = m;
    st.lastW = box.w;
    st.lastH = box.h;
    if (!m) {
      // 数据不足以成图：清空画布，但不报错
      try { ctx.clearRect(0, 0, box.w, box.h); } catch (e4) { /* ignore */ }
      return false;
    }
    return true;
  }

  function drawFrame(st, t) {
    if (!st.alive || !st.ctx || !st.m) return;
    try {
      CHARTS[st.kind].draw(st, st.ctx, t, st.m);
    } catch (e) {
      // 绘制异常不能冒泡到主程序，也不能打断动画链
    }
  }

  function animate(st) {
    stopAnim(st);
    st.t = 0;
    st.animating = true;
    var start = nowMs();
    var step = function () {
      if (!st.alive) return;
      var elapsed = nowMs() - start;
      var tt = DURATION > 0 ? elapsed / DURATION : 1;
      if (tt >= 1) tt = 1;
      if (tt < 0) tt = 0;
      st.t = tt;
      drawFrame(st, tt);
      if (tt < 1) {
        st.rafId = raf(step);
      } else {
        st.rafId = 0;
        st.animating = false;
      }
    };
    st.rafId = raf(step);
  }

  function render(st, allowAnim) {
    if (!st.alive) return;
    st.pal = palette();
    // 容器不可见：保留监听，等 ResizeObserver 再画
    var ok = measureChart(st);
    if (!ok) return;
    if (st.hover) st.hover = null;
    if (allowAnim && st.animEnabled) {
      animate(st);
    } else {
      stopAnim(st);
      st.t = 1;
      drawFrame(st, 1);
    }
    st.firstRender = false;
  }

  function scheduleDraw(st) {
    if (!st.alive || st.hoverRaf) return;
    st.hoverRaf = raf(function () {
      st.hoverRaf = 0;
      if (!st.alive) return;
      drawFrame(st, st.t);
    });
  }

  function on(st, target, type, fn, opts) {
    if (!target || typeof target.addEventListener !== 'function') return;
    var use = opts === undefined ? false : opts;
    try {
      target.addEventListener(type, fn, use);
    } catch (e) {
      return;
    }
    st.off.push(function () {
      try { target.removeEventListener(type, fn, use); } catch (e2) { /* ignore */ }
    });
  }

  function clearHover(st) {
    var had = !!st.hover;
    st.hover = null;
    hideTip(st);
    if (had) scheduleDraw(st);
  }

  function pointerMove(st, cx, cy) {
    if (!st.alive || !st.canvas) return;
    var rect = null;
    try { rect = st.canvas.getBoundingClientRect(); } catch (e) { rect = null; }
    if (!rect) return;
    var w = rect.width || st.lastW;
    var h = rect.height || st.lastH;
    var mx = cx - rect.left;
    var my = cy - rect.top;
    if (mx < 0 || my < 0 || mx > w || my > h) { clearHover(st); return; }

    var info = null;
    if (st.m) {
      try { info = CHARTS[st.kind].hit(st, mx, my) || null; } catch (e2) { info = null; }
    }
    st.hover = info ? info.hover : null;
    scheduleDraw(st);
    if (info) showTip(st, cx, cy, info);
    else hideTip(st);
  }

  function bind(st) {
    var canvas = st.canvas;

    on(st, canvas, 'mousemove', function (e) {
      pointerMove(st, e.clientX, e.clientY);
    });
    on(st, canvas, 'mouseleave', function () {
      clearHover(st);
    });
    on(st, canvas, 'touchstart', function (e) {
      var tp = e && e.touches && e.touches[0] ? e.touches[0] : null;
      if (tp) pointerMove(st, tp.clientX, tp.clientY);
    });
    on(st, canvas, 'touchmove', function (e) {
      var tp = e && e.touches && e.touches[0] ? e.touches[0] : null;
      if (tp) pointerMove(st, tp.clientX, tp.clientY);
    });
    on(st, canvas, 'touchend', function () {
      if (st.hideTimer) clearTimeout(st.hideTimer);
      st.hideTimer = setTimeout(function () {
        if (!st.alive) return;
        clearHover(st);
      }, 1400);   // 触摸设备上留一点阅读时间
    });

    // 页面滚动时 tooltip 会与数据错位，直接收起
    if (global && typeof global.addEventListener === 'function') {
      on(st, global, 'scroll', function () { hideTip(st); }, true);
    }

    // 响应式：容器尺寸变化重绘（尺寸为 0 时直接跳过）
    if (global && typeof global.ResizeObserver === 'function') {
      try {
        st.ro = new global.ResizeObserver(function () {
          if (!st.alive) return;
          var w = st.el ? st.el.clientWidth : 0;
          var h = st.el ? st.el.clientHeight : 0;
          if (!(w > 0) || !(h > 0)) return;         // 不可见：跳过，不报错
          if (w === st.lastW && h === st.lastH) return;
          render(st, st.firstRender);              // resize 直接终态，避免抖动
        });
        st.ro.observe(st.el);
      } catch (e) {
        st.ro = null;
      }
    }
  }

  function destroyEntry(entry) {
    var st = entry.st;
    if (!st) return;
    st.alive = false;
    stopAnim(st);
    if (st.hoverRaf) { caf(st.hoverRaf); st.hoverRaf = 0; }
    if (st.hideTimer) { clearTimeout(st.hideTimer); st.hideTimer = 0; }
    if (st.ro) {
      try { st.ro.disconnect(); } catch (e) { /* ignore */ }
      st.ro = null;
    }
    for (var i = 0; i < st.off.length; i++) {
      try { st.off[i](); } catch (e2) { /* ignore */ }
    }
    st.off = [];
    removeTip(st);
    if (st.canvas) {
      try {
        var ctx = st.canvas.getContext('2d');
        if (ctx) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, st.canvas.width || 0, st.canvas.height || 0);
        }
      } catch (e3) { /* ignore */ }
      if (st.owned && st.canvas.parentNode) {
        try { st.canvas.parentNode.removeChild(st.canvas); } catch (e4) { /* ignore */ }
      }
    }
    st.canvas = null;
    st.ctx = null;
    st.m = null;
    st.hover = null;
    for (var j = registry.length - 1; j >= 0; j--) {
      if (registry[j] === entry) registry.splice(j, 1);
    }
  }

  function findEntry(el) {
    for (var i = 0; i < registry.length; i++) {
      var e = registry[i];
      if (e.el === el) return e;
      if (e.st && e.st.canvas === el) return e;   // 允许传 canvas 本身
    }
    return null;
  }

  function destroyEl(el) {
    if (!el) return;
    var entry = findEntry(el);
    if (!entry) return;
    destroyEntry(entry);
  }

  /* ==========================================================================
   * 13. 初始化 / 对外 API
   * ======================================================================== */

  function create(el, kind, cfg) {
    // 无 window（例如 Node 环境 require）时静默返回，绝不抛错
    if (!global) return;
    if (!el || typeof el !== 'object' || !el.tagName) return;
    if (!CHARTS[kind]) return;
    if (!global.document || typeof global.document.createElement !== 'function') return;

    var container = el;
    try {
      destroyEl(el);   // 重复初始化同一容器：先 destroy 再 init

      var cfgObj = cfg && typeof cfg === 'object' ? cfg : {};
      var canvas = null;
      var owned = false;

      if (el.tagName === 'CANVAS') {
        canvas = el;
      } else {
        // 容器若不是定位元素，补一个 relative，保证 canvas 铺满
        var pos = cssPosition(el);
        if (!pos || pos === 'static') {
          try { el.style.position = 'relative'; } catch (e0) { /* ignore */ }
        }
        canvas = global.document.createElement('canvas');
        try { canvas.setAttribute('data-chart', kind); } catch (e1) { /* ignore */ }
        var cs = canvas.style;
        cs.position = 'absolute';
        cs.left = '0';
        cs.top = '0';
        cs.display = 'block';
        cs.width = '100%';
        cs.height = '100%';
        if (kind === 'line' || kind === 'sparkline') cs.cursor = 'crosshair';
        try { el.appendChild(canvas); } catch (e2) { return; }
        owned = true;
      }

      var reduce = false;
      try {
        if (global.matchMedia) reduce = !!global.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch (e3) { reduce = false; }

      var st = {
        el: container,
        canvas: canvas,
        owned: owned,
        kind: kind,
        cfg: cfgObj,
        ctx: null,
        m: null,
        pal: palette(),
        series: normalizeSeries(cfgObj, kind === 'bar' ? 'bar' : 'line'),
        items: [],
        rows: [],
        rowLabels: [],
        hover: null,
        t: 1,
        rafId: 0,
        hoverRaf: 0,
        ro: null,
        tip: null,
        off: [],
        hideTimer: 0,
        alive: true,
        animating: false,
        animEnabled: cfgObj.animate !== false && !reduce,
        firstRender: true,
        lastW: 0,
        lastH: 0
      };

      var entry = { el: container, st: st };
      registry.push(entry);

      bind(st);
      render(st, true);   // 首帧：量尺寸 + 入场动画
    } catch (err) {
      // 任何异常都不影响主程序：图表失败即降级为空白
      var cur = findEntry(el);
      if (cur) destroyEntry(cur);
    }
  }

  var api = {
    /** 折线 / 面积图（series.type 支持 'bar' 组合） */
    line: function (el, cfg) { create(el, 'line', cfg); },
    /** 柱状图（cfg.stacked === true 时堆叠；series.type:'line' 作叠加层） */
    bar: function (el, cfg) { create(el, 'bar', cfg); },
    /** 环形图（cfg.centerValue / cfg.centerLabel） */
    donut: function (el, cfg) { create(el, 'donut', cfg); },
    /** 迷你趋势线（无坐标轴、无网格） */
    sparkline: function (el, cfg) { create(el, 'sparkline', cfg); },
    /** 热力图（cfg.rows 或每系列一行） */
    heatmap: function (el, cfg) { create(el, 'heatmap', cfg); },
    /** 漏斗图（labels + 单系列 data，或 cfg.items） */
    funnel: function (el, cfg) { create(el, 'funnel', cfg); },
    /** 卸载容器上的图表：断 observer、取消动画、移除 tooltip 与事件 */
    destroy: function (el) {
      try { destroyEl(el); } catch (e) { /* ignore */ }
    }
  };

  // 只暴露 window.Charts；require 时不做任何浏览器 API 访问
  if (global && typeof global === 'object') {
    global.Charts = api;
  }
})(typeof window !== 'undefined' ? window : null);
