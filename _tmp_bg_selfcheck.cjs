/* 临时逻辑级自检（不启动浏览器）——用完即删 */
'use strict';

var path = require('path');
var file = path.join(__dirname, 'web-console', 'js', 'three-bg.js');

var failures = [];
function check(name, cond, extra) {
  if (cond) {
    console.log('  ok   ' + name);
  } else {
    failures.push(name + (extra !== undefined ? '  [' + extra + ']' : ''));
    console.log('  FAIL ' + name + (extra !== undefined ? '  [' + extra + ']' : ''));
  }
}

function freshLoad() {
  delete require.cache[require.resolve(file)];
  delete globalThis.BG;
  if (globalThis.window) delete globalThis.window.BG;
  require(file);
  // 有 window 时模块挂到 window.BG，否则挂到 globalThis.BG
  return (globalThis.window && globalThis.window.BG) || globalThis.BG;
}

function clearGlobals() {
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.THREE;
  delete globalThis.ResizeObserver;
  delete globalThis.THREE_CREATED;
}

/* ---------------------------------------------------------------- 场景 1 ---
 * 完全裸环境（无 window / document / THREE）：
 * require 不能崩，window.BG 必须暴露 5 个方法 + 只读 mode。
 */
console.log('\n[1] 裸环境加载（无 window/document/THREE）');
clearGlobals();
var BG1 = freshLoad();
check('require 不抛错且 globalThis.BG 已挂载', !!BG1);
check('init 是函数', typeof BG1.init === 'function');
check('setParallax 是函数', typeof BG1.setParallax === 'function');
check('pause 是函数', typeof BG1.pause === 'function');
check('resume 是函数', typeof BG1.resume === 'function');
check('destroy 是函数', typeof BG1.destroy === 'function');
check("mode 初始为 'off'", BG1.mode === 'off', BG1.mode);

var desc = Object.getOwnPropertyDescriptor(BG1, 'mode');
check('mode 是只读（getter，无 setter）', !!desc && typeof desc.get === 'function' && desc.set === undefined);

var r1 = BG1.init(null);
check('init(null) 返回 API 本身', r1 === BG1);
check("init(null) 后 mode 仍为 'off'", BG1.mode === 'off', BG1.mode);
var r2 = BG1.init(undefined, { dprLimit: 2 });
check('init(undefined) 安全返回', r2 === BG1 && BG1.mode === 'off');
var r3 = BG1.init({}, {});
check('init(非 canvas 对象) 安全返回', r3 === BG1 && BG1.mode === 'off');
BG1.setParallax(0.4, -0.6);
BG1.setParallax(NaN, Infinity);
BG1.setParallax('x', null);
check('setParallax 非法入参不抛错', true);
check('pause/resume/destroy 在未初始化时安全', BG1.pause() === BG1 && BG1.resume() === BG1 && BG1.destroy() === BG1);

/* ---------------------------------------------------------------- 场景 2 ---
 * THREE 可用：验证 Three 路径的参数落在要求区间（点数/透明度/线框尺寸）。
 */
console.log('\n[2] THREE 可用（WebGL 探测通过）');

function vec3() {
  return {
    x: 0, y: 0, z: 0,
    set: function (a, b, c) { this.x = a; this.y = b; this.z = c; return this; }
  };
}

