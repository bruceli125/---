'use strict';
/* 临时自检（第二版，用完删除）：stub DOM + 记录型 2D context，验证 charts.js */
var path = require('path');
var CH = path.join(__dirname, 'js', 'charts.js');
var checks = 0, failures = [];
function ok(c, m) { checks++; if (!c) failures.push(m); }
function guard(label, fn) { try { fn(); } catch (e) { failures.push('抛异常 [' + label + ']: ' + e.message); } }

function makeCtx() {
  var c = {
    saveDepth: 0, maxSaveDepth: 0, calls: 0, badNumbers: [], badColors: [], texts: [], textCalls: [],
    strokes: [], font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, lineJoin: '', lineCap: '',
    textAlign: '', textBaseline: '', shadowColor: '', shadowBlur: 0
  };
  function chk() {
    if (typeof c.fillStyle === 'string' && c.fillStyle.indexOf('var(') !== -1) c.badColors.push(c.fillStyle);
    if (typeof c.strokeStyle === 'string' && c.strokeStyle.indexOf('var(') !== -1) c.badColors.push(c.strokeStyle);
  }
  ['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'rect', 'clip',
    'fill', 'stroke', 'fillRect', 'strokeRect', 'translate', 'rotate', 'scale', 'setLineDash',
    'clearRect', 'resetTransform'].forEach(function (name) {
    c[name] = function () {
      c.calls++;
      if (name === 'save') { c.saveDepth++; if (c.saveDepth > c.maxSaveDepth) c.maxSaveDepth = c.saveDepth; }
      else if (name === 'restore') { c.saveDepth--; if (c.saveDepth < 0) c.badNumbers.push('restore 多于 save'); }
      for (var i = 0; i < arguments.length; i++) {
        if (typeof arguments[i] === 'number' && !isFinite(arguments[i])) c.badNumbers.push(name + '(' + i + ')=' + arguments[i]);
      }
      if (name === 'fill' || name === 'stroke') { chk(); if (name === 'stroke') c.strokes.push(c.lineWidth); }
    };
  });
  c.fillText = function (t, x, y) {
    c.calls++;
    if (!isFinite(x) || !isFinite(y)) c.badNumbers.push('fillText 坐标非有限');
    chk();
    var s = String(t);
    if (/NaN|undefined|Infinity/.test(s)) c.badNumbers.push('文本异常: ' + s);
    c.texts.push(s);
    c.textCalls.push({ text: s, font: String(c.font) });
  };
  c.strokeText = c.fillText;
  c.setTransform = function (a) { c.calls++; c.dpr = a; };
  c.measureText = function (t) { c.calls++; return { width: String(t).length * (c.font.indexOf('SF Mono') !== -1 ? 6.2 : 7.4) }; };
  function grad() {
    c.calls++;
    return { addColorStop: function (o, col) { if (!isFinite(o)) c.badNumbers.push('grad off'); if (String(col).indexOf('var(') !== -1) c.badColors.push(col); } };
  }
  c.createLinearGradient = grad;
  return c;
}

function El(tag, w, h) {
  this.tagName = String(tag).toUpperCase(); this.style = {}; this.children = []; this.parentNode = null;
  this.clientWidth = w || 0; this.clientHeight = h || 0; this.width = 0; this.height = 0;
  this.listeners = {}; this.attrs = {}; this._ctx = null; this.className = '';
}
El.prototype.appendChild = function (c) { c.parentNode = this; this.children.push(c); return c; };
El.prototype.removeChild = function (c) { var i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; };
El.prototype.setAttribute = function (k, v) { this.attrs[k] = v; };
El.prototype.addEventListener = function (t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); };
El.prototype.removeEventListener = function (t, f) { var a = this.listeners[t] || []; var i = a.indexOf(f); if (i >= 0) a.splice(i, 1); };
El.prototype.dispatch = function (t, ev) { (this.listeners[t] || []).slice().forEach(function (f) { f(ev || {}); }); };
El.prototype.lcount = function (t) { return (this.listeners[t] || []).length; };
El.prototype.getContext = function () { return this._ctx || (this._ctx = makeCtx()); };
El.prototype.getBoundingClientRect = function () {
  var w = this.clientWidth, h = this.clientHeight;
  if (typeof this.style.width === 'string' && this.style.width.slice(-2) === 'px') { var pw = parseFloat(this.style.width); if (isFinite(pw)) w = pw; }
  if (typeof this.style.height === 'string' && this.style.height.slice(-2) === 'px') { var ph = parseFloat(this.style.height); if (isFinite(ph)) h = ph; }
  return { left: 0, top: 0, width: w, height: h, right: w, bottom: h };
};

