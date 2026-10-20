/* ============================================================================
 * icons.js —— 内联 SVG 图标集
 * 统一 24×24 viewBox、currentColor 描边、round 端点，保证任意尺寸下视觉一致。
 * 用法：Icons.svg('demand') 或 <span data-icon="demand"></span> 由 app.js 注入
 * ========================================================================== */
(function (global) {
  'use strict';

  var PATHS = {
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.6"/><rect x="14" y="3" width="7" height="5" rx="1.6"/><rect x="14" y="12" width="7" height="9" rx="1.6"/><rect x="3" y="16" width="7" height="5" rx="1.6"/>',
    demand: '<path d="M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    matching: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><path d="m4.9 4.9 2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
    shield: '<path d="M12 3 5 6v6c0 4.2 2.9 7.7 7 9 4.1-1.3 7-4.8 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
    alert: '<path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5"/><circle cx="12" cy="17.5" r="0.6" fill="currentColor"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
    users: '<circle cx="9" cy="8" r="3.4"/><path d="M3 20c0-3.3 2.7-5.4 6-5.4s6 2.1 6 5.4"/><path d="M16.5 5.6a3 3 0 0 1 0 5.6M18 14.8c2 .7 3 2.3 3 5.2"/>',
    chart: '<path d="M4 20V10M10 20V5M16 20v-7M22 20H2"/>',
    check: '<path d="m4 12.5 5 5L20 6.5"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.2 2.4 2.4 4.6-4.8"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    chevronRight: '<path d="m9 5 7 7-7 7"/>',
    chevronDown: '<path d="m5 9 7 7 7-7"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.4-3.4"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z"/>',
    more: '<circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/>',
    star: '<path d="m12 3.5 2.6 5.3 5.9.85-4.25 4.15 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.65l5.9-.85L12 3.5Z" fill="currentColor" stroke="none"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 1.8"/>',
    location: '<path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    download: '<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 6V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h1"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    arrowUp: '<path d="M12 19V5"/><path d="m6 11 6-6 6 6"/>',
    arrowDown: '<path d="M12 5v14"/><path d="m6 13 6 6 6-6"/>',
    arrowRight: '<path d="M4 12h15"/><path d="m13 6 6 6-6 6"/>',
    minus: '<path d="M5 12h14"/>',
    sparkle: '<path d="m12 3 1.8 4.9L19 9.7l-4.4 3.1L15.9 18 12 15.1 8.1 18l1.3-5.2L5 9.7l5.2-1.8L12 3Z"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5Z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5"/>',
    scale: '<path d="M12 4v16"/><path d="M7 20h10"/><path d="M4 9h16"/><path d="m4 9-2 5h4L4 9Z"/><path d="m20 9-2 5h4l-2-5Z"/>',
    building: '<rect x="4" y="3" width="16" height="18" rx="1.6"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.87 1.2v.17a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 3.5 15H3.4a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 5 9.4a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9.4 5a1.7 1.7 0 0 0 1-1.55V3.4a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 5a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.55 1h.17a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.63 1Z"/>',
    command: '<path d="M9 6a2 2 0 1 0-2 2h10a2 2 0 1 0-2-2v12a2 2 0 1 0 2-2H7a2 2 0 1 0 2 2V6Z"/>'
  };

  function svg(name, size, extraClass) {
    var path = PATHS[name] || PATHS.sparkle;
    return (
      '<svg class="ico ' +
      (extraClass || '') +
      '" viewBox="0 0 24 24" width="' +
      (size || 16) +
      '" height="' +
      (size || 16) +
      '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      path +
      '</svg>'
    );
  }

  global.Icons = { svg: svg, paths: PATHS };
})(window);