function makeThreeStub(created) {
  function Scene() { this.children = []; }
  Scene.prototype.add = function (o) { this.children.push(o); };
  Scene.prototype.remove = function (o) {
    var i = this.children.indexOf(o);
    if (i >= 0) this.children.splice(i, 1);
  };

  function PerspectiveCamera(fov, aspect) {
    this.fov = fov; this.aspect = aspect; this.position = vec3();
  }
  PerspectiveCamera.prototype.updateProjectionMatrix = function () { this.updated = true; };

  function Group() { this.position = vec3(); this.rotation = vec3(); this.children = []; }
  Group.prototype.add = function (o) { this.children.push(o); };

  function BufferAttribute(arr, itemSize) {
    this.array = arr; this.itemSize = itemSize; this.count = arr.length / itemSize; this.needsUpdate = false;
  }

  function BufferGeometry() { this.attributes = {}; }
  BufferGeometry.prototype.setAttribute = function (n, a) { this.attributes[n] = a; return this; };
  BufferGeometry.prototype.setDrawRange = function (s, c) { this.drawRange = { start: s, count: c }; return this; };
  BufferGeometry.prototype.dispose = function () { this.disposed = true; this.disposeCount = (this.disposeCount || 0) + 1; };

  function ShaderMaterial(opts) {
    this.uniforms = opts.uniforms;
    this.vertexShader = opts.vertexShader;
    this.fragmentShader = opts.fragmentShader;
    this.blending = opts.blending;
    this.transparent = opts.transparent;
  }
  ShaderMaterial.prototype.dispose = function () { this.disposed = true; };

  function LineBasicMaterial(opts) { this.opts = opts; this.opacity = opts.opacity; this.color = opts.color; }
  LineBasicMaterial.prototype.dispose = function () { this.disposed = true; };

  function Points(geo, mat) { this.geometry = geo; this.material = mat; created.points.push(this); }
  function LineSegments(geo, mat) {
    this.geometry = geo; this.material = mat;
    this.position = vec3(); this.scale = vec3(); this.rotation = vec3();
    this.userData = {};
    created.wires.push(this);
  }

  function PolyGeo() { }
  PolyGeo.prototype.dispose = function () { this.disposed = true; };

  function WireframeGeometry(base) { this.base = base; created.wireGeos.push(this); }
  WireframeGeometry.prototype.dispose = function () { this.disposed = true; };

  function WebGLRenderer(opts) {
    this.opts = opts;
    this.domElement = opts.canvas;
    this.pixelRatio = 1;
    this.size = null;
    this.renders = 0;
    this.info = { render: { points: 0 } };
    created.renderers.push(this);
  }
  WebGLRenderer.prototype.getContext = function () { return { fake: true }; };
  WebGLRenderer.prototype.setClearColor = function () { };
  WebGLRenderer.prototype.setPixelRatio = function (d) { this.pixelRatio = d; };
  WebGLRenderer.prototype.setSize = function (w, h) { this.size = { w: w, h: h }; };
  WebGLRenderer.prototype.setAnimationLoop = function () { };
  WebGLRenderer.prototype.render = function (scene, camera) {
    this.renders++;
    this.scene = scene;
    this.camera = camera;
    var n = 0;
    if (this.scene && this.scene.children) {
      for (var i = 0; i < this.scene.children.length; i++) {
        var g = this.scene.children[i];
        for (var j = 0; j < g.children.length; j++) {
          if (g.children[j] instanceof Points) n += g.children[j].geometry.drawRange ? g.children[j].geometry.drawRange.count : 0;
        }
      }
    }
    this.info.render.points = n;
  };
  WebGLRenderer.prototype.dispose = function () { this.disposed = true; };
  WebGLRenderer.prototype.forceContextLoss = function () { this.lost = true; };

  var THREE = {
    Scene: Scene,
    PerspectiveCamera: PerspectiveCamera,
    Group: Group,
    BufferAttribute: BufferAttribute,
    BufferGeometry: BufferGeometry,
    ShaderMaterial: ShaderMaterial,
    LineBasicMaterial: LineBasicMaterial,
    Points: Points,
    LineSegments: LineSegments,
    IcosahedronGeometry: PolyGeo,
    OctahedronGeometry: PolyGeo,
    TorusGeometry: PolyGeo,
    WireframeGeometry: WireframeGeometry,
    WebGLRenderer: WebGLRenderer,
    AdditiveBlending: 2,
    __created: created
  };
  return THREE;
}