var rafQ = [], rafSeq = 0, cancelled = {}, fakeTime = 1000, ros = [], winL = {}, bodyEl, windowStub;

function pingRO(cb) { this.cb = cb; this.targets = []; this.disconnected = false; ros.push(this); }
pingRO.prototype.observe = function (t) { this.targets.push(t); };
pingRO.prototype.unobserve = function () {};
pingRO.prototype.disconnect = function () { this.disconnected = true; };

function pump(limit) {
  var frames = 0;
  while (rafQ.length && frames < (limit || 400)) {
    var q = rafQ; rafQ = []; fakeTime += 16;
    for (var i = 0; i < q.length; i++) {
      if (cancelled[q[i].id]) continue;
      try { q[i].cb(fakeTime); } catch (e) { failures.push('rAF 抛错: ' + e.message); }
    }
    frames++;
  }
  if (rafQ.length) failures.push('动画未收敛');
  return frames;
}
function load() { delete require.cache[require.resolve(CH)]; return require(CH); }

var docc = 0, gcs = 0, rafc = 0;
windowStub = {
  devicePixelRatio: 3, innerWidth: 1440, innerHeight: 900,
  requestAnimationFrame: function (cb) { rafc++; rafQ.push({ id: ++rafSeq, cb: cb }); return rafSeq; },
  cancelAnimationFrame: function (id) { cancelled[id] = true; },
  performance: { now: function () { return fakeTime; } },
  matchMedia: function () { return { matches: false }; },
  addEventListener: function (t, f) { (winL[t] = winL[t] || []).push(f); },
  removeEventListener: function (t, f) { var a = winL[t] || []; var i = a.indexOf(f); if (i >= 0) a.splice(i, 1); },
  ResizeObserver: pingRO,
  getComputedStyle: function () {
    gcs++;
    return {
      position: 'static',
      getPropertyValue: function (n) {
        if (n === '--accent') return '  #5B8CFF  ';
        if (n === '--teal') return '#22D3A6';
        return '';
      }
    };
  }
};
Object.defineProperty(windowStub, 'document', { configurable: true, get: function () { docc++; return undefined; } });
global.window = windowStub;
guard('require', function () { load(); });
ok(docc === 0 && gcs === 0 && rafc === 0, 'require 时访问了浏览器 API（doc=' + docc + ' gcs=' + gcs + ' raf=' + rafc + '）');
var api0 = windowStub.Charts;
ok(!!api0, 'window.Charts 缺失');
ok(Object.keys(api0 || {}).length === 7, 'API 数量 ' + Object.keys(api0 || {}).length);
guard('无 document 调用', function () { api0.line(null, {}); api0.destroy(null); });

bodyEl = new El('body', 1440, 900);
Object.defineProperty(windowStub, 'document', {
  configurable: true, writable: true,
  value: { documentElement: new El('html', 1440, 900), body: bodyEl, createElement: function (t) { return new El(t, 0, 0); } }
});
load();
var Charts = windowStub.Charts;
function box(w, h) { var e = new El('div', w, h); bodyEl.appendChild(e); return e; }
function tips() { return bodyEl.children.filter(function (c) { return c.className === 'chart-tip'; }); }
function audit(label, el) {
  var c = el.children[0];
  if (!c) { failures.push(label + ': 无 canvas'); checks++; return; }
  var x = c.getContext('2d');
  ok(x.badNumbers.length === 0, label + ' 非法数值: ' + x.badNumbers.slice(0, 3).join('|'));
  ok(x.badColors.length === 0, label + ' 未解析颜色: ' + x.badColors.slice(0, 3).join('|'));
  ok(x.saveDepth === 0, label + ' save/restore 不平衡(' + x.saveDepth + ')');
  ok(x.calls > 0, label + ' 无绘制调用');
}

