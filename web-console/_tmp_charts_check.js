'use strict';
/* 临时自检脚本（用完删除）：stub 最小 DOM + 记录型 2D context，验证 charts.js */

var path = require('path');
var CH = path.join(__dirname, 'js', 'charts.js');

var checks = 0;
var failures = [];

function ok(cond, msg) {
  checks++;
  if (!cond) failures.push(msg);
}
function section(name) {
  console.log('--- ' + name);
}
function guard(label, fn) {
  try {
    fn();
  } catch (e) {
    failures.push('抛异常 [' + label + ']: ' + (e && e.stack ? e.stack.split('\n')[0] : e));
  }
}

/* ------------------------------ 记录型 context ----------------------------- */
function makeCtx() {
  var c = {
    saveDepth: 0,
    maxSaveDepth: 0,
    calls: 0,
    badNumbers: [],
    badColors: [],
    texts: [],
    textCalls: [],
    strokes: [],
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: '',
    lineCap: '',
    textAlign: '',
    textBaseline: '',
    shadowColor: '',
    shadowBlur: 0
  };

  function checkStyle() {
    var s = c.fillStyle;
    if (typeof s === 'string' && s.indexOf('var(') !== -1) c.badColors.push('fillStyle=' + s);
    s = c.strokeStyle;
    if (typeof s === 'string' && s.indexOf('var(') !== -1) c.badColors.push('strokeStyle=' + s);
  }

  var methods = ['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'rect', 'clip',
    'fill', 'stroke', 'fillRect', 'strokeRect', 'translate', 'rotate', 'scale', 'setLineDash',
    'clearRect', 'resetTransform', 'bezierCurveTo', 'quadraticCurveTo'];

  methods.forEach(function (name) {
    c[name] = function () {
      c.calls++;
      if (name === 'save') {
        c.saveDepth++;
        if (c.saveDepth > c.maxSaveDepth) c.maxSaveDepth = c.saveDepth;
      } else if (name === 'restore') {
        c.saveDepth--;
        if (c.saveDepth < 0) c.badNumbers.push('restore 多于 save');
      }
      for (var i = 0; i < arguments.length; i++) {
        if (typeof arguments[i] === 'number' && !isFinite(arguments[i])) {
          c.badNumbers.push(name + '(' + i + ')=' + arguments[i]);
        }
      }
      if (name === 'fill' || name === 'stroke') {
        checkStyle();
        if (name === 'stroke') c.strokes.push(c.lineWidth);
      }
    };
  });

  c.fillText = function (text, x, y) {
    c.calls++;
    if (!isFinite(x) || !isFinite(y)) c.badNumbers.push('fillText(' + text + ') 坐标非有限');
    checkStyle();
    var s = String(text);
    if (s.indexOf('NaN') !== -1 || s.indexOf('undefined') !== -1 || s.indexOf('Infinity') !== -1) {
      c.badNumbers.push('文本异常: ' + s);
    }
    c.texts.push(s);
    c.textCalls.push({ text: s, font: String(c.font), style: String(c.fillStyle) });
  };
  c.strokeText = c.fillText;

  c.setTransform = function (a, b, d, e, f, g) {
    c.calls++;
    c.lastTransform = [a, b, d, e, f, g];
    for (var i = 0; i < arguments.length; i++) {
      if (typeof arguments[i] === 'number' && !isFinite(arguments[i])) c.badNumbers.push('setTransform 非有限');
    }
  };

  c.measureText = function (t) {
    c.calls++;
    return { width: String(t).length * 6.2 };
  };

  function gradient() {
    c.calls++;
    return {
      addColorStop: function (offset, color) {
        if (!isFinite(offset)) c.badNumbers.push('gradient offset=' + offset);
        if (String(color).indexOf('var(') !== -1) c.badColors.push('gradient=' + color);
      }
    };
  }
  c.createLinearGradient = gradient;
  c.createRadialGradient = gradient;
  return c;
}

