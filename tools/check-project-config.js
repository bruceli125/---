/**
 * 自检：project.config.json 里的所有页面路径必须真实存在
 * ------------------------------------------------------------------
 * 为什么需要这条：IDE 会按 condition.list 的启动页去打开文件，
 * 页面被删除/改名后若配置没同步，编译就会报
 *   ENOENT: no such file or directory, open '.../pages/xxx/xxx.js'
 * 这类错误看起来像"文件没了"，实际是配置过期。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const CFG = path.join(ROOT, 'project.config.json');

let errors = 0;
let checked = 0;

function fail(msg) {
  errors++;
  console.log('  ❌ ' + msg);
}

/* ---------- 1. app.json 的 pages ---------- */
const appJson = JSON.parse(fs.readFileSync(path.join(MP, 'app.json'), 'utf8'));
const pages = appJson.pages || [];
pages.forEach(function (p) {
  checked++;
  ['js', 'wxml', 'json'].forEach(function (ext) {
    const f = path.join(MP, p + '.' + ext);
    if (!fs.existsSync(f)) fail('app.json 声明了 ' + p + '，但缺少 ' + ext + ' 文件');
  });
  if (!fs.existsSync(path.join(MP, p + '.wxss'))) {
    // wxss 允许缺失，只提示
    console.log('  ⚠️  ' + p + ' 没有 .wxss（不影响编译，但样式会是空白）');
  }
});

/* ---------- 2. tabBar 指向的页面必须在 pages 里 ---------- */
const tabs = ((appJson.tabBar || {}).list) || [];
tabs.forEach(function (t) {
  checked++;
  if (pages.indexOf(t.pagePath) === -1) fail('tabBar「' + t.text + '」指向的 ' + t.pagePath + ' 不在 pages 中');
  ['iconPath', 'selectedIconPath'].forEach(function (k) {
    if (t[k] && !fs.existsSync(path.join(MP, t[k]))) fail('tabBar「' + t.text + '」的 ' + k + ' 不存在：' + t[k]);
  });
});

/* ---------- 3. project.config.json 的编译模式 ---------- */
if (fs.existsSync(CFG)) {
  const cfg = JSON.parse(fs.readFileSync(CFG, 'utf8'));
  const list = (((cfg.condition || {}).miniprogram || {}).list) || [];
  list.forEach(function (it) {
    checked++;
    const jsFile = path.join(MP, it.pathName + '.js');
    if (!fs.existsSync(jsFile)) {
      fail('编译模式「' + it.name + '」指向不存在的页面：' + it.pathName + '（这会导致 ENOENT 编译错误）');
    }
  });
  if (!list.length) console.log('  ⚠️  project.config.json 未配置编译模式（不影响编译）');
}

/* ---------- 4. 组件引用必须存在 ---------- */
const compDirs = [path.join(MP, 'components')];
function checkUsing(dir) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (dir === compDirs[0] && false) return;
      checkUsing(f);
    } else if (e.name.endsWith('.json')) {
      let j;
      try {
        j = JSON.parse(fs.readFileSync(f, 'utf8'));
      } catch (err) {
        return;
      }
      const using = j.usingComponents || {};
      Object.keys(using).forEach(function (tag) {
        checked++;
        const ref = using[tag];
        const target = ref.charAt(0) === '/' ? path.join(MP, ref) : path.resolve(path.dirname(f), ref);
        if (!fs.existsSync(target + '.js')) {
          fail(path.relative(ROOT, f).replace(/\\/g, '/') + ' 引用的组件「' + tag + '」不存在：' + ref);
        }
      });
    }
  });
}
checkUsing(MP);

console.log('');
if (errors) {
  console.log('=== ❌ 发现 ' + errors + ' 个配置/路径问题（共检查 ' + checked + ' 项）===');
  process.exit(1);
} else {
  console.log('=== ✅ 配置与页面一致（共检查 ' + checked + ' 项）===');
}