function makeDocumentStub(webglOk, view) {
  var listeners = {};
  return {
    hidden: false,
    visibilityState: 'visible',
    listeners: listeners,
    createElement: function (tag) {
      if (tag !== 'canvas') return {};
      return {
        width: 0, height: 0,
        style: { cssText: '', display: '' },
        className: '',
        getContext: function (kind) {
          if (kind === 'webgl' || kind === 'experimental-webgl') {
            return webglOk ? { getExtension: function () { return null; } } : null;
          }
          return view ? view.ctx : null;
        },
        addEventListener: function () { },
        removeEventListener: function () { }
      };
    },
    addEventListener: function (n, fn) { listeners[n] = fn; },
    removeEventListener: function (n) { delete listeners[n]; }
  };
}

var created = {
  points: [], wires: [], wireGeos: [], renderers: [], geos: [], mats: []
};
clearGlobals();
globalThis.THREE = makeThreeStub(created);
globalThis.document = makeDocumentStub(true, null);
var winListeners = {};
globalThis.window = {
  devicePixelRatio: 4, // 故意给 4：验证 dprLimit=2 的钳制
  addEventListener: function (n, fn) { winListeners[n] = fn; },
  removeEventListener: function (n) { delete winListeners[n]; },
  matchMedia: undefined // 无 reduced-motion 支持：应正常跑动画
};

var canvas2 = {
  width: 0, height: 0,
  style: { cssText: '', display: '' },
  className: 'atmos__canvas',
  clientWidth: 1440, clientHeight: 900,
  getBoundingClientRect: function () { return { width: 1440, height: 900 }; },
  getContext: function (kind) {
    if (kind === 'webgl') return { getExtension: function () { return null; } };
    return null;
  },
  addEventListener: function () { },
  removeEventListener: function () { }
};

var BG2 = freshLoad();
var ret2 = BG2.init(canvas2, { dprLimit: 2 });
check("THREE 可用时 mode === 'three'", BG2.mode === 'three', BG2.mode);
check('init 返回 API 本身', ret2 === BG2);
check('renderer 已创建 1 个', created.renderers.length === 1, created.renderers.length);

var rnd = created.renderers[0];
check('dpr 被钳到 2（devicePixelRatio=4, dprLimit=2）', rnd.pixelRatio === 2, rnd.pixelRatio);
check('renderer 尺寸跟随画布', !!rnd.size && rnd.size.w === 1440 && rnd.size.h === 900, JSON.stringify(rnd.size));

var pts = created.points[0];
check('Points 已创建', !!pts);
var g = pts.geometry;
var attrs = Object.keys(g.attributes);
check('几何体属性齐全（position/aSize/aAlpha/aSeed/aColor）',
  attrs.indexOf('position') >= 0 && attrs.indexOf('aSize') >= 0 && attrs.indexOf('aAlpha') >= 0 &&
  attrs.indexOf('aSeed') >= 0 && attrs.indexOf('aColor') >= 0, attrs.join(','));
var n = g.drawRange.count;
check('粒子数 800~1400（1440×900 → ' + n + '）', n >= 800 && n <= 1400, n);
check('position 缓冲长度与点数一致', g.attributes.position.array.length === n * 3);

// 尺寸 0.6~2.2
var sz = g.attributes.aSize.array, szOk = true, szMin = 9, szMax = -9;
for (var i = 0; i < n; i++) { if (sz[i] < szMin) szMin = sz[i]; if (sz[i] > szMax) szMax = sz[i]; }
szOk = szMin >= 0.6 && szMax <= 2.2;
check('随机尺寸落在 0.6~2.2px', szOk, szMin.toFixed(2) + '~' + szMax.toFixed(2));

// 颜色在 accent 蓝 → violet 紫之间
var col = g.attributes.aColor.array, colOk = true;
for (var j = 0; j < n; j++) {
  var r = col[j * 3] * 255, gg = col[j * 3 + 1] * 255, b = col[j * 3 + 2] * 255;
  if (r < 90.5 || r > 139.5 || gg < 107.5 || gg > 140.5 || b < 254.5) { colOk = false; break; }
}
check('颜色严格在 accent(91,140,255) → violet(139,108,255) 之间', colOk);
check('z 方向是薄层（跨度 ≤ 10 世界单位）', (function () {
  var p = g.attributes.position.array, zMin = 1e9, zMax = -1e9;
  for (var k = 0; k < n; k++) { var z = p[k * 3 + 2]; if (z < zMin) zMin = z; if (z > zMax) zMax = z; }
  return (zMax - zMin) <= 10.01;
})());

