#!/usr/bin/env node
/**
 * 青拾对接 —— 工程自检脚本
 *
 * 用法：node tools/validate-project.js
 *
 * 检查项：
 *  1. app.json 中注册的每个页面，四个文件（js/json/wxml/wxss）是否齐全；
 *  2. 页面与组件的 usingComponents 路径是否真实存在，组件 json 是否声明 component: true；
 *  3. 所有 .json 文件是否合法；
 *  4. WXML 中绑定的事件处理函数（bind 系 / catch 系）是否在对应 js 中定义；
 *  5. WXML 中 {{ }} 引用的顶层标识符是否在对应 js 中出现（启发式，用于发现字段名拼写错误）；
 *  6. 架构约束：页面/组件不得直接读写业务 Storage、不得直接调用 wx.cloud（应走 services/api.js）。
 *
 * 退出码：存在 error 时为 1，否则为 0（warning 不影响退出码）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');

const errors = [];
const warnings = [];

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, '/');
}

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch (e) {
    return false;
  }
}

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

function listDirs(dir) {
  if (!exists(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

function listJsonFiles(dir, acc) {
  const out = acc || [];
  if (!exists(dir)) return out;
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    if (e.name === 'node_modules' || e.name === '.git') return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) listJsonFiles(full, out);
    else if (e.name.endsWith('.json')) out.push(full);
  });
  return out;
}

/* ---------------- 1. 全量 JSON 合法性 ---------------- */
/* 注意：database/ 下的文件是微信云开发控制台要求的 JSON Lines 格式（每行一个对象），
   不能整文件 JSON.parse，必须逐行解析。 */
listJsonFiles(ROOT).forEach((f) => {
  const isJsonLines = path.relative(ROOT, f).replace(/\\/g, '/').indexOf('database/') === 0;
  const text = read(f);
  if (!isJsonLines) {
    try {
      JSON.parse(text);
    } catch (err) {
      errors.push('[JSON] ' + rel(f) + ' 解析失败：' + err.message);
    }
    return;
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const ids = {};
  lines.forEach((line, i) => {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (err) {
      errors.push('[JSONL] ' + rel(f) + ' 第 ' + (i + 1) + ' 行解析失败：' + err.message);
      return;
    }
    if (!obj._id) {
      errors.push('[JSONL] ' + rel(f) + ' 第 ' + (i + 1) + ' 行缺少 _id（云数据库导入需要唯一 _id）');
    } else if (ids[obj._id]) {
      errors.push('[JSONL] ' + rel(f) + ' 出现重复 _id：' + obj._id);
    } else {
      ids[obj._id] = true;
    }
  });
});

/* ---------------- 2. 页面文件齐全性 ---------------- */
const appJsonPath = path.join(MP, 'app.json');
let appJson = null;
if (!exists(appJsonPath)) {
  errors.push('[app.json] 缺少 miniprogram/app.json');
} else {
  appJson = JSON.parse(read(appJsonPath));
  const exts = ['.js', '.json', '.wxml', '.wxss'];
  (appJson.pages || []).forEach((page) => {
    const base = path.join(MP, page);
    exts.forEach((ext) => {
      if (!exists(base + ext)) errors.push('[页面缺文件] ' + page + ext);
    });
  });

  // tabBar 的页面必须在 pages 中注册
  const tabList = (appJson.tabBar && appJson.tabBar.list) || [];
  tabList.forEach((item) => {
    if ((appJson.pages || []).indexOf(item.pagePath) === -1) {
      errors.push('[tabBar] ' + item.pagePath + ' 未在 app.json pages 中注册');
    }
  });
}

/* ---------------- 3. usingComponents 路径 ---------------- */
function checkUsingComponents(jsonPath) {
  let cfg;
  try {
    cfg = JSON.parse(read(jsonPath));
  } catch (e) {
    return;
  }
  const using = cfg.usingComponents || {};
  Object.keys(using).forEach((name) => {
    const target = using[name];
    const base = target.charAt(0) === '/' ? path.join(MP, target) : path.resolve(path.dirname(jsonPath), target);
    if (!exists(base + '.json')) {
      errors.push('[组件路径] ' + rel(jsonPath) + ' -> ' + name + ' (' + target + ') 不存在');
      return;
    }
    try {
      const compCfg = JSON.parse(read(base + '.json'));
      if (compCfg.component !== true) {
        errors.push('[组件声明] ' + rel(base + '.json') + ' 缺少 "component": true');
      }
    } catch (e) {
      /* JSON 合法性已在第 1 步检查 */
    }
  });
}

if (appJson) checkUsingComponents(appJsonPath);
listDirs(path.join(MP, 'pages')).forEach((p) =>
  checkUsingComponents(path.join(MP, 'pages', p, p + '.json'))
);
listDirs(path.join(MP, 'components')).forEach((c) =>
  checkUsingComponents(path.join(MP, 'components', c, 'index.json'))
);

/* ---------------- 4/5/6. WXML 与 JS 一致性 ---------------- */
const BUILTIN = [
  'true',
  'false',
  'null',
  'undefined',
  'item',
  'index',
  'idx',
  'key',
  'value',
  'wx',
  'Math',
  'Date',
  'JSON'
];

const EVENT_RE = /\b(?:bind|catch|capture-bind|capture-catch):?([a-zA-Z]+)\s*=\s*"\s*([A-Za-z_$][\w$]*)\s*"/g;
const MUSTACHE_RE = /\{\{([^}]*)\}\}/g;
const IDENT_RE = /[A-Za-z_$][\w$]*/g;

