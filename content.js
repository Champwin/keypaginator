/* =========================================================================
 * 键盘翻页助手 KeyPaginator — content script
 * 职责：识别页面上的「下一页/下一章/Next」类翻页元素，并在按下指定按键时点击它
 * ========================================================================= */
(function () {
  'use strict';

  const api = (typeof browser !== 'undefined') ? browser : chrome;

  /* ----------------------------- 默认配置 ----------------------------- */
  const DEFAULTS = {
    enabled: true,             // 全局开关
    nextKeys: ['ArrowRight', 'Alt+KeyN'],
    prevKeys: ['ArrowLeft', 'Alt+KeyP'],
    highlightMs: 150,          // 点击前高亮提示时长（ms），0 = 不高亮直接点
    showToast: true,           // 是否显示角标提示
    scrollTop: true,           // 翻页后回到页面顶部
    allowRepeat: false,        // 长按按键是否连续翻页
    disabledHosts: [],         // 禁用站点，如 ["mail.google.com"]
    siteRules: []              // 站点自定义选择器 [{host, next, prev}]
  };

  let cfg = Object.assign({}, DEFAULTS);

  /* ----------------------------- 关键词表 ----------------------------- */
  // 强正向词（命中即高分）
  const NEXT_WORDS = [
    '下一页', '下页', '下一章', '下章', '下一节', '下节', '下一篇', '下一张', '下一回',
    '下一集', '下一题', '下一话', '下一話', '下一頁', '下頁', '下一個', '下一个',
    '后一页', '後一頁', '后一章', '继续阅读', '继续下一章', '下一页>', '下一页 >',
    'next page', 'next chapter', 'next chapter', 'nextchapter', 'next-page',
    'next page ›', 'next ›', 'next »', 'nextpostslink', 'nav-next'
  ];
  const PREV_WORDS = [
    '上一页', '上页', '上一章', '上章', '上一节', '上节', '上一篇', '上一张', '上一回',
    '上一集', '上一题', '上一話', '上一頁', '上頁', '前一個', '前一个', '前一页', '前页',
    '前一章', '前一篇', '返回上一页', '返回上页',
    'prev page', 'previous page', 'prev-page', 'previous-page',
    'prev chapter', 'previouspostslink', 'nav-previous'
  ];
  // 弱正向词（可能是「加载更多」，权重低）
  const NEXT_WEAK = ['更多', '加载更多', 'more', 'load more', 'next', 'older', '›', '»', '→', '>>', '&gt;&gt;'];
  const PREV_WEAK = ['prev', 'previous', 'back', '‹', '«', '←', '<<', '&lt;&lt;', 'newer'];
  // id / class 命中词（权重低于文本）
  const NEXT_ATTR = ['next', 'nextpage', 'next_page', 'next-page', 'nex', 'page-next', 'pagination-next'];
  const PREV_ATTR = ['prev', 'previous', 'prevpage', 'prev_page', 'prev-page', 'page-prev', 'pagination-prev'];

  /* ------------------------------ 工具函数 ------------------------------ */
  const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const low = s => norm(s).toLowerCase();

  function sGet(keys) {
    return new Promise(res => {
      try { api.storage.local.get(keys, v => res(v || {})); } catch (e) { res({}); }
    });
  }
  function sSet(obj) {
    try { api.storage.local.set(obj); } catch (e) { /* ignore */ }
  }
  function hostMatch(pattern, hostname) {
    if (!pattern) return false;
    let p = low(pattern)
      .replace(/^https?:\/\//, '')
      .replace(/^\*\./, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '');
    if (!p) return false;
    const h = low(hostname).replace(/^www\./, '');
    return h === p || h.endsWith('.' + p);
  }
  function isDisabledHost() {
    const h = location.hostname;
    return (cfg.disabledHosts || []).some(p => hostMatch(p, h));
  }
  function getRule() {
    const rules = cfg.siteRules || [];
    const hit = rules.filter(r => r && r.host && hostMatch(r.host, location.hostname));
    if (!hit.length) return null;
    hit.sort((a, b) => String(b.host).length - String(a.host).length);
    return hit[0];
  }
  function classOf(el) {
    try {
      const c = el.className;
      return typeof c === 'string' ? c : (el.getAttribute && el.getAttribute('class')) || '';
    } catch (e) { return ''; }
  }
  function isDisabled(el) {
    if (!el) return true;
    if (el.disabled) return true;
    const ad = el.getAttribute && el.getAttribute('aria-disabled');
    if (ad && ad.toLowerCase() === 'true') return true;
    const c = low(classOf(el));
    return /(\b|_)disabled(\b|_)|is-disabled|btn-disabled/.test(c);
  }
  function isTypingTarget(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (el.isContentEditable) return true;
    try { if (el.closest && el.closest('[contenteditable="true"]')) return true; } catch (e) { /* noop */ }
    return false;
  }

  /* --------------------------- 候选元素评分 --------------------------- */
  const CANDIDATE_SEL = 'a, button, [role="button"], input[type="button"], input[type="submit"], [onclick]';

  function scoreEl(el, dir) {
    if (isDisabled(el)) return -999;

    const text = norm(el.innerText || el.textContent || '');
    const lt = low(text);
    const aria = low((el.getAttribute && (el.getAttribute('aria-label') || '')) + ' ' +
                     (el.getAttribute && (el.getAttribute('title') || '')));
    const attrs = low((el.id || '') + ' ' + classOf(el) + ' ' + aria);
    const rel = low(el.getAttribute ? el.getAttribute('rel') : '');

    const posWords = dir === 'next' ? NEXT_WORDS : PREV_WORDS;
    const negWords = dir === 'next' ? PREV_WORDS : NEXT_WORDS;
    const posWeak = dir === 'next' ? NEXT_WEAK : PREV_WEAK;
    const negWeak = dir === 'next' ? PREV_WEAK : NEXT_WEAK;
    const posAttr = dir === 'next' ? NEXT_ATTR : PREV_ATTR;
    const negAttr = dir === 'next' ? PREV_ATTR : NEXT_ATTR;

    // 反向词排除（只看文本与 aria，避免 class 误伤）
    for (const w of negWords) {
      if (w && (lt.indexOf(w) >= 0 || aria.indexOf(w) >= 0)) return -999;
    }

    let s = 0;

    // 1) rel 属性：最强信号
    if (rel) {
      if (dir === 'next' && /\bnext\b/.test(rel)) s += 100;
      if (dir === 'prev' && /\b(prev|previous)\b/.test(rel)) s += 100;
      if (dir === 'next' && /\bprev|previous\b/.test(rel)) return -999;
      if (dir === 'prev' && /\bnext\b/.test(rel)) return -999;
    }

    // 2) 文本命中
    let textHit = false;
    for (const w of posWords) {
      if (!w) continue;
      if (lt === w) { s += 60; textHit = true; break; }
      if (lt.indexOf(w) >= 0) { s += 45; textHit = true; break; }
    }
    if (!textHit) {
      for (const w of posWeak) {
        if (!w) continue;
        if (lt === w || aria === w) { s += 34; textHit = true; break; }
        if (lt.indexOf(w) >= 0) { s += 24; textHit = true; break; }
      }
    }
    // 文本过长（可能是段落里的句子），降权
    if (text.length > 20) s -= 22;
    if (text.length > 40) s -= 20;

    // 3) aria / title 命中
    for (const w of posWords.concat(posWeak)) {
      if (w && aria.indexOf(w) >= 0) { s += 30; break; }
    }

    // 4) id / class 命中
    for (const w of posAttr) {
      if (w && attrs.indexOf(w) >= 0) { s += 22; break; }
    }
    for (const w of negAttr) {
      if (w && low((el.id || '') + ' ' + classOf(el)).indexOf(w) >= 0) { s -= 45; break; }
    }

    // 5) 元素类型
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'a') {
      s += 14;
      const href = el.getAttribute('href') || '';
      if (!href || href === '#' || /^javascript\s*:/i.test(href)) s -= 25;
      else if (/page|pageNum|p=\d|offset|start=/i.test(href)) s += 8;
    } else if (tag === 'button' || (el.getAttribute && el.getAttribute('role') === 'button')) {
      s += 12;
    }

    // 6) 可见性（不可见只是降权，不排除，懒加载场景仍可点击）
    try {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') s -= 30;
      else if (r.width > 0 && r.height > 0) s += 5;
    } catch (e) { /* noop */ }

    return s;
  }

  /* 数字分页兜底：<span class=current>3</span> → 找文本为 4 的 <a> */
  function numericCandidate(dir) {
    const markers = document.querySelectorAll('[aria-current="page"], .current, .active, .selected, .on, .page-current');
    for (const m of markers) {
      const t = norm(m.textContent);
      if (!/^\d{1,4}$/.test(t)) continue;
      const n = parseInt(t, 10);
      const want = dir === 'next' ? n + 1 : n - 1;
      if (want < 1) continue;
      const scope = (m.closest && m.closest('nav, .pagination, .pager, .pages, .page-nav, .pagenavi, ul, ol')) ||
                    (m.parentElement && m.parentElement.parentElement) || document;
      const links = scope.querySelectorAll('a');
      for (const a of links) {
        if (isDisabled(a)) continue;
        if (norm(a.textContent) === String(want)) {
          return { el: a, score: 36, label: norm(a.textContent), src: 'numeric' };
        }
      }
    }
    return null;
  }

  /* 主查找入口 */
  function findTarget(dir) {
    // 0) 站点自定义选择器（最高优先级）
    const rule = getRule();
    if (rule) {
      const sel = dir === 'next' ? rule.next : rule.prev;
      if (sel) {
        try {
          const el = document.querySelector(sel);
          if (el && !isDisabled(el)) {
            return { el, score: 1000, label: norm(el.innerText || el.textContent || sel), src: 'rule' };
          }
        } catch (e) { /* 选择器非法则忽略 */ }
      }
    }

    const best = { el: null, score: 0, label: '', src: '' };

    // 1) <link rel="next|prev">（常用于搜索引擎 / 博客）
    const relName = dir === 'next' ? 'next' : 'prev';
    const linkEl = document.querySelector('link[rel="' + relName + '" i][href]') ||
                   (dir === 'prev' ? document.querySelector('link[rel="previous" i][href]') : null);
    if (linkEl && linkEl.href) {
      const href = linkEl.href;
      const anchor = Array.prototype.find.call(
        document.querySelectorAll('a[href]'),
        a => { try { return a.href === href; } catch (e) { return false; } }
      );
      if (anchor && !isDisabled(anchor)) {
        best.el = anchor; best.score = 92; best.src = 'link-rel';
        best.label = norm(anchor.innerText || anchor.textContent || '下一页');
      } else {
        best.href = href; best.score = 88; best.src = 'link-rel';
        best.label = dir === 'next' ? '下一页' : '上一页';
      }
    }

    // 2) 遍历候选元素打分
    let nodes;
    try { nodes = document.querySelectorAll(CANDIDATE_SEL); } catch (e) { nodes = []; }
    for (const el of nodes) {
      const s = scoreEl(el, dir);
      if (s > best.score) {
        best.el = el; best.href = null; best.score = s; best.src = 'match';
        best.label = norm(el.innerText || el.textContent ||
                          (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) || '');
      }
    }

    // 3) 数字分页兜底
    if (best.score < 30) {
      const num = numericCandidate(dir);
      if (num && num.score > best.score) return num;
    }

    if (best.score >= 30 && (best.el || best.href)) return best;
    return null;
  }

  /* ------------------------------ 视觉反馈 ------------------------------ */
  function highlight(el) {
    if (!cfg.highlightMs) return;
    let r;
    try { r = el.getBoundingClientRect(); } catch (e) { return; }
    if (!r || (!r.width && !r.height)) return;
    const box = document.createElement('div');
    box.style.cssText = [
      'position:fixed', 'z-index:2147483647', 'pointer-events:none',
      'left:' + (r.left - 4) + 'px', 'top:' + (r.top - 4) + 'px',
      'width:' + (r.width + 8) + 'px', 'height:' + (r.height + 8) + 'px',
      'border:3px solid #ff7a00', 'border-radius:6px',
      'background:rgba(255,122,0,.18)', 'box-shadow:0 0 14px rgba(255,122,0,.55)',
      'transition:opacity .18s ease'
    ].join(';');
    (document.body || document.documentElement).appendChild(box);
    setTimeout(() => {
      box.style.opacity = '0';
      setTimeout(() => { try { box.remove(); } catch (e) { /* noop */ } }, 220);
    }, Math.max(120, cfg.highlightMs));
  }

  let toastTimer = null;
  function toast(msg, kind) {
    if (!cfg.showToast) return;
    let t = document.getElementById('__kp_toast__');
    if (!t) {
      t = document.createElement('div');
      t.id = '__kp_toast__';
      t.style.cssText = [
        'position:fixed', 'right:18px', 'bottom:18px', 'z-index:2147483647',
        'padding:8px 14px', 'border-radius:8px', 'font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif',
        'color:#fff', 'background:rgba(23,23,23,.9)', 'box-shadow:0 4px 16px rgba(0,0,0,.25)',
        'pointer-events:none', 'max-width:70vw', 'opacity:0', 'transition:opacity .15s ease'
      ].join(';');
      (document.body || document.documentElement).appendChild(t);
    }
    t.textContent = msg;
    t.style.background = kind === 'warn' ? 'rgba(180,83,9,.95)' : 'rgba(23,23,23,.9)';
    t.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 1400);
  }

  /* ------------------------------ 执行点击 ------------------------------ */
  function clickEl(el) {
    try {
      if (typeof el.click === 'function') el.click();
      else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    } catch (e) {
      try { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch (e2) { /* noop */ }
    }
  }

  function go(dir) {
    const t = findTarget(dir);
    if (!t) {
      toast(dir === 'next' ? '未找到「下一页」链接（可在设置里为该站点指定选择器）' : '未找到「上一页」链接', 'warn');
      return;
    }
    if (t.el) {
      highlight(t.el);
      const delay = Math.max(0, Number(cfg.highlightMs) || 0);
      setTimeout(() => clickEl(t.el), delay);
      toast((dir === 'next' ? '→ ' : '← ') + (t.label || '已触发'), 'ok');
    } else if (t.href) {
      toast((dir === 'next' ? '→ ' : '← ') + (t.label || '跳转中…'), 'ok');
      setTimeout(() => { try { location.assign(t.href); } catch (e) { location.href = t.href; } }, Math.max(0, cfg.highlightMs || 0));
    }
    if (cfg.scrollTop) {
      setTimeout(() => {
        try { window.scrollTo({ top: 0, behavior: 'auto' }); }
        catch (e) { try { window.scrollTo(0, 0); } catch (e2) { /* noop */ } }
      }, 500);
    }
  }

  /* ------------------------------ 按键解析 ------------------------------ */
  function keyMatch(raw, e) {
    const spec = norm(raw);
    if (!spec) return false;
    const parts = spec.split('+').map(s => s.trim()).filter(Boolean);
    if (!parts.length) return false;
    const key = parts.pop();
    const mods = parts.map(m => m.toLowerCase());
    const needCtrl = mods.indexOf('ctrl') >= 0 || mods.indexOf('control') >= 0;
    const needAlt = mods.indexOf('alt') >= 0 || mods.indexOf('option') >= 0;
    const needShift = mods.indexOf('shift') >= 0;
    const needMeta = mods.indexOf('meta') >= 0 || mods.indexOf('cmd') >= 0 || mods.indexOf('command') >= 0;
    if (needCtrl !== !!e.ctrlKey) return false;
    if (needAlt !== !!e.altKey) return false;
    if (needShift !== !!e.shiftKey) return false;
    if (needMeta !== !!e.metaKey) return false;

    const k = key.toLowerCase();
    const code = low(e.code);
    const ek = low(e.key);
    if (code === k || ek === k) return true;
    // 单字符键：配置 "n" 与 code "KeyN" 互通
    if (k.length === 1 && k >= 'a' && k <= 'z') return code === 'key' + k;
    if (k.indexOf('key') === 0 && /^key[a-z]$/.test(k)) return ek === k.slice(3) || code === k;
    if (k.indexOf('digit') === 0) return ek === k.slice(5) || code === k;
    return false;
  }

  function matchBinding(e) {
    const pairs = [['next', cfg.nextKeys], ['prev', cfg.prevKeys]];
    for (const [act, list] of pairs) {
      for (const raw of (list || [])) {
        if (keyMatch(raw, e)) return act;
      }
    }
    return null;
  }

  function onKeyDown(e) {
    if (!cfg.enabled || isDisabledHost()) return;
    if (isTypingTarget(document.activeElement) || isTypingTarget(e.target)) return;
    if (e.repeat && !cfg.allowRepeat) return;
    const act = matchBinding(e);
    if (!act) return;
    e.preventDefault();
    e.stopPropagation();
    go(act);
  }

  document.addEventListener('keydown', onKeyDown, true);

  /* ------------------------------ 配置同步 ------------------------------ */
  async function refresh() {
    const v = await sGet(DEFAULTS);
    cfg = Object.assign({}, DEFAULTS, v || {});
  }
  refresh();

  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') refresh();
  });

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return undefined;
    if (msg.type === 'KP_PROBE') {
      const n = findTarget('next');
      const p = findTarget('prev');
      sendResponse({
        ok: true,
        host: location.hostname,
        enabled: !!cfg.enabled,
        hostDisabled: isDisabledHost(),
        next: n ? (n.label || n.src) : '',
        prev: p ? (p.label || p.src) : ''
      });
      return true;
    }
    if (msg.type === 'KP_TEST') {
      const t = findTarget(msg.dir || 'next');
      if (t && t.el) highlight(t.el);
      sendResponse({ ok: !!t, label: t ? (t.label || t.src) : '' });
      return true;
    }
    if (msg.type === 'KP_CFG') {
      cfg = Object.assign({}, DEFAULTS, msg.cfg || {});
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'KP_DISABLE_HOST') {
      const hosts = (cfg.disabledHosts || []).slice();
      if (hosts.indexOf(msg.host) < 0) hosts.push(msg.host);
      cfg.disabledHosts = hosts;
      sSet({ disabledHosts: hosts });
      sendResponse({ ok: true });
      return true;
    }
    return undefined;
  });
})();