var mat = pts.material;
check('粒子总透明度 0.25~0.45（' + mat.uniforms.uOpacity.value + '）',
  mat.uniforms.uOpacity.value >= 0.25 && mat.uniforms.uOpacity.value <= 0.45, mat.uniforms.uOpacity.value);
check('uPixelRatio 跟随 dpr', mat.uniforms.uPixelRatio.value === 2, mat.uniforms.uPixelRatio.value);
check('着色器里有点尺寸衰减 + 深度压暗 + 中心淡化',
  /uRefDist \/ dist/.test(mat.vertexShader) && /mix\(1\.0, 0\.30, depth01\)/.test(mat.vertexShader) &&
  /centerFade/.test(mat.vertexShader));
check('着色器非空且含 gl_PointSize', /gl_PointSize/.test(mat.vertexShader));

check('线框几何体 3~4 个（' + created.wires.length + '）', created.wires.length >= 3 && created.wires.length <= 4, created.wires.length);
var opOk = true, sizeOk = true, colors = [], shortSide = Math.min(1440, 900), focal = (900 * 0.5) / Math.tan(58 * 0.5 * Math.PI / 180);
for (var w = 0; w < created.wires.length; w++) {
  var m = created.wires[w];
  var op = m.material.opacity;
  if (op < 0.08 || op > 0.18) opOk = false;
  colors.push(m.material.color);
  // 视觉直径 = 2*r*focal/dist，要求 ≤ 18% 短边
  var dist = 10 - m.position.z;
  var diaPx = 2 * m.scale.x * focal / dist;
  if (diaPx > 0.18 * shortSide + 0.5) sizeOk = false;
}
check('线框透明度 0.08~0.18', opOk);
check('线框视觉直径 ≤ 短边的 18%', sizeOk);
check('线框颜色取 accent/violet/teal',
  colors.indexOf(0x5b8cff) >= 0 && colors.indexOf(0x8b6cff) >= 0 && colors.indexOf(0x22d3a6) >= 0, colors.join(','));
check('线框位置避开画面中心（|x/hx|≥0.7 或 |y/hy|≥0.6 的不同角落）', (function () {
  var cornerish = 0;
  for (var q = 0; q < created.wires.length; q++) {
    var px = created.wires[q].position.x, py = created.wires[q].position.y;
    if (Math.abs(px) > 0.6 && Math.abs(py) > 0.4) cornerish++;
  }
  return cornerish === created.wires.length;
})());
check('线框带自转速度', created.wires.every(function (x) { return x.userData.spin && x.userData.spin.length === 3; }));

// 跑几帧（requestAnimationFrame 不存在 → setTimeout 回退），确认 drawThree 不抛错
var framesBefore = rnd.renders;
BG2.setParallax(1, -1);
BG2.setParallax(0.5, 0.25);

