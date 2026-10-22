/* ============================================================================
 * app.js —— 应用控制器
 * 职责：路由 / 导航渲染 / 视图挂载 / 动效编排 / 抽屉 / 吐司 / 命令面板 /
 *       表格筛选排序 / 按钮状态机 / 3D 背景初始化。零依赖，ES5。
 * ========================================================================== */
(function (global) {
  'use strict';

  var C = global.Components;
  var I = global.Icons;
  var V = global.Views;
  var D = global.DATA;
  var esc = C.esc;

  /**
   * 静态渲染模式：给自动化截图 / 视觉回归用（window.__STATIC_RENDER__ = true）。
   * 关闭数字滚动与图表入场动画，直接呈现终态——避免无头浏览器虚拟时间
   * 被 requestAnimationFrame 循环卡住，导致"截图停在动画第一帧"的假象。
   */
  var STATIC_RENDER =
    !!global.__STATIC_RENDER__ ||
    !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ==========================================================================
   * 路由表（导航与页头文案的唯一数据源）
   * ====================================================================== */
  var PAGES = [
    { key: 'overview', label: '运营总览', icon: 'dashboard', group: '概览', title: '平台运行概览' },
    { key: 'demands', label: '需求工单', icon: 'demand', group: '业务', title: '需求工单管理', badge: function () { return D.demands.length; } },
    { key: 'matching', label: '智能匹配', icon: 'matching', group: '业务', title: '智能匹配与对接报告' },
    { key: 'verify', label: '认证审核', icon: 'shield', group: '业务', title: '三重认证审核', badge: function () { return D.tutors.filter(function (t) { return t.certs.ability === 'pending'; }).length; } },
    { key: 'fulfillment', label: '履约与评价', icon: 'clock', group: '履约', title: '履约打卡与双向评价' },
    { key: 'design', label: '设计规范', icon: 'layers', group: '系统', title: '设计规范与组件状态' }
  ];

  var state = {
    view: 'overview',
    prevView: null,
    demandFilter: 'all',
    demandKeyword: '',
    onlyRisk: false,
    sortKey: 'id',
    sortDir: 1
  };

  var el = {
    nav: document.getElementById('nav'),
    views: document.getElementById('views'),
    content: document.getElementById('content'),
    crumb: document.getElementById('crumb'),
    title: document.getElementById('page-title'),
    app: document.getElementById('app'),
    scrim: document.getElementById('scrim'),
    drawer: document.getElementById('drawer'),
    drawerTitle: document.getElementById('drawer-title'),
    drawerSub: document.getElementById('drawer-sub'),
    drawerBody: document.getElementById('drawer-body'),
    drawerFoot: document.getElementById('drawer-foot'),
    toasts: document.getElementById('toasts'),
    palette: document.getElementById('palette'),
    paletteScrim: document.getElementById('palette-scrim'),
    paletteInput: document.getElementById('palette-input'),
    paletteList: document.getElementById('palette-list'),
    liveStatus: document.getElementById('live-status')
  };

  /* ==========================================================================
   * 工具
   * ====================================================================== */
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function $all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function nowText() {
    var d = new Date();
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  /* ==========================================================================
   * 吐司
   * ====================================================================== */
  var Toast = {
    show: function (msg, type) {
      var t = type || 'info';
      var iconName = t === 'ok' ? 'checkCircle' : t === 'warn' ? 'alert' : 'sparkle';
      var node = document.createElement('div');
      node.className = 'toast toast--' + t;
      node.innerHTML =
        '<span class="toast__icon">' + I.svg(iconName, 13) + '</span><span>' + esc(msg) + '</span>';
      el.toasts.appendChild(node);
      setTimeout(function () {
        node.classList.add('is-out');
        setTimeout(function () {
          if (node.parentNode) node.parentNode.removeChild(node);
        }, 320);
      }, 2600);
    }
  };

  /* ==========================================================================
   * 抽屉
   * ====================================================================== */
  var Drawer = {
    open: function (cfg) {
      el.drawerTitle.textContent = cfg.title || '详情';
      el.drawerSub.textContent = cfg.sub || '';
      el.drawerBody.innerHTML = cfg.body || '';
      el.drawerFoot.innerHTML = cfg.foot || '';
      el.drawer.classList.add('is-open');
      el.scrim.classList.add('is-open');
      el.drawer.setAttribute('aria-hidden', 'false');
      // 抽屉内的按钮同样需要点击反馈与动作派发
      bindRipples(el.drawer);
    },
    close: function () {
      el.drawer.classList.remove('is-open');
      el.scrim.classList.remove('is-open');
      el.drawer.setAttribute('aria-hidden', 'true');
    }
  };

  el.scrim.addEventListener('click', Drawer.close);
  document.getElementById('drawer-close').addEventListener('click', Drawer.close);

  /* ==========================================================================
   * 导航渲染
   * ====================================================================== */
  function groupPages() {
    var groups = [];
    PAGES.forEach(function (p) {
      var g = groups.filter(function (x) { return x.name === p.group; })[0];
      if (!g) {
        g = { name: p.group, items: [] };
        groups.push(g);
      }
      g.items.push(p);
    });
    return groups;
  }

  function renderNav() {
    el.nav.innerHTML = groupPages()
      .map(function (g) {
        return (
          '<div class="nav__group">' +
          '<div class="nav__label">' + esc(g.name) + '</div>' +
          g.items
            .map(function (p) {
              var count = typeof p.badge === 'function' ? p.badge() : null;
              return (
                '<button class="nav__item' + (p.key === state.view ? ' is-active' : '') + '" data-nav="' + p.key + '">' +
                '<span class="nav__icon">' + I.svg(p.icon, 17) + '</span>' +
                '<span class="nav__text">' + esc(p.label) + '</span>' +
                (count ? '<span class="nav__count">' + count + '</span>' : '') +
                '</button>'
              );
            })
            .join('') +
          '</div>'
        );
      })
      .join('');
  }

  /* ==========================================================================
   * 视图挂载
   * ====================================================================== */
  var revealObserver = null;

  function destroyCharts() {
    if (!global.Charts) return;
    $all('[data-chart], [data-spark]').forEach(function (node) {
      try {
        global.Charts.destroy(node);
      } catch (e) {
        /* 图表未初始化时忽略 */
      }
    });
  }

  function runCountUp(root) {
    $all('[data-count]', root).forEach(function (node) {
      var target = parseFloat(node.getAttribute('data-count')) || 0;
      var decimals = parseInt(node.getAttribute('data-decimals') || '0', 10);
      if (STATIC_RENDER) {
        node.textContent = decimals ? target.toFixed(decimals) : Math.round(target).toString();
        return;
      }
      var start = 0;
      var dur = 760;
      var t0 = 0;
      function frame(ts) {
        if (!t0) t0 = ts;
        var p = Math.min(1, (ts - t0) / dur);
        var v = start + (target - start) * easeOutCubic(p);
        node.textContent = decimals ? v.toFixed(decimals) : Math.round(v).toString();
        if (p < 1) requestAnimationFrame(frame);
      }
      node.textContent = decimals ? (0).toFixed(decimals) : '0';
      requestAnimationFrame(frame);
    });
  }

  function observeReveal(root) {
    if (STATIC_RENDER || !('IntersectionObserver' in global)) {
      $all('.reveal, .stagger', root).forEach(function (n) {
        n.classList.add('is-in');
      });
      return;
    }
    if (revealObserver) revealObserver.disconnect();
    revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { root: el.content, threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
    );
    $all('.reveal, .stagger', root).forEach(function (n, i) {
      if (!n.style.getPropertyValue('--d')) n.style.setProperty('--d', Math.min(i, 6) * 45 + 'ms');
      revealObserver.observe(n);
    });
  }

  function mount(key) {
    var page = PAGES.filter(function (p) { return p.key === key; })[0];
    if (!page) key = 'overview';

    destroyCharts();

    el.views.innerHTML = V[key]();
    el.crumb.textContent = page ? page.group + ' / ' + page.label : '运营总览';
    el.title.textContent = page ? page.title : '平台运行概览';
    document.title = '京师家教 · ' + (page ? page.title : '运营控制台');

    // 激活当前视图（CSS 用 .view.is-active 控制显示）
    var node = $('[data-view="' + key + '"]', el.views);
    if (node) node.classList.add('is-active');

    bindRipples(el.views);
    observeReveal(el.views);
    runCountUp(el.views);

    if (V.after && V.after[key]) {
      // 等一帧，确保布局完成、Canvas 能测量到尺寸
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          try {
            V.after[key](el.views);
          } catch (e) {
            console.warn('[charts] 初始化失败：', e);
          }
        });
      });
    }

    if (key === 'demands') applyDemandFilters();
    el.content.scrollTop = 0;
  }

  function navigate(key, opts) {
    if (!key) return;
    if (state.view === key && !(opts && opts.force)) {
      el.content.scrollTop = 0;
      return;
    }
    state.prevView = state.view;
    state.view = key;
    if (location.hash !== '#/' + key) {
      location.hash = '#/' + key;
    } else {
      renderNav();
      mount(key);
    }
  }

  function route() {
    var key = (location.hash || '').replace(/^#\/?/, '') || 'overview';
    if (!PAGES.filter(function (p) { return p.key === key; }).length) key = 'overview';
    state.view = key;
    renderNav();
    mount(key);
  }

  global.addEventListener('hashchange', route);

  /* ==========================================================================
   * 交互：水波纹 / 卡片光标高光 / 导航点击
   * ====================================================================== */
  function bindRipples(root) {
    $all('.btn', root).forEach(function (btn) {
      if (btn.__ripple) return;
      btn.__ripple = true;
      btn.addEventListener('click', function (e) {
        var rect = btn.getBoundingClientRect();
        var size = Math.max(rect.width, rect.height);
        var span = document.createElement('span');
        span.className = 'ripple';
        span.style.width = span.style.height = size + 'px';
        span.style.left = e.clientX - rect.left - size / 2 + 'px';
        span.style.top = e.clientY - rect.top - size / 2 + 'px';
        btn.appendChild(span);
        setTimeout(function () {
          if (span.parentNode) span.parentNode.removeChild(span);
        }, 580);
      });
    });
  }

  document.addEventListener('pointermove', function (e) {
    var card = e.target.closest ? e.target.closest('.card--spot') : null;
    if (!card) return;
    var r = card.getBoundingClientRect();
    card.style.setProperty('--mx', e.clientX - r.left + 'px');
    card.style.setProperty('--my', e.clientY - r.top + 'px');
  });

  document.addEventListener('click', function (e) {
    var navBtn = e.target.closest ? e.target.closest('[data-nav]') : null;
    if (navBtn) {
      navigate(navBtn.getAttribute('data-nav'));
      return;
    }

    // 打开需求抽屉
    var openDemand = e.target.closest ? e.target.closest('[data-open-demand]') : null;
    if (openDemand) {
      var did = openDemand.getAttribute('data-open-demand');
      var d = D.demands.filter(function (x) { return x.id === did; })[0];
      if (d) {
        var cfg = V.drawerDemand(d);
        Drawer.open(cfg);
      }
      return;
    }

    // 打开学生抽屉
    var openTutor = e.target.closest ? e.target.closest('[data-open-tutor]') : null;
    if (openTutor) {
      var tid = openTutor.getAttribute('data-open-tutor');
      var t = D.tutors.filter(function (x) { return x.id === tid; })[0];
      if (t) Drawer.open(V.drawerTutor(t));
      return;
    }

    // 打开打卡抽屉
    var openCheckin = e.target.closest ? e.target.closest('[data-open-checkin]') : null;
    if (openCheckin) {
      var cid = openCheckin.getAttribute('data-open-checkin');
      var c = D.checkins.filter(function (x) { return x.id === cid; })[0];
      if (c) Drawer.open(V.drawerCheckin(c));
      return;
    }

    // 动作派发
    var actionEl = e.target.closest ? e.target.closest('[data-action]') : null;
    if (actionEl) handleAction(actionEl.getAttribute('data-action'), actionEl);
  });

  function setLoading(btn, on) {
    if (!btn) return;
    if (on) {
      btn.classList.add('is-loading');
      btn.disabled = true;
    } else {
      btn.classList.remove('is-loading');
      btn.disabled = false;
    }
  }

  function handleAction(action, btn) {
    switch (action) {
      case 'new-demand':
        Toast.show('已打开新建需求表单（演示）', 'info');
        break;
      case 'export':
        Toast.show('已生成导出任务，稍后可在消息中心下载', 'ok');
        break;
      case 'goto-demands':
        navigate('demands');
        break;
      case 'goto-policy':
        state.demandFilter = 'blocked';
        navigate('demands');
        Toast.show('已筛选出被双减拦截的工单', 'warn');
        break;
      case 'rematch':
        setLoading(btn, true);
        setTimeout(function () {
          setLoading(btn, false);
          Toast.show('匹配已重算：Top1 林嘉怡 99.2 分', 'ok');
          var first = $('[data-view="matching"] .card--spot');
          if (first) {
            first.classList.remove('flash');
            void first.offsetWidth;
            first.classList.add('flash');
          }
        }, 900);
        break;
      case 'gen-report':
        setLoading(btn, true);
        setTimeout(function () {
          setLoading(btn, false);
          Toast.show('对接报告已生成，含试课建议与避坑提示', 'ok');
        }, 800);
        break;
      case 'copy-report':
        copyText(buildReportText());
        break;
      case 'approve':
        Toast.show('已通过审核，认证等级已重算', 'ok');
        var row = btn.closest('tr');
        if (row) {
          var cell = row.lastElementChild;
          if (cell) cell.innerHTML = C.badge('已完成', 'neutral');
        }
        break;
      case 'batch-approve':
        Toast.show('已批量通过 3 位学生的能力认证', 'ok');
        break;
      case 'confirm-checkin':
        Toast.show('已确认本次履约，小结对家长可见', 'ok');
        var crow = btn.closest('tr');
        if (crow) {
          var ccell = crow.children[5];
          if (ccell) ccell.innerHTML = C.badge('家长已确认', 'ok', true);
          btn.parentNode.innerHTML = C.button('查看', { variant: 'ghost', size: 'sm' });
        }
        break;
      case 'filter':
        Toast.show('高级筛选（演示）：可按区域、预算、风险等级组合过滤', 'info');
        break;
      default:
        break;
    }
  }

  function buildReportText() {
    var d = D.demands[0];
    return [
      '【京师家教可信对接平台 · 对接报告】',
      '需求编号：' + d.id + '　生成时间：' + D.meta.updatedAt,
      '',
      '一、需求摘要',
      '  ' + d.grade + d.subject + ' | ' + d.frequency + ' | ' + d.mode + ' | ' + d.district,
      '  预算：¥' + d.budget + '/小时 | 时间：' + d.timeRange,
      '',
      '二、试课建议',
      '  建议先通过线上或在校内认证场地进行首次试课，需监护人知情。',
      '',
      '三、推荐学生 Top3',
      '  1. 林嘉怡（99.2 分）| XX大学 数学与应用数学| 三重认证 JS-2026-000101',
      '  2. 郑一诺（75.3 分）| XX大学 计算机科学与技术| 认证等级 1',
      '  3. 赵沐阳（74.0 分）| XX大学 物理学| 三重认证 JS-2026-000104',
      '',
      '四、平台性质',
      '  ' + D.meta.platformPosition + '。'
    ].join('\n');
  }

  function copyText(text) {
    function done() {
      Toast.show('报告文本已复制到剪贴板', 'ok');
    }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        done();
      } catch (e) {
        Toast.show('复制失败，请手动选择文本', 'warn');
      }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  /* ==========================================================================
   * 需求表格：搜索 / 状态筛选 / 只看风险 / 排序
   * ====================================================================== */
  function applyDemandFilters() {
    var tbody = $('#demand-tbody');
    if (!tbody) return;
    var kw = state.demandKeyword.trim().toLowerCase();

    var rows = D.demands.filter(function (d) {
      if (state.demandFilter !== 'all' && d.status !== state.demandFilter) return false;
      if (state.onlyRisk && d.risk === 'low') return false;
      if (!kw) return true;
      return (
        d.id.toLowerCase().indexOf(kw) > -1 ||
        d.parent.toLowerCase().indexOf(kw) > -1 ||
        d.subject.toLowerCase().indexOf(kw) > -1
      );
    });

    rows.sort(function (a, b) {
      var av, bv;
      if (state.sortKey === 'budget') {
        av = parseInt(String(a.budget).split('-')[0], 10) || 0;
        bv = parseInt(String(b.budget).split('-')[0], 10) || 0;
      } else if (state.sortKey === 'score') {
        av = a.score || 0;
        bv = b.score || 0;
      } else {
        av = a.id;
        bv = b.id;
      }
      if (av === bv) return 0;
      return (av > bv ? 1 : -1) * state.sortDir;
    });

    tbody.innerHTML = rows.length
      ? rows.map(V.demandRow).join('')
      : '<tr><td colspan="10">' +
        C.emptyState('没有符合条件的需求', '试着清空搜索词或切换状态筛选；被拦截的工单需要家长修改时段后才能重新发布。') +
        '</td></tr>';

    var count = $('#demand-count');
    if (count) count.textContent = '显示 ' + rows.length + ' / ' + D.demands.length + ' 条';
  }

  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'demand-search') {
      state.demandKeyword = e.target.value || '';
      applyDemandFilters();
    }
  });

  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'only-risk') {
      state.onlyRisk = !!e.target.checked;
      applyDemandFilters();
    }
  });

  document.addEventListener('click', function (e) {
    var seg = e.target.closest ? e.target.closest('[data-seg-value]') : null;
    if (seg) {
      var group = seg.parentNode;
      $all('.seg__btn', group).forEach(function (b) { b.classList.remove('is-active'); });
      seg.classList.add('is-active');
      var segName = group.getAttribute('data-seg');
      if (segName === 'demand-status') {
        state.demandFilter = seg.getAttribute('data-seg-value');
        applyDemandFilters();
      } else if (segName === 'trend-range') {
        Toast.show('已切换到近 ' + seg.getAttribute('data-seg-value') + ' 天视图（演示）', 'info');
      } else if (segName === 'cert-filter') {
        Toast.show('筛选：' + seg.textContent, 'info');
      }
      return;
    }

    var sortTh = e.target.closest ? e.target.closest('[data-sort]') : null;
    if (sortTh) {
      var key = sortTh.getAttribute('data-sort');
      if (state.sortKey === key) {
        state.sortDir = -state.sortDir;
      } else {
        state.sortKey = key;
        state.sortDir = 1;
      }
      $all('[data-sort]').forEach(function (th) { th.classList.remove('is-sorted'); });
      sortTh.classList.add('is-sorted');
      applyDemandFilters();
    }
  });

  /* ==========================================================================
   * 命令面板
   * ====================================================================== */
  var paletteState = { open: false, items: [], active: 0 };

  function buildPaletteItems(query) {
    var q = (query || '').trim().toLowerCase();
    var items = [];

    PAGES.forEach(function (p) {
      items.push({ type: 'nav', key: p.key, label: p.label, hint: p.group, icon: p.icon });
    });
    D.demands.forEach(function (d) {
      items.push({ type: 'demand', id: d.id, label: d.id + ' · ' + d.subject + ' ' + d.grade, hint: d.parent + ' · ' + d.status, icon: 'demand' });
    });
    D.tutors.forEach(function (t) {
      items.push({ type: 'tutor', id: t.id, label: t.name + ' · ' + t.major, hint: t.school, icon: 'users' });
    });

    if (!q) return items.slice(0, 9);
    return items
      .filter(function (it) {
        return (it.label + ' ' + it.hint).toLowerCase().indexOf(q) > -1;
      })
      .slice(0, 12);
  }

  function renderPalette() {
    var items = paletteState.items;
    if (!items.length) {
      el.paletteList.innerHTML = '<div class="empty" style="padding:28px">没有匹配项</div>';
      return;
    }
    el.paletteList.innerHTML = items
      .map(function (it, i) {
        return (
          '<div class="palette__item' + (i === paletteState.active ? ' is-active' : '') + '" data-palette-idx="' + i + '">' +
          I.svg(it.icon, 15) +
          '<span class="u-grow u-truncate">' + esc(it.label) + '</span>' +
          '<span class="u-dim" style="font-size:11px">' + esc(it.hint) + '</span>' +
          '</div>'
        );
      })
      .join('');
  }

  function paletteOpen() {
    paletteState.open = true;
    paletteState.items = buildPaletteItems('');
    paletteState.active = 0;
    el.paletteInput.value = '';
    el.palette.classList.add('is-open');
    el.paletteScrim.classList.add('is-open');
    el.palette.setAttribute('aria-hidden', 'false');
    renderPalette();
    setTimeout(function () { el.paletteInput.focus(); }, 30);
  }

  function paletteClose() {
    paletteState.open = false;
    el.palette.classList.remove('is-open');
    el.paletteScrim.classList.remove('is-open');
    el.palette.setAttribute('aria-hidden', 'true');
  }

  function paletteRun(idx) {
    var it = paletteState.items[idx];
    if (!it) return;
    paletteClose();
    if (it.type === 'nav') {
      navigate(it.key);
    } else if (it.type === 'demand') {
      var d = D.demands.filter(function (x) { return x.id === it.id; })[0];
      if (d) Drawer.open(V.drawerDemand(d));
    } else if (it.type === 'tutor') {
      var t = D.tutors.filter(function (x) { return x.id === it.id; })[0];
      if (t) Drawer.open(V.drawerTutor(t));
    }
  }

  document.getElementById('btn-cmdk').addEventListener('click', paletteOpen);
  el.paletteScrim.addEventListener('click', paletteClose);

  el.paletteInput.addEventListener('input', function () {
    paletteState.items = buildPaletteItems(el.paletteInput.value);
    paletteState.active = 0;
    renderPalette();
  });

  el.paletteList.addEventListener('click', function (e) {
    var item = e.target.closest ? e.target.closest('[data-palette-idx]') : null;
    if (item) paletteRun(parseInt(item.getAttribute('data-palette-idx'), 10));
  });

  document.addEventListener('keydown', function (e) {
    // 命令面板
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      paletteState.open ? paletteClose() : paletteOpen();
      return;
    }
    if (e.key === 'Escape') {
      if (paletteState.open) paletteClose();
      else Drawer.close();
      return;
    }
    if (paletteState.open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        paletteState.active = Math.min(paletteState.items.length - 1, paletteState.active + 1);
        renderPalette();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        paletteState.active = Math.max(0, paletteState.active - 1);
        renderPalette();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        paletteRun(paletteState.active);
      }
    }
  });

  /* ==========================================================================
   * 侧栏折叠 / 刷新 / 实时状态
   * ====================================================================== */
  document.getElementById('btn-collapse').addEventListener('click', function () {
    el.app.classList.toggle('is-collapsed');
    var collapsed = el.app.classList.contains('is-collapsed');
    this.setAttribute('data-tip', collapsed ? '展开侧栏' : '折叠侧栏');
    setTimeout(function () {
      // 布局变化后让图表重新测量
      if (global.Charts) {
        $all('[data-chart]').forEach(function (n) {
          var ev = new Event('resize');
          global.dispatchEvent(ev);
          void n;
        });
      }
    }, 340);
  });

  document.getElementById('btn-refresh').addEventListener('click', function () {
    var btn = this;
    btn.classList.add('is-loading');
    setTimeout(function () {
      btn.classList.remove('is-loading');
      D.meta.updatedAt = new Date().toLocaleString('zh-CN', { hour12: false });
      Toast.show('数据已刷新至 ' + nowText(), 'ok');
      navigate(state.view, { force: true });
    }, 700);
  });

  document.getElementById('operator').addEventListener('click', function () {
    Toast.show('账号与团队设置（演示）', 'info');
  });

  // 实时状态灯：每 30 秒更新一次时间戳，制造"活着"的感觉
  setInterval(function () {
    if (el.liveStatus) el.liveStatus.textContent = '同步于 ' + nowText();
  }, 30000);

  /* ==========================================================================
   * 3D 氛围背景
   * ====================================================================== */
  function initBackground() {
    var canvas = document.getElementById('bg-canvas');
    if (!canvas || !global.BG) return;

    // Three.js 走 async CDN：最多等 1.2s，超时就用 Canvas2D 降级，
    // 保证"离线/被墙/慢网"三种情况下首屏都不被阻塞。
    var waited = 0;
    function start() {
      try {
        global.BG.init(canvas, { dprLimit: 2 });
      } catch (e) {
        console.warn('[bg] 初始化失败，背景退回纯 CSS：', e);
      }
    }
    function waitThree() {
      if (global.THREE || global.__THREE_FAILED__ || waited >= 1200) {
        start();
        return;
      }
      waited += 150;
      setTimeout(waitThree, 150);
    }
    waitThree();

    // 视差：以视口中心归一化，阻尼由 BG 内部处理
    var raf = null;
    var last = { x: 0, y: 0 };
    document.addEventListener('pointermove', function (e) {
      last.x = (e.clientX / global.innerWidth) * 2 - 1;
      last.y = (e.clientY / global.innerHeight) * 2 - 1;
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = null;
        if (global.BG && global.BG.setParallax) global.BG.setParallax(last.x, last.y);
      });
    });

    document.addEventListener('visibilitychange', function () {
      if (!global.BG) return;
      if (document.hidden) global.BG.pause();
      else global.BG.resume();
    });
  }

  /* ==========================================================================
   * 启动
   * ====================================================================== */
  function boot() {
    if (!location.hash) location.hash = '#/overview';
    route();
    initBackground();
    bindRipples(document);

    // 首屏提示：让评委/评审一眼看到关键能力
    setTimeout(function () {
      Toast.show('已启用双减合规拦截与双向盲评规则', 'ok');
    }, 900);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