/* ---- 1. line ---- */
var el = box(600, 300);
guard('line', function () {
  Charts.line(el, {
    labels: ['1月', '2月', '3月', '4月', '5月', '6月'],
    series: [{ name: '需求', data: [12, 18, 15, 26, 22, 31], color: 'var(--accent)', type: 'area' },
      { name: '成交', data: [6, 9, 8, 14, 12, 19], color: 'var(--teal)' }],
    valueFormat: function (v) { return v + ' 单'; }, yTicks: 4
  });
});
var f = pump();
var cv = el.children[0];
ok(cv && cv.width === 1200, 'DPR 宽 ' + (cv && cv.width));
ok(cv && cv.height === 600, 'DPR 高');
ok(f >= 3, '动画帧数 ' + f);
var cx = cv.getContext('2d');
ok(cx.dpr === 2, 'setTransform dpr');
ok(cx.textCalls.some(function (t) { return /11px/.test(t.font) && /SF Mono/.test(t.font); }), '刻度等宽 11px');
ok(cx.strokes.indexOf(1.75) !== -1, '折线 1.75');
ok(tips().length === 0, 'tooltip 惰性');
audit('line', el);
cv.dispatch('mousemove', { clientX: 300, clientY: 150 });
pump();
ok(tips().length === 1 && /需求/.test(tips()[0].innerHTML), 'tooltip 系列名');
ok(tips().length === 1 && /单/.test(tips()[0].innerHTML), 'tooltip valueFormat');
ok(tips()[0].style.position === 'fixed' && tips()[0].style.pointerEvents === 'none', 'tooltip 样式');
ok(cx.maxSaveDepth >= 1, 'hover 包裹 save/restore');
cv.dispatch('mouseleave', {});
ok(tips()[0].style.opacity === '0', 'mouseleave 隐藏');
cv.dispatch('touchstart', { touches: [{ clientX: 260, clientY: 120 }] });
pump();
ok(tips()[0].style.opacity === '1', 'touchstart 显示');
cv.dispatch('touchend', {});
Charts.destroy(el);
ok(el.children.length === 0 && tips().length === 0, 'destroy 清理 canvas + tooltip');
pump();

/* ---- 2. 容错矩阵 ---- */
var kinds = ['line', 'bar', 'donut', 'sparkline', 'heatmap', 'funnel'];
var cases = [
  ['empty-cfg', 'EL', {}], ['series-empty', 'EL', { series: [] }],
  ['data-empty', 'EL', { labels: [], series: [{ data: [] }] }],
  ['one-point', 'EL', { labels: ['唯一'], series: [{ name: 'a', data: [5] }] }],
  ['all-equal', 'EL', { labels: ['a', 'b', 'c'], series: [{ name: 'a', data: [7, 7, 7] }] }],
  ['dirty', 'EL', { labels: ['a', 'b', 'c', 'd'], series: [{ data: [1, 'x', null, NaN] }] }],
  ['neg', 'EL', { labels: ['a', 'b', 'c'], series: [{ data: [5, -4, 2] }] }],
  ['locked', 'EL', { series: [{ data: [3, 1, 4] }], min: 0, max: 10, yTicks: 5 }],
  ['minmax-eq', 'EL', { series: [{ data: [3, 1, 4] }], min: 5, max: 5 }],
  ['no-grid', 'EL', { series: [{ data: [3, 1, 4] }], grid: false, yTicks: 0 }],
  ['no-anim', 'EL', { series: [{ data: [3, 1, 4] }], animate: false }],
  ['tiny', 'TINY', { labels: ['a', 'b'], series: [{ data: [3, 1] }] }],
  ['zero', 'ZERO', { series: [{ data: [3, 1] }] }],
  ['var-color', 'EL', { labels: ['a', 'b'], series: [{ data: [3, 1], color: 'var(--teal)' }, { data: [1, 2], color: 'var(--nope)' }] }],
  ['fmt-throw', 'EL', { series: [{ data: [3, 1, 4] }], valueFormat: function () { throw new Error('x'); } }],
  ['stacked', 'EL', { labels: ['a', 'b'], stacked: true, series: [{ name: 'x', data: [3, 1] }, { name: 'y', data: [2, 5] }] }],
  ['combo', 'EL', { labels: ['a', 'b', 'c'], series: [{ name: 'x', data: [3, 1, 4], type: 'bar' }, { name: 'y', data: [1, 2, 3], type: 'area' }] }],
  ['long-labels', 'EL', { labels: ['交押金/押金', '中介费', '培训贷', '扣押证件', '刷单'], series: [{ name: 'hits', data: [32, 18, 11, 7, 5], type: 'bar', color: 'var(--amber)' }] }],
  ['spark-data', 'EL', { data: [1, 4, 2, 8, 6], color: 'var(--danger)' }],
  ['items', 'EL', { items: [{ name: 'p', value: 10 }, { name: 'q', value: 5 }] }],
  ['num-series', 'EL', { series: [1, 2, 3] }]
];
cases.forEach(function (cs) {
  kinds.forEach(function (k) {
    var e = cs[1] === 'E' ? null : (cs[1] === 'EL' ? box(360, 220) : (cs[1] === 'TINY' ? box(40, 30) : box(0, 0)));
    guard('case ' + k + '/' + cs[0], function () { Charts[k](e, cs[2]); });
    pump();
    if (e && e.clientWidth > 0) {
      audit(k + '/' + cs[0], e);
      var c2 = e.children[0];
      [[2, 2], [180, 110], [358, 218], [-3, -3]].forEach(function (pt) {
        guard('hover ' + k, function () { c2.dispatch('mousemove', { clientX: pt[0], clientY: pt[1] }); });
      });
      pump();
      c2.dispatch('mouseleave', {});
      guard('destroy ' + k, function () { Charts.destroy(e); });
      ok(e.children.length === 0, 'destroy 未移除 canvas: ' + k + '/' + cs[0]);
    } else if (e) {
      // 零尺寸容器：不绘制像素，但必须能正常 destroy
      guard('destroy-zero ' + k, function () { Charts.destroy(e); });
      ok(!e.children[0] || e.children[0].width === 0, '零尺寸不应产生像素: ' + k);
    }
  });
});
ok(tips().length === 0, 'tooltip 泄漏: ' + tips().length);