/**
 * 去掉注释后的源码，用于「事件/字段是否存在」与架构约束检查：
 * 注释里出现的函数名或 wx.cloud 示例不应被当成真实代码（避免误报，也避免注释掩盖真实缺失）。
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释
    .replace(/^[ \t]*\/\/.*$/gm, '');   // 整行行注释
}

function checkWxml(wxmlPath, jsPath, label) {
  if (!exists(wxmlPath) || !exists(jsPath)) return;
  const wxml = read(wxmlPath);
  const js = stripComments(read(jsPath));

  // 4. 事件处理函数是否存在
  const seenEvents = {};
  let m;
  while ((m = EVENT_RE.exec(wxml)) !== null) {
    const handler = m[2];
    if (seenEvents[handler]) continue;
    seenEvents[handler] = true;
    const defRe = new RegExp('(^|[\\s,{])' + handler + '\\s*[(:]', 'm');
    if (!defRe.test(js)) {
      errors.push('[事件未定义] ' + rel(wxmlPath) + ' 绑定了 ' + handler + '()，但 ' + rel(jsPath) + ' 中未找到该方法');
    }
  }

  // 5. {{ }} 中的顶层标识符是否在 js 中出现
  const dataKeys = {};
  while ((m = MUSTACHE_RE.exec(wxml)) !== null) {
    const expr = m[1];
    // 去掉字符串字面量，避免把 '中文' 当成标识符
    const cleaned = expr.replace(/'[^']*'/g, ' ').replace(/"[^"]*"/g, ' ');
    let t;
    IDENT_RE.lastIndex = 0;
    while ((t = IDENT_RE.exec(cleaned)) !== null) {
      const id = t[0];
      const start = t.index;
      const before = cleaned.slice(0, start).trim();
      // 只检查顶层标识符：前面不是 . 或 数字
      if (/[.\w$]$/.test(before)) continue;
      if (BUILTIN.indexOf(id) > -1) continue;
      if (dataKeys[id]) continue;
      const inJs = new RegExp('(^|[\\s,{[(])' + id + '\\s*[:(,]', 'm').test(js) || js.indexOf(id) > -1;
      if (!inJs) {
        errors.push('[字段可疑] ' + rel(wxmlPath) + ' 使用了 {{' + id + '}}，但 ' + rel(jsPath) + ' 中未出现该标识符');
      }
      dataKeys[id] = true;
    }
  }

  // 6. 架构约束
  if (/wx\.getStorageSync|wx\.setStorageSync|wx\.removeStorageSync|wx\.clearStorageSync/.test(js)) {
    warnings.push('[架构] ' + rel(jsPath) + ' 直接读写了 Storage，应统一走 services/api.js');
  }
  if (/wx\.cloud\./.test(js)) {
    warnings.push('[架构] ' + rel(jsPath) + ' 直接调用了 wx.cloud，应统一走 services/api.js');
  }
  void label;
}

listDirs(path.join(MP, 'pages')).forEach((p) =>
  checkWxml(path.join(MP, 'pages', p, p + '.wxml'), path.join(MP, 'pages', p, p + '.js'), p)
);
listDirs(path.join(MP, 'components')).forEach((c) =>
  checkWxml(path.join(MP, 'components', c, 'index.wxml'), path.join(MP, 'components', c, 'index.js'), c)
);

/* ---------------- 7. 自定义标签是否已注册 + 8. 组件属性契约 ---------------- */

