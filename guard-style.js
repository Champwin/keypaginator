/* =========================================================================
 * guard-style.js — 「绝不黑屏」兜底（可被 JS 主动注入，不依赖浏览器 CSS 注入）
 * -------------------------------------------------------------------------
 * 为什么 guard.css 之外还要这一份：
 *   guard.css 走 manifest 的 content_scripts.css，由浏览器在 document_start
 *   注入，理论上最早。但不同浏览器/版本对它的处理可能有差异，一旦它没生效，
 *   「深色背景 + 无文字色」的黑底黑字就会直接暴露给用户。
 *   本文件提供同内容的 JS 注入版，在对比度模块启动时立即打进页面，
 *   形成双保险：任一路径生效即可避免全黑。
 *
 * ★ 与 guard.css 保持一致的硬性要求：
 *   规则必须**无条件**生效。曾有人给它加 `html.has-custom-text` 条件，
 *   而该class 由站点 Alpine 绑定、扩展自己从不添加 → 整份 CSS 静默失效。
 * ========================================================================= */
(function () {
  'use strict';
  if (window.__kpGuardInjected) return;
  window.__kpGuardInjected = true;

  const css =
    'html{color-scheme:light !important;' +
    '--custom-bg:#ffffff !important;--custom-text:#1a1a1a !important;' +
    'background-color:#ffffff !important;}' +
    'body{background-color:#ffffff !important;color:#1a1a1a !important;}' +
    '#article-content,.reader-text,.reader-card,.chapter-content,#content,.txtnav{' +
    'color:#1a1a1a !important;}' +
    '#article-content p,.reader-text p,.reader-card p,.chapter-content p,#content p,.txtnav p,' +
    '#article-content li,.reader-text li,.reader-card li,.chapter-content li,#content li,.txtnav li{' +
    'color:#1a1a1a !important;}';

  const inject = () => {
    try {
      if (document.getElementById('__kp_guard_style__')) return;
      const el = document.createElement('style');
      el.id = '__kp_guard_style__';
      el.textContent = css;
      (document.head || document.documentElement).appendChild(el);
    } catch (e) { /* noop */ }
  };

  inject();
  // document_start 时 head 可能尚未建立，等一下再试
  if (!document.head) {
    document.addEventListener('DOMContentLoaded', inject, { once: true });
    try {
      document.documentElement.appendChild(document.createElement('style'))
        .setAttribute('id', '__kp_guard_pending__');
    } catch (e) { /* noop */ }
  }
})();