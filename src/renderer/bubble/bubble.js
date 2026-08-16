'use strict';
const api = window.wfBubble;

const $ = (id) => document.getElementById(id);
const refs = {
  root: $('root'),
  brand: $('brand'),
  src: $('src'),
  word: $('word'),
  phonetic: $('phonetic'),
  meanings: $('meanings'),
};

const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SOURCE_LABEL = { new: '新词', due: '复习', marked: '生词复习', random: '随见' };

// 手势状态：meaningHidden 由 toggleMeaning 手势切换（默认显示释义）；
// currentPayload 保存最近一次渲染的 payload，供 speak 手势朗读当前单词
let meaningHidden = false;
let currentPayload = null;

function render(payload) {
  if (!payload) return;
  currentPayload = payload;
  const v = payload.view;
  document.body.dataset.theme = v.theme || 'light';
  const w = payload.word;
  refs.word.textContent = w.w;
  refs.src.textContent = SOURCE_LABEL[payload.source] || '推送';

  const us = w.us ? `<span><span class="label">美</span>${esc(w.us)}</span>` : '';
  const uk = w.uk ? `<span><span class="label">英</span>${esc(w.uk)}</span>` : '';
  refs.phonetic.innerHTML = us + (us && uk ? '<span class="sep">|</span>' : '') + uk;

  const meanings = (w.t || [])
    .slice(0, 2)
    .map((t) => `<div><span class="pos">${esc(t.p || '')}</span>${esc(t.c)}</div>`)
    .join('');
  refs.meanings.innerHTML = meanings || '<div style="color:var(--mute)">无释义</div>';
  // 换词重渲染时保持手势设置的释义显隐状态
  refs.meanings.classList.toggle('meaning-hidden', meaningHidden);

  refs.root.classList.remove('fading');
  refs.root.style.opacity = '1'; // 收到真实单词后再显示，避免占位(abandon)闪烁

  requestAnimationFrame(() => {
    const h = refs.root.getBoundingClientRect().height;
    const w_ = refs.root.getBoundingClientRect().width;
    api.resize(Math.ceil(w_), Math.ceil(h));
  });
}

document.getElementById('btn-skip').addEventListener('click', async () => {
  // 旧实现：markUnknown() → hold()（清掉自动关闭定时器）→ next()，但 next() 不广播，
  // 气泡只监听 word:update 重绘，于是气泡停在旧单词且永不关闭（被 hold 冻住）。
  // 改为：用 markUnknown + next 返回的新 payload 直接 render，保留自动关闭定时器。
  await api.markUnknown();
  const np = await api.next();
  if (np) render(np);
});
document.getElementById('btn-know').addEventListener('click', async () => {
  await api.markKnown();
  const np = await api.next();
  if (np) render(np);
});
document.getElementById('btn-open').addEventListener('click', () => api.showPopup());
document.getElementById('btn-close').addEventListener('click', () => api.close());

api.onWord((p) => render(p));
api.onFadeOut(() => refs.root.classList.add('fading'));

// 主进程 dispatchAction 会把 toggleMeaning / speak 手势广播到 bubble
// （channel 'gesture:fire'，payload 形如 { gesture: 'toggleMeaning' }），
// 处理方式与 popup.js 的 onGesture 保持一致。
api.onGesture((p) => {
  if (!p) return;
  if (p.gesture === 'toggleMeaning') {
    meaningHidden = !meaningHidden;
    refs.meanings.classList.toggle('meaning-hidden', meaningHidden);
  } else if (p.gesture === 'speak' && currentPayload) {
    speakWord(currentPayload.word.w);
  }
});

// bubble 的 preload 没暴露 speak，直接用 speechSynthesis
// （参数与 preload/popup.js 里的 speak 实现一致）
function speakWord(text) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.9;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch (e) {}
}

window.addEventListener('resize', () => {
  const h = refs.root.getBoundingClientRect().height;
  const w_ = refs.root.getBoundingClientRect().width;
  api.resize(Math.ceil(w_), Math.ceil(h));
});