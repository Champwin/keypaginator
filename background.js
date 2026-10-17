/* background.js — 初始化默认配置、处理少量后台消息 */
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
    cgResetDirty: false
  };

  /* 首次安装 / 升级时补齐缺失的配置项 */
  api.runtime.onInstalled.addListener(() => {
    try {
      api.storage.local.get(DEFAULTS, cur => {
        const next = Object.assign({}, DEFAULTS, cur || {});
        api.storage.local.set(next);
      });
    } catch (e) { /* noop */ }
  });

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'KP_OPEN_OPTIONS') {
      try { api.runtime.openOptionsPage(); sendResponse({ ok: true }); } catch (e) { sendResponse({ ok: false }); }
      return true;
    }
    return undefined;
  });
})();
