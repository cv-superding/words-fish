'use strict';
const api = window.wfSettings;

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { cfg: null, constants: null, books: [], stats: null, dirty: false };

/* ============================ 通用工具 ============================ */

function setNested(obj, path, value) {
  const seg = path.split('.');
  let cur = obj;
  for (let i = 0; i < seg.length - 1; i++) {
    if (!isObj(cur[seg[i]])) cur[seg[i]] = {};
    cur = cur[seg[i]];
  }
  cur[seg[seg.length - 1]] = value;
  return obj;
}
function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

function gotoPage(name) {
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.go === name));
  document.querySelectorAll('.page').forEach((el) => el.classList.toggle('active', el.id === `page-${name}`));
}

function flashStatus(text, ms = 1500) {
  const el = $('status-line');
  el.textContent = text;
  clearTimeout(flashStatus._t);
  flashStatus._t = setTimeout(() => (el.textContent = '就绪'), ms);
}

/* ============================ 配置双向绑定 ============================ */

function readCfgFromUI() {
  const out = {};
  document.querySelectorAll('[data-cfg]').forEach((el) => {
    const path = el.dataset.cfg;
    let val;
    if (el.type === 'checkbox') val = el.checked;
    else if (el.type === 'number') {
      if (el.tagName === 'INPUT') {
        // 清空（NaN）不保存；0 是合法值（如透明度调到 0），不能 || 0 一刀切
        const v = parseFloat(el.value);
        if (Number.isNaN(v)) return;
        val = v;
      } else val = el.value;
    }
    else val = el.value;
    setNested(out, path, val);
  });
  return out;
}

async function applyConfigToUI(cfg) {
  state.cfg = cfg;
  document.querySelectorAll('[data-cfg]').forEach((el) => {
    const v = getByPath(cfg, el.dataset.cfg);
    if (v === undefined || v === null) return;
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v;
  });
  renderBooks();
  renderThemeGrid();
  renderHotkeyList();
  renderGestureList();
  renderPreview();
}

function getByPath(obj, path) {
  let cur = obj;
  for (const s of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[s];
  }
  return cur;
}

function debounce(fn, ms = 250) {
  let t = null;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

async function onCfgInputChange(meta = {}) {
  const patch = readCfgFromUI();
  const newCfg = await api.config.update(patch, meta);
  state.dirty = true;
  state.cfg = newCfg;
  if (meta.fromAutoLaunch === undefined) {
    renderPreview();
  }
  flashStatus('已保存');
}

async function onAutoLaunchChange(checked) {
  await api.app.setAutoLaunch(checked);
  await onCfgInputChange({ fromAutoLaunch: true });
}

/* ============================ 词库 ============================ */

async function renderBooks() {
  const list = $('book-list');
  const active = getByPath(state.cfg, 'study.activeBookId');
  list.innerHTML = '';
  for (const b of state.books) {
    const el = document.createElement('div');
    el.className = `book-item ${b.id === active ? 'active' : ''}`;
    el.innerHTML = `
      <div>
        <div class="name">${esc(b.name)}${b.builtin ? '<span class="meta" style="margin-left:8px;color:#0f7b6c">内置</span>' : ''}</div>
        <div class="meta">${esc(b.tag || '')} · ${b.count} 词${b.source ? ' · 来源 ' + esc(b.source) : ''}</div>
      </div>
      <div class="actions">
        ${b.id === active ? '<span class="btn active">使用中</span>' : `<button class="btn" data-act="use" data-id="${b.id}">使用</button>`}
        ${!b.builtin ? `<button class="btn danger" data-act="del" data-id="${b.id}">删除</button>` : ''}
      </div>`;
    list.appendChild(el);
  }
  list.onclick = async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.act === 'use') {
      await api.dict.setActive(id);
      const cfg = await api.config.get();
      state.cfg = cfg;
      await renderBooks();
    } else if (btn.dataset.act === 'del') {
      if (!confirm('删除此自定义词库？')) return;
      const r = await api.dict.delete(id);
      if (r.ok) {
        state.books = await api.dict.list();
        const cfg = await api.config.get();
        state.cfg = cfg;
        await renderBooks();
      } else alert(r.error || '删除失败');
    }
  };
}

/* ============================ 主题 ============================ */

