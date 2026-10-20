/* ============================================================================
 * 京师家教 · 运营控制台 —— 3D 氛围背景层
 * ----------------------------------------------------------------------------
 * 职责：只负责"沉在内容下面"的那一层纵深（粒子星尘 + 线框几何体）。
 *       它不参与任何信息表达，所以亮度、对比度、动态幅度全部压到最低。
 *
 * 对外唯一入口（全部挂在 window.BG，其余都收在 IIFE 里）：
 *   window.BG.init(canvasEl, opts)   opts: { dprLimit: 2 }   返回 API 本身
 *   window.BG.setParallax(nx, ny)    nx/ny ∈ [-1, 1]，阻尼跟随
 *   window.BG.pause() / resume()
 *   window.BG.destroy()              解绑监听 + 释放 geometry/material/renderer
 *   window.BG.mode                   只读：'three' | 'canvas2d' | 'off'
 *
 * 两条渲染路径：
 *   1) Three.js（全局 THREE，r128）：Points 自定义着色器 + LineSegments 线框
 *   2) Canvas 2D 伪 3D：同一套粒子数据，自己算投影（focal / 相机距离），
 *      观感（最近的更大更亮、中心更淡）与 Three 路径保持一致
 *   降级全程静默：不抛错、不 console.error、不留空白画布。
 *
 * 性能约定：devicePixelRatio 上限 2；页面隐藏自动 pause；ResizeObserver 处理尺寸；
 *           尺寸为 0 时直接跳过渲染；prefers-reduced-motion 时只画一帧静态图。
 *
 * 兼容约定：ES5 语法（无 let/const/箭头函数/模板字符串/可选链），
 *           文件被 require 时不访问任何浏览器 API（只在 init 被调用后才用）。
 * ========================================================================== */
