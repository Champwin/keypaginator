/* =========================================================================
 * background.js — 初始化默认配置、处理后台消息、
 *   动态注册「阅读配色」内容脚本（在 document_start 首屏绘制前注入配置色，消除白闪）
 * -------------------------------------------------------------------------
 * 为什么需要动态注册，而不是靠 guard.css 静态白兜底：
 *   旧版 guard.css 在 document_start 给所有网址无条件铺白底，导致翻页（每次新导航）
 *   都先白底、~800ms 后 contrast.js 才换成配置色 —— 白闪无法避免。
 *   这里改为：后台读取阅读配色配置，生成与 contrast.js buildCss 完全同步的 CSS，
 *   用 browser.contentScripts.register 按域名在 document_start 注入**用户配置好的**
 *   背景/文字色。首屏即正确上色，既不白闪也不黑屏。
 *
 * 作用范围与 contrast.js 保持一致：
 *   - cgAllHosts=true        → 注册 <all_urls>
 *   - cgHosts 有名单         → 按名单生成 *://host/* 与 *://*.host/*
 *   - 两者皆空（启发式模式）→ 不在此强注（交给 contrast.js + guard-style 桥接，
 *                             不在 document_start 对未知页面强加配色）
 *
 * ★ 同步约束：buildThemeCss / CONTENT_SEL / TEXT_TAGS / HEADINGS / PRESETS 必须与
 *   contrast.js 的 buildCss 与 PRESETS 保持完全一致，否则会出现"背景对了、文字没对"
 *   之类的口径不一致。改动一处须同步另一处。
 * ========================================================================= */