/* ---- 3. 各图断言 ---- */
var ed = box(320, 320);
guard('donut', function () {
  Charts.donut(ed, {
    labels: ['已认证', '审核中', '已拒绝', '未提交'], series: [{ data: [62, 21, 9, 8] }],
    centerValue: '1,284', centerLabel: '教员总数'
  });
});
pump();
var cdx = ed.children[0].getContext('2d');
ok(cdx.texts.indexOf('1,284') !== -1 && cdx.texts.indexOf('教员总数') !== -1, 'donut 中心文案');
ok(cdx.strokes.some(function (w) { return w > 14; }), 'donut 环宽');
ed.children[0].dispatch('mousemove', { clientX: 290, clientY: 160 });
pump();
ok(tips().length === 1 && /%/.test(tips()[0].innerHTML), 'donut tooltip 占比');
Charts.destroy(ed);
pump();

var ef = box(360, 240);   // 真实主程序的窄卡片宽度
guard('funnel', function () {
  Charts.funnel(ef, { items: [{ name: '提交认证', value: 240 }, { name: '学籍通过', value: 218 }, { name: '资质通过', value: 176 }, { name: '能力通过', value: 129 }] });
});
pump();
var cfx = ef.children[0].getContext('2d');
ok(cfx.texts.indexOf('提交认证') !== -1, 'funnel 阶段名');
ok(cfx.texts.indexOf('100%') !== -1, 'funnel 首段 100%');
ok(cfx.texts.some(function (t) { return /%$/.test(t); }), 'funnel 百分比');
ef.children[0].dispatch('mousemove', { clientX: 200, clientY: 40 });
pump();
ok(tips().length === 1 && /提交认证/.test(tips()[0].innerHTML), 'funnel tooltip');
Charts.destroy(ef);
pump();

var eh = box(360, 200);
guard('heatmap', function () {
  Charts.heatmap(eh, {
    rows: [[1, 2, 3], [0, 4, 2]], rowLabels: ['周一', '周二'], labels: ['W1', 'W2', 'W3']
  });
});
pump();
audit('heatmap', eh);
var chx = eh.children[0].getContext('2d');
ok(chx.texts.indexOf('周一') !== -1 && chx.texts.indexOf('W1') !== -1, 'heatmap 行列标签');
Charts.destroy(eh);
pump();