const THEME_SWATCH = {
  light: { bg: '#ffffff', fg: '#1a1f2c', accent: '#0f7b6c', name: '素白' },
  dark: { bg: '#181b24', fg: '#e9ecf3', accent: '#2dc4a6', name: '暗夜' },
  ink: { bg: '#f3f0e8', fg: '#1f1d18', accent: '#8a3324', name: '水墨' },
  mint: { bg: '#dcf0e8', fg: '#1b3a32', accent: '#2b8a6f', name: '薄荷' },
  ide: { bg: '#282a36', fg: '#f8f8f2', accent: '#50fa7b', name: '伪装代码' },
};

function renderThemeGrid() {
  const themes = state.constants?.THEMES || [];
  const cur = getByPath(state.cfg, 'popup.theme');
  const grid = $('theme-grid');
  grid.innerHTML = '';
  for (const t of themes) {
    const sw = THEME_SWATCH[t.key] || THEME_SWATCH.light;
    const el = document.createElement('div');
    el.className = `theme-card ${t.key === cur ? 'active' : ''}`;
    el.innerHTML = `
      <div class="preview" style="background:${sw.bg};color:${sw.fg}">
        <span style="color:${sw.accent}">fish</span>
      </div>
      <div class="name">${esc(t.label)}</div>`;
    el.addEventListener('click', async () => {
      await api.config.update({ popup: { theme: t.key } });
      const cfg = await api.config.get();
      await applyConfigToUI(cfg);
      flashStatus('主题已切换');
    });
    grid.appendChild(el);
  }
}

/* ============================ 悬浮窗预览 ============================ */

async function renderPreview() {
  const host = $('preview-host');
  host.innerHTML = '';
  const v = getByPath(state.cfg, 'popup');
  const wordSample = {
    w: 'subsequent',
    us: 'ˈsʌbsɪkwənt',
    uk: 'ˈsʌbsɪkwənt',
    t: [
      { p: 'adj', c: '随后的；后来的' },
      { p: 'adv', c: '接着；随后地' },
    ],
    e: 'The problems and the subsequent losses are beyond description.',
    ec: '这些问题以及随之而来的损失难以言喻。',
    m: 'sub(下面) + sequ(跟随) + ent → 在下面跟着的 → 随后的',
  };

  const theme = v.theme || 'light';
  const card = document.createElement('div');
  card.style.cssText = `
    width:${v.width || 380}px;
    background:${THEME_PREVIEW_BG[theme] || '#fff'};
    color:${THEME_PREVIEW_FG[theme] || '#1a1f2c'};
    border-radius:14px; border:1px solid ${THEME_PREVIEW_BORDER[theme] || '#e3e6eb'};
    box-shadow:0 8px 24px rgba(0,0,0,0.12);
    font-size:${v.fontSize || 15}px;
    padding:18px;
    opacity:${v.opacity ?? 0.96};
  `;
  const posTag = (t) => (t.p ? `<span style="color:${THEME_PREVIEW_POS[theme]};font-style:italic;font-size:11px;margin-right:6px">${esc(t.p)}</span>` : '');
  card.innerHTML = `
    <div style="font-size:${Math.round((v.fontSize||15)*1.85)}px;font-weight:700;margin-bottom:6px">${esc(wordSample.w)} <button style="background:transparent;border:0;color:#888;cursor:pointer">🔊</button></div>
    ${v.showPhonetic ? `<div style="font-size:11px;color:#888;margin-bottom:8px">美 ${esc(wordSample.us)} | 英 ${esc(wordSample.uk)}</div>` : ''}
    ${v.meaningHidden
      ? `<div style="background:${THEME_PREVIEW_HINT_BG[theme]};color:${THEME_PREVIEW_POS[theme]};padding:8px 12px;border-radius:6px;font-size:12px;text-align:center">已隐藏释义 · 单击显示</div>`
      : `<div style="line-height:1.6">${(wordSample.t||[]).map((t) => `<div>${posTag(t)}${esc(t.c)}</div>`).join('')}</div>
         ${v.showSentence && wordSample.e ? `<div style="border-left:3px solid #0f7b6c40;padding:6px 12px;margin-top:8px;color:${THEME_PREVIEW_POS[theme]};font-size:12px;line-height:1.5">${esc(wordSample.e)}<div style="margin-top:4px;color:#999">${esc(wordSample.ec)}</div></div>` : ''}`
    }
  `;
  host.appendChild(card);
}

