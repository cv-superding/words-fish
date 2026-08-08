'use strict';
const api = window.wfPopup;

const $ = (id) => document.getElementById(id);
const refs = {
  root: $('root'),
  body: document.body,
  content: $('content'),
  progress: $('progress'),
  meaningPanel: $('meaning-panel'),
  tabWord: $('tab-word'),
  tabKnowledge: $('tab-knowledge'),
  wordView: $('word-view'),
  knowledgeView: $('knowledge-view'),
  knowledgeWebview: $('knowledge-webview'),
  actions: $('actions'),
  btnPin: $('btn-pin'),
  btnClose: $('btn-close'),
  btnUnknown: $('btn-unknown'),
  btnKnown: $('btn-known'),
  btnReveal: $('btn-reveal'),
  btnNext: $('btn-next'),
  resizeGrip: document.querySelector('.resize-grip'),
};

let state = {
  payload: null,
  revealed: true,
  pinned: false,
  view: 'word',
  gestures: {},
  clickPending: null,
  longPressTimer: null,
  longPressed: false,
};

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtProgress(p) {
  if (!p) return '';
  const { learned, total, todayLearned, dailyGoal } = p;
  const goalText = dailyGoal ? `${todayLearned}/${dailyGoal}` : `${learned}/${total}`;
  return `${goalText} · ${learned}/${total}`;
}

function buildMeanings(w) {
  const items = (w.t || [])
    .map((t) => `<div class="row"><span class="pos">${escapeHtml(t.p || '')}</span><span class="c">${escapeHtml(t.c || '')}</span></div>`)
    .join('');
  return `<div class="trans">${items}</div>`;
}

function buildPhonetic(w, v) {
  if (!v.showPhonetic) return '';
  const us = w.us ? `<span><span class="label">美</span>${escapeHtml(w.us)}</span>` : '';
  const uk = w.uk ? `<span><span class="label">英</span>${escapeHtml(w.uk)}</span>` : '';
  if (!us && !uk) return '';
  return `<div class="phonetic">${us}${us && uk ? '<span class="sep">|</span>' : ''}${uk}</div>`;
}

function buildSentence(w, v) {
  if (!v.showSentence || !w.e) return '';
  return `<div class="sentence">${escapeHtml(w.e)}${w.ec ? `<div class="ec">${escapeHtml(w.ec)}</div>` : ''}</div>`;
}

function buildPhrase(w, v) {
  if (!v.showPhrase || !w.ph || !w.ph.length) return '';
  const rows = w.ph.map((p) => `<div class="row"><span class="p">${escapeHtml(p.p)}</span>${escapeHtml(p.c)}</div>`).join('');
  return `<div class="phrase"><h4>短语</h4>${rows}</div>`;
}

function buildMethod(w) {
  if (!w.m) return '';
  return `<div class="method">💡 ${escapeHtml(w.m)}</div>`;
}

function buildTags(rec, source) {
  const tags = [];
  if (rec.marked) tags.push(`<span class="tag">生词</span>`);
  if (rec.status === 'known') tags.push(`<span class="tag">已掌握</span>`);
  if (source === 'new') tags.push(`<span class="tag">新词</span>`);
  if (source === 'due') tags.push(`<span class="tag">复习</span>`);
  if (rec.seen > 1) tags.push(`<span class="tag">×${rec.seen}</span>`);
  return tags.length ? `<div class="tags">${tags.join('')}</div>` : '';
}

