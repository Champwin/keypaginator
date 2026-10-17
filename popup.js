/* popup.js — 快速开关与当前页识别结果 */
(function () {
  'use strict';
  const api = (typeof browser !== 'undefined') ? browser : chrome;

  const DEFAULTS = {
    enabled: true,
    nextKeys: ['ArrowRight', 'Alt+KeyN'],
    prevKeys: ['ArrowLeft', 'Alt+KeyP'],
    disabledHosts: [],
    siteRules: [],
    cgEnabled: true,
    cgPreset: 'green',
    cgCustomBg: '#c7dcc0',
    cgCustomFg: '#050603'
  };

  const $ = id => document.getElementById(id);
  let tabId = null;
  let host = '';
  let state = Object.assign({}, DEFAULTS);

  function get(keys) {
    return new Promise(res => { try { api.storage.local.get(keys, v => res(v || {})); } catch (e) { res({}); } });
  }
  function set(obj) { try { api.storage.local.set(obj); } catch (e) { /* noop */ } }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }

  async function init() {
    const cfg = Object.assign({}, DEFAULTS, await get(DEFAULTS));
    state = Object.assign({}, cfg);

    $('globalOn').checked = !!cfg.enabled;
    $('kNext').textContent = (cfg.nextKeys || []).join('  /  ') || '未设置';
    $('kPrev').textContent = (cfg.prevKeys || []).join('  /  ') || '未设置';
    $('dot').className = 'dot' + (cfg.enabled ? '' : ' off');
    syncCgUI();

    const tabs = await new Promise(res => {
      try { api.tabs.query({ active: true, currentWindow: true }, t => res(t || [])); } catch (e) { res([]); }
    });
    const tab = tabs && tabs[0];
    if (!tab) { tip('无法读取当前标签页信息。'); return; }
    tabId = tab.id;
    host = hostOf(tab.url || '');

    if (!host || /^(about|moz-extension|chrome|file):/.test(tab.url || '')) {
      tip('内置页面不支持注入脚本，请打开普通网页后重试。');
      $('hostOn').checked = true;
      $('hostOn').disabled = true;
      return;
    }

    const disabled = (cfg.disabledHosts || []).some(p => {
      const pp = String(p).toLowerCase().replace(/^\*\./, '').replace(/^www\./, '');
      return host === pp || host.endsWith('.' + pp);
    });
    $('hostOn').checked = !disabled;

    let probe = null;
    try {
      probe = await new Promise(res => {
        api.tabs.sendMessage(tabId, { type: 'KP_PROBE' }, r => res(r && r.ok ? r : null));
      });
    } catch (e) { probe = null; }

    if (!probe) {
      // 分别探测翻页与配色两个模块——只用 KP_PROBE 判定会把
      //「翻页正常但配色没生效」误报成「本页尚未注入脚本」。
      let contrast = null;
      try {
        contrast = await new Promise(res => {
          api.tabs.sendMessage(tabId, { type: 'KP_CONTRAST_MEASURE' }, r => res(r || null));
        });
      } catch (e) { contrast = null; }

      if (contrast) {
        tip(contrast.target === false
          ? '翻页正常；配色未作用于本页（该站不在作用范围或非阅读页）。'
          : '翻页正常；配色已注入但未启用（请检查「阅读配色」总开关）。');
      } else {
        // 常见成因：about:debugging 点了「重新载入」但没刷新网页。
        // Firefox 不会把新 code 注入已打开的标签页——必须 F5 刷新。
        tip('本页没有扩展脚本。\n若刚在 about:debugging 点了「重新载入」，'
          + '必须再刷新本网页（F5）才会生效。');
      }
      $('dNext').textContent = '—';
      $('dPrev').textContent = '—';
      return;
    }

    setText('dNext', probe.next);
    setText('dPrev', probe.prev);
    if (!probe.next && !probe.prev) {
      tip('本页没自动识别到翻页元素。可点「打开完整设置」为该站点手写 CSS 选择器。', true);
    }
  }

  function setText(id, val) {
    const el = $(id);
    if (val) { el.textContent = val.length > 28 ? val.slice(0, 28) + '…' : val; el.className = 'v'; }
    else { el.textContent = '未识别'; el.className = 'v empty'; }
  }

  function tip(msg, warn) {
    const t = $('tip');
    t.textContent = msg;
    t.className = 'tip' + (warn ? ' warn' : '');
  }

  $('globalOn').addEventListener('change', e => {
    set({ enabled: e.target.checked });
    $('dot').className = 'dot' + (e.target.checked ? '' : ' off');
  });

  $('hostOn').addEventListener('change', async e => {
    if (!host) return;
    const cfg = await get(DEFAULTS);
    let hosts = (cfg.disabledHosts || []).slice();
    if (e.target.checked) hosts = hosts.filter(h => h !== host && h.replace(/^\*\./, '') !== host);
    else if (hosts.indexOf(host) < 0) hosts.push(host);
    set({ disabledHosts: hosts });
    if (tabId != null) {
      try { api.tabs.sendMessage(tabId, { type: 'KP_CFG', cfg: Object.assign({}, DEFAULTS, cfg, { disabledHosts: hosts }) }); } catch (err) { /* noop */ }
    }
  });

  $('opt').addEventListener('click', () => {
    try { api.runtime.openOptionsPage(); } catch (e) { /* noop */ }
  });

  /* --------------------------- 阅读配色快速切换 --------------------------- */
  function syncCgUI() {
    $('cgOn').checked = !!state.cgEnabled;
    document.querySelectorAll('#cgPicks .pk').forEach((b) => {
      b.classList.toggle('on', state.cgPreset === b.dataset.p);
    });
    $('cgBg').value = state.cgCustomBg;
    $('cgFg').value = state.cgCustomFg;
    $('cgPicks').style.opacity = state.cgEnabled ? '1' : '.4';
    $('cgPicks').style.pointerEvents = state.cgEnabled ? '' : 'none';
  }

  async function applyCg(patch) {
    Object.assign(state, patch);
    syncCgUI();
    const cfg = Object.assign({}, DEFAULTS, state);
    set(cfg);
    if (tabId != null) {
      try { await api.tabs.sendMessage(tabId, { type: 'KP_CONTRAST_APPLY', cfg }); } catch (e) { /* 页面未注入 */ }
    }
    // 当前页是否在配色名单内，给个提示
    try {
      const r = await api.tabs.sendMessage(tabId, { type: 'KP_CONTRAST_MEASURE' });
      if (r && r.target === false) $('cgNote').textContent = '当前站点不在配色名单内';
      else if (r && r.decision && r.decision.mode === 'repaired') $('cgNote').textContent = '原配色不可读，已自动纠正';
      else $('cgNote').textContent = '点色块切换；改自定义色会自动切到自定义';
    } catch (e) { /* ignore */ }
  }

  $('cgOn').addEventListener('change', (e) => applyCg({ cgEnabled: e.target.checked }));
  document.querySelectorAll('#cgPicks .pk').forEach((b) => {
    b.addEventListener('click', () => applyCg({ cgPreset: b.dataset.p }));
  });
  $('cgBg').addEventListener('change', (e) => applyCg({ cgCustomBg: e.target.value, cgPreset: 'custom' }));
  $('cgFg').addEventListener('change', (e) => applyCg({ cgCustomFg: e.target.value, cgPreset: 'custom' }));

  $('test').addEventListener('click', () => {
    if (tabId == null) return;
    try {
      api.tabs.sendMessage(tabId, { type: 'KP_TEST', dir: 'next' }, r => {
        tip(r && r.ok ? ('已触发：' + (r.label || '翻页元素')) : '本页未找到翻页元素。', !(r && r.ok));
      });
    } catch (e) { tip('测试失败，请刷新页面后重试。', true); }
  });

  let started = false;
  function boot() { if (started) return; started = true; init(); }
  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();
})();