const THEME_PREVIEW_BG = { light: '#fff', dark: '#181b24', ink: '#f3f0e8', mint: '#dcf0e8', ide: '#282a36' };
const THEME_PREVIEW_FG = { light: '#1a1f2c', dark: '#e9ecf3', ink: '#1f1d18', mint: '#1b3a32', ide: '#f8f8f2' };
const THEME_PREVIEW_BORDER = { light: '#e3e6eb', dark: 'rgba(255,255,255,0.10)', ink: 'rgba(31,29,24,0.10)', mint: 'rgba(43,138,111,0.14)', ide: 'rgba(255,255,255,0.06)' };
const THEME_PREVIEW_POS = { light: '#5f6577', dark: '#b6bbc8', ink: '#6f6356', mint: '#406d61', ide: '#ff79c6' };
const THEME_PREVIEW_HINT_BG = { light: '#e0f2ee', dark: 'rgba(45,196,166,0.15)', ink: 'rgba(138,51,36,0.10)', mint: 'rgba(43,138,111,0.14)', ide: 'rgba(80,250,123,0.12)' };

/* ============================ 全局快捷键 ============================ */

function accelFromEvent(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey && isMac) parts.push('Cmd');
  let key = e.key;
  // 排除纯修饰键
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null;
  // 标准化
  if (key === ' ') key = 'Space';
  if (key.length === 1) key = key.toUpperCase();
  if (key.startsWith('Arrow')) key = key.replace('Arrow', '');
  if (key === 'Escape') key = 'Esc';
  parts.push(key);
  return parts.join('+');
}
const isMac = api.app && api.app.platform === 'darwin';