/* -------------------------------- DOM stub -------------------------------- */
function El(tag, w, h) {
  this.tagName = String(tag).toUpperCase();
  this.style = {};
  this.children = [];
  this.parentNode = null;
  this.clientWidth = w || 0;
  this.clientHeight = h || 0;
  this.width = 0;
  this.height = 0;
  this.listeners = {};
  this.attrs = {};
  this._ctx = null;
  this.className = '';
}
El.prototype.appendChild = function (c) {
  c.parentNode = this;
  this.children.push(c);
  return c;
};
El.prototype.removeChild = function (c) {
  var i = this.children.indexOf(c);
  if (i >= 0) this.children.splice(i, 1);
  c.parentNode = null;
  return c;
};
El.prototype.setAttribute = function (k, v) { this.attrs[k] = v; };
El.prototype.getAttribute = function (k) { return this.attrs[k]; };
El.prototype.addEventListener = function (t, f) {
  if (!this.listeners[t]) this.listeners[t] = [];
  this.listeners[t].push(f);
};
El.prototype.removeEventListener = function (t, f) {
  var a = this.listeners[t] || [];
  var i = a.indexOf(f);
  if (i >= 0) a.splice(i, 1);
};
El.prototype.dispatch = function (t, ev) {
  var a = (this.listeners[t] || []).slice();
  for (var i = 0; i < a.length; i++) a[i].call(this, ev || {});
};
El.prototype.listenerCount = function (t) {
  return (this.listeners[t] || []).length;
};
El.prototype.getContext = function () {
  if (!this._ctx) this._ctx = makeCtx();
  return this._ctx;
};
El.prototype.getBoundingClientRect = function () {
  var w = this.clientWidth;
  var h = this.clientHeight;
  if (this.style && typeof this.style.width === 'string' && this.style.width.slice(-2) === 'px') {
    var pw = parseFloat(this.style.width);
    if (isFinite(pw)) w = pw;
  }
  if (this.style && typeof this.style.height === 'string' && this.style.height.slice(-2) === 'px') {
    var ph = parseFloat(this.style.height);
    if (isFinite(ph)) h = ph;
  }
  return { left: 0, top: 0, width: w, height: h, right: w, bottom: h };
};

/* ------------------------------- 环境装配 ------------------------------- */
var rafQueue = [];
var rafSeq = 0;
var cancelled = {};
var fakeTime = 1000;
var ros = [];
var winListeners = {};
var windowStub = null;
var bodyEl = null;
var docStub = null;

function makeRO(cb) {
  this.cb = cb;
  this.targets = [];
  this.disconnected = false;
  ros.push(this);
}
makeRO.prototype.observe = function (t) { this.targets.push(t); };
makeRO.prototype.unobserve = function () {};
makeRO.prototype.disconnect = function () { this.disconnected = true; };

function pump(limit) {
  var frames = 0;
  while (rafQueue.length && frames < (limit || 400)) {
    var q = rafQueue;
    rafQueue = [];
    fakeTime += 16;
    for (var i = 0; i < q.length; i++) {
      if (cancelled[q[i].id]) continue;
      try {
        q[i].cb(fakeTime);
      } catch (e) {
        failures.push('rAF 回调抛错: ' + e.message);
      }
    }
    frames++;
  }
  if (rafQueue.length) failures.push('动画未收敛（rAF 队列仍有 ' + rafQueue.length + ' 项）');
  return frames;
}

function load() {
  delete require.cache[require.resolve(CH)];
  return require(CH);
}

function cssStub() {
  return {
    position: 'static',
    getPropertyValue: function (name) {
      if (name === '--accent') return '  #5B8CFF  ';   // 故意带空白，验证 trim
      if (name === '--teal') return '#22D3A6';
      if (name === '--text-3') return '#6C7896';
      return '';
    }
  };
}

/* =========================================================================
 * T0：require 时不得访问浏览器 API
 * ======================================================================= */
section('T0 require 时零浏览器 API 访问');
var docAccess = 0;
var gcsCalls = 0;
var rafCalls = 0;

