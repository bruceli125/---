/**
 * WXML 结构检查：标签配对 + vue 指令完整性
 * 注意：<image></image> 这类成对写法是合法的，不能因为它在自闭合集合里就报错。
 */
const fs = require('fs');
const path = require('path');

const SELF = new Set([
  'image', 'input', 'icon', 'progress', 'switch', 'slider', 'canvas',
  'video', 'audio', 'map', 'ad', 'import', 'include', 'wxs', 'template'
]);

function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, acc);
    else if (/\.wxml$/.test(e.name)) acc.push(f);
  }
  return acc;
}

let bad = 0;
const files = walk('D:/2026大挑京师家教/miniprogram', []);
files.forEach((f) => {
  const raw = fs.readFileSync(f, 'utf8');
  const s = raw.replace(/<!--[\s\S]*?-->/g, '');
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  const stack = [];
  let m;
  let err = null;
  while ((m = re.exec(s))) {
    const isClose = m[1] === '/';
    const tag = m[2];
    const selfClose = m[4] === '/';
    if (isClose) {
      // 自闭合集合里的标签若出现闭合写法，直接视为配对成功（如 <image></image>）
      if (SELF.has(tag)) continue;
      const top = stack.pop();
      if (top !== tag) {
        err = '第 ' + (s.slice(0, m.index).split('\n').length) + ' 行 </' + tag + '> 与 <' + (top || '空') + '> 不匹配';
        break;
      }
    } else if (!selfClose && !SELF.has(tag)) {
      stack.push(tag);
    }
  }
  if (!err && stack.length) err = '未闭合: ' + stack.join(' > ');

  // 指令完整性：有 wx:for 必须有 wx:key（小程序会告警）
  const forCount = (s.match(/wx:for=/g) || []).length;
  const keyCount = (s.match(/wx:key=/g) || []).length;
  const keyWarn = forCount > keyCount ? ' [wx:for 缺 wx:key x' + (forCount - keyCount) + ']' : '';

  if (err) {
    bad++;
    console.log('  ❌ ' + path.relative('D:/2026大挑京师家教/miniprogram', f).replace(/\\/g, '/') + '  ' + err);
  } else if (keyWarn) {
    console.log('  ⚠️  ' + path.relative('D:/2026大挑京师家教/miniprogram', f).replace(/\\/g, '/') + keyWarn);
  }
});

console.log(bad ? '  结构异常 ' + bad + ' 个' : '  ✅ 全部 ' + files.length + ' 个 WXML 标签平衡');
