/**
 * 生成静态预览页（用于自动化截图 / 视觉回归）
 * 由 index.html 注入 __STATIC_RENDER__ 与初始 hash，输出到 web-console/.preview/
 * 用法：node tools/make-preview.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.preview');
const VIEWS = ['overview', 'demands', 'matching', 'verify', 'fulfillment', 'design'];

const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
fs.mkdirSync(OUT, { recursive: true });

VIEWS.forEach(function (view) {
  // base 必须是 head 的第一个节点，否则其后解析的 <link> 会按 .preview/ 目录解析（404）
  const injectScript =
    '<script>window.__STATIC_RENDER__=true;location.hash="#/' + view + '";</script>\n  </head>';
  const html = src
    .replace('<head>', '<head>\n    <base href="../" />')
    .replace('</head>', injectScript);
  const file = path.join(OUT, view + '.html');
  fs.writeFileSync(file, html, 'utf8');
  console.log('written ' + path.relative(process.cwd(), file));
});