windowStub = {
  devicePixelRatio: 3,
  innerWidth: 1440,
  innerHeight: 900,
  requestAnimationFrame: function (cb) { rafCalls++; rafQueue.push({ id: ++rafSeq, cb: cb }); return rafSeq; },
  cancelAnimationFrame: function (id) { cancelled[id] = true; },
  performance: { now: function () { return fakeTime; } },
  matchMedia: function () { return { matches: false }; },
  addEventListener: function (t, f) { if (!winListeners[t]) winListeners[t] = []; winListeners[t].push(f); },
  removeEventListener: function (t, f) {
    var a = winListeners[t] || [];
    var i = a.indexOf(f);
    if (i >= 0) a.splice(i, 1);
  },
  ResizeObserver: makeRO,
  getComputedStyle: function () { gcsCalls++; return cssStub(); }
};
Object.defineProperty(windowStub, 'document', {
  configurable: true,
  get: function () { docAccess++; return undefined; }
});
global.window = windowStub;

guard('T0 require', function () { load(); });
ok(docAccess === 0, 'require 时访问了 document（次数 ' + docAccess + '）');
ok(gcsCalls === 0, 'require 时调用了 getComputedStyle');
ok(rafCalls === 0, 'require 时调用了 requestAnimationFrame');

var api0 = windowStub.Charts;
ok(!!api0, 'window.Charts 已暴露');
var keys = Object.keys(api0 || {});
ok(keys.length === 7, 'API 数量应为 7，实际 ' + keys.length + '（' + keys.join(',') + '）');
['line', 'bar', 'donut', 'sparkline', 'heatmap', 'funnel', 'destroy'].forEach(function (k) {
  ok(typeof api0[k] === 'function', '缺少方法 ' + k);
});

// 无 document 时调用必须静默返回
guard('T0 无 document 调用', function () {
  api0.line(null, {});
  api0.line({}, {});
  api0.destroy(null);
  api0.line(undefined, undefined);
});

/* =========================================================================
 * T1：完整环境
 * ======================================================================= */
section('T1 完整环境装配');
bodyEl = new El('body', 1440, 900);
var docEl = new El('html', 1440, 900);
docStub = {
  documentElement: docEl,
  body: bodyEl,
  createElement: function (t) { return new El(t, 0, 0); }
};
Object.defineProperty(windowStub, 'document', {
  configurable: true,
  value: docStub,
  writable: true
});
docAccess = 0;
gcsCalls = 0;
rafCalls = 0;
load();
var Charts = winListeners && windowStub.Charts;
ok(!!Charts, '重新加载后 Charts 可用');

function box(w, h) {
  var e = new El('div', w, h);
  bodyEl.appendChild(e);
  return e;
}
function tips() {
  var out = [];
  for (var i = 0; i < bodyEl.children.length; i++) {
    if (bodyEl.children[i].className === 'chart-tip') out.push(bodyEl.children[i]);
  }
  return out;
}
function canvasOf(el) { return el.children[0] || null; }
function ctxOf(el) {
  var c = canvasOf(el);
  return c ? c.getContext('2d') : null;
}
function auditCanvas(label, el) {
  var c = canvasOf(el);
  if (!c) { failures.push(label + ': 未创建 canvas'); checks++; return; }
  var ctx = c.getContext('2d');
  ok(ctx.badNumbers.length === 0, label + ' 出现非法数值: ' + ctx.badNumbers.slice(0, 4).join(' | '));
  ok(ctx.badColors.length === 0, label + ' 出现未解析颜色: ' + ctx.badColors.slice(0, 4).join(' | '));
  ok(ctx.saveDepth === 0, label + ' save/restore 不平衡（depth=' + ctx.saveDepth + '）');
  ok(ctx.calls > 0, label + ' 没有任何绘制调用');
}