function render(payload) {
  if (!payload) return;
  state.payload = payload;
  state.gestures = payload.gestures || {};
  const v = payload.view;
  refs.body.dataset.theme = v.theme || 'light';
  refs.root.style.opacity = v.opacity ?? 0.96;
  document.documentElement.style.fontSize = `${v.fontSize || 15}px`;
  refs.root.style.minWidth = `${v.width || 380}px`;
  refs.body.style.fontSize = `${v.fontSize || 15}px`;
  refs.btnPin.classList.toggle('active', !!v.pinned);
  state.pinned = !!v.pinned;

  const w = payload.word;
  const wordBlock = `<div class="word-block"><span class="word">${escapeHtml(w.w)}</span><button class="speak" id="speak-btn">🔊 朗读</button></div>`;
  const tags = buildTags(payload.rec, payload.source);
  const phonetic = buildPhonetic(w, v);

  if (!state.revealed) {
    refs.meaningPanel.innerHTML = `
      ${wordBlock}
      ${tags}
      ${phonetic}
      <div class="meaning-locked">
        <div class="hint">已隐藏释义 · 单击显示</div>
      </div>`;
  } else {
    refs.meaningPanel.innerHTML = `
      ${wordBlock}
      ${tags}
      ${phonetic}
      ${buildMeanings(w)}
      ${buildSentence(w, v)}
      ${buildPhrase(w, v)}
      ${buildMethod(w)}
    `;
  }

  refs.progress.textContent = fmtProgress(payload.progress);
  refs.btnReveal.textContent = state.revealed ? '隐藏释义' : '显示释义';

  const speakBtn = document.getElementById('speak-btn');
  if (speakBtn) speakBtn.addEventListener('click', (e) => { e.stopPropagation(); api.speak(w.w); });

  // 仅在单词视图下随内容自适应高度；知识视图尺寸由用户/视图切换控制
  if (state.view !== 'knowledge') scheduleResize();
}

function scheduleResize() {
  requestAnimationFrame(() => {
    const h = document.getElementById('root').getBoundingClientRect().height;
    const w = document.getElementById('root').getBoundingClientRect().width;
    api.resize(Math.ceil(w), Math.ceil(h));
  });
}

/* ----------------------- 单词 / 知识 视图切换 ----------------------- */

// 知识视图尺寸：默认比单词视图大一档够用，但绝不能撑满屏幕（这就是个悬浮窗）。
const KNOWLEDGE_DEFAULT = { width: 520, height: 440 };
// 视图最大尺寸：旧 session 拖过的 size 会被存到 config，下次切视图会用回来；上限防失控。
const KNOWLEDGE_MAX = { width: 620, height: 540 };
const WORD_MAX = { width: 560, height: 420 };
function clampSize(s, max, fallback) {
  const w = Math.max(280, Math.min(max.width, s && Number.isFinite(s.width) ? s.width : fallback.width));
  const h = Math.max(180, Math.min(max.height, s && Number.isFinite(s.height) ? s.height : fallback.height));
  return { width: w, height: h };
}

async function applyView(view) {
  if (view !== 'word' && view !== 'knowledge') view = 'word';
  state.view = view;

  refs.tabWord.classList.toggle('active', view === 'word');
  refs.tabKnowledge.classList.toggle('active', view === 'knowledge');
  refs.wordView.classList.toggle('hidden', view !== 'word');
  refs.knowledgeView.classList.toggle('hidden', view !== 'knowledge');
  // 单词视图才显示底部操作栏（生词/下一个等）；知识视图使用内嵌知识面板的输入区
  refs.actions.classList.toggle('hidden', view !== 'word');

  try { await api.setView(view); } catch (e) {}

  let size = KNOWLEDGE_DEFAULT;
  try {
    const cfg = await api.getPopup();
    if (view === 'knowledge') {
      // 即使 cfg.knowledgeSize 已被旧 session 拖到 1000+，也强制钳到 KNOWLEDGE_MAX
      size = clampSize(cfg && cfg.knowledgeSize, KNOWLEDGE_MAX, KNOWLEDGE_DEFAULT);
    } else {
      const raw = (cfg && cfg.size) || {};
      size = clampSize({ width: raw.width || 380, height: raw.height || 240 }, WORD_MAX, { width: 380, height: 240 });
    }
  } catch (e) {}

  // force=true：切换视图时允许在两种尺寸间自由变化（不受手动缩放钳制）
  api.resize(size.width, size.height, true);
  if (view === 'word') scheduleResize();
}

function setupTabs() {
  refs.tabWord.addEventListener('click', (e) => { e.stopPropagation(); applyView('word'); });
  refs.tabKnowledge.addEventListener('click', (e) => { e.stopPropagation(); applyView('knowledge'); });
}