function renderHotkeyList() {
  const items = state.constants?.HOTKEY_ITEMS || [];
  const list = $('hotkey-list');
  list.innerHTML = '';
  for (const item of items) {
    const cur = getByPath(state.cfg, `hotkeys.${item.key}`) || '';
    const el = document.createElement('div');
    el.className = 'hotkey-item';
    el.innerHTML = `
      <div class="label">${esc(item.label)}</div>
      <div class="input-wrap">
        <input type="text" data-key="${esc(item.key)}" value="${esc(cur)}" placeholder="（未设置）" />
        <button class="clear-btn" data-key="${esc(item.key)}" title="清除">清除</button>
      </div>
      <span class="meta" style="font-size:11px;color:#999">建议: ${esc(item.default)}</span>`;
    list.appendChild(el);
  }
  list.onclick = (e) => {
    const btn = e.target.closest('button.clear-btn');
    if (btn) {
      const k = btn.dataset.key;
      api.config.update({ hotkeys: { [k]: '' } }).then(async (cfg) => {
        state.cfg = cfg;
        renderHotkeyList();
        flashStatus('快捷键已清除');
      });
    }
  };
  list.onkeydown = async (e) => {
    const input = e.target.closest('input');
    if (!input) return;
    if (e.key === 'Enter' || e.key === 'Escape') {
      input.blur();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const accel = accelFromEvent(e);
    if (!accel) return;
    input.value = accel;
    input.classList.add('recording');
    const k = input.dataset.key;
    try {
      const cfg = await api.config.update({ hotkeys: { [k]: accel } });
      state.cfg = cfg;
      const warn = $('hotkey-warning');
      warn.textContent = '';
      flashStatus(`已注册 ${accel}`);
    } catch (err) {
      input.classList.add('invalid');
      $('hotkey-warning').textContent = `快捷键 ${accel} 注册失败：可能被占用`;
    }
    setTimeout(() => input.classList.remove('recording', 'invalid'), 600);
  };
  list.oninput = (e) => {
    const input = e.target.closest('input');
    if (input) input.value = ''; // 只允许按键录入
  };
}

/* ============================ 手势映射 ============================
 * 自定义下拉（替代原生 <select>）。
 * 原因：Electron 33 = Chromium 130，appearance: base-select / ::picker(select)
 * 还没启用，原生下拉面板的打开态（系统蓝条高亮）无法用 CSS 美化——必须自绘。
 * 设计：触发器 + portal 到 body 的 popup，保证打开面板也现代、且不被 .content 的 overflow 裁剪。
 */
let _csCurrent = null;
function closeCsPopup() {
  if (!_csCurrent) return;
  const { cs, pop } = _csCurrent;
  if (pop && pop.parentNode) pop.parentNode.removeChild(pop);
  const tr = cs && cs.querySelector('.cs-trigger');
  if (tr) tr.classList.remove('is-open');
  if (cs) cs.dataset.open = '';
  _csCurrent = null;
}
function ensureCsGlobals() {
  if (ensureCsGlobals._d) return; ensureCsGlobals._d = 1;
  // 外部点击关闭（click 阶段；触发器自己处理开关，不需 stopPropagation）
  document.addEventListener('click', (e) => {
    if (!_csCurrent) return;
    if (e.target.closest('.cs-pop') || e.target.closest('.cs')) return;
    closeCsPopup();
  });
  document.addEventListener('keydown', (e) => {
    if (!_csCurrent) return;
    if (e.key === 'Escape') { e.preventDefault(); closeCsPopup(); }
  });
  // 滚动/缩放时关闭：popup 在 body，触发器在滚动容器内，滚动会错位
  window.addEventListener('scroll', () => { if (_csCurrent) closeCsPopup(); }, true);
  window.addEventListener('resize', () => { if (_csCurrent) closeCsPopup(); });
}
function setCsValue(cs, value) {
  const opts = cs._csOpts || [];
  const cur = opts.find((o) => o.key === value) || opts[0];
  if (!cur) return;
  cs.dataset.value = cur.key;
  const lbl = cs.querySelector('.cs-label');
  if (lbl) lbl.textContent = cur.label;
}
function openCsPopup(cs) {
  closeCsPopup();
  ensureCsGlobals();
  const trigger = cs.querySelector('.cs-trigger');
  const opts = cs._csOpts || [];
  const cur = cs.dataset.value;
  const rect = trigger.getBoundingClientRect();
  const pop = document.createElement('div');
  pop.className = 'cs-pop';
  pop.setAttribute('role', 'listbox');
  pop.innerHTML = opts.map((o) => `
    <div class="cs-opt${o.key === cur ? ' is-cur' : ''}" role="option" data-value="${esc(o.key)}" aria-selected="${o.key === cur}">
      <svg class="cs-check" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2 L5 8.7 L9.7 3.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span class="cs-opt-label">${esc(o.label)}</span>
    </div>`).join('');
  document.body.appendChild(pop);
  // 先隐藏测量，再定位（避免出现位置闪烁）
  pop.style.visibility = 'hidden';
  pop.style.display = 'block';
  const ph = pop.offsetHeight;
  pop.style.visibility = '';
  pop.style.display = '';
  pop.style.minWidth = rect.width + 'px';
  const vh = window.innerHeight;
  const spaceBelow = vh - rect.bottom - 8;
  const desired = Math.min(opts.length * 36 + 12, 300);
  const maxH = Math.max(140, Math.min(desired, spaceBelow > 200 ? desired : Math.max(140, spaceBelow - 4)));
  pop.style.maxHeight = maxH + 'px';
  // 智能翻转：下方空间不够且上方够，则朝上
  let top = rect.bottom + 6;
  if (spaceBelow < 180 && rect.top > maxH + 16) { top = rect.top - ph - 6; pop.dataset.flip = 'up'; }
  pop.style.left = rect.left + 'px';
  pop.style.top = top + 'px';
  requestAnimationFrame(() => pop.classList.add('cs-pop-open'));
  trigger.classList.add('is-open');
  cs.dataset.open = '1';
  // 初始 active = current
  const firstCur = pop.querySelector('.cs-opt.is-cur') || pop.querySelector('.cs-opt');
  if (firstCur) firstCur.classList.add('is-active');
  // 选项点击
  pop.addEventListener('click', (ev) => {
    const opt = ev.target.closest('.cs-opt');
    if (!opt) return;
    const v = opt.dataset.value;
    setCsValue(cs, v);
    closeCsPopup();
    if (cs._csOnChange) cs._csOnChange(v);
  });
  // hover → active（视觉同步键盘 active）
  pop.querySelectorAll('.cs-opt').forEach((o) => {
    o.addEventListener('mouseenter', () => {
      pop.querySelectorAll('.cs-opt').forEach((x) => x.classList.remove('is-active'));
      o.classList.add('is-active');
    });
  });
  // popup 键盘
  pop.tabIndex = -1;
  pop.addEventListener('keydown', (e) => {
    const all = [...pop.querySelectorAll('.cs-opt')];
    const idx = all.indexOf(pop.querySelector('.cs-opt.is-active'));
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const n = all[Math.min(all.length - 1, Math.max(0, idx + 1))] || all[0];
      all.forEach((x) => x.classList.remove('is-active')); n.classList.add('is-active');
      n.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const n = all[Math.max(0, (idx < 0 ? all.length : idx) - 1)] || all[all.length - 1];
      all.forEach((x) => x.classList.remove('is-active')); n.classList.add('is-active');
      n.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const a = pop.querySelector('.cs-opt.is-active'); if (a) a.click();
    } else if (e.key === 'Escape') {
      e.preventDefault(); closeCsPopup(); trigger.focus();
    }
  });
  pop.focus({ preventScroll: true });
  _csCurrent = { cs, pop, opts };
}