/* ------------------------------ T2 折线图 ------------------------------ */
section('T2 line 折线图 + DPR + 网格 + 等宽刻度');
var cfgLine = {
  labels: ['1月', '2月', '3月', '4月', '5月', '6月'],
  series: [
    { name: '需求数', data: [12, 18, 15, 26, 22, 31], color: 'var(--accent)', type: 'area' },
    { name: '成交数', data: [6, 9, 8, 14, 12, 19], type: 'line' }
  ],
  valueFormat: function (v) { return v + ' 单'; },
  yTicks: 4
};
var elLine = box(600, 300);
guard('T2 line', function () { Charts.line(elLine, cfgLine); });
var frames = pump();
var canvasLine = canvasOf(elLine);
ok(!!canvasLine, 'line 创建了 canvas');
ok(canvasLine && canvasLine.tagName === 'CANVAS', 'canvas 节点');
ok(canvasLine && canvasLine.width === 600 * 2, 'DPR 上限 2（宽 ' + (canvasLine && canvasLine.width) + '）');
ok(canvasLine && canvasLine.height === 300 * 2, 'DPR 上限 2（高 ' + (canvasLine && canvasLine.height) + '）');
ok(canvasLine && canvasLine.style.width === '600px', 'CSS 宽同步');
ok(frames >= 3, '入场动画驱动了多帧（' + frames + '）');
var ctxLine = ctxOf(elLine);
ok(ctxLine.lastTransform && ctxLine.lastTransform[0] === 2 && ctxLine.lastTransform[3] === 2, 'setTransform 使用 dpr=2');
ok(ctxLine.textCalls.some(function (t) { return t.font.indexOf('SF Mono') !== -1 && t.font.indexOf('11px') !== -1; }), '刻度使用 11px 等宽字体');
ok(ctxLine.texts.indexOf('1月') !== -1 || ctxLine.texts.indexOf('2月') !== -1, '绘制了 X 轴标签');
ok(ctxLine.texts.indexOf('需求数') !== -1, '绘制了图例文本');
ok(ctxLine.strokes.some(function (w) { return w === 1.75; }), '折线宽度 1.75');
ok(ctxLine.strokes.some(function (w) { return w === 1; }), '网格 1px');
ok(tips().length === 0, 'tooltip 惰性创建（初始不存在）');
auditCanvas('line', elLine);

section('T2b line hover + tooltip');
canvasLine.dispatch('mousemove', { clientX: 300, clientY: 150 });
pump();
var t2 = tips();
ok(t2.length === 1, 'hover 后创建 1 个 tooltip（实际 ' + t2.length + '）');
ok(t2.length === 1 && t2[0].style.position === 'fixed', 'tooltip position:fixed');
ok(t2.length === 1 && t2[0].style.pointerEvents === 'none', 'tooltip pointer-events:none');
ok(t2.length === 1 && t2[0].innerHTML.indexOf('需求数') !== -1, 'tooltip 含系列名');
ok(t2.length === 1 && /[0-9]/.test(t2[0].innerHTML), 'tooltip 含数值');
ok(t2.length === 1 && /\d\s*单/.test(t2[0].innerHTML), 'tooltip 走了 valueFormat');
ok(ctxLine.maxSaveDepth >= 1, 'hover 使用 save/restore 包裹');
canvasLine.dispatch('mouseleave', {});
ok(tips()[0].style.opacity === '0', 'mouseleave 隐藏 tooltip');
canvasLine.dispatch('touchstart', { touches: [{ clientX: 200, clientY: 120 }] });
pump();
ok(tips()[0].style.opacity === '1', 'touchstart 显示 tooltip');
canvasLine.dispatch('touchend', {});
ok(true, 'touchend 不抛错');
Charts.destroy(elLine);
ok(tips().length === 0, 'destroy 清掉 line 的 tooltip');
pump();