function setupKnowledgeWebview() {
  const wv = refs.knowledgeWebview;
  if (!wv) return;
  // 隐藏知识面板自带的标题栏（最小化/关闭按钮会作用到错误的宿主窗口）
  const hideGuestTitlebar = () => {
    try { wv.insertCSS('.titlebar { display: none !important; }'); } catch (e) {}
  };
  wv.addEventListener('dom-ready', hideGuestTitlebar);
  wv.addEventListener('did-stop-loading', hideGuestTitlebar);

  api.onAssets(({ knowledgeHtml, knowledgePreload }) => {
    if (!knowledgeHtml) return;
    try { wv.preload = knowledgePreload; } catch (e) {}
    // 标记宿主为 popup：知识页面会据此精简布局（隐藏侧栏 / 砍多余按钮）。
    const sep = knowledgeHtml.includes('?') ? '&' : '?';
    wv.src = `${knowledgeHtml}${sep}host=popup`;
  });

  // webview 收不到主进程对顶层 BrowserWindow 的 config:changed 广播
  //（wins.broadcast 只发到父 webContents），所以 popup 收到的配置变化需要转发给 webview，
  // 这样切主题时知识页能立即 applyTheme()，而不是等下次刷新。
  api.onConfig((payload) => {
    try { wv.send('config:changed', payload); } catch (e) {}
  });
}

/* ----------------------------- 手势 ----------------------------- */

function fireGesture(gesture) {
  if (!gesture || gesture === 'none') return;
  const action = state.gestures[gesture];
  if (!action || action === 'none') return;
  api.fireGesture(gesture).catch(() => {});
}

function handleClick(e) {
  if (e.target.closest('button')) return;
  if (state.longPressed) { state.longPressed = false; return; }
  if (state.clickPending) {
    clearTimeout(state.clickPending);
    state.clickPending = null;
    fireGesture(state.gestures.dblclick || 'dblclick');
    return;
  }
  state.clickPending = setTimeout(() => {
    state.clickPending = null;
    if (!state.revealed) {
      // 释义已隐藏：单击直接显示，不再额外触发 toggleMeaning 手势，
      // 否则 onGesture 会把刚显示的释义又翻转回去（无反应）。
      state.revealed = true;
      if (state.payload) render(state.payload);
      return;
    }
    fireGesture(state.gestures.click || 'click');
  }, 280);
}

function handleContext(e) {
  e.preventDefault();
  fireGesture('rightclick');
}

function handleMiddle(e) {
  e.preventDefault();
  fireGesture('middleclick');
}

function handleDown(e) {
  if (e.button !== 0) return;
  state.longPressed = false;
  state.longPressTimer = setTimeout(() => {
    state.longPressed = true;
    fireGesture('longpress');
  }, 520);
}
function handleUp(e) {
  if (e.button !== 0) return;
  clearTimeout(state.longPressTimer);
}

/* ------------------------------ 按钮 ------------------------------ */

refs.btnClose.addEventListener('click', (e) => { e.stopPropagation(); api.close(); });
refs.btnUnknown.addEventListener('click', async (e) => {
  e.stopPropagation();
  await api.markUnknown();
  const p = await api.next();
  render(p);
});
refs.btnKnown.addEventListener('click', async (e) => {
  e.stopPropagation();
  await api.markKnown();
  const p = await api.next();
  render(p);
});
refs.btnReveal.addEventListener('click', (e) => {
  e.stopPropagation();
  state.revealed = !state.revealed;
  if (state.payload) render(state.payload);
});
refs.btnNext.addEventListener('click', async (e) => {
  e.stopPropagation();
  const p = await api.next();
  render(p);
});
refs.btnPin.addEventListener('click', (e) => {
  e.stopPropagation();
  state.pinned = !state.pinned;
  refs.btnPin.classList.toggle('active', state.pinned);
  // 置顶必须写进 config.popup.pinned：失焦自动收起逻辑（windows.js 的 blur handler）
  // 判断的是 config 值，按钮若只改窗口状态不落配置，点别的窗口仍会被收起。
  api.alwaysOnTop(state.pinned);
  api.configUpdate({ popup: { pinned: state.pinned } }, { silentReload: true }).catch(() => {});
});

