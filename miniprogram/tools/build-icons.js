/**
 * 生成 miniprogram/utils/icons.js
 * 小程序无法内联 <svg>，用 data:image/svg+xml;base64 的 <image> 是唯一稳妥的矢量方案。
 * 用法：<image class="ico" src="{{item.src}}" />
 */
const fs = require('fs');

const S = (inner) =>
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0A0A0C" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
  inner +
  '</svg>';

const SET = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  home: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-9.5Z"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c.8-3.4 3.8-5.4 7.5-5.4s6.7 2 7.5 5.4"/>',
  bell: '<path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 6-2.5 8h17C20.5 15 18 15 18 9Z"/><path d="M10 20h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  shield: '<path d="M12 3 5 6v6c0 4.4 3 8 7 9 4-1 7-4.6 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-4.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 6.5"/>',
  arrow: '<path d="M4 12h15"/><path d="m13 6 6 6-6 6"/>',
  filter: '<path d="M3 5h18l-7 8.2V20l-4-2.2v-4.6L3 5Z"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2.4"/><path d="M15 6V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h1"/>'
};

const entries = Object.keys(SET).map((k) => {
  const b64 = Buffer.from(S(SET[k]), 'utf8').toString('base64');
  return { key: k, src: 'data:image/svg+xml;base64,' + b64 };
});

const out =
  '/* 由 tools/build-icons.js 生成，请勿手改。12 个极简线条图标（24×24，墨色描边） */\n' +
  'const ICONS = ' +
  JSON.stringify(entries, null, 2) +
  ';\n\n' +
  'const MAP = {};\n' +
  'ICONS.forEach(function (it) { MAP[it.key] = it.src; });\n\n' +
  'module.exports = {\n  list: ICONS,\n  map: MAP,\n  get: function (k) { return MAP[k] || MAP.sparkle || MAP.arrow; }\n};\n';

fs.writeFileSync('D:/2026大挑京师家教/miniprogram/utils/icons.js', out, 'utf8');
console.log('已生成 utils/icons.js，图标数 ' + entries.length);
console.log(entries.map((e) => e.key + '(' + Math.round(e.src.length / 1024 * 100) / 100 + 'KB)').join('  '));
