'use strict';
const api = window.wfPopup;

const $ = (id) => document.getElementById(id);
const refs = {
  root: $('root'),
  body: document.body,
  content: $('content'),
  progress: $('progress'),
  meaningPanel: $('meaning-panel'),
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

  state.revealed = !v.meaningHidden;

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

  scheduleResize();
}

function scheduleResize() {
  requestAnimationFrame(() => {
    const h = document.getElementById('root').getBoundingClientRect().height;
    const w = document.getElementById('root').getBoundingClientRect().width;
    api.resize(Math.ceil(w), Math.ceil(h));
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
    const gesture = state.revealed ? 'click' : 'toggleMeaning';
    fireGesture(gesture);
    if (!state.revealed) {
      state.revealed = true;
      if (state.payload) render(state.payload);
    }
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
  api.alwaysOnTop(state.pinned);
  refs.btnPin.classList.toggle('active', state.pinned);
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
    const nw = Math.max(280, Math.round(startW + (e.clientX - startX)));
    const nh = Math.max(180, Math.round(startH + (e.clientY - startY)));
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
  else if (e.key === ' ') {
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

api.onWord((payload) => render(payload));
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
  if (!section) return;
  api.current().then((p) => { if (p) render(p); });
});

window.addEventListener('resize', scheduleResize);

(async () => {
  const p = await api.current();
  render(p);
})();