function renderGestureList() {
  const events = state.constants?.GESTURE_EVENTS || [];
  const actions = state.constants?.GESTURE_ACTIONS || [];
  const list = $('gesture-list');
  list.innerHTML = '';
  for (const ev of events) {
    const cur = getByPath(state.cfg, `gestures.${ev.key}`) || 'none';
    const el = document.createElement('div');
    el.className = 'gesture-item';
    const curOpt = actions.find((a) => a.key === cur) || actions[0];
    el.innerHTML = `<div class="label">${esc(ev.label)}</div>`;
    const cs = document.createElement('div');
    cs.className = 'cs';
    cs.dataset.key = ev.key;
    cs.dataset.value = cur;
    cs._csOpts = actions;
    cs._csOnChange = async (v) => {
      await api.config.update({ gestures: { [ev.key]: v } });
      const cfg = await api.config.get();
      state.cfg = cfg;
      flashStatus('手势已更新');
    };
    cs.innerHTML = `
      <button type="button" class="cs-trigger" aria-haspopup="listbox" aria-expanded="false">
        <span class="cs-label">${esc(curOpt ? curOpt.label : cur)}</span>
        <svg class="cs-chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 L6 8 L9 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>`;
    cs.querySelector('.cs-trigger').addEventListener('click', (e) => {
      e.stopPropagation();
      if (cs.dataset.open) closeCsPopup(); else openCsPopup(cs);
    });
    el.appendChild(cs);
    list.appendChild(el);
  }
}

/* ============================ 统计 ============================ */

async function refreshStats() {
  state.stats = await api.study.stats();
  const s = state.stats;
  const grid = $('stat-grid');
  if (!s.progress) {
    grid.innerHTML = '<div class="muted">暂无数据</div>';
    return;
  }
  const items = [
    { num: s.progress.learned, lbl: '已学单词' },
    { num: s.progress.known, lbl: '已掌握' },
    { num: s.progress.marked, lbl: '生词' },
    { num: s.progress.total, lbl: '词库总数' },
    { num: s.today.learned || 0, lbl: '今日已学' },
    { num: s.today.reviewed || 0, lbl: '今日已复习' },
    { num: s.today.exposed || 0, lbl: '今日曝光' },
    { num: s.totals?.marked || 0, lbl: '历史生词累计' },
  ];
  grid.innerHTML = items.map((it) => `<div class="stat-card"><div class="num">${it.num}</div><div class="lbl">${it.lbl}</div></div>`).join('');

  const trend = $('trend');
  const max = Math.max(1, ...s.recent.map((d) => d.exposed || 0));
  trend.innerHTML = s.recent
    .map((d) => {
      const h = ((d.exposed || 0) / max) * 88;
      const cls = d.exposed ? 'bar' : 'bar empty';
      return `<div class="${cls}" style="height:${Math.max(h, d.exposed ? 2 : 1)}px" data-tip="${d.date} · 看过 ${d.exposed || 0} · 学 ${d.learned || 0} · 复习 ${d.reviewed || 0}"></div>`;
    })
    .join('');

  const marked = await api.study.marked();
  const ml = $('marked-list');
  if (!marked || !marked.length) {
    ml.innerHTML = '<div class="muted">（暂无生词）</div>';
  } else {
    ml.innerHTML = marked
      .slice(0, 80)
      .map((m) => `<div class="marked-pill">${esc(m.w)} <span class="due">×${m.n}</span></div>`)
      .join('');
  }
}

/* ============================ AI / 知识学习 ============================ */