/* ------------------------------ T3 容错矩阵 ------------------------------ */
section('T3 容错矩阵（6 类 × 非法入参）');
var kinds = ['line', 'bar', 'donut', 'sparkline', 'heatmap', 'funnel'];
var cfgs = [
  ['null-el', null, {}],
  ['plain-obj', {}, { series: [{ data: [1, 2, 3] }] }],
  ['no-cfg', 'EL', undefined],
  ['empty-cfg', 'EL', {}],
  ['series-empty', 'EL', { series: [] }],
  ['data-empty', 'EL', { labels: [], series: [{ name: 'a', data: [] }] }],
  ['one-point', 'EL', { labels: ['唯一'], series: [{ name: 'a', data: [5] }] }],
  ['all-equal', 'EL', { labels: ['a', 'b', 'c'], series: [{ name: 'a', data: [7, 7, 7] }] }],
  ['all-zero', 'EL', { labels: ['a', 'b'], series: [{ name: 'a', data: [0, 0] }] }],
  ['dirty-values', 'EL', { labels: ['a', 'b', 'c', 'd', 'e', 'f'], series: [{ name: 'a', data: [1, 'x', null, NaN, Infinity, -3] }] }],
  ['all-nan', 'EL', { labels: ['a', 'b'], series: [{ name: 'a', data: [NaN, undefined] }] }],
  ['min-max-lock', 'EL', { series: [{ data: [3, 1, 4] }], min: 0, max: 10, yTicks: 5 }],
  ['min-eq-max', 'EL', { series: [{ data: [3, 1, 4] }], min: 5, max: 5 }],
  ['negative', 'EL', { labels: ['a', 'b', 'c'], series: [{ data: [5, -4, 2] }] }],
  ['no-animate', 'EL', { series: [{ data: [3, 1, 4] }], animate: false }],
  ['no-grid', 'EL', { series: [{ data: [3, 1, 4] }], grid: false, yTicks: 0 }],
  ['yTicks-str', 'EL', { series: [{ data: [3, 1, 4] }], yTicks: 'x' }],
  ['tiny-box', 'TINY', { series: [{ data: [3, 1, 4] }] }],
  ['zero-box', 'ZERO', { series: [{ data: [3, 1, 4] }] }],
  ['var-color', 'EL', { labels: ['a', 'b'], series: [{ data: [3, 1], color: 'var(--teal)' }, { data: [1, 2], color: 'var(--nope)' }] }],
  ['format-throw', 'EL', { series: [{ data: [3, 1, 4] }], valueFormat: function () { throw new Error('boom'); } }],
  ['format-bad-return', 'EL', { series: [{ data: [3, 1, 4] }], valueFormat: function () { return null; } }],
  ['stacked', 'EL', { labels: ['a', 'b'], stacked: true, series: [{ name: 'x', data: [3, 1] }, { name: 'y', data: [2, 5] }] }],
  ['combo', 'EL', { labels: ['a', 'b', 'c'], series: [{ name: 'x', data: [3, 1, 4], type: 'bar' }, { name: 'y', data: [1, 2, 3], type: 'area' }] }],
  ['labels-long', 'EL', { labels: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], series: [{ data: [1, 2] }] }],
  ['data-long', 'EL', { labels: ['a'], series: [{ data: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }] }],
  ['num-series', 'EL', { series: [1, 2, 3] }],
  ['items-cfg', 'EL', { items: [{ name: 'p', value: 10 }, { name: 'q', value: 5 }] }]
];

for (var ci = 0; ci < cfgs.length; ci++) {
  var caseName = cfgs[ci][0];
  var elSpec = cfgs[ci][1];
  var cfgCase = cfgs[ci][2];
  for (var ki = 0; ki < kinds.length; ki++) {
    var kind = kinds[ki];
    var el;
    if (elSpec === 'EL') el = box(320, 200);
    else if (elSpec === 'TINY') el = box(40, 30);
    else if (elSpec === 'ZERO') el = box(0, 0);
    else el = elSpec;

    (function (k, e, c, label) {
      guard('T3 ' + k + '/' + label, function () { Charts[k](e, c); });
    })(kind, el, cfgCase, caseName);

    pump();

    if (el && el.tagName === 'DIV' && el.clientWidth > 0) {
      auditCanvas('T3 ' + kind + '/' + caseName, el);
      var cvs = canvasOf(el);
      // 命中测试：容器内多点扫描，不能抛错
      (function (cv) {
        if (!cv) return;
        var pts = [[1, 1], [160, 100], [319, 199], [0, 0], [-5, -5], [500, 400]];
        for (var pi = 0; pi < pts.length; pi++) {
          guard('T3 hover ' + kind, function () {
            cv.dispatch('mousemove', { clientX: pts[pi][0], clientY: pts[pi][1] });
          });
        }
        pump();
        cv.dispatch('mouseleave', {});
        pump();
        guard('T3 destroy ' + kind, function () { Charts.destroy(el); });
      })(cvs);
    } else if (el && el.tagName === 'DIV') {
      ok(!canvasOf(el) || canvasOf(el).width === 0, 'T3 零尺寸容器不应生成像素');
      guard('T3 destroy0 ' + kind, function () { Charts.destroy(el); });
    }
  }
}
ok(tips().length <= 1, 'tooltip 单例（最多 1 个，实际 ' + tips().length + '）');

