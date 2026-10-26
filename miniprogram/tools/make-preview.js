/**
 * 生成小程序 UI 的浏览器预览页（视觉验收用）
 * 做法：把 WXSS 原样取用，只做两件事——
 *   1) rpx → px（750rpx = 375px，按 0.5 缩放）
 *   2) 元素选择器 page → .mp-page 包裹层
 * 这样预览里的布局/颜色与小程序高度一致，可提前发现塌陷、重叠、挤压。
 */
const fs = require('fs');
const path = require('path');

const MP = 'D:/2026大挑京师家教/miniprogram';
const OUT = path.join(MP, '.preview');
fs.mkdirSync(OUT, { recursive: true });

function convert(css) {
  return css
    .replace(/(\d*\.?\d+)rpx/g, (_, n) => (parseFloat(n) * 0.5).toFixed(2) + 'px')
    // 只替换"独立出现"的 page 元素选择器：前不能是 - 或字母（否则会把 .mp-page 再替换成 .mp-.mp-page）
    .replace(/(^|[\s,{}>+~])page(?=[\s,{])/gm, '$1.mp-page');
}

const appCss = convert(fs.readFileSync(path.join(MP, 'app.wxss'), 'utf8'));
const kitCss = convert(fs.readFileSync(path.join(MP, 'pages/ui-kit/ui-kit.wxss'), 'utf8'));
const idxCss = convert(fs.readFileSync(path.join(MP, 'pages/index/index.wxss'), 'utf8'));
fs.writeFileSync(path.join(OUT, 'preview.css'), appCss + '\n' + kitCss + '\n' + idxCss, 'utf8');

/* ---------- 数据（与 ui-kit.js 保持一致） ---------- */
const colors = [
  ['白色', '#FFFFFF', '卡片'],
  ['雪色', '#FAFAFC', '页面底'],
  ['板岩色', '#F2F4F8', '分区'],
  ['边框色', '#E6E8EF', '描边'],
  ['墨色', '#0A0A0C', '文字']
];
const prism = ['#FFB27A', '#FFD166', '#6FE3E1', '#A78BFA', '#FF9EC4'];
const weights = [
  ['Light', 300],
  ['Regular', 400],
  ['Medium', 500],
  ['Semibold', 600]
];
const week = [38, 52, 44, 66, 78, 30, 26];
const weekLabels = ['一', '二', '三', '四', '五', '六', '日'];
const maxV = Math.max.apply(null, week);

const Icons = require(path.join(MP, 'utils/icons.js'));

const swatches = colors
  .map(
    (c) =>
      `<div class="ui-swatch"><div class="ui-swatch__chip" style="background:${c[1]}"></div>
       <div class="ui-swatch__name">${c[0]}</div><div class="ui-swatch__hex">${c[1]}</div>
       <div class="ui-swatch__note">${c[2]}</div></div>`
  )
  .join('');

const icons = Icons.list
  .map((i) => `<div class="ui-icon"><img class="ui-icon__img" src="${i.src}" /></div>`)
  .join('');

const typeRows = weights
  .map(
    (w) =>
      `<div class="ui-type__row"><span class="ui-type__sample" style="font-weight:${w[1]}">光</span>
       <span class="ui-type__label">${w[0]}</span><span class="ui-type__weight">${w[1]}</span></div>`
  )
  .join('');

const bars = week
  .map(
    (v, i) =>
      `<div class="bars__col"><div class="bars__bar" style="height:${Math.max(
        8,
        Math.round((v / maxV) * 60)
      )}px"></div><div class="bars__label">${weekLabels[i]}</div></div>`
  )
  .join('');

const phoneBars = week
  .map((v) => `<div class="ui-phone__bar" style="height:${Math.max(6, Math.round((v / maxV) * 35))}px"></div>`)
  .join('');

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="stylesheet" href="preview.css" />
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #eceef3; padding: 24px; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
  .mp-page { width: 375px; margin: 0 auto; border-radius: 26px; overflow: hidden; box-shadow: 0 24px 60px -30px rgba(10,10,12,.35); }
  .hero, .ui-hero { border-radius: 0 0 20px 20px; }
</style></head>
<body>
<div class="mp-page">

  <!-- 首页 Hero -->
  <div class="hero">
    <div class="hero-wash"></div>
    <div class="hero-ring"><div class="prism-halo"></div><div class="prism-ring"></div></div>
    <div class="hero-inner">
      <div class="hero-eyebrow">LIGHTCORE PRISM</div>
      <div class="hero-title">青拾对接</div>
      <div class="prism-bar hero-bar"></div>
      <div class="hero-slogan">在校学生 · 认证可查 · 信息撮合</div>
      <div class="hero-desc">高校主导的家教可信对接平台，连接家长 / 机构与XX大学学生</div>
      <div class="hero-tags">
        <span class="tag tag-prism">认证可查</span>
        <span class="tag tag-line">试课可换</span>
        <span class="tag tag-line">学生不收取费用</span>
      </div>
      <div class="hero-version">v0.2.0 · 可信对接 · 智能匹配</div>
    </div>
  </div>

  <div class="ui-body" style="padding-top:20px">
    <!-- 设计系统头 -->
    <div class="ui-section">
      <div class="ui-section__head"><span class="ui-section__title">色彩</span><span class="ui-section__meta">5 · 中性骨架</span></div>
      <div class="ui-swatches">${swatches}</div>
    </div>

    <div class="ui-section">
      <div class="ui-section__head"><span class="ui-section__title">棱镜渐变</span><span class="ui-section__meta">唯一的彩色来源</span></div>
      <div class="prism-bar ui-prism"></div>
      <div class="ui-prism__codes">${prism.map((c) => `<span class="ui-prism__code">${c}</span>`).join('')}</div>
    </div>

    <div class="ui-section">
      <div class="ui-section__head"><span class="ui-section__title">排版</span><span class="ui-section__meta">4 字重</span></div>
      <div class="ui-type">
        <div class="ui-type__aa">Aa</div>
        <div class="ui-type__list">${typeRows}</div>
      </div>
      <div class="ui-type__alphabet">ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789</div>
    </div>

    <div class="ui-section">
      <div class="ui-section__head"><span class="ui-section__title">图标</span><span class="ui-section__meta">12 · 线条</span></div>
      <div class="ui-icons">${icons}</div>
    </div>

    <div class="ui-section">
      <div class="ui-section__head"><span class="ui-section__title">按钮</span><span class="ui-section__meta">4 类 × 正常/禁用</span></div>
      <div class="ui-btn-row">
        <div class="ui-btn-col"><span class="ui-btn-col__label">主要</span>
          <div class="btn btn-prism">开始使用</div><div class="btn btn-prism btn-disabled">开始使用</div></div>
        <div class="ui-btn-col"><span class="ui-btn-col__label">次要</span>
          <div class="btn btn-ghost">了解更多</div><div class="btn btn-ghost btn-disabled">了解更多</div></div>
      </div>
      <div class="ui-btn-row">
        <div class="ui-btn-col"><span class="ui-btn-col__label">文本</span>
          <div class="ui-text-btn">查看文档 ›</div><div class="ui-text-btn ui-text-btn--disabled">查看文档 ›</div></div>
        <div class="ui-btn-col"><span class="ui-btn-col__label">图标</span>
          <div class="ui-btn-inline"><div class="ui-icon-btn"><span class="ui-icon-btn__glyph">⧉</span></div>
          <div class="ui-icon-btn"><span class="ui-icon-btn__glyph">≡</span></div>
          <div class="ui-icon-btn ui-icon-btn--disabled"><span class="ui-icon-btn__glyph">＋</span></div></div></div>
      </div>
    </div>

    <div class="ui-section">
      <div class="ui-section__head"><span class="ui-section__title">组件</span><span class="ui-section__meta">数据可视化</span></div>
      <div class="ui-viz">
        <div class="ui-donut-wrap"><div class="donut"></div>
          <div class="donut__center"><div class="ui-donut__num">54%</div><div class="ui-donut__cap">三重认证</div></div></div>
        <div class="ui-legend">
          <div class="ui-legend__item"><span class="ui-legend__dot" style="background:#A78BFA"></span><span class="ui-legend__label">三重认证</span><span class="ui-legend__val">54%</span></div>
          <div class="ui-legend__item"><span class="ui-legend__dot" style="background:#6FE3E1"></span><span class="ui-legend__label">双重认证</span><span class="ui-legend__val">31%</span></div>
          <div class="ui-legend__item"><span class="ui-legend__dot" style="background:#FFD166"></span><span class="ui-legend__label">学籍认证</span><span class="ui-legend__val">15%</span></div>
        </div>
      </div>
      <div class="ui-chart">
        <div class="ui-chart__head"><span class="ui-chart__title">近 7 天匹配量</span><span class="ui-chart__meta">峰值 78</span></div>
        <div class="bars">${bars}</div>
      </div>
    </div>

    <div class="ui-section">
      <div class="ui-section__head"><span class="ui-section__title">移动应用</span><span class="ui-section__meta">手机模型</span></div>
      <div class="ui-phone">
        <div class="ui-phone__screen">
          <div class="ui-phone__balance"><div class="ui-phone__label">本月课时结算</div>
            <div class="ui-phone__amount">¥24,880</div><div class="ui-phone__delta">+12.4% 较上月</div></div>
          <div class="ui-phone__chart">${phoneBars}</div>
        </div>
      </div>
    </div>
  </div>
</div>
</body></html>`;

fs.writeFileSync(path.join(OUT, 'mp-preview.html'), html, 'utf8');
console.log('已生成 .preview/mp-preview.html');
console.log('CSS 体积: ' + Math.round((appCss.length + kitCss.length + idxCss.length) / 1024) + ' KB');