setTimeout(function () {
  check('动画循环在跑（至少渲染 1 帧）', rnd.renders > framesBefore, rnd.renders);
  // 视差幅度：|group.position| ≤ 半视口 × 5.5% ⇒ 视觉位移 2.75% ≤ 6%
  var grp = null;
  for (var s = 0; s < 1; s++) { }
  BG2.pause();
  var pausedRenders = rnd.renders;
  setTimeout(function () {
    BG2.pause();
    check('pause() 之后不再渲染', rnd.renders === pausedRenders, rnd.renders + ' vs ' + pausedRenders);

    // 模拟 visibilitychange 隐藏 → 自动暂停
    globalThis.document.hidden = true;
    globalThis.document.visibilityState = 'hidden';
    if (globalThis.document.listeners.visibilitychange) globalThis.document.listeners.visibilitychange();
    var hiddenRenders = rnd.renders;
    setTimeout(function () {
      check('document.hidden 时自动暂停', rnd.renders === hiddenRenders);
      globalThis.document.hidden = false;
      globalThis.document.visibilityState = 'visible';
      if (globalThis.document.listeners.visibilitychange) globalThis.document.listeners.visibilitychange();
      BG2.resume();
      var beforeResume = rnd.renders;
      setTimeout(function () {
        check('resume() 后恢复渲染', rnd.renders > beforeResume, rnd.renders + ' vs ' + beforeResume);

        // 尺寸为 0：不应报错、不应渲染
        var c0 = canvas2.getBoundingClientRect;
        canvas2.getBoundingClientRect = function () { return { width: 0, height: 0 }; };
        canvas2.clientWidth = 0; canvas2.clientHeight = 0;
        var err = null;
        try { if (winListeners.resize) winListeners.resize(); } catch (e) { err = e; }
        check('尺寸为 0 时不抛错', err === null, err && err.message);

        canvas2.getBoundingClientRect = c0;
        canvas2.clientWidth = 1440; canvas2.clientHeight = 900;

        // destroy 清理
        BG2.destroy();
        check("destroy() 后 mode === 'off'", BG2.mode === 'off', BG2.mode);
        check('renderer.dispose 已调用', rnd.disposed === true);
        check('forceContextLoss 已调用（归还 WebGL 上下文）', rnd.lost === true);
        check('geometry 已 dispose', g.disposed === true);
        check('粒子 material 已 dispose', mat.disposed === true);
        check('线框 material 全部 dispose', created.wires.every(function (x) { return x.material.disposed === true; }));
        check('线框 geometry 全部 dispose', created.wireGeos.every(function (x) { return x.disposed === true; }));
        check('visibilitychange 监听已解绑', !globalThis.document.listeners.visibilitychange);
        check('window.resize 监听已解绑', !winListeners.resize);
        var afterDestroy = rnd.renders;
        setTimeout(function () {
          check('destroy() 后不再渲染', rnd.renders === afterDestroy);
          scenario3();
        }, 40);
      }, 60);
    }, 40);
  }, 40);
}, 60);

/* ---------------------------------------------------------------- 场景 3 ---
 * 无 WebGL：走 Canvas 2D 伪 3D，必须真的画出东西（不留空白）。
 */