/* --------------------------- T4 各图专属校验 --------------------------- */
section('T4 donut 中心文案 / heatmap / funnel');
var elD = box(320, 320);
guard('T4 donut', function () {
  Charts.donut(elD, {
    labels: ['已认证', '审核中', '已拒绝', '未提交'],
    series: [{ name: '数量', data: [62, 21, 9, 8] }],
    centerValue: '1,284',
    centerLabel: '教员总数',
    valueFormat: function (v) { return v + ' 人'; }
  });
});
pump();
var ctxD = ctxOf(elD);
ok(ctxD.texts.indexOf('1,284') !== -1, 'donut 中心数值');
ok(ctxD.texts.indexOf('教员总数') !== -1, 'donut 中心标签');
ok(ctxD.strokes.some(function (w) { return w > 14; }), 'donut 环宽按半径比例');
auditCanvas('donut', elD);
var canvasD = canvasOf(elD);
canvasD.dispatch('mousemove', { clientX: 160 + 130, clientY: 160 });
pump();
var td = tips();
ok(td.length === 1 && /已认证|审核中|已拒绝|未提交/.test(td[0].innerHTML), 'donut hover 分段 tooltip');
ok(td.length === 1 && td[0].innerHTML.indexOf('%') !== -1, 'donut tooltip 含占比');
canvasD.dispatch('mousemove', { clientX: 160, clientY: 160 });
pump();
ok(tips()[0].style.opacity === '0', 'donut 中心区域不显示 tooltip');
canvasD.dispatch('mouseleave', {});
Charts.destroy(elD);

var elH = box(420, 220);
guard('T4 heatmap-2d', function () {
  Charts.heatmap(elH, {
    labels: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
    rowLabels: ['第1周', '第2周', '第3周', '第4周', '第5周', '第6周', '第7周', '第8周'],
    rows: [
      [3, 2, 3, 1, 2, 0, 0],
      [2, 3, 3, 2, 3, 1, 0],
      [3, 3, 2, 3, 3, 2, 1],
      [1, 2, 3, 3, 2, 3, 2],
      [3, 3, 3, 2, 3, 3, 1],
      [2, 2, 3, 3, 3, 2, 0],
      [3, 3, 2, 3, 2, 2, 1],
      [3, 2, null, 3, 3, 3, 2]
    ],
    valueFormat: function (v) { return v + ' 次'; }
  });
});
pump();
var ctxH = ctxOf(elH);
ok(ctxH.texts.indexOf('周一') !== -1, 'heatmap 列标签');
ok(ctxH.texts.indexOf('第1周') !== -1, 'heatmap 行标签');
auditCanvas('heatmap', elH);
var canvasH = canvasOf(elH);
canvasH.dispatch('mousemove', { clientX: 150, clientY: 12 });
pump();
var th = tips();
ok(th.length === 1 && /次|无记录/.test(th[0].innerHTML), 'heatmap hover tooltip');
canvasH.dispatch('mouseleave', {});
Charts.destroy(elH);

var elH2 = box(420, 200);
guard('T4 heatmap-series', function () {
  Charts.heatmap(elH2, {
    labels: ['W1', 'W2', 'W3', 'W4'],
    series: [
      { name: '北京', data: [1, 5, 3, 9] },
      { name: '上海', data: [2, 4, 6, 8] },
      { name: '广州', data: [0, 1, 2, 3] }
    ]
  });
});
pump();
auditCanvas('heatmap-series', elH2);
Charts.destroy(elH2);