var es = box(84, 30);    // 真实 KPI 迷你图尺寸
guard('spark', function () { Charts.sparkline(es, { data: [42, 51, 47, 62, 58, 71, 69, 78], color: 'var(--danger)' }); });
pump();
var csx = es.children[0].getContext('2d');
ok(csx.texts.length === 0, 'sparkline 无文字');
ok(csx.strokeStyle === '' || String(csx.strokeStyle).indexOf('255,107,107') !== -1 || String(csx.strokeStyle).indexOf('FF6B6B') !== -1 || String(csx.strokeStyle).indexOf('rgba(255,107,107') !== -1 || String(csx.strokeStyle).indexOf('rgb(255,107,107') !== -1, 'sparkline 顶置 color 生效: ' + csx.strokeStyle);
audit('sparkline', es);
Charts.destroy(es);

/* ---- 4. bar 类目标签不抽稀 ---- */
var eb = box(350, 200);
guard('bar labels', function () {
  Charts.bar(eb, {
    labels: ['交押金/押金', '中介费', '培训贷', '扣押证件', '刷单'],
    series: [{ name: '命中次数', data: [32, 18, 11, 7, 5], color: 'var(--amber)', type: 'bar' }]
  });
});
pump();
var cbx = eb.children[0].getContext('2d');
var shown = ['交押金/押金', '中介费', '培训贷', '扣押证件', '刷单'].filter(function (L) {
  return cbx.texts.some(function (t) { return t.indexOf(L.slice(0, 2)) === 0; });
});
ok(shown.length === 5, 'bar 每个类目都有标签（实际 ' + shown.length + '/5: ' + shown.join(',') + '）');
audit('bar', eb);
Charts.destroy(eb);
pump();

/* ---- 5. 重复 init / resize / window scroll 清理 ---- */
var er = box(500, 260);
guard('init1', function () { Charts.line(er, { labels: ['a', 'b'], series: [{ data: [1, 4] }] }); });
pump();
er.children[0].dispatch('mousemove', { clientX: 120, clientY: 100 });
pump();
ok(tips().length === 1, 'hover 建 tooltip');
var roBefore = ros.length;
guard('reinit', function () { Charts.bar(er, { labels: ['a', 'b'], series: [{ data: [3, 5] }] }); });
pump();
ok(er.children.length === 1, '重复 init 只留 1 个 canvas');
ok(tips().length === 0, '重复 init 清 tooltip');
ok(ros[ros.length - 2].disconnected === true, '旧 RO 断开');
ok(er.children[0].lcount('mousemove') === 1, '监听未重复绑定');
var ro = ros[ros.length - 1];
guard('resize0', function () { er.clientWidth = 0; er.clientHeight = 0; ro.cb(); });
guard('resize+', function () { er.clientWidth = 720; er.clientHeight = 340; ro.cb(); });
pump();
ok(er.children[0].width === 1440, 'resize 重绘');
Charts.destroy(er);
ok(ro.disconnected === true && er.children.length === 0, 'destroy 清理');
ok(er.children[0] ? false : true, 'canvas 已移除');
ok((winL.scroll || []).length === 0, 'window scroll 监听已移除');
pump();

/* ---- 6. canvas 直传 ---- */
var hd = box(300, 160);
var direct = new El('canvas', 300, 160);
hd.appendChild(direct);
guard('canvas-el', function () { Charts.line(direct, { labels: ['a', 'b'], series: [{ data: [1, 4] }] }); });
pump();
ok(direct.width === 600, 'canvas 直传 DPR');
Charts.destroy(direct);

/* ---- 7. 极端尺寸 ---- */
[['1x1', 1, 1], ['3x2', 3, 2], ['2000x600', 2000, 600], ['40x400', 40, 400]].forEach(function (s) {
  var e = box(s[1], s[2]);
  kinds.forEach(function (k) {
    guard('尺寸 ' + s[0] + '/' + k, function () {
      Charts[k](e, { labels: ['a', 'b', 'c'], series: [{ name: 'x', data: [1, 2, 3] }, { name: 'y', data: [3, 2, 1] }], centerValue: '99', centerLabel: '总' });
    });
    pump();
    var x = e.children[0] && e.children[0].getContext('2d');
    if (x) {
      ok(x.badNumbers.length === 0, s[0] + '/' + k + ' 非法数值: ' + x.badNumbers.slice(0, 3).join('|'));
      ok(x.saveDepth === 0, s[0] + '/' + k + ' save 不平衡');
    }
    Charts.destroy(e);
  });
});

console.log('检查项: ' + checks + '，失败: ' + failures.length);
if (failures.length) { failures.forEach(function (m) { console.log('  × ' + m); }); process.exit(1); }
console.log('全部通过');
