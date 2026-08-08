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

function render(payload) {
  if (!payload) return;
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

window.addEventListener('resize', () => {
  const h = refs.root.getBoundingClientRect().height;
  const w_ = refs.root.getBoundingClientRect().width;
  api.resize(Math.ceil(w_), Math.ceil(h));
});