refs.meaningPanel.addEventListener('click', handleClick);
refs.meaningPanel.addEventListener('contextmenu', handleContext);
refs.meaningPanel.addEventListener('mousedown', handleDown);
refs.meaningPanel.addEventListener('mouseup', handleUp);
refs.meaningPanel.addEventListener('mouseleave', () => clearTimeout(state.longPressTimer));

// 右下角 grip 拖拽缩放（同时窗口四边也可由系统原生边框拖拽）
if (refs.resizeGrip) {
  let dragging = false, startX = 0, startY = 0, startW = 0, startH = 0;
  refs.resizeGrip.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = refs.root.getBoundingClientRect();
    startW = rect.width;
    startH = rect.height;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'nwse-resize';
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const max = state.view === 'knowledge' ? KNOWLEDGE_MAX : WORD_MAX;
    const nw = Math.max(280, Math.min(max.width, Math.round(startW + (e.clientX - startX))));
    const nh = Math.max(180, Math.min(max.height, Math.round(startH + (e.clientY - startY))));
    api.resize(nw, nh, true);
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  });
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api.close();
  else if (e.key === 'Tab') {
    e.preventDefault();
    applyView(state.view === 'word' ? 'knowledge' : 'word');
  } else if (e.key === ' ') {
    e.preventDefault();
    refs.btnNext.click();
  } else if (e.key === 'Enter') {
    if (!state.revealed) {
      state.revealed = true;
      if (state.payload) render(state.payload);
    } else refs.btnKnown.click();
  } else if (e.key === '?' || e.key === '/') {
    refs.btnUnknown.click();
  }
});

/* ----------------------------- 初始化 ----------------------------- */

// 加载新词：根据“自测模式”设置初始释义显隐，再渲染。
// 注意：revealed 只在“新词”时按 meaningHidden 计算，切换释义显隐由用户手动控制，
// 不能在 render 里重置（否则点“隐藏释义”后 render 会立刻把它改回 true，导致没反应）。
function loadWord(payload) {
  if (!payload) return;
  state.revealed = !payload.view.meaningHidden;
  render(payload);
}

api.onWord(loadWord);
api.onGesture((p) => {
  if (!p) return;
  if (p.gesture === 'toggleMeaning') {
    state.revealed = !state.revealed;
    if (state.payload) render(state.payload);
  } else if (p.gesture === 'speak' && state.payload) {
    api.speak(state.payload.word.w);
  }
});
api.onConfig(({ section }) => {
  // 任何配置变化都即时重渲染（悬浮窗可见属性都来自 config）。
  // 但不要用 loadWord（它会重置 state.revealed = !meaningHidden），否则用户手动
  // 隐藏的释义会被任何配置广播（切主题/字号/间隔等）无声重置，自测模式被打断。
  // 这里只更新 payload / gestures 后直接 render，render 内部依据 state.revealed
  // 决定释义显隐，从而保留用户当前的显隐状态。
  if (section === 'llm') return;
  api.current().then((p) => {
    if (!p) return;
    state.payload = p;
    state.gestures = p.gestures || {};
    render(p);
  });
});

window.addEventListener('resize', scheduleResize);

// 滚轮兜底：config 里有 wheelUp/wheelDown 映射到 prevWord/nextWord，
// 但渲染层没有任何触发器。为防潜在的父级/Electron 级监听误触发切词，
// 显式 stopPropagation（不 preventDefault，内容区自身的滚动不受影响）。
window.addEventListener('wheel', (e) => { e.stopPropagation(); }, { passive: true });

(async () => {
  const p = await api.current();
  loadWord(p);
  setupTabs();
  setupKnowledgeWebview();
  try { await api.requestAssets(); } catch (e) {}

  // 恢复上次停留的视图（单词 / 知识）
  let initialView = 'word';
  try {
    const cfg = await api.getPopup();
    initialView = (cfg && cfg.view) || 'word';
  } catch (e) {}
  applyView(initialView);
})();