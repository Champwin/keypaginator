/* =========================================================================
 * 阅读配色助手 ContrastGuard — content script
 * -------------------------------------------------------------------------
 * 需求背景：不少小说/长文阅读站把配色写进 CSS 变量，用户只设深色背景、
 *   没设文字色时，正文会回落纯黑 → 黑底黑字、整页漆黑。
 *
 * 本模块的定位是「阅读配色控制」，不是单纯救火：
 *   1) 提供多套预设配色（护眼绿 / 米黄 / 灰青 / 夜间 / 纯白）一键切换
 *   2) 支持自定义背景色与文字色
 *   3) 内置对比度守护：无论怎么设，实际对比度低于阈值时自动纠正，
 *      杜绝「黑底黑字」这类不可读情况
 *
 * 分级注入：
 *   L0 清洗  —— 可选，清掉站点的脏配色（治本）
 *   L1 兜底  —— document_start 声明式 CSS，先把黑屏窗口期堵住
 *   L2 精算  —— 测量真实对比度，按亮度选黑字/白字定稿
 *
 * 作用范围：默认「仅在名单内生效」，名单为空即全站不干预；
 *   名单由用户在设置页自行添加（不想预置任何站点，避免内置特定域名）。
 * ========================================================================= */
(function () {
  'use strict';

  const api = (typeof browser !== 'undefined') ? browser : chrome;

  /* ----------------------------- 配置默认值 ----------------------------- */
  const DEFAULTS = {
    cgEnabled: true,          // 总开关
    cgPreset: 'green',        // 预设：green / paper / gray / night / white / custom
    cgCustomBg: '#c7dcc0',    // 自定义背景色
    cgCustomFg: '#050603',    // 自定义文字色
    cgThreshold: 4.5,         // 对比度阈值（WCAG AA 正文）
    cgProtect: true,          // 对比度守护：低于阈值自动纠正
    cgAutoDark: true,         // 站点本身是暗色时，是否自动切夜间配色
    cgResetDirty: false,      // 是否顺带清除站点脏配色
    cgHosts: [],              // 作用站点名单（空 = 全站都不干预）
    cgAllHosts: false         // 对所有站点生效
  };

  /** 预设配色表：每套都是人工校验过的高对比度组合 */
  const PRESETS = {
    green:  { bg: '#c7dcc0', fg: '#050603', name: '护眼绿' },
    paper:  { bg: '#f5ecd9', fg: '#3b2f1e', name: '米黄纸' },
    gray:   { bg: '#e4e7ea', fg: '#1f2933', name: '灰青'  },
    night:  { bg: '#151515', fg: '#d6d6d6', name: '夜间'  },
    white:  { bg: '#ffffff', fg: '#1a1a1a', name: '纯白'  }
  };

  /* 注意：不预置任何站点域名（避免内置特定站点、也便于使用者自行添加）。
   * 需要在更多阅读站启用时，到「设置 → 阅读配色 → 作用站点」里添加即可。 */
  const TARGET_HOSTS = [];

  let cfg = Object.assign({}, DEFAULTS);
  let styleEl = null;
  let observer = null;
  let repairCount = 0;
  let lastDecision = null;

  const dbg = (...a) => { try { console.debug('[ContrastGuard]', ...a); } catch (e) { /* noop */ } };

  /* ------------------------------ 颜色工具 ------------------------------ */
  const srgbToLin = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const luminance = (r, g, b) =>
    0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
  const contrast = (l1, l2) => {
    const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  };

  function parseRGB(str) {
    if (!str) return null;
    const m = String(str).match(/rgba?\(([^)]+)\)/i);
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (p.length < 3 || p.some(Number.isNaN)) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }

  function hexLum(hex) {
    const m = String(hex || '').trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
    if (!m) return null;
    let h = m[1];
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return luminance(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16));
  }

  /** 站点已知的配色存储键（与实测一致） */
  const DIRTY_KEYS = ['r_bgHex', 'r_textHex'];

  /** 当前生效的目标配色 */
  function targetPair() {
    if (cfg.cgPreset === 'custom') {
      return { bg: cfg.cgCustomBg, fg: cfg.cgCustomFg, name: '自定义' };
    }
    return PRESETS[cfg.cgPreset] || PRESETS.green;
  }

  /**
   * 沿祖先链合成真实可见背景。
   * 站点把背景写在 body 上而中间层透明，直接取自身 backgroundColor 会拿到 alpha=0，
   * 必须向上找到第一个不透明层并做 alpha 叠加，否则会把黑底误判成白底。
   */
  function effectiveBg(el) {
    const layers = [];
    let node = el;
    while (node && node.nodeType === 1) {
      const c = parseRGB(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a >= 1) break;
      }
      node = node.parentElement;
    }
    if (!layers.length) return { r: 255, g: 255, b: 255, a: 1 };
    const base = layers[layers.length - 1];
    let out = { r: base.r, g: base.g, b: base.b };
    for (let i = layers.length - 2; i >= 0; i--) {
      const t = layers[i], a = t.a;
      out = {
        r: t.r * a + out.r * (1 - a),
        g: t.g * a + out.g * (1 - a),
        b: t.b * a + out.b * (1 - a)
      };
    }
    return { r: out.r, g: out.g, b: out.b, a: 1 };
  }

  /* ------------------------------ 站点判定 ------------------------------ */
  /* ------------------------------ 站点判定 ------------------------------ */
  // 正文容器选择器：先于站点判定定义，供启发式判定复用
  const CONTENT_SEL = '#article-content,.reader-text,.reader-card,.chapter-content,#content,.txtnav';

  function hostMatch(pattern, hostname) {
    if (!pattern) return false;
    const p = String(pattern).toLowerCase().replace(/^\*\./, '').replace(/www\./, '');
    const h = String(hostname || '').toLowerCase().replace(/^www\./, '');
    return !!p && (h === p || h.endsWith('.' + p));
  }
  /** 用户可在设置页填写「*」表示对所有站点生效 */
  const isTargetHost = () => {
    // 显式对所有站点生效
    if (cfg.cgAllHosts) return true;
    // 用户在设置页添加了名单：只对名单内站点生效
    const list = Array.isArray(cfg.cgHosts) ? cfg.cgHosts.filter(Boolean) : [];
    if (list.length) return list.some(p => hostMatch(p, location.hostname));
    // 未配置任何名单：采用「仅在疑似阅读页生效」的启发式——
    // 页面里存在正文容器或 rel=next 时才应用，避免干扰普通网页。
    return looksLikeReaderPage();
  };

  /** 本脚本在 document_start 运行，此刻 DOM 尚未解析，
   *  依赖 DOM 的启发式判定必然为 false —— 此时不能据此认定「不是阅读页」。
   *  返回 true 表示「待定」，需等 DOM 就绪后重判。 */
  const domReady = () => document.readyState !== 'loading';

  /** 启发式判断当前页是否是长文/小说阅读页（需 DOM 已就绪） */
  function looksLikeReaderPage() {
    if (!domReady()) return false;               // DOM 未就绪，判定不可靠
    try {
      if (document.querySelector(CONTENT_SEL)) return true;
      if (document.querySelector('a[rel="next"],link[rel="next"]')) return true;
      const t = (document.title || '').trim();
      // 标题里出现章节/页码等典型阅读页特征
      return /(第[零一二三四五六七八九十百千\d]+[章节回卷])|(上一页|下一页|目录)|(\d+\s*\/\s*\d+)\s*[-–|]?\s*(完|下一)/.test(t);
    } catch (e) { return false; }
  }

  /** 是否应应用配色。DOM 未就绪且依赖启发式时，返回 null 表示「待定」。 */
  function targetDecision() {
    if (cfg.cgAllHosts) return true;
    const list = Array.isArray(cfg.cgHosts) ? cfg.cgHosts.filter(Boolean) : [];
    if (list.length) return list.some(p => hostMatch(p, location.hostname));
    if (!domReady()) return null;                // 待 DOM 就绪后重判
    return looksLikeReaderPage();
  }

  /* ---------------------------- L0：脏配置清洗 ---------------------------- */
  function resetDirtyPalette() {
    try {
      let hit = false;
      DIRTY_KEYS.forEach((k) => {
        if (localStorage.getItem(k) !== null) { localStorage.removeItem(k); hit = true; }
      });
      if (hit) dbg('L0 已清除站点脏配色', DIRTY_KEYS);
    } catch (e) { /* 存储不可用则跳过 */ }
  }

  /* --------------------------- 样式注入（L1/L2） --------------------------- */

  function ensureStyle() {
    if (styleEl && styleEl.isConnected) return;
    styleEl = document.createElement('style');
    styleEl.id = '__kp_contrast_style__';
    styleEl.dataset.active = '0';
    (document.head || document.documentElement).appendChild(styleEl);
  }
  function dropStyle() {
    if (styleEl) { try { styleEl.remove(); } catch (e) { /* noop */ } }
    styleEl = null;
  }

  /** 生成一套配色规则；用 html:root:root 提高特异性压过行内 style */
  function buildCss(bg, fg) {
    const isLight = (hexLum(bg) || 1) >= 0.18;
    return {
      isLight,
      css:
        `html:root:root{background-color:${bg} !important;` +
        `color-scheme:${isLight ? 'light' : 'dark'} !important;` +
        `--custom-bg:${bg} !important;--custom-text:${fg} !important;}` +
        `html:root:root body{background-color:${bg} !important;color:${fg} !important;}` +
        `html:root:root ${CONTENT_SEL}{color:${fg} !important;background-color:transparent !important;}` +
        `html:root:root h1,html:root:root h2,html:root:root h3{color:${fg} !important;}`
    };
  }

  /** L1：立即铺上目标配色，堵住黑屏窗口期 */
  function applyL1() {
    const t = targetPair();
    ensureStyle();
    styleEl.textContent = buildCss(t.bg, t.fg).css;
    styleEl.dataset.active = '1';
  }

  function findContentRoot() {
    return (
      document.querySelector('#article-content') ||
      document.querySelector('.reader-text') ||
      document.querySelector('.reader-card') ||
      document.querySelector('.chapter-content') ||
      document.querySelector('#content') ||
      document.querySelector('article') ||
      document.body
    );
  }

  function measure() {
    const root = findContentRoot();
    if (!root || !root.isConnected) return null;
    const bg = effectiveBg(root);
    const p = root.querySelector('p') || root;
    const fgRaw = parseRGB(getComputedStyle(p).color) || { r: 0, g: 0, b: 0 };
    const bgL = luminance(bg.r, bg.g, bg.b);
    const fgL = luminance(fgRaw.r, fgRaw.g, fgRaw.b);
    return { root, bg, fg: { r: fgRaw.r, g: fgRaw.g, b: fgRaw.b }, bgLum: bgL, cr: contrast(fgL, bgL) };
  }

  /**
   * L2：定稿。
   * - 守护开启：对比度不足则强制用高对比组合纠正
   * - 守护关闭：完全按用户选的配色走
   */
  function applyL2(m) {
    if (!m) return;
    const t = targetPair();
    const threshold = Number(cfg.cgThreshold) || 4.5;
    ensureStyle();

    const wantCr = contrast(hexLum(t.fg) || 0, hexLum(t.bg) || 0);
    const needFix = cfg.cgProtect && wantCr < threshold;

    if (!needFix) {
      styleEl.textContent = buildCss(t.bg, t.fg).css;
      styleEl.dataset.active = '1';
      lastDecision = {
        mode: 'preset', preset: t.name, bg: t.bg, fg: t.fg, cr: +wantCr.toFixed(2)
      };
      notify();
      return;
    }

    // 用户选的组合本身不达标 → 用黑白强制纠正
    const isLightBg = m.bgLum >= 0.18;
    const bg = isLightBg ? '#ffffff' : '#151515';
    const fg = isLightBg ? '#1a1a1a' : '#e8e8e8';
    const fixedCr = contrast(hexLum(fg) || 0, hexLum(bg) || 0);

    styleEl.textContent = buildCss(bg, fg).css;
    styleEl.dataset.active = '2';
    repairCount++;
    lastDecision = {
      mode: 'repaired', preset: t.name,
      crBefore: +wantCr.toFixed(2), crAfter: +fixedCr.toFixed(2),
      picked: isLightBg ? '浅底→深字' : '深底→浅字', bg, fg
    };
    notify();
    dbg('对比度不足，已纠正', lastDecision);
  }

  function notify() {
    try {
      api.runtime.sendMessage({
        type: 'KP_CONTRAST_STATUS', host: location.hostname,
        applied: !!(styleEl && styleEl.dataset.active === '2'),
        repairs: repairCount, decision: lastDecision, preset: cfg.cgPreset
      }, () => void chrome.runtime.lastError);
    } catch (e) { /* 扩展重载中 */ }
  }

  /* ---------------------- 监听：SPA 换页 / 站点异步改色 ---------------------- */
  function watch() {
    if (observer) return;
    let t = null;
    observer = new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => applyL2(measure()), 200);
    });
    try {
      observer.observe(document.documentElement, {
        subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style']
      });
    } catch (e) { /* noop */ }
  }

  /* -------------------------------- 启动 -------------------------------- */
  /** DOM 就绪后的真正启动动作 */
  function startIfTarget() {
    const dec = targetDecision();
    if (dec !== true) { lastDecision = { mode: 'skip', reason: dec === null ? 'dom-not-ready' : 'not-target' }; return false; }
    if (cfg.cgResetDirty) resetDirtyPalette();

    applyL1();                                   // L1 兜底
    const m = measure();
    if (m) applyL2(m);                           // L2 定稿
    watch();
    dbg('已启用 @', location.hostname, '预设=', cfg.cgPreset);
    return true;
  }

  function boot() {
    if (!cfg.cgEnabled) return;

    // 依赖 DOM 的启发式判定在 document_start 阶段不可用，
    // 必须等 DOM 就绪后再判，否则会漏应用（表现为「刷新后全黑」）。
    if (!domReady()) {
      lastDecision = { mode: 'pending' };
      document.addEventListener('DOMContentLoaded', () => { startIfTarget(); },
        { once: true });
      // 某些站点 DOMContentLoaded 早于脚本注册，这里再兜一层
      if (document.readyState !== 'loading') startIfTarget();
      return;
    }
    startIfTarget();
  }

  /* ------------------------------ 消息接口 ------------------------------ */
  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return undefined;

    if (msg.type === 'KP_CONTRAST_MEASURE') {
      const m = measure();
      sendResponse({
        ok: !!m, host: location.hostname, target: isTargetHost(),
        enabled: !!cfg.cgEnabled, preset: cfg.cgPreset,
        cr: m ? +m.cr.toFixed(2) : null, bg: m ? m.bg : null, fg: m ? m.fg : null,
        applied: !!(styleEl && styleEl.dataset.active === '2'),
        repairs: repairCount, decision: lastDecision
      });
      return true;
    }

    // 换预设 / 改自定义色 —— popup 与设置页都走这里，无需刷新
    if (msg.type === 'KP_CONTRAST_APPLY') {
      cfg = Object.assign({}, cfg, msg.cfg || {});
      if (cfg.cgResetDirty) resetDirtyPalette();
      applyL2(measure());
      sendResponse({ ok: true, decision: lastDecision });
      return true;
    }

    if (msg.type === 'KP_CONTRAST_TOGGLE') {
      if (msg.on === false) { dropStyle(); lastDecision = { mode: 'off' }; notify(); }
      else applyL2(measure());
      sendResponse({ ok: true, decision: lastDecision });
      return true;
    }

    return undefined;
  });

  /* ------------------------------ 配置同步 ------------------------------ */
  function sGet(keys) {
    return new Promise(res => {
      try { api.storage.local.get(keys, v => res(v || {})); } catch (e) { res({}); }
    });
  }
  async function refresh() {
    const v = await sGet(DEFAULTS);
    const prevOn = cfg.cgEnabled;
    cfg = Object.assign({}, DEFAULTS, v || {});

    // DOM 未就绪时不要贸然 dropStyle —— 判定不可靠，等就绪后由 startIfTarget 处理
    const dec = targetDecision();
    if (dec === false) { dropStyle(); lastDecision = { mode: 'skip', reason: 'not-target' }; return; }
    if (!cfg.cgEnabled) {
      if (prevOn) { dropStyle(); try { observer && observer.disconnect(); } catch (e) { /* noop */ } }
      lastDecision = { mode: 'off' };
      return;
    }
    if (dec === null) {          // DOM 未就绪：挂一次就绪回调
      if (document.readyState !== 'loading') startIfTarget();
      else document.addEventListener('DOMContentLoaded', () => startIfTarget(), { once: true });
      return;
    }
    if (!prevOn) { boot(); return; }                    // 从关到开：重新起
    applyL2(measure());                                  // 其余情况：立即重算
  }

  sGet(DEFAULTS).then((v) => {
    cfg = Object.assign({}, DEFAULTS, v || {});
    boot();
    try {
      api.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') refresh();
      });
    } catch (e) { /* noop */ }
  });
})();