(function () {
  'use strict';
  const api = (typeof browser !== 'undefined') ? browser : chrome;

  const DEFAULTS = {
    enabled: true,
    nextKeys: ['ArrowRight', 'Alt+KeyN'],
    prevKeys: ['ArrowLeft', 'Alt+KeyP'],
    highlightMs: 150,
    showToast: true,
    scrollTop: true,
    allowRepeat: false,
    disabledHosts: [],
    siteRules: [],
    /* ---- 阅读配色助手（contrast.js）---- */
    cgEnabled: true,
    cgPreset: 'green',       // green / paper / gray / night / white / custom
    cgCustomBg: '#c7dcc0',
    cgCustomFg: '#050603',
    cgThreshold: 4.5,
    cgProtect: true,
    cgAutoDark: true,
    cgResetDirty: false,
    cgHosts: [],
    cgAllHosts: false
  };

  /* ----------------- 与 contrast.js 同步的配色构造 ----------------- */
  const CONTENT_SEL = '#article-content,.reader-text,.reader-card,.chapter-content,#content,.txtnav';
  const TEXT_TAGS = ['p', 'li', 'dd', 'dt', 'blockquote', 'pre',
    'em', 'strong', 'b', 'i', 'small', 'u', 'label', 'td', 'th', 'figcaption'];
  const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  const PRESETS = {
    green:  { bg: '#c7dcc0', fg: '#050603' },
    paper:  { bg: '#f5ecd9', fg: '#3b2f1e' },
    gray:   { bg: '#e4e7ea', fg: '#1f2933' },
    night:  { bg: '#151515', fg: '#d6d6d6' },
    white:  { bg: '#ffffff', fg: '#1a1a1a' }
  };

  function hexLum(hex) {
    const m = String(hex || '').trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
    if (!m) return null;
    let h = m[1];
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const srgbToLin = (c) => {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const L = (r, g, b) => 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
    return L(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16));
  }

  /** 与 contrast.js buildCss 完全一致的 CSS 字符串 */
  function buildThemeCss(bg, fg) {
    const isLight = (hexLum(bg) || 1) >= 0.18;
    const P = 'html:root:root ';                 // 高特异性前缀，压过行内 style
    const containers = CONTENT_SEL.split(',').map(s => s.trim()).filter(Boolean);
    const rules = [];
    rules.push(P + '{' +
      'background-color:' + bg + ' !important;' +
      'color-scheme:' + (isLight ? 'light' : 'dark') + ' !important;' +
      '--custom-bg:' + bg + ' !important;--custom-text:' + fg + ' !important;}');
    rules.push(P + 'body{background-color:' + bg + ' !important;color:' + fg + ' !important;}');
    containers.forEach(c => {
      rules.push(P + c + '{color:' + fg + ' !important;background-color:transparent !important;}');
      TEXT_TAGS.forEach(t => rules.push(P + c + ' ' + t + '{color:' + fg + ' !important;}'));
    });
    TEXT_TAGS.forEach(t => rules.push(P + 'body ' + t + '{color:' + fg + ' !important;}'));
    HEADINGS.forEach(h => rules.push(P + h + '{color:' + fg + ' !important;}'));
    return rules.join('');
  }

  function presetBgFg(cfg) {
    if (cfg.cgPreset === 'custom') {
      return { bg: cfg.cgCustomBg || '#c7dcc0', fg: cfg.cgCustomFg || '#050603' };
    }
    return PRESETS[cfg.cgPreset] || PRESETS.green;
  }

  function hostToMatches(hosts) {
    const out = [];
    (hosts || []).forEach(p => {
      if (!p) return;
      const h = String(p).trim().toLowerCase()
        .replace(/^https?:\/\//, '').replace(/^\*\./, '')
        .replace(/^www\./, '').replace(/\/.*$/, '');
      if (!h) return;
      out.push('*://' + h + '/*');
      out.push('*://*.' + h + '/*');
    });
    // 去重
    return Array.from(new Set(out));
  }

  /* ----------------- 动态内容脚本注册 ----------------- */
  let registered = [];   // RegisteredContentScript 实例，便于反注册

  async function applyThemeScript() {
    // 先反注册旧实例，避免规则叠加
    for (const r of registered) { try { r.unregister(); } catch (e) { /* noop */ } }
    registered = [];

    let cfg;
    try {
      cfg = await new Promise(res => {
        try { api.storage.local.get(DEFAULTS, v => res(Object.assign({}, DEFAULTS, v || {}))); }
        catch (e) { res(Object.assign({}, DEFAULTS)); }
      });
    } catch (e) { cfg = Object.assign({}, DEFAULTS); }

    if (!cfg.cgEnabled) return;                 // 总开关关：不注入任何配色

    let matches;
    if (cfg.cgAllHosts) {
      matches = ['<all_urls>'];
    } else {
      matches = hostToMatches(cfg.cgHosts);
      if (!matches.length) return;              // 启发式模式：交给 contrast.js，不在此强注
    }

    const { bg, fg } = presetBgFg(cfg);
    const css = buildThemeCss(bg, fg);

    try {
      if (typeof api.contentScripts === 'undefined' || !api.contentScripts.register) {
        // 浏览器不支持动态注册：静默回退到 contrast.js（仍有 ~800ms 过渡，但不再铺白）
        return;
      }
      const reg = await api.contentScripts.register({
        matches: matches,
        css: [{ code: css }],
        runAt: 'document_start',
        allFrames: true
      });
      registered.push(reg);
    } catch (e) {
      // 注册失败（如权限不足）：回退到 contrast.js，不阻断扩展其它功能
      try { console.warn('[KeyPaginator] 动态配色注册失败，已回退 contrast.js：', e && e.message); } catch (x) { /* noop */ }
    }
  }

  /* ---------------------------- 生命周期 ---------------------------- */
  api.runtime.onInstalled.addListener(() => {
    try {
      api.storage.local.get(DEFAULTS, cur => {
        const next = Object.assign({}, DEFAULTS, cur || {});
        api.storage.local.set(next);
      });
    } catch (e) { /* noop */ }
    applyThemeScript();
  });

  if (api.runtime.onStartup) {
    api.runtime.onStartup.addListener(applyThemeScript);
  }

  try {
    api.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') applyThemeScript();
    });
  } catch (e) { /* noop */ }

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'KP_OPEN_OPTIONS') {
      try { api.runtime.openOptionsPage(); sendResponse({ ok: true }); }
      catch (e) { sendResponse({ ok: false }); }
      return true;
    }
    if (msg && msg.type === 'KP_THEME_RELOAD') {
      applyThemeScript();
      sendResponse({ ok: true });
      return true;
    }
    return undefined;
  });
})();