(function () {
  'use strict';

  /* ==========================================================================
   * 一、常量：颜色与强度
   * 颜色严格取自 css/tokens.css，改这里必须同步改 tokens，否则会和页面失配。
   * ======================================================================== */

  // --accent / --violet / --teal
  var HEX_ACCENT = 0x5b8cff;
  var HEX_VIOLET = 0x8b6cff;
  var HEX_TEAL = 0x22d3a6;
  var RGB_ACCENT = [91, 140, 255];
  var RGB_VIOLET = [139, 108, 255];

  var TAU = Math.PI * 2;

  // ---- 相机 ----
  // 视场角偏窄（58°）：点阵看起来更"平"，避免广角带来的鱼眼式夸张纵深，
  // 这是"高级感"和"炫技"的分界线。
  var FOV = 58;
  var CAM_Z = 10; // 相机在 z 轴上的位置：粒子槽位于 z ∈ [-8.5, 1.5]

  // ---- 粒子规模 ----
  // 800~1400 个点按屏幕面积自适应；1200px²/点 是实测"看得见颗粒感但不吵"的密度。
  // 1080p → 1400（封顶），1440×900 → 1080，1366×768 → 875，手机 → 800（保底）。
  var PARTICLE_MIN = 800;
  var PARTICLE_MAX = 1400;
  var AREA_PER_POINT = 1200;

  // 粒子/线框统一的总不透明度：取要求区间 0.25~0.45 的上沿 0.44。
  // 为什么是上沿：再叠加 base.css 里 .atmos__canvas 的 opacity 0.85、.atmos__vignette 渐晕
  // 以及"内容区中心淡化"，真正落到屏幕上的有效亮度只剩 ~0.15 左右 —— 这已经是
  // "看得见星尘但绝不抢文字"的临界点，再低就变成一片死黑了。
  var BASE_OPACITY = 0.44;

  // 点的视觉尺寸增益：随机尺寸仍是 0.6~2.2px（要求值），但 1px 以下的点会被抗锯齿
  // 和渐晕吃掉，所以整体再乘 1.3，并给一个 0.85px 的下限。
  var SIZE_GAIN = 2.0;
  var SIZE_MIN_PX = 0.85;

  // 线框透明度 0.08~0.18（同样的道理：只做轮廓暗示，不做实体）
  var WIRE_OPACITY_MIN = 0.08;

  // ---- 视差 ----
  // 位移 = 半视口 × 5.5% ⇒ 视觉位移 = 视口宽度的 2.75%，安全落在"≤6%"的要求内。
  // 之所以不取满 6%：背景是配角，位移一大就会变成"跟着鼠标晃的玩具"。
  var PARALLAX_RATIO = 0.055;
  var PARALLAX_DAMP = 2.6; // 阻尼常数（1/s）：约 0.38s 收敛，肉眼是"缓慢跟过去"

  // ---- 深度范围（同时供 shader 与 2D 投影使用，保证两条路径观感一致）----
  var Z_FRONT = 1.5;
  var Z_BACK = -8.5;
  var NEAR_D = CAM_Z - Z_FRONT; // 8.5
  var FAR_D = CAM_Z - Z_BACK; // 18.5

  var MAX_DPR = 2;
  var SPRITE_PX = 24; // 2D 软圆点精灵尺寸
  var SPRITE_STEPS = 10; // accent→violet 的调色级数（逐帧按级取图，避免每帧拼 rgba 字符串）

  /* ==========================================================================
   * 二、线框几何体的"布景单"
   * 位置用视口半宽/半高的比例表示（|x|≥0.7、|y|≥0.6），保证永远待在四角边缘，
   * 不会压到中间的内容区；z 为负值表示往远处推，越远越暗。
   * ======================================================================== */
  var WIRE_SPECS = [
    {
      kind: 'ico',
      color: HEX_ACCENT,
      opacity: 0.14,
      x: -0.82,
      y: 0.66,
      z: -2.5,
      scale: 0.85,
      rx: 0.5,
      ry: 0.2,
      rz: 0.1,
      spin: [0.052, 0.036, 0.0]
    },
    {
      kind: 'octa',
      color: HEX_VIOLET,
      opacity: 0.12,
      x: 0.86,
      y: -0.6,
      z: -4.0,
      scale: 0.72,
      rx: 0.15,
      ry: 0.6,
      rz: 0.35,
      spin: [0.038, -0.044, 0.02]
    },
    {
      kind: 'torus',
      color: HEX_TEAL,
      opacity: 0.1,
      x: -0.72,
      y: -0.78,
      z: -5.5,
      scale: 0.62,
      rx: 0.85,
      ry: 0.15,
      rz: 0.0,
      spin: [0.03, 0.026, 0.014]
    },
    {
      kind: 'ico',
      color: HEX_VIOLET,
      opacity: WIRE_OPACITY_MIN + 0.02,
      x: 0.78,
      y: 0.8,
      z: -7.0,
      scale: 0.5,
      rx: 0.25,
      ry: 0.4,
      rz: 0.6,
      spin: [-0.042, 0.03, 0.0]
    }
  ];

  /* ==========================================================================
   * 三、着色器（Three 路径）
   * 用 ShaderMaterial 而不是 PointsMaterial 的原因：要求"每个点尺寸随机 + 近大远小 +
   * 近亮远暗 + 中心淡化"，PointsMaterial 只有一个统一 size，做不到。
   * 顶点着色器里一次算完，CPU 每帧零开销。
   * ======================================================================== */

  var PARTICLE_VS = [
    'attribute float aSize;',
    'attribute float aAlpha;',
    'attribute vec3 aColor;',
    'attribute vec3 aSeed;',
    '',
    'uniform float uTime;',
    'uniform float uPixelRatio;',
    'uniform float uRefDist;',
    '',
    'varying vec3 vColor;',
    'varying float vAlpha;',
    '',
    'void main() {',
    '  vec3 p = position;',
    '  // 缓慢飘移 + 轻微浮动：三个轴不同频率的正弦叠加，幅度都 < 1 世界单位',
    '  // （视口宽约 20 世界单位），所以是"呼吸式"微动而不是粒子飞行 —— 不抢注意力。',
    '  p.x += sin(uTime * 0.075 + aSeed.x * 6.2831853) * (0.34 + aSeed.y * 0.52);',
    '  p.y += sin(uTime * 0.104 + aSeed.z * 6.2831853) * (0.16 + aSeed.x * 0.26);',
    '  p.z += sin(uTime * 0.055 + aSeed.y * 6.2831853) * 0.30;',
    '',
    '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
    '  float dist = max(-mv.z, 0.001);',
    '',
    '  // 近大远小：以相机距离做正确的透视反比衰减',
    '  // （乘 SIZE_GAIN 后随机尺寸 0.6~2.2 的观感仍在 1~3px 量级，不会变成大点）',
    '  float px = aSize * 1.3 * (uRefDist / dist);',
    '  gl_PointSize = clamp(px * uPixelRatio, 0.85 * uPixelRatio, 5.0 * uPixelRatio);',
    '',
    '  // 近亮远暗：远处压到 60% 亮度（压太狠远景会整片溶进颗粒噪声里）',
    '  float depth01 = clamp((dist - uRefDist * 0.55) / (uRefDist * 1.15), 0.0, 1.0);',
    '  float depthAlpha = mix(1.0, 0.60, depth01);',
    '',
    '  // 内容区中心淡化：横轴乘 0.66 把衰减做成"竖椭圆"，',
    '  // 于是画面中栏（阅读区）最暗、四周最亮 —— 背景永远不和文字抢对比度。',
    '  // 下限 0.70：中心仍保留七成亮度，否则中间会出现一块明显的"空洞"。',
    '  vec4 clip = projectionMatrix * mv;',
    '  gl_Position = clip;',
    '  vec2 ndc = clip.xy / max(clip.w, 0.0001);',
    '  float rN = length(ndc * vec2(0.66, 1.0));',
    '  float centerFade = mix(0.70, 1.0, smoothstep(0.16, 0.92, rN));',
    '',
    '  vAlpha = aAlpha * depthAlpha * centerFade;',
    '  vColor = aColor;',
    '}'
  ].join('\n');

  var PARTICLE_FS = [
    'uniform float uOpacity;',
    '',
    'varying vec3 vColor;',
    'varying float vAlpha;',
    '',
    'void main() {',
    '  vec2 d = gl_PointCoord - vec2(0.5);',
    '  float r = length(d);',
    '  if (r > 0.5) discard;',
    '  // 软边：1px 的小点也不会出现硬像素噪点，天然避开"高亮闪烁"',
    '  float soft = smoothstep(0.5, 0.10, r);',
    '  gl_FragColor = vec4(vColor, vAlpha * soft * uOpacity);',
    '}'
  ].join('\n');

  /* ==========================================================================
   * 四、状态
   * 所有可变状态集中在一个对象里，destroy() 时整体清空，避免任何泄漏。
   * ======================================================================== */
  function makeState() {
    return {
      mode: 'off',
      canvas: null,
      ctx: null,
      T: null, // 捕获的 THREE 引用

      renderer: null,
      scene: null,
      camera: null,
      group: null,
      points: null,
      geo: null,
      mat: null,
      wires: null,

      field: null, // 粒子数据（Float32Array 组）
      sprites: null, // Canvas 2D 用的软圆点精灵

      w: 0,
      h: 0,
      dpr: 1,
      dprLimit: MAX_DPR,
      sizeReady: false,
      focal: 1,
      hx: 1,
      hy: 1,

      rafId: 0,
      lastTs: 0,
      time: 0,

      paused: false,
      hidden: false,
      destroyed: true,
      reduced: false,
      contextLost: false,
      errCount: 0,
      verified: false, // 首次渲染自检是否已做

      parTX: 0,
      parTY: 0,
      parX: 0,
      parY: 0,

      ro: null,
      mql: null,
      mqlListener: null,
      onVis: null,
      onWinResize: null,
      onCtxLost: null,
      onCtxRestored: null,

      swapped: false,
      replacement: null,
      hiddenCanvas: null
    };
  }

  var state = makeState();
  var hasModeGetter = false;

  /* ==========================================================================
   * 五、小工具（纯函数，不碰浏览器 API 的居多）
   * ======================================================================== */

  function clampNum(v, min, max, fallback) {
    var n = Number(v);
    if (!isFinite(n)) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  function smoothstep(a, b, x) {
    var t = (x - a) / (b - a);
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    return t * t * (3 - 2 * t);
  }

  // 与帧率无关的指数阻尼：不同刷新率下收敛速度一致（120Hz 屏不会"更快"）
  function damp(cur, target, dt) {
    var k = 1 - Math.exp(-Math.min(dt, 0.1) * PARALLAX_DAMP);
    return cur + (target - cur) * k;
  }

  function nowMs() {
    try {
      if (typeof performance !== 'undefined' && performance.now) return performance.now();
    } catch (e) {
      /* 忽略 */
    }
    return Date.now();
  }

  function raf(fn) {
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(fn);
    return setTimeout(function () {
      fn(nowMs());
    }, 16);
  }

  function cancelRaf(id) {
    if (!id) return;
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
    else clearTimeout(id);
  }

  function mixed(rgbA, rgbB, t) {
    return [
      Math.round(rgbA[0] + (rgbB[0] - rgbA[0]) * t),
      Math.round(rgbA[1] + (rgbB[1] - rgbA[1]) * t),
      Math.round(rgbA[2] + (rgbB[2] - rgbA[2]) * t)
    ];
  }

  // 全局对象解析：优先 window，其次 self，最后 globalThis。
  // 全程 sizeof 检查，文件被 require 时不会因为 window 未定义而崩。
  function getGlobalScope() {
    try {
      if (typeof window !== 'undefined' && window) return window;
      if (typeof self !== 'undefined' && self) return self;
      if (typeof globalThis !== 'undefined' && globalThis) return globalThis;
    } catch (e) {
      /* 忽略 */
    }
    return null;
  }

  function safeThree() {
    try {
      if (typeof THREE === 'undefined' || !THREE) return null;
      return THREE;
    } catch (e) {
      return null;
    }
  }

  /* ==========================================================================
   * 六、尺寸 / 像素比
   * ======================================================================== */

  function resolveDpr() {
    var d = 1;
    try {
      if (typeof window !== 'undefined' && window.devicePixelRatio) d = window.devicePixelRatio;
    } catch (e) {
      /* 忽略 */
    }
    if (!isFinite(d) || d <= 0) d = 1;
    if (d > state.dprLimit) d = state.dprLimit; // 上限 2：4K 屏也不去烧 GPU 顶点带宽
    if (d < 1) d = 1;
    return Math.round(d * 100) / 100;
  }

  function measure(el) {
    var w = 0;
    var h = 0;
    try {
      if (el && el.getBoundingClientRect) {
        var r = el.getBoundingClientRect();
        w = r.width || 0;
        h = r.height || 0;
      }
    } catch (e) {
      /* 忽略 */
    }
    if (!w || !h) {
      try {
        w = el.clientWidth || w;
        h = el.clientHeight || h;
      } catch (e2) {
        /* 忽略 */
      }
    }
    if (!w || !h) {
      try {
        var p = el && el.parentNode;
        if (p) {
          w = p.clientWidth || w;
          h = p.clientHeight || h;
        }
      } catch (e3) {
        /* 忽略 */
      }
    }
    return { w: w || 0, h: h || 0 };
  }

  // 由屏幕像素尺寸反推世界尺寸：相机在 z=CAM_Z、视角 FOV
  function computeFrustum(w, h) {
    var tanH = Math.tan(FOV * 0.5 * Math.PI / 180);
    var safeH = h > 0 ? h : 1;
    var safeW = w > 0 ? w : 1;
    state.focal = (safeH * 0.5) / tanH; // 距离 1 处 1 世界单位对应多少像素
    state.hy = CAM_Z * tanH; // 距离 CAM_Z 处的半个可见高度
    state.hx = state.hy * (safeW / safeH); // 半个可见宽度
  }

  function applySize(w, h, force) {
    if (!(w > 0) || !(h > 0)) {
      // 尺寸为 0（display:none / 尚未布局）：不报错，只标记未就绪，等 ResizeObserver 唤醒
      state.sizeReady = false;
      return false;
    }
    var dpr = resolveDpr();
    var changed = force || w !== state.w || h !== state.h || dpr !== state.dpr;
    state.w = w;
    state.h = h;
    state.dpr = dpr;
    state.sizeReady = true;
    computeFrustum(w, h);

    if (state.mode === 'three' && state.renderer) {
      try {
        state.renderer.setPixelRatio(dpr);
        state.renderer.setSize(w, h, false); // false：不改 style，尺寸完全交给 CSS
        if (state.camera) {
          state.camera.aspect = w / h;
          state.camera.updateProjectionMatrix();
        }
        if (state.mat && state.mat.uniforms && state.mat.uniforms.uPixelRatio) {
          state.mat.uniforms.uPixelRatio.value = dpr;
        }
      } catch (e) {
        /* 忽略：单帧异常不影响主流程 */
      }
    } else if (state.mode === 'canvas2d' && state.canvas) {
      try {
        state.canvas.width = Math.max(1, Math.round(w * dpr));
        state.canvas.height = Math.max(1, Math.round(h * dpr));
      } catch (e2) {
        /* 忽略 */
      }
    }
    return changed;
  }

  /* ==========================================================================
   * 七、粒子数据（两条渲染路径共用同一套分布，保证降级后观感不"塌"）
   * ======================================================================== */

  function countFor(w, h) {
    var n = Math.round(((w > 0 ? w : 1) * (h > 0 ? h : 1)) / AREA_PER_POINT);
    if (n < PARTICLE_MIN) n = PARTICLE_MIN;
    if (n > PARTICLE_MAX) n = PARTICLE_MAX;
    return n;
  }

  function ensureBuffers(count) {
    var f = state.field;
    if (f && f.count === count) return false; // 复用：新尺寸下只改数值，不重建 GPU 缓冲
    state.field = {
      count: count,
      pos: new Float32Array(count * 3),
      size: new Float32Array(count),
      alpha: new Float32Array(count),
      tint: new Float32Array(count),
      seed: new Float32Array(count * 3),
      color: new Float32Array(count * 3)
    };
    return true;
  }

  function writeField(f, count, hx, hy) {
    var pos = f.pos;
    var size = f.size;
    var alpha = f.alpha;
    var tint = f.tint;
    var seed = f.seed;
    var color = f.color;
    var i, i3, u, v, z, d, t, tt, k;

    for (i = 0; i < count; i++) {
      i3 = i * 3;

      // 在"屏幕空间"均匀采样：±1.16 让边缘略微溢出视口，
      // 这样视差平移或漂移时四条边不会露出空白。
      u = (Math.random() * 2 - 1) * 1.16;
      v = (Math.random() * 2 - 1) * 1.16;

      // 薄层：z 方向只跨 10 个世界单位（≈半个视口宽），比 xy 平坦得多。
      // 这样既有近大远小的纵深，又不会出现"穿过镜头飞出来"的强运动视差。
      z = Z_BACK + Math.random() * (Z_FRONT - Z_BACK);
      d = CAM_Z - z;

      // 按深度等比放大世界坐标 → 投影回屏幕后依然是均匀分布（不会近处稀、远处密）
      pos[i3] = u * hx * (d / CAM_Z);
      pos[i3 + 1] = v * hy * (d / CAM_Z);
      pos[i3 + 2] = z;

      // 基础尺寸 0.6~2.2（参考深度处的 CSS px），实际像素还要乘上 focal/dist 衰减
      size[i] = 0.6 + Math.random() * 1.6;

      // 亮度本身也做分层（0.75~1.0），否则整片点看起来像均匀噪点，缺少"星等"层次。
      // 下限不能太低：base.css 的颗粒纹理本身噪声约 ±8，星等太暗会被噪声直接吃掉。
      alpha[i] = 0.75 + Math.random() * 0.25;

      // 颜色比例做平方偏置：多数点偏 accent 蓝，少数偏 violet 紫，
      // 6:4 的蓝紫比 5:5 更"科技蓝"，也更不容易看出生硬的渐变带。
      t = Math.random();
      tt = t * t;
      tint[i] = tt;

      seed[i3] = Math.random();
      seed[i3 + 1] = Math.random();
      seed[i3 + 2] = Math.random();

      k = 1 / 255;
      color[i3] = (RGB_ACCENT[0] + (RGB_VIOLET[0] - RGB_ACCENT[0]) * tt) * k;
      color[i3 + 1] = (RGB_ACCENT[1] + (RGB_VIOLET[1] - RGB_ACCENT[1]) * tt) * k;
      color[i3 + 2] = (RGB_ACCENT[2] + (RGB_VIOLET[2] - RGB_ACCENT[2]) * tt) * k;
    }
  }

  /* ==========================================================================
   * 八、Three 路径
   * ======================================================================== */

  function makeGeometry(f, count) {
    var T = state.T;
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(f.pos, 3));
    g.setAttribute('aSize', new T.BufferAttribute(f.size, 1));
    g.setAttribute('aAlpha', new T.BufferAttribute(f.alpha, 1));
    g.setAttribute('aSeed', new T.BufferAttribute(f.seed, 3));
    g.setAttribute('aColor', new T.BufferAttribute(f.color, 3));
    g.setDrawRange(0, count);
    return g;
  }

  function markGeometryDirty() {
    var g = state.geo;
    if (!g || !g.attributes) return;
    var names = ['position', 'aSize', 'aAlpha', 'aSeed', 'aColor'];
    for (var i = 0; i < names.length; i++) {
      if (g.attributes[names[i]]) g.attributes[names[i]].needsUpdate = true;
    }
  }

  function makeParticleMaterial(T) {
    return new T.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: BASE_OPACITY },
        uPixelRatio: { value: state.dpr || 1 },
        uRefDist: { value: CAM_Z }
      },
      vertexShader: PARTICLE_VS,
      fragmentShader: PARTICLE_FS,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: T.AdditiveBlending // 叠加：暗底上只在重叠处微微提亮，不会形成硬边色块
    });
  }

  function buildWireGeometry(T, kind) {
    var base = null;
    try {
      if (kind === 'ico') base = new T.IcosahedronGeometry(1, 0);
      else if (kind === 'octa') base = new T.OctahedronGeometry(1, 0);
      else if (kind === 'torus') base = new T.TorusGeometry(0.82, 0.16, 8, 22);
      else base = new T.IcosahedronGeometry(1, 0);
      var g = new T.WireframeGeometry(base);
      base.dispose();
      return g;
    } catch (e) {
      if (base && base.dispose) {
        try {
          base.dispose();
        } catch (e2) {
          /* 忽略 */
        }
      }
      return null;
    }
  }

  // 线框尺寸上限：视觉直径 ≤ 屏幕短边的 18%。
  // 换算成"该深度下的世界半径"后就与分辨率无关了，大屏也不会变成巨型几何体。
  function layoutWires() {
    var wires = state.wires;
    if (!wires || !state.focal || !state.w || !state.h) return;
    var shortSide = Math.min(state.w, state.h);
    for (var i = 0; i < wires.length; i++) {
      var m = wires[i];
      var spec = m.userData && m.userData.spec;
      if (!spec) continue;
      var dist = CAM_Z - spec.z;
      var maxR = 0.09 * shortSide * dist / state.focal; // 2r*focal/dist ≤ 0.18*shortSide
      var radius = maxR * spec.scale;
      m.position.set(spec.x * state.hx, spec.y * state.hy, spec.z);
      m.scale.set(radius, radius, radius);
    }
  }

  function buildWires() {
    var T = state.T;
    var group = state.group;
    if (!T || !group) return;
    var wires = [];
    for (var i = 0; i < WIRE_SPECS.length; i++) {
      var spec = WIRE_SPECS[i];
      var geo = buildWireGeometry(T, spec.kind);
      if (!geo) continue;
      var mat = new T.LineBasicMaterial({
        color: spec.color,
        transparent: true,
        opacity: spec.opacity,
        depthTest: false, // 关深度：线框自交时呈 X 光效果，比被自身遮挡好看
        depthWrite: false,
        blending: T.AdditiveBlending
      });
      var mesh = new T.LineSegments(geo, mat);
      mesh.rotation.set(spec.rx, spec.ry, spec.rz);
      mesh.frustumCulled = false;
      mesh.userData.spec = spec;
      mesh.userData.spin = spec.spin;
      group.add(mesh);
      wires.push(mesh);
    }
    state.wires = wires;
    layoutWires();
  }

  function rebuildThree() {
    if (state.mode !== 'three' || !state.points || !state.T) return;
    var count = countFor(state.w || 1, state.h || 1);
    var fresh = ensureBuffers(count);
    writeField(state.field, count, state.hx, state.hy);

    if (fresh || !state.geo) {
      if (state.geo) {
        try {
          state.geo.dispose();
        } catch (e) {
          /* 忽略 */
        }
      }
      state.geo = makeGeometry(state.field, count);
      state.points.geometry = state.geo;
    } else {
      markGeometryDirty();
    }
    layoutWires();
  }

  function setupThree() {
    var T = state.T;
    var renderer = null;
    try {
      renderer = new T.WebGLRenderer({
        canvas: state.canvas,
        alpha: true, // 透明底，让下层的渐变网格透出来
        antialias: false, // 点阵用不到 MSAA，关掉省带宽
        depth: false,
        stencil: false,
        powerPreference: 'low-power'
      });
    } catch (e) {
      return false;
    }

    try {
      var gl = renderer.getContext ? renderer.getContext() : null;
      if (!gl) {
        try {
          renderer.dispose();
        } catch (e2) {
          /* 忽略 */
        }
        return false;
      }

      // 先把 renderer 交给 state：之后任何一步抛错，disposeThreeObjects() 都能兜住，
      // 不会漏掉一个已创建的 WebGL 上下文（浏览器配额只有十几个，漏一个就少一个）
      state.renderer = renderer;

      renderer.setClearColor(0x000000, 0); // 完全透明清屏

      var scene = new T.Scene();
      var camera = new T.PerspectiveCamera(FOV, (state.w || 1) / (state.h || 1), 0.1, 200);
      camera.position.set(0, 0, CAM_Z);

      var group = new T.Group();
      scene.add(group);

      var mat = makeParticleMaterial(T);
      var points = new T.Points(new T.BufferGeometry(), mat);
      // 相机位于粒子场内部，关掉剔除，避免整批点被误判到视锥外而"凭空消失"
      points.frustumCulled = false;
      group.add(points);

      state.scene = scene;
      state.camera = camera;
      state.group = group;
      state.points = points;
      state.mat = mat;
      // 占位几何体也登记进来，随后 rebuildThree() 会把它 dispose 掉换成真正的点云
      state.geo = points.geometry;

      // 上下文丢失（切显卡、系统休眠）时安静暂停，恢复后自动续上
      state.onCtxLost = function (ev) {
        try {
          if (ev && ev.preventDefault) ev.preventDefault();
        } catch (e3) {
          /* 忽略 */
        }
        state.contextLost = true;
        stopLoop();
      };
      state.onCtxRestored = function () {
        state.contextLost = false;
        startLoop();
      };
      try {
        state.canvas.addEventListener('webglcontextlost', state.onCtxLost, false);
        state.canvas.addEventListener('webglcontextrestored', state.onCtxRestored, false);
      } catch (e4) {
        /* 忽略 */
      }

      return true;
    } catch (err) {
      disposeThreeObjects();
      return false;
    }
  }

  function disposeThreeObjects() {
    var i;
    if (state.wires) {
      for (i = 0; i < state.wires.length; i++) {
        try {
          if (state.wires[i].geometry) state.wires[i].geometry.dispose();
          if (state.wires[i].material) state.wires[i].material.dispose();
        } catch (e) {
          /* 忽略 */
        }
      }
    }
    state.wires = null;

    try {
      if (state.geo) state.geo.dispose();
    } catch (e2) {
      /* 忽略 */
    }
    try {
      if (state.mat) state.mat.dispose();
    } catch (e3) {
      /* 忽略 */
    }
    state.geo = null;
    state.mat = null;
    state.points = null;

    try {
      if (state.canvas && state.onCtxLost) {
        state.canvas.removeEventListener('webglcontextlost', state.onCtxLost, false);
      }
      if (state.canvas && state.onCtxRestored) {
        state.canvas.removeEventListener('webglcontextrestored', state.onCtxRestored, false);
      }
    } catch (e4) {
      /* 忽略 */
    }
    state.onCtxLost = null;
    state.onCtxRestored = null;

    try {
      if (state.scene && state.group) state.scene.remove(state.group);
    } catch (e5) {
      /* 忽略 */
    }
    state.group = null;
    state.scene = null;
    state.camera = null;

    var r = state.renderer;
    state.renderer = null;
    if (r) {
      try {
        if (r.setAnimationLoop) r.setAnimationLoop(null);
      } catch (e6) {
        /* 忽略 */
      }
      try {
        r.dispose();
      } catch (e7) {
        /* 忽略 */
      }
      try {
        // 主动放弃上下文，把浏览器的 WebGL 上下文配额还回去（Chrome 上限约 16 个）
        if (r.forceContextLoss) r.forceContextLoss();
      } catch (e8) {
        /* 忽略 */
      }
      try {
        r.domElement = null;
      } catch (e9) {
        /* 忽略 */
      }
    }
  }

  function drawThree(dt, t) {
    var s = state;
    if (!s.renderer || !s.scene || !s.camera) return;

    s.parX = damp(s.parX, s.parTX, dt);
    s.parY = damp(s.parY, s.parTY, dt);

    if (s.group) {
      // 位移 = 半视口 × 5.5%：近处点位移更多、远处更少，天然产生层间视差
      s.group.position.x = s.parX * PARALLAX_RATIO * s.hx;
      s.group.position.y = s.parY * PARALLAX_RATIO * s.hy;
      // 再叠一点点极小的旋转，纯平移会显得"纸片"，几度的转动就有体积感了
      s.group.rotation.y = s.parX * 0.035;
      s.group.rotation.x = -s.parY * 0.028;
    }

    if (s.mat && s.mat.uniforms && s.mat.uniforms.uTime) s.mat.uniforms.uTime.value = t;

    if (s.wires) {
      for (var i = 0; i < s.wires.length; i++) {
        var m = s.wires[i];
        var sp = m.userData && m.userData.spin;
        if (!sp) continue;
        m.rotation.x += sp[0] * dt;
        m.rotation.y += sp[1] * dt;
        m.rotation.z += sp[2] * dt;
      }
    }

    try {
      s.renderer.render(s.scene, s.camera);
    } catch (e) {
      return;
    }

    // 首帧自检：着色器/程序若因驱动原因没跑起来（three 只会在控制台打警告，不抛错），
    // 这里能看到"本帧一个点都没画出来"，于是静默切到 Canvas 2D，绝不接受空白画布。
    if (!s.verified) {
      s.verified = true;
      try {
        var info = s.renderer.info;
        if (info && info.render && info.render.points === 0) demoteToCanvas2D();
      } catch (e2) {
        /* 忽略 */
      }
    }
  }

  /* ==========================================================================
   * 九、Canvas 2D 伪 3D 路径
   * 投影公式与 Three 完全同构：k = focal / (CAM_Z - z)。
   * 所以两条路径下"点的大小、亮度、密度、视差"几乎一样，降级不会露馅。
   * ======================================================================== */

  function makeSprites() {
    var list = [];
    var flats = [];
    for (var i = 0; i < SPRITE_STEPS; i++) {
      var t = i / (SPRITE_STEPS - 1);
      var rgb = mixed(RGB_ACCENT, RGB_VIOLET, t);
      var css = rgb[0] + ',' + rgb[1] + ',' + rgb[2];
      flats.push('rgba(' + css + ',1)');

      var cv = null;
      try {
        cv = document.createElement('canvas');
        cv.width = SPRITE_PX;
        cv.height = SPRITE_PX;
        var c2 = cv.getContext('2d');
        if (!c2) cv = null;
        else {
          // 预渲染软圆点：逐帧 drawImage 一张小图，比 1200 次 arc+fill 便宜得多。
          // 光斑必须"实心偏多、只在边缘虚化"：太虚的渐变在缩到 1px 时平均下来几乎透明，
          // 整条 2D 路径就会看起来像没画东西。
          var half = SPRITE_PX * 0.5;
          var g = c2.createRadialGradient(half, half, 0, half, half, half);
          g.addColorStop(0, 'rgba(' + css + ',1)');
          g.addColorStop(0.52, 'rgba(' + css + ',0.9)');
          g.addColorStop(0.8, 'rgba(' + css + ',0.32)');
          g.addColorStop(1, 'rgba(' + css + ',0)');
          c2.fillStyle = g;
          c2.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
        }
      } catch (e) {
        cv = null;
      }
      list.push(cv);
    }
    return { list: list, flats: flats };
  }

  function rebuildTwo() {
    if (state.mode !== 'canvas2d') return;
    var count = countFor(state.w || 1, state.h || 1);
    ensureBuffers(count);
    writeField(state.field, count, state.hx, state.hy);
  }

  function drawTwo(dt, t) {
    var s = state;
    var ctx = s.ctx;
    var f = s.field;
    var spr = s.sprites;
    if (!ctx || !f || !spr || !s.sizeReady) return;

    s.parX = damp(s.parX, s.parTX, dt);
    s.parY = damp(s.parY, s.parTY, dt);

    var w = s.w;
    var h = s.h;
    var dpr = s.dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // 叠加混合：暗底上只在重叠处微弱提亮，不会出现整片高亮色块
    ctx.globalCompositeOperation = 'lighter';

    var focal = s.focal;
    var cx = w * 0.5;
    var cy = h * 0.5;
    // 视差：先在世界坐标层平移再统一投影 → 近处位移大、远处位移小
    var ox = s.parX * PARALLAX_RATIO * s.hx;
    var oy = s.parY * PARALLAX_RATIO * s.hy;

    var pos = f.pos;
    var size = f.size;
    var alpha = f.alpha;
    var tint = f.tint;
    var seed = f.seed;
    var n = f.count;
    var sprites = spr.list;
    var flats = spr.flats;
    var steps = SPRITE_STEPS - 1;

    for (var i = 0; i < n; i++) {
      var i3 = i * 3;

      // 与顶点着色器同构的漂移公式（同一频率、同一幅度）
      var x = pos[i3] + Math.sin(t * 0.075 + seed[i3] * TAU) * (0.34 + seed[i3 + 1] * 0.52) + ox;
      var y = pos[i3 + 1] + Math.sin(t * 0.104 + seed[i3 + 2] * TAU) * (0.16 + seed[i3] * 0.26) + oy;
      var z = pos[i3 + 2] + Math.sin(t * 0.055 + seed[i3 + 1] * TAU) * 0.3;

      var d = CAM_Z - z; // 8.5 ~ 18.5
      var k = focal / d;
      var sx = cx + x * k;
      var sy = cy - y * k;

      if (sx < -12 || sx > w + 12 || sy < -12 || sy > h + 12) continue; // 出屏跳过

      // 近亮远暗
      var depth01 = (d - NEAR_D) / (FAR_D - NEAR_D);
      if (depth01 < 0) depth01 = 0;
      else if (depth01 > 1) depth01 = 1;
      var a = alpha[i] * (1 - 0.4 * depth01);

      // 内容区中心淡化（竖椭圆，与 shader 的 centerFade 一致：0.70 ~ 1.0）
      var nx = (sx - cx) / cx;
      var ny = (sy - cy) / cy;
      var rn = Math.sqrt(nx * 0.66 * (nx * 0.66) + ny * ny);
      a *= (0.7 + 0.3 * smoothstep(0.16, 0.92, rn)) * BASE_OPACITY;

      if (a < 0.012) continue; // 肉眼不可见，省掉一次绘制

      var ss = size[i] * SIZE_GAIN * (CAM_Z / d);
      if (ss < SIZE_MIN_PX) ss = SIZE_MIN_PX; // 亚像素精灵会被吃掉，给个下限

      var si = Math.round(tint[i] * steps);
      if (si < 0) si = 0;
      else if (si > steps) si = steps;

      ctx.globalAlpha = a > 1 ? 1 : a;
      if (sprites[si]) {
        ctx.drawImage(sprites[si], sx - ss * 0.5, sy - ss * 0.5, ss, ss);
      } else {
        ctx.fillStyle = flats[si];
        ctx.fillRect(sx - 0.5, sy - 0.5, 1, 1);
      }
    }

    ctx.globalAlpha = 1;
  }

  /* ==========================================================================
   * 十、画布兜底：该 canvas 已被 WebGL 占用时（getContext('2d') 返回 null），
   *     换一个同款兄弟节点继续渲染，保证"降级不留空白"。
   * ======================================================================== */
  function get2DContext() {
    var cv = state.canvas;
    if (!cv) return null;
    var ctx = null;
    try {
      ctx = cv.getContext('2d');
    } catch (e) {
      ctx = null;
    }
    if (ctx) return ctx;

    try {
      var fresh = document.createElement('canvas');
      fresh.className = cv.className || '';
      fresh.style.cssText = cv.style.cssText || '';
      if (cv.parentNode) cv.parentNode.insertBefore(fresh, cv.nextSibling);
      cv.style.display = 'none';
      state.hiddenCanvas = cv;
      state.canvas = fresh;
      state.replacement = fresh;
      state.swapped = true;
      ctx = fresh.getContext('2d');
    } catch (e2) {
      ctx = null;
    }
    return ctx;
  }

  function setupTwo() {
    var ctx = get2DContext();
    if (!ctx) return false;
    state.ctx = ctx;
    state.sprites = makeSprites();
    return true;
  }

  function demoteToCanvas2D() {
    disposeThreeObjects();
    if (!setupTwo()) {
      state.mode = 'off';
      syncMode();
      stopLoop();
      return;
    }
    state.mode = 'canvas2d';
    syncMode();
    applySize(state.w, state.h, true);
    rebuildTwo();
    if (state.reduced) drawStatic();
    else startLoop();
  }

  // WebGL 可用性探测：用一次性 canvas，并立刻归还上下文配额。
  // 先探测的好处是：纯无 WebGL 的环境里，目标 canvas 不会被"失败的 getContext"污染。
  function webglAvailable() {
    try {
      if (typeof document === 'undefined' || !document.createElement) return false;
      var cv = document.createElement('canvas');
      var gl = cv.getContext('webgl') || cv.getContext('experimental-webgl');
      if (!gl) return false;
      var lose = gl.getExtension('WEBGL_lose_context');
      if (lose && lose.loseContext) lose.loseContext();
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ==========================================================================
   * 十一、主循环
   * ======================================================================== */

  function drawFrame(dt, t) {
    if (!state.sizeReady || !state.w || !state.h) return; // 尺寸为 0：直接跳过渲染
    if (state.contextLost) return;
    if (state.mode === 'three') drawThree(dt, t);
    else if (state.mode === 'canvas2d') drawTwo(dt, t);
  }

  function drawStatic() {
    try {
      drawFrame(0, state.time);
    } catch (e) {
      /* 静态帧失败也不冒泡 */
    }
  }

  function loop(ts) {
    state.rafId = 0;
    if (state.destroyed || state.paused || state.hidden || state.mode === 'off') return;

    var t = typeof ts === 'number' ? ts : nowMs();
    var dt = state.lastTs ? (t - state.lastTs) / 1000 : 1 / 60;
    if (!(dt > 0)) dt = 1 / 60;
    if (dt > 0.1) dt = 0.1; // 切页回来时 dt 会很大，钳住避免视差/自转"跳一下"
    state.lastTs = t;
    state.time += dt;

    try {
      drawFrame(dt, state.time);
      state.errCount = 0;
    } catch (e) {
      // 任何单帧异常都在这里吞掉，绝不冒泡到主程序
      state.errCount++;
      if (state.errCount > 3) {
        stopLoop();
        return;
      }
    }

    if (state.paused || state.hidden || state.destroyed || state.reduced) return;
    state.rafId = raf(loop);
  }

  function startLoop() {
    if (state.rafId || state.destroyed) return;
    if (state.paused || state.hidden || state.reduced || state.contextLost) return;
    if (state.mode === 'off') return;
    state.lastTs = 0;
    state.rafId = raf(loop);
  }

  function stopLoop() {
    if (state.rafId) {
      cancelRaf(state.rafId);
      state.rafId = 0;
    }
    state.lastTs = 0;
  }

  function rebuild() {
    if (state.mode === 'three') rebuildThree();
    else if (state.mode === 'canvas2d') rebuildTwo();
  }

  /* ==========================================================================
   * 十二、事件
   * ======================================================================== */

  function handleResize() {
    if (state.destroyed || !state.canvas) return;
    var m = measure(state.canvas);
    if (!m.w || !m.h) {
      // 尺寸为 0（容器被折叠/隐藏）：不渲染、不报错，等下一次尺寸变化
      state.sizeReady = false;
      return;
    }
    applySize(m.w, m.h, false);
    rebuild();
    if (state.reduced || state.paused || state.hidden || state.mode === 'off') {
      drawStatic(); // 没有动画循环时也把这一帧画出来，避免暂停/降级态出现空白
    } else {
      startLoop();
    }
  }

  function bindEvents() {
    // 1. 可见性：切到后台自动停 rAF（省电、省 GPU），回来再续上
    state.onVis = function () {
      var hidden = false;
      try {
        hidden = !!document.hidden || document.visibilityState === 'hidden';
      } catch (e) {
        hidden = false;
      }
      state.hidden = hidden;
      if (hidden) stopLoop();
      else startLoop();
    };
    try {
      document.addEventListener('visibilitychange', state.onVis, false);
    } catch (e2) {
      state.onVis = null;
    }

    // 2. 尺寸：优先 ResizeObserver，老环境退回 window.resize
    state.onROResize = handleResize;
    try {
      if (typeof ResizeObserver !== 'undefined' && state.canvas) {
        state.ro = new ResizeObserver(handleResize);
        state.ro.observe(state.canvas);
      } else if (typeof window !== 'undefined' && window.addEventListener) {
        state.onWinResize = handleResize;
        window.addEventListener('resize', state.onWinResize, false);
      }
    } catch (e3) {
      /* 忽略 */
    }

    // 3. 减少动态效果：命中时只保留一帧静态画面（不跑 rAF），
    //    并且跟随系统设置的实时切换。
    try {
      if (typeof window !== 'undefined' && window.matchMedia) {
        var mql = window.matchMedia('(prefers-reduced-motion: reduce)');
        state.mql = mql;
        state.reduced = !!(mql && mql.matches);
        state.mqlListener = function (ev) {
          state.reduced = !!(ev && ev.matches);
          if (state.reduced) {
            stopLoop();
            drawStatic();
          } else {
            startLoop();
          }
        };
        if (mql && mql.addEventListener) mql.addEventListener('change', state.mqlListener);
        else if (mql && mql.addListener) mql.addListener(state.mqlListener);
      }
    } catch (e4) {
      /* 忽略 */
    }
  }

  function unbindEvents() {
    try {
      if (state.onVis && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', state.onVis, false);
      }
    } catch (e) {
      /* 忽略 */
    }
    state.onVis = null;

    try {
      if (state.ro) state.ro.disconnect();
    } catch (e2) {
      /* 忽略 */
    }
    state.ro = null;

    try {
      if (state.onWinResize && typeof window !== 'undefined') {
        window.removeEventListener('resize', state.onWinResize, false);
      }
    } catch (e3) {
      /* 忽略 */
    }
    state.onWinResize = null;

    try {
      if (state.mql && state.mqlListener) {
        if (state.mql.removeEventListener) state.mql.removeEventListener('change', state.mqlListener);
        else if (state.mql.removeListener) state.mql.removeListener(state.mqlListener);
      }
    } catch (e4) {
      /* 忽略 */
    }
    state.mql = null;
    state.mqlListener = null;
  }

  /* ==========================================================================
   * 十三、对外 API
   * ======================================================================== */

  function syncMode() {
    // 极端环境（不支持 defineProperty）下用普通属性兜底，保持 mode 与内部一致
    if (!hasModeGetter) {
      try {
        BG.mode = state.mode;
      } catch (e) {
        /* 忽略 */
      }
    }
  }

  function init(canvasEl, opts) {
    // 重复 init：先把上一份彻底收干净，避免两套 rAF 叠在一起跑
    if (state.mode !== 'off' || state.rafId || state.renderer) destroy();
    state = makeState();
    state.destroyed = false;

    // 画布为 null / 不是 canvas：安全返回，不抛错，mode 保持 'off'
    if (!canvasEl || typeof canvasEl.getContext !== 'function') {
      state.destroyed = true;
      state.mode = 'off';
      syncMode();
      return BG;
    }

    state.canvas = canvasEl;

    var o = opts || {};
    state.dprLimit = clampNum(o.dprLimit, 1, 3, MAX_DPR); // 默认且推荐 2

    // 先用可能的尺寸算一遍视锥（尺寸为 0 时退化成 1×1，只是不渲染）
    var m = measure(canvasEl);
    state.w = m.w > 0 ? m.w : 0;
    state.h = m.h > 0 ? m.h : 0;
    state.sizeReady = state.w > 0 && state.h > 0;
    state.dpr = resolveDpr();
    computeFrustum(state.w, state.h);

    // ---- 优先 Three ----
    var okThree = false;
    try {
      var T = safeThree(); // window.THREE 不存在时返回 null，全程静默
      if (T && T.WebGLRenderer && T.Scene && webglAvailable()) {
        state.T = T;
        okThree = setupThree();
      }
    } catch (e) {
      okThree = false;
      disposeThreeObjects();
    }

    if (okThree) {
      state.mode = 'three';
      syncMode();
      applySize(state.w, state.h, true);
      rebuildThree();
      buildWires();
    } else {
      // ---- 降级：纯 Canvas 2D 粒子场 ----
      state.T = null;
      disposeThreeObjects();
      if (setupTwo()) {
        state.mode = 'canvas2d';
        syncMode();
        applySize(state.w, state.h, true);
        rebuildTwo();
      } else {
        state.mode = 'off';
        syncMode();
      }
    }

    bindEvents();

    if (state.mode === 'off') return BG; // 连 2D 上下文都拿不到：安静地什么都不做
    if (state.reduced) drawStatic(); // 无障碍：只画一帧，不进入动画循环
    else startLoop();

    return BG; // 返回 API 本身（等价于 this —— 主程序以 window.BG.init(...) 调用）
  }

  function setParallax(nx, ny) {
    var x = Number(nx);
    var y = Number(ny);
    if (!isFinite(x)) x = 0;
    if (!isFinite(y)) y = 0;
    if (x < -1) x = -1;
    else if (x > 1) x = 1;
    if (y < -1) y = -1;
    else if (y > 1) y = 1;
    state.parTX = x;
    state.parTY = y;
    // 减少动态效果命中时不跟随鼠标（静态画面就是静态画面）
    return BG;
  }

  function pause() {
    state.paused = true;
    stopLoop();
    return BG;
  }

  function resume() {
    state.paused = false;
    if (state.reduced) {
      drawStatic(); // 静态模式下"恢复"只补画一帧
      return BG;
    }
    startLoop();
    return BG;
  }

  function destroy() {
    stopLoop();
    // 帧先停，再断事件，最后放 GPU —— 顺序保证不会在释放过程中被回调重入
    state.paused = true;
    state.destroyed = true;

    unbindEvents();
    disposeThreeObjects();

    if (state.ctx && state.canvas) {
      try {
        state.ctx.setTransform(1, 0, 0, 1, 0, 0);
        state.ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
      } catch (e) {
        /* 忽略 */
      }
    }
    state.ctx = null;
    state.sprites = null;
    state.field = null;
    state.verified = false;

    // 若曾为 2D 兜底换过节点：移除替代节点并恢复原节点显示
    try {
      if (state.replacement && state.replacement.parentNode) {
        state.replacement.parentNode.removeChild(state.replacement);
      }
    } catch (e2) {
      /* 忽略 */
    }
    state.replacement = null;
    state.swapped = false;
    try {
      if (state.hiddenCanvas) state.hiddenCanvas.style.display = '';
    } catch (e3) {
      /* 忽略 */
    }
    state.hiddenCanvas = null;

    // 移除对画布节点的引用，别把 DOM 节点拖在闭包里
    state.canvas = null;
    state.T = null;
    state.mode = 'off';
    syncMode();
    return BG;
  }

  /* ==========================================================================
   * 十四、挂载：全局只留一个 window.BG
   * getGlobalScope / BG 的赋值都发生在函数与顶部表达式里，
   * 文件被 require 时不会触碰任何浏览器 API。
   * ======================================================================== */
  var BG = {
    init: init,
    setParallax: setParallax,
    pause: pause,
    resume: resume,
    destroy: destroy
  };

  // mode 做成只读属性（内部 state.mode 是唯一事实来源）
  try {
    Object.defineProperty(BG, 'mode', {
      get: function () {
        return state.mode;
      },
      enumerable: true,
      configurable: true
    });
    hasModeGetter = true;
  } catch (e) {
    hasModeGetter = false;
    BG.mode = 'off';
  }

  var scope = getGlobalScope();
  if (scope) {
    try {
      scope.BG = BG;
    } catch (e2) {
      /* 只读沙箱等极端环境：忽略 */
    }
  }
})();