/** 微信内置标签（含带连字符的那些），其余带连字符的标签都视为自定义组件 */
const NATIVE_TAGS = [
  'view', 'scroll-view', 'swiper', 'swiper-item', 'movable-area', 'movable-view', 'cover-view', 'cover-image',
  'match-media', 'page-container', 'share-element', 'root-portal', 'sticky-section', 'sticky-header',
  'grid-view', 'list-view', 'snapshot', 'page-meta', 'navigation-bar', 'open-data', 'web-view', 'rich-text',
  'progress', 'icon', 'text', 'image', 'button', 'input', 'textarea', 'picker', 'picker-view', 'picker-view-column',
  'switch', 'checkbox', 'checkbox-group', 'radio', 'radio-group', 'slider', 'form', 'label', 'navigator', 'camera',
  'video', 'audio', 'canvas', 'map', 'editor', 'ad', 'ad-custom', 'official-account', 'functional-page-navigator',
  'keyboard-accessory', 'voip-room', 'channel-live', 'channel-video', 'double-tap-gesture-handler',
  'scale-gesture-handler', 'pan-gesture-handler', 'tap-gesture-handler', 'vertical-drag-gesture-handler',
  'horizontal-drag-gesture-handler', 'force-press-gesture-handler', 'long-press-gesture-handler',
  'custom-route', 'aria-component', 'slot', 'block', 'template', 'import', 'include', 'wxs'
];

const TAG_RE = /<([a-zA-Z][\w:-]*)[\s/>]/g;

/** 取组件 index.js 中 properties 块的一级键名 */
function parseComponentProperties(jsPath) {
  if (!exists(jsPath)) return [];
  const src = read(jsPath);
  const m = src.match(/^[ \t]*properties\s*:\s*\{/m);
  if (!m) return [];
  const start = src.indexOf('{', m.index);
  let depth = 0;
  let end = -1;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return [];
  const body = src.slice(start + 1, end);
  const keys = [];
  let d = 0;
  body.split(/\r?\n/).forEach((raw) => {
    const t = raw.trim();
    if (d === 0) {
      const km = t.match(/^([A-Za-z_$][\w$]*)\s*:/);
      if (km) keys.push(km[1]);
    }
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch === '{' || ch === '[' || ch === '(') d++;
      else if (ch === '}' || ch === ']' || ch === ')') d--;
    }
  });
  return keys;
}

function kebabToCamel(name) {
  return name.replace(/-([a-z])/g, function (s, c) {
    return c.toUpperCase();
  });
}

const ATTR_IGNORE = /^(class|style|id|slot|hidden|hover-class|hover-start-time|hover-stay-time|animation|data-|bind|catch|capture-|wx:|generic:|mut-bind|model:|change:)/;

function resolveComponentBase(target, jsonPath) {
  return target.charAt(0) === '/' ? path.join(MP, target) : path.resolve(path.dirname(jsonPath), target);
}

/**
 * 全局自定义组件：app.json 的 usingComponents 对所有页面生效（微信 2.11.1+），
 * 因此页面 wxml 里可以直接用 <platform-notice /> 而不需要页面 json 再声明。
 */