var elF = box(420, 260);
guard('T4 funnel', function () {
  Charts.funnel(elF, {
    labels: ['提交申请', '资料初审', '线上面试', '试讲评估', '正式签约'],
    series: [{ name: '人数', data: [1280, 964, 612, 388, 251] }],
    unit: '人'
  });
});
pump();
var ctxF = ctxOf(elF);
ok(ctxF.texts.indexOf('提交申请') !== -1, 'funnel 阶段名');
ok(ctxF.texts.indexOf('100%') !== -1, 'funnel 首段 100%');
ok(ctxF.texts.some(function (t) { return /%$/.test(t); }), 'funnel 含转化率百分比');
ok(ctxF.texts.some(function (t) { return /人/.test(t); }), 'funnel 数值带单位');
auditCanvas('funnel', elF);
var canvasF = canvasOf(elF);
canvasF.dispatch('mousemove', { clientX: 200, clientY: 40 });
pump();
var tf = tips();
ok(tf.length === 1 && /提交申请/.test(tf[0].innerHTML), 'funnel hover tooltip');
ok(tf.length === 1 && tf[0].innerHTML.indexOf('%') !== -1, 'funnel tooltip 含转化率');
canvasF.dispatch('mouseleave', {});
Charts.destroy(elF);

/* ------------------------------ T5 sparkline ------------------------------ */
section('T5 sparkline 无坐标轴');
var elS = box(180, 48);
guard('T5 spark', function () {
  Charts.sparkline(elS, { labels: ['a', 'b', 'c', 'd', 'e'], series: [{ name: '趋势', data: [4, 7, 5, 9, 11] }] });
});
pump();
var ctxS = ctxOf(elS);
ok(ctxS.texts.length === 0, 'sparkline 不应绘制任何文字（实际 ' + ctxS.texts.length + '）');
ok(ctxS.strokes.indexOf(1.5) !== -1, 'sparkline 线宽 1.5');
auditCanvas('sparkline', elS);
canvasOf(elS).dispatch('mousemove', { clientX: 90, clientY: 24 });
pump();
ok(tips().length === 1, 'sparkline hover tooltip');
canvasOf(elS).dispatch('mouseleave', {});
Charts.destroy(elS);

/* ---------------------- T6 destroy / 重复 init / resize ---------------------- */
section('T6 destroy + 重复初始化 + ResizeObserver');
var elR = box(500, 260);
guard('T6 init1', function () { Charts.line(elR, cfgLine); });
pump();
var canvasR = canvasOf(elR);
canvasR.dispatch('mousemove', { clientX: 120, clientY: 100 });
pump();
ok(tips().length === 1, 'T6 hover 创建 tooltip');
var roBefore = ros.length;
guard('T6 reinit', function () { Charts.bar(elR, { labels: ['a', 'b'], series: [{ data: [3, 5] }] }); });
pump();
ok(elR.children.length === 1, '重复初始化只保留 1 个 canvas（实际 ' + elR.children.length + '）');
ok(tips().length === 0, '重新初始化清掉旧 tooltip');
var roCur = ros[ros.length - 1];
ok(ros.length > roBefore, 'T6 新建了 ResizeObserver');
ok(ros[ros.length - 2] && ros[ros.length - 2].disconnected === true, '旧 ResizeObserver 已 disconnect');

var canvasR2 = canvasOf(elR);
ok(canvasR2.listenerCount('mousemove') === 1, '事件监听未重复绑定（' + canvasR2.listenerCount('mousemove') + '）');

// resize：先归零再放大
guard('T6 resize0', function () {
  elR.clientWidth = 0;
  elR.clientHeight = 0;
  roCur.cb();
});
guard('T6 resize-big', function () {
  elR.clientWidth = 720;
  elR.clientHeight = 340;
  roCur.cb();
});
pump();
ok(canvasR2.width === 720 * 2, 'resize 后按新尺寸重绘（' + canvasR2.width + '）');