async function bindLlm() {
  const setStatus = (t) => {
    $('llm-status').textContent = t;
  };
  $('btn-test-llm').addEventListener('click', async () => {
    setStatus('测试中…');
    try {
      const r = await api.knowledge.test();
      setStatus(r.ok ? `✓ 成功 · ${r.model} · ${r.latencyMs}ms` : '✗ ' + (r.error || '失败'));
    } catch (e) {
      setStatus('✗ ' + (e.message || '失败'));
    }
  });
  try {
    const st = await api.knowledge.status();
    setStatus(st.configured ? `已配置 · ${st.model}` : '未配置 / 未启用');
  } catch (e) {
    setStatus('未检测');
  }
}

/* ============================ 推送控制 ============================ */

async function bindPushControls() {
  $('btn-push-now').addEventListener('click', async () => {
    await api.notify.push();
    $('push-status').textContent = '已推送';
  });
  $('btn-pause-1h').addEventListener('click', async () => {
    await api.notify.pause(3600 * 1000);
    $('push-status').textContent = '已临时静默 1 小时';
    flashStatus('已临时静默 1 小时');
  });
  $('btn-resume-push').addEventListener('click', async () => {
    await api.notify.resume();
    $('push-status').textContent = '已恢复';
    flashStatus('已恢复推送');
  });
}

/* ============================ 词库操作 ============================ */

async function bindDictControls() {
  $('btn-import-dict').addEventListener('click', async () => {
    const r = await api.dict.import();
    if (r.canceled) return;
    if (!r.ok) {
      alert(r.error || '导入失败');
      return;
    }
    state.books = await api.dict.list();
    const cfg = await api.config.get();
    state.cfg = cfg;
    await renderBooks();
    await refreshStats();
    flashStatus(`已导入 ${r.name} · ${r.count} 词`);
  });
  $('btn-reset-progress').addEventListener('click', async () => {
    if (!confirm('清空当前词库的已学 / 复习 / 生词记录？此操作不可撤销。')) return;
    const r = await api.study.reset();
    if (r.ok) {
      flashStatus(`已清空 ${r.cleared} 条记录`);
      await refreshStats();
    }
  });
}

/* ============================ 杂项 ============================ */

async function bindUI() {
  // 导航
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.addEventListener('click', () => gotoPage(el.dataset.go));
  });

  // 标题栏
  $('btn-minimize').addEventListener('click', () => api.win.minimize());
  $('btn-close').addEventListener('click', () => api.win.close());
  $('btn-save-close').addEventListener('click', () => api.win.close());

  // 数据目录
  $('btn-open-data').addEventListener('click', () => api.win.openDataDir());

  // 自动启动同步
  document.querySelector('[data-cfg="general.autoLaunch"]').addEventListener('change', (e) => onAutoLaunchChange(e.target.checked));

  // 其余字段更新
  const debouncedUpdate = debounce(onCfgInputChange, 250);
  document.querySelectorAll('[data-cfg]').forEach((el) => {
    if (el.dataset.cfg === 'general.autoLaunch') return;
    el.addEventListener('change', debouncedUpdate);
    if (el.type === 'number' || el.tagName === 'SELECT') el.addEventListener('input', debouncedUpdate);
  });
}

/* ============================ 初始化 ============================ */

async function init() {
  const [cfg, constants, books, version] = await Promise.all([
    api.config.get(), api.config.constants(), api.dict.list(), api.app.version(),
  ]);
  state.cfg = cfg;
  state.constants = constants;
  state.books = books;
  $('version').textContent = `v${version}`;

  await bindUI();
  await applyConfigToUI(cfg);
  await refreshStats();
  await bindDictControls();
  await bindPushControls();
  await bindLlm();

  // 启动时根据配置里的 autoLaunch 同步 checkbox 状态
  const al = await api.app.getAutoLaunch();
  const alEl = document.querySelector('[data-cfg="general.autoLaunch"]');
  if (alEl) alEl.checked = al;

  api.onConfigChanged(async ({ section }) => {
    if (!section) return;
    const cfg = await api.config.get();
    state.cfg = cfg;
    if (['hotkeys', 'gestures', 'popup'].includes(section)) {
      renderHotkeyList();
      renderGestureList();
      renderPreview();
    }
  });
  api.onStats(() => refreshStats());
  api.onGoto((section) => {
    if (section) gotoPage(section);
  });
}

init().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<pre style="padding:20px;color:#d85a30">初始化失败：${esc(e.message)}\n${esc(e.stack)}</pre>`;
});