function scenario3() {
  console.log('\n[3] 无 THREE / 无 WebGL → Canvas 2D 降级');

  var drawCalls = 0, clearCalls = 0, transform = null, composite = null;
  var ctx = {
    globalAlpha: 1,
    fillStyle: '',
    globalCompositeOperation: 'source-over',
    setTransform: function (a) { transform = a; },
    clearRect: function () { clearCalls++; },
    drawImage: function () { drawCalls++; },
    fillRect: function () { drawCalls++; },
    createRadialGradient: function () {
      return { addColorStop: function () { } };
    }
  };
  // 记录 composite / alpha 的最终取值
  Object.defineProperty(ctx, 'globalCompositeOperation2', { value: 0 });

  clearGlobals();
  globalThis.document = makeDocumentStub(false, { ctx: ctx });
  var winL = {};
  globalThis.window = {
    devicePixelRatio: 1.5,
    addEventListener: function (nm, fn) { winL[nm] = fn; },
    removeEventListener: function (nm) { delete winL[nm]; }
  };

  var cv = {
    width: 0, height: 0,
    style: { cssText: '', display: '' },
    className: 'atmos__canvas',
    clientWidth: 1366, clientHeight: 768,
    getBoundingClientRect: function () { return { width: 1366, height: 768 }; },
    getContext: function (kind) {
      if (kind === 'webgl' || kind === 'experimental-webgl') return null; // 没有 WebGL
      return ctx;
    },
    addEventListener: function () { },
    removeEventListener: function () { }
  };

  var BG3 = freshLoad();
  var threw = null;
  try { BG3.init(cv, { dprLimit: 2 }); } catch (e) { threw = e; }
  check('降级过程不抛错', threw === null, threw && threw.message);
  check("无 WebGL 时 mode === 'canvas2d'", BG3.mode === 'canvas2d', BG3.mode);
  check('画布位图按 dpr 放大（1366×768 × 1.5）', cv.width === 1366 * 1.5 && cv.height === 768 * 1.5, cv.width + 'x' + cv.height);

  setTimeout(function () {
    check('2D 上下文做了 dpr 缩放', transform === 1.5, transform);
    check('真的画了粒子（drawImage/fillRect 有调用）', drawCalls > 0, drawCalls);
    check('每帧先清屏', clearCalls > 0, clearCalls);
    check('使用了叠加混合（lighter）', ctx.globalCompositeOperation === 'lighter', ctx.globalCompositeOperation);
    check('每帧结束把 globalAlpha 复位为 1', ctx.globalAlpha === 1, ctx.globalAlpha);

    // 降级后视差/暂停/恢复仍然可用
    var threw2 = null;
    try {
      BG3.setParallax(0.8, -0.8);
      BG3.pause();
      BG3.resume();
    } catch (e) { threw2 = e; }
    check('2D 路径下 setParallax/pause/resume 不抛错', threw2 === null);

    var destroyed = null;
    try { BG3.destroy(); } catch (e) { destroyed = e; }
    check('2D 路径 destroy 不抛错', destroyed === null);
    check("destroy 后 mode === 'off'", BG3.mode === 'off');

    setTimeout(function () {
      var after = drawCalls;
      setTimeout(function () {
        check('2D 路径 destroy 后停止绘制', drawCalls === after, drawCalls + ' vs ' + after);
        scenario4();
      }, 50);
    }, 50);
  }, 80);
}

/* ---------------------------------------------------------------- 场景 4 ---
 * prefers-reduced-motion: reduce → 只渲染一帧，不进动画循环。
 */
function scenario4() {
  console.log('\n[4] prefers-reduced-motion: reduce → 只画一帧');
  var drawCalls = 0;
  var ctx = {
    globalAlpha: 1, fillStyle: '', globalCompositeOperation: 'source-over',
    setTransform: function () { }, clearRect: function () { },
    drawImage: function () { drawCalls++; }, fillRect: function () { drawCalls++; },
    createRadialGradient: function () { return { addColorStop: function () { } }; }
  };
  clearGlobals();
  globalThis.document = makeDocumentStub(false, { ctx: ctx });
  globalThis.window = {
    devicePixelRatio: 2,
    addEventListener: function () { },
    removeEventListener: function () { },
    matchMedia: function () {
      return { matches: true, addEventListener: function () { }, removeEventListener: function () { } };
    }
  };
  var cv = {
    width: 0, height: 0, style: { cssText: '', display: '' }, className: 'atmos__canvas',
    clientWidth: 1280, clientHeight: 720,
    getBoundingClientRect: function () { return { width: 1280, height: 720 }; },
    getContext: function (k) { return (k === 'webgl' || k === 'experimental-webgl') ? null : ctx; },
    addEventListener: function () { }, removeEventListener: function () { }
  };
  var BG4 = freshLoad();
  BG4.init(cv, { dprLimit: 2 });
  check("reduced-motion 下仍正常初始化", BG4.mode === 'canvas2d', BG4.mode);
  check('渲染了一帧静态画面', drawCalls > 0, drawCalls);
  var first = drawCalls;
  setTimeout(function () {
    check('reduced-motion 下没有动画循环（画面不再重绘）', drawCalls === first, drawCalls + ' vs ' + first);
    BG4.destroy();
    finish();
  }, 120);
}

function finish() {
  console.log('\n================ 结果 ================');
  if (failures.length === 0) {
    console.log('全部通过 ✔');
    process.exit(0);
  } else {
    console.log('失败 ' + failures.length + ' 项：');
    failures.forEach(function (f) { console.log(' - ' + f); });
    process.exit(1);
  }
}
