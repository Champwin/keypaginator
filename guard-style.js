/* =========================================================================
 * guard-style.js — 阅读配色「回退桥接」（绝不铺白）
 * -------------------------------------------------------------------------
 * 职责变化（2026-10-18）：
 *   旧版：在 document_start 无条件注入白色兜底（html/body 白底黑字），
 *        这是白闪的根因，已移除。
 *   新版：仅在「本站点此前已被应用过配色」时，于 document_start 立即注入
 *        **用户配置好的**背景/文字色，形成双保险（与 background.js 的动态注入
 *        口径一致）。未配置 / 未缓存的站点一律不Inject，绝不铺白。
 *
 * 数据来源：contrast.js 应用配色后写入 localStorage.__kp_theme__
 *   { bg, fg, host, allHosts, hosts:[...], ts }。该键按源站（origin）隔离，
 *   不会跨站泄露，也只在用户自己启用配色后才会存在。
 *
 * 作用判定（与 background.js 动态注入、contrast.js 作用范围保持一致）：
 *   - allHosts=true             → 注入
 *   - 当前 host 命中 hosts 名单  → 注入
 *   - 当前 host === 缓存 host    → 注入（覆盖启发式模式下按站点记忆的情形）
 *   - 其它                       → 不注入
 * ========================================================================= */
(function () {
  'use strict';
  if (window.__kpGuardInjected) return;
  window.__kpGuardInjected = true;

  const KEY = '__kp_theme__';

  function hostMatch(pattern, hostname) {
    if (!pattern) return false;
    const p = String(pattern).toLowerCase().replace(/^\*\./, '').replace(/^www\./, '');
    const h = String(hostname || '').toLowerCase().replace(/^www\./, '');
    return !!p && (h === p || h.endsWith('.' + p));
  }

  /** 判断当前站点是否应注入已缓存的配色；返回缓存对象或 null */
  function shouldInject() {
    let raw;
    try { raw = localStorage.getItem(KEY); } catch (e) { return null; }
    if (!raw) return null;
    let data;
    try { data = JSON.parse(raw); } catch (e) { return null; }
    if (!data || !data.bg || !data.fg) return null;
    if (data.allHosts) return data;
    const list = Array.isArray(data.hosts) ? data.hosts : [];
    if (list.some(p => hostMatch(p, location.hostname))) return data;
    if (data.host && (data.host === location.hostname || location.hostname.endsWith('.' + data.host))) {
      return data;
    }
    return null;
  }

  function inject(data) {
    const bg = data.bg, fg = data.fg;
    const P = 'html:root:root ';
    const CONTENT_SEL = '#article-content,.reader-text,.reader-card,.chapter-content,#content,.txtnav';
    const TEXT_TAGS = ['p', 'li', 'dd', 'dt', 'blockquote', 'pre',
      'em', 'strong', 'b', 'i', 'small', 'u', 'label', 'td', 'th', 'figcaption'];
    const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
    const isLight = (function (hex) {
      const m = String(hex || '').trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
      if (!m) return true;
      let h = m[1];
      if (h.length === 3) h = h.split('').map(c => c + c).join('');
      const srgbToLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      const L = (r, g, b) => 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
      return L(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)) >= 0.18;
    })(bg);

    const rules = [];
    rules.push(P + '{' +
      'background-color:' + bg + ' !important;' +
      'color-scheme:' + (isLight ? 'light' : 'dark') + ' !important;' +
      '--custom-bg:' + bg + ' !important;--custom-text:' + fg + ' !important;}');
    rules.push(P + 'body{background-color:' + bg + ' !important;color:' + fg + ' !important;}'); // 正文容器及其后代
    CONTENT_SEL.split(',').map(s => s.trim()).filter(Boolean).forEach(c => {
      rules.push(P + c + '{color:' + fg + ' !important;background-color:transparent !important;}');
      TEXT_TAGS.forEach(t => rules.push(P + c + ' ' + t + '{color:' + fg + ' !important;}'));
    });
    TEXT_TAGS.forEach(t => rules.push(P + 'body ' + t + '{color:' + fg + ' !important;}'));
    HEADINGS.forEach(h => rules.push(P + h + '{color:' + fg + ' !important;}'));
    const css = rules.join('');

    let el = document.getElementById('__kp_guard_style__');
    if (el) { try { el.textContent = css; } catch (e) { /* noop */ } return; }
    try {
      el = document.createElement('style');
      el.id = '__kp_guard_style__';
      el.textContent = css;
      (document.head || document.documentElement).appendChild(el);
    } catch (e) { /* noop */ }
  }

  const data = shouldInject();
  if (data) inject(data);
})();
