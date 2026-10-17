/* options.js — 设置页 */
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
    /* ---- 阅读配色（contrast.js）---- */
    cgEnabled: true,
    cgPreset: 'green',
    cgCustomBg: '#c7dcc0',
    cgCustomFg: '#050603',
    cgThreshold: 4.5,
    cgProtect: true,
    cgAutoDark: true,
    cgResetDirty: false,
    /* 作用站点：默认为空 = 全站不干预，由使用者自行添加 */
    cgHosts: [],
    cgAllHosts: false
  };

  const CG_PRESET_DEFAULT = { bg: '#c7dcc0', fg: '#050603' };

  const PRESETS = {
    arrow:   { nextKeys: ['ArrowRight'], prevKeys: ['ArrowLeft'] },
    arrow2:  { nextKeys: ['ArrowDown'], prevKeys: ['ArrowUp'] },
    alt:     { nextKeys: ['Alt+KeyN'], prevKeys: ['Alt+KeyP'] },
    vim:     { nextKeys: ['KeyL'], prevKeys: ['KeyH'] },
    jk:      { nextKeys: ['KeyJ'], prevKeys: ['KeyK'] },
    dot:     { nextKeys: ['Period'], prevKeys: ['Comma'] },
    page:    { nextKeys: ['PageDown'], prevKeys: ['PageUp'] },
    space:   { nextKeys: ['Space'], prevKeys: ['Shift+Space'] },
    bracket: { nextKeys: ['BracketRight'], prevKeys: ['BracketLeft'] }
  };

  const $ = id => document.getElementById(id);

  function get(keys) {
    return new Promise(res => { try { api.storage.local.get(keys, v => res(v || {})); } catch (e) { res({}); } });
  }
  function set(obj) {
    return new Promise(res => { try { api.storage.local.set(obj, () => res(true)); } catch (e) { res(false); } });
  }
  function parseList(str) {
    return String(str || '')
      .split(/[,\n，]/)
      .map(s => s.trim())
      .filter(Boolean);
  }
  function flashSaved() {
    const el = $('saved');
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 1400);
  }

  /* ------------------------------ 站点规则表格 ------------------------------ */
  /* 注意：不使用 innerHTML 拼接（会触发 AMO linter 的 Unsafe assignment 警告），
     统一用 createElement + .value / .textContent 赋值 */
  function tdInput(i, field, placeholder, val) {
    const td = document.createElement('td');
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = placeholder;
    inp.value = String(val == null ? '' : val);
    inp.addEventListener('change', () => {
      state.siteRules[i] = state.siteRules[i] || { host: '', next: '', prev: '' };
      state.siteRules[i][field] = inp.value.trim();
    });
    td.appendChild(inp);
    return td;
  }

  function renderRules(rules) {
    const tb = $('rules');
    while (tb.firstChild) tb.removeChild(tb.firstChild);
    (rules || []).forEach((r, i) => {
      const tr = document.createElement('tr');
      tr.appendChild(tdInput(i, 'host', 'example.com', r.host));
      tr.appendChild(tdInput(i, 'next', '#next a', r.next));
      tr.appendChild(tdInput(i, 'prev', '#prev a', r.prev));

      const td = document.createElement('td');
      const del = document.createElement('button');
      del.className = 'danger';
      del.textContent = '删除';
      del.addEventListener('click', () => {
        state.siteRules.splice(i, 1);
        renderRules(state.siteRules);
      });
      td.appendChild(del);
      tr.appendChild(td);
      tb.appendChild(tr);
    });
  }

  let state = Object.assign({}, DEFAULTS);

  function fillUI(cfg) {
    state = Object.assign({}, DEFAULTS, cfg || {});
    state.siteRules = Array.isArray(state.siteRules) ? state.siteRules : [];
    state.disabledHosts = Array.isArray(state.disabledHosts) ? state.disabledHosts : [];

    $('enabled').checked = !!state.enabled;
    $('nextKeys').value = (state.nextKeys || []).join(', ');
    $('prevKeys').value = (state.prevKeys || []).join(', ');
    $('highlightMs').value = String(state.highlightMs);
    $('showToast').checked = !!state.showToast;
    $('scrollTop').checked = !!state.scrollTop;
    $('allowRepeat').checked = !!state.allowRepeat;
    $('disabledHosts').value = (state.disabledHosts || []).join('\n');
    /* ---- 阅读配色 ---- */
    $('cgEnabled').checked = !!state.cgEnabled;
    $('cgThreshold').value = String(state.cgThreshold);
    $('cgProtect').checked = !!state.cgProtect;
    $('cgResetDirty').checked = !!state.cgResetDirty;
    $('cgCustomBg').value = state.cgCustomBg;
    $('cgCustomFg').value = state.cgCustomFg;
    $('cgAllHosts').checked = !!state.cgAllHosts;
    renderCgHosts();
    syncPresetUI();
    renderRules(state.siteRules);
    renderChips();
  }

  /** 作用站点列表：每行一个输入框 + 删除按钮（用 createElement，不拼 HTML） */
  function renderCgHosts() {
    const box = $('cgHostRows');
    if (!box) return;
    box.textContent = '';
    const list = Array.isArray(state.cgHosts) ? state.cgHosts : [];
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'hint';
      empty.style.margin = '0 0 6px';
      empty.textContent = '（尚未添加任何站点，配色不会生效）';
      box.appendChild(empty);
      return;
    }
    list.forEach((host, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:6px';

      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = host;
      inp.placeholder = 'example.com';
      inp.style.flex = '1';
      inp.addEventListener('change', () => {
        const arr = (state.cgHosts || []).slice();
        arr[i] = inp.value.trim();
        state.cgHosts = arr.filter(Boolean);
        renderCgHosts();
      });

      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = '删除';
      del.addEventListener('click', () => {
        state.cgHosts = (state.cgHosts || []).filter((_, x) => x !== i);
        renderCgHosts();
      });

      row.appendChild(inp);
      row.appendChild(del);
      box.appendChild(row);
    });
  }

  /** 预设色卡的选中态 + 自定义行的显隐 */
  function syncPresetUI() {
    document.querySelectorAll('#cgPresets .sw').forEach((b) => {
      b.classList.toggle('on', b.dataset.preset === state.cgPreset);
    });
    const custom = state.cgPreset === 'custom';
    $('cgCustomRow').style.display = custom ? '' : 'none';
    // 总开关关闭时，配色相关控件整体置灰
    const on = !!state.cgEnabled;
    document.querySelectorAll('#cgPresets, #cgCustomRow, #cgProbe').forEach((el) => {
      if (el) el.classList.toggle('off', !on);
    });
  }

  function renderChips() {
    const c = $('chips');
    c.textContent = '';
    (state.nextKeys || []).forEach(k => addChip(c, '下一页 ' + k));
    (state.prevKeys || []).forEach(k => addChip(c, '上一页 ' + k));
  }
  function addChip(box, text) {
    const s = document.createElement('span');
    s.className = 'chip';
    s.textContent = text;
    box.appendChild(s);
  }

  function collect() {
    return {
      enabled: $('enabled').checked,
      nextKeys: parseList($('nextKeys').value),
      prevKeys: parseList($('prevKeys').value),
      highlightMs: Math.max(0, parseInt($('highlightMs').value, 10) || 0),
      showToast: $('showToast').checked,
      scrollTop: $('scrollTop').checked,
      allowRepeat: $('allowRepeat').checked,
      disabledHosts: parseList($('disabledHosts').value),
      siteRules: (state.siteRules || []).filter(r => r && (r.host || r.next || r.prev)),
      /* ---- 阅读配色 ---- */
      cgEnabled: $('cgEnabled').checked,
      cgPreset: state.cgPreset || 'green',
      cgCustomBg: $('cgCustomBg').value,
      cgCustomFg: $('cgCustomFg').value,
      cgThreshold: Math.min(21, Math.max(1, parseFloat($('cgThreshold').value) || 4.5)),
      cgProtect: $('cgProtect').checked,
      cgResetDirty: $('cgResetDirty').checked,
      cgAllHosts: $('cgAllHosts') ? $('cgAllHosts').checked : false,
      cgHosts: (Array.isArray(state.cgHosts) ? state.cgHosts : [])
        .map(h => String(h || '').trim()).filter(Boolean)
    };
  }

  async function save(silent) {
    state = Object.assign({}, DEFAULTS, collect());
    await set(state);
    renderChips();
    if (!silent) flashSaved();
  }

  /* ------------------------------ 按键捕获 ------------------------------ */
  let capturing = null;
  function keyToString(e) {
    const mods = [];
    if (e.ctrlKey) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Meta');
    let k = e.code || e.key;
    if (!k) return '';
    // 单个可打印字符统一成 KeyX / DigitX / 标点名，便于阅读
    if (k.length === 1) {
      if (/[a-zA-Z]/.test(k)) k = 'Key' + k.toUpperCase();
      else if (/\d/.test(k)) k = 'Digit' + k;
    }
    return mods.concat(k).join('+');
  }
  document.querySelectorAll('.capture').forEach(btn => {
    btn.addEventListener('click', () => {
      if (capturing) { stopCapture(); return; }
      capturing = btn.dataset.target;
      btn.classList.add('active');
      btn.textContent = '请按键…（Esc 取消）';
    });
  });
  function stopCapture() {
    document.querySelectorAll('.capture').forEach(b => {
      b.classList.remove('active');
      b.textContent = '捕获按键';
    });
    capturing = null;
  }
  window.addEventListener('keydown', e => {
    if (!capturing) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { stopCapture(); return; }
    const s = keyToString(e);
    const input = $(capturing);
    const cur = parseList(input.value);
    if (cur.indexOf(s) < 0) cur.push(s);
    input.value = cur.join(', ');
    stopCapture();
  }, true);

  /* ------------------------------ 事件绑定 ------------------------------ */
  $('applyPreset').addEventListener('click', () => {
    const v = $('preset').value;
    if (!v || !PRESETS[v]) return;
    $('nextKeys').value = PRESETS[v].nextKeys.join(', ');
    $('prevKeys').value = PRESETS[v].prevKeys.join(', ');
    save(true);
    renderChips();
    flashSaved();
  });

  $('addRule').addEventListener('click', () => {
    state.siteRules.push({ host: '', next: '', prev: '' });
    renderRules(state.siteRules);
  });

  $('save').addEventListener('click', () => save(false));

  ['enabled', 'showToast', 'scrollTop', 'allowRepeat'].forEach(id => {
    $(id).addEventListener('change', () => save(true));
  });
  ['nextKeys', 'prevKeys', 'highlightMs', 'disabledHosts'].forEach(id => {
    $(id).addEventListener('change', () => save(true));
  });

  /* ---- 阅读配色：色卡选择 / 开关即时生效 / 当前页检测 ---- */
  ['cgEnabled', 'cgProtect', 'cgResetDirty', 'cgThreshold', 'cgCustomBg', 'cgCustomFg', 'cgAllHosts'].forEach(id => {
    $(id).addEventListener('change', () => {
      state = Object.assign({}, DEFAULTS, collect());
      syncPresetUI();
      save(true);
      pushToPage();
    });
  });

  /* 添加当前活动页主机名到作用站点名单 */
  $('cgHostAdd').addEventListener('click', async () => {
    let host = '';
    try {
      const tabs = await new Promise(res => {
        api.tabs.query({ active: true, lastFocusedWindow: true }, t => res(t || []));
      });
      host = safeHost((tabs && tabs[0] && tabs[0].url) || '');
    } catch (e) { host = ''; }
    if (!host) {
      window.alert('无法自动读取当前站点，请手动输入主机名。');
      return;
    }
    const list = (Array.isArray(state.cgHosts) ? state.cgHosts : []).slice();
    if (!list.some(h => hostMatchLoose(h, host))) list.push(host);
    state.cgHosts = list;
    renderCgHosts();
    save(true);
    pushToPage();
  });

  /** 从 URL 取主机名；非 http(s) 页面返回空 */
  function safeHost(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      return u.hostname.replace(/^www\./, '');
    } catch (e) { return ''; }
  }
  function hostMatchLoose(a, b) {
    return String(a || '').toLowerCase() === String(b || '').toLowerCase();
  }

  document.querySelectorAll('#cgPresets .sw').forEach((b) => {
    b.addEventListener('click', () => {
      state.cgPreset = b.dataset.preset;
      syncPresetUI();
      save(true);
      pushToPage();
    });
  });

  $('cgCustomReset').addEventListener('click', () => {
    $('cgCustomBg').value = CG_PRESET_DEFAULT.bg;
    $('cgCustomFg').value = CG_PRESET_DEFAULT.fg;
    state = Object.assign({}, DEFAULTS, collect());
    save(true);
    pushToPage();
  });

  /** 把最新配色推给当前活动页，免刷新生效 */
  async function pushToPage() {
    try {
      const tabs = await new Promise(res => {
        api.tabs.query({ active: true, lastFocusedWindow: true }, t => res(t || []));
      });
      const t = tabs[0];
      if (!t || !t.id) return;
      const cfg = Object.assign({}, DEFAULTS, collect());
      try { await api.tabs.sendMessage(t.id, { type: 'KP_CONTRAST_APPLY', cfg }); } catch (e) { /* 页面未注入 */ }
    } catch (e) { /* ignore */ }
  }

  $('cgProbe').addEventListener('click', async () => {
    const out = $('cgProbeOut');
    out.textContent = '检测中…';
    try {
      // 设置页自身没有正文，必须在活动标签页里测
      const tabs = await new Promise(res => {
        api.tabs.query({ active: true, lastFocusedWindow: true }, t => res(t || []));
      });
      const tab = tabs[0];
      if (!tab || !tab.id) { out.textContent = '找不到活动标签页。'; return; }
      const r = await new Promise(res => {
        try {
          api.tabs.sendMessage(tab.id, { type: 'KP_CONTRAST_MEASURE' }, v => res(v));
        } catch (e) { res(null); }
        setTimeout(() => res(null), 1500);
      });
      if (!r) { out.textContent = '该页面无法检测（内置页面或未注入脚本）。'; return; }
      if (r.target === false) { out.textContent = '该站点不在配色名单内，未做处理。'; return; }
      const bad = r.cr != null && r.cr < (Number($('cgThreshold').value) || 4.5);
      out.innerHTML = '对比度 <b>' + r.cr + ' : 1</b>　' +
        (bad ? '<span style="color:var(--danger)">低于阈值</span>' : '<span style="color:#16a34a">正常</span>') +
        (r.decision && r.decision.mode === 'repaired' ? '　已自动纠正' : '');
    } catch (e) {
      out.textContent = '检测失败：' + e.message;
    }
  });

  $('export').addEventListener('click', async () => {
    state = Object.assign({}, DEFAULTS, collect());
    $('ioArea').value = JSON.stringify(state, null, 2);
    flashSaved();
  });

  $('importBtn').addEventListener('click', async () => {
    try {
      const obj = JSON.parse($('ioArea').value);
      await set(Object.assign({}, DEFAULTS, obj));
      fillUI(await get(DEFAULTS));
      flashSaved();
    } catch (e) {
      alert('导入失败：JSON 格式不正确。\n' + e.message);
    }
  });

  $('reset').addEventListener('click', async () => {
    if (!confirm('确定恢复默认设置？站点规则和禁用列表会一并清空。')) return;
    await set(Object.assign({}, DEFAULTS));
    fillUI(await get(DEFAULTS));
    flashSaved();
  });

  /* ------------------------------ 初始化 ------------------------------ */
  (async function init() {
    fillUI(await get(DEFAULTS));
  })();
})();