function globalUsingComponents() {
  if (!appJson || !appJson.usingComponents) return {};
  return appJson.usingComponents;
}

function checkCustomTagsAndProps(wxmlPath, jsonPath) {
  if (!exists(wxmlPath) || !exists(jsonPath)) return;
  const wxml = read(wxmlPath);
  let cfg = {};
  try {
    cfg = JSON.parse(read(jsonPath));
  } catch (e) {
    return;
  }
  // 页面声明优先，其次才是 app.json 的全局组件
  const using = Object.assign({}, globalUsingComponents(), cfg.usingComponents || {});

  // 7. 未注册的自定义标签（例如 index.wxml 用了 <cert-badge> 但 json 未声明）
  const seen = {};
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(wxml)) !== null) {
    const tag = m[1];
    if (NATIVE_TAGS.indexOf(tag) > -1) continue;
    if (tag.indexOf('-') === -1 && !/[A-Z]/.test(tag)) continue; // 无连字符的小写标签不视为组件
    if (seen[tag]) continue;
    seen[tag] = true;
    if (!using[tag]) {
      // 兼容写法：注册名是 PascalCase 而标签用了 kebab-case（或反之）
      const alt = tag.indexOf('-') > -1 ? kebabToCamel(tag) : tag.replace(/([A-Z])/g, '-$1').toLowerCase();
      if (using[alt]) {
        warnings.push(
          '[组件名风格] ' + rel(wxmlPath) + ' 使用 <' + tag + '>，而 ' + rel(jsonPath) + ' 注册名是 "' + alt + '"，建议统一为 kebab-case 以免解析歧义'
        );
      } else {
        errors.push('[组件未注册] ' + rel(wxmlPath) + ' 使用了 <' + tag + '>，但 ' + rel(jsonPath) + ' 的 usingComponents 未声明');
      }
    }
  }

  // 8. 属性契约：传给组件的属性必须在其 properties 中声明
  Object.keys(using).forEach((tag) => {
    const base = resolveComponentBase(using[tag], jsonPath);
    const props = parseComponentProperties(base + '.js');
    if (!props.length) return;
    const propSet = {};
    props.forEach((k) => {
      propSet[k] = true;
    });
    const tagRe = new RegExp('<' + tag + '\\b([^>]*)>', 'g');
    let t;
    while ((t = tagRe.exec(wxml)) !== null) {
      const attrRe = /([a-zA-Z_:][\w:.-]*)\s*=\s*"/g;
      let a;
      while ((a = attrRe.exec(t[1])) !== null) {
        const name = a[1];
        if (ATTR_IGNORE.test(name)) continue;
        if (!propSet[name] && !propSet[kebabToCamel(name)]) {
          errors.push(
            '[属性未声明] ' + rel(wxmlPath) + ' 的 <' + tag + ' ' + name + '> 未在 ' + rel(base + '.js') + ' 的 properties 中声明'
          );
        }
      }
    }
  });
}

listDirs(path.join(MP, 'pages')).forEach((p) =>
  checkCustomTagsAndProps(path.join(MP, 'pages', p, p + '.wxml'), path.join(MP, 'pages', p, p + '.json'))
);
listDirs(path.join(MP, 'components')).forEach((c) =>
  checkCustomTagsAndProps(path.join(MP, 'components', c, 'index.wxml'), path.join(MP, 'components', c, 'index.json'))
);

/* ---------------- 输出 ---------------- */
console.log('=== 青拾对接 · 工程自检 ===');
console.log('错误 ' + errors.length + ' 项，警告 ' + warnings.length + ' 项');
if (errors.length) {
  console.log('\n--- 错误 ---');
  errors.forEach((e) => console.log('  ✗ ' + e));
}
if (warnings.length) {
  console.log('\n--- 警告 ---');
  warnings.forEach((w) => console.log('  ! ' + w));
}
if (!errors.length && !warnings.length) {
  console.log('\n✅ 全部检查通过');
}
process.exit(errors.length ? 1 : 0);