guard('T6 destroy', function () { Charts.destroy(elR); });
ok(elR.children.length === 0, 'destroy 移除自建 canvas');
ok(roCur.disconnected === true, 'destroy 断开 ResizeObserver');
ok(canvasR2.listenerCount('mousemove') === 0, 'destroy 移除 mousemove');
ok(canvasR2.listenerCount('touchstart') === 0, 'destroy 移除 touchstart');
ok(tips().length === 0, 'destroy 移除 tooltip');
ok((winListeners.scroll || []).length === 0, 'destroy 移除 window scroll 监听');
guard('T6 destroy-again', function () { Charts.destroy(elR); });
guard('T6 destroy-null', function () { Charts.destroy(null); });
guard('T6 destroy-canvas', function () {
  var e2 = box(200, 120);
  Charts.line(e2, { series: [{ data: [1, 2, 3] }] });
  pump();
  Charts.destroy(canvasOf(e2));
  ok(e2.children.length === 0, '支持传 canvas 做 destroy');
});

/* ---------------------------- T7 canvas 直传 ---------------------------- */
section('T7 el 直接是 canvas');
var hostDiv = box(300, 160);
var canvasHost = new El('canvas', 300, 160);
hostDiv.appendChild(canvasHost);
guard('T7 canvas-el', function () { Charts.line(canvasHost, { labels: ['a', 'b'], series: [{ data: [1, 4] }] }); });
pump();
ok(canvasHost.width === 600, 'canvas 直传也能正确设置 DPR（' + canvasHost.width + '）');
ok(canvasHost.getContext('2d').calls > 0, 'canvas 直传有绘制');
Charts.destroy(canvasHost);

/* ------------------------- T8 动画帧数 / animate:false ------------------------- */
section('T8 动画开关');
var elA = box(300, 180);
rafQueue = [];
cancelled = {};
guard('T8 no-animate', function () {
  Charts.line(elA, { series: [{ data: [1, 2, 3] }], animate: false });
});
ok(rafQueue.length === 0, 'animate:false 不排队 rAF');
ok(canvasOf(elA).getContext('2d').calls > 0, 'animate:false 直接终态绘制');
Charts.destroy(elA);

var elA2 = box(300, 180);
rafQueue = [];
guard('T8 animate', function () {
  Charts.line(elA2, { series: [{ data: [1, 2, 3] }] });
});
var f2 = pump();
ok(f2 > 2, 'animate:true 多帧动画（' + f2 + ' 帧）');
Charts.destroy(elA2);

/* ------------------------------ T9 极端尺寸 ------------------------------ */
section('T9 极端尺寸');
[['1x1', 1, 1], ['3x2', 3, 2], ['2000x600', 2000, 600], ['40x400', 40, 400]].forEach(function (spec) {
  var el = box(spec[1], spec[2]);
  kinds.forEach(function (k) {
    guard('T9 ' + spec[0] + '/' + k, function () {
      Charts[k](el, {
        labels: ['a', 'b', 'c'],
        series: [{ name: 'x', data: [1, 2, 3] }, { name: 'y', data: [3, 2, 1] }],
        centerValue: '99',
        centerLabel: '总数'
      });
    });
    pump();
    var ctx = ctxOf(el);
    if (ctx) {
      ok(ctx.badNumbers.length === 0, 'T9 ' + spec[0] + '/' + k + ' 非法数值: ' + ctx.badNumbers.slice(0, 3).join('|'));
      ok(ctx.saveDepth === 0, 'T9 ' + spec[0] + '/' + k + ' save/restore 不平衡');
    }
    Charts.destroy(el);
  });
});

/* --------------------------------- 汇总 --------------------------------- */
console.log('\n检查项: ' + checks + '，失败: ' + failures.length);
if (failures.length) {
  for (var fi = 0; fi < failures.length; fi++) console.log('  × ' + failures[fi]);
  process.exit(1);
} else {
  console.log('全部通过');
}
