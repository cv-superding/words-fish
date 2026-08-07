'use strict';
const api = window.wfKnowledge;

const $ = (id) => document.getElementById(id);
const flash = (text) => {
  const el = $('status-line');
  if (!el) return; // popup 模式无标题栏，没 status-line，silent 即可
  el.textContent = text;
  clearTimeout(flash._t);
  flash._t = setTimeout(() => (el.textContent = '就绪'), 1800);
};

const state = {
  presets: [],
  sessions: [],
  current: null, // { id, domain, domainName }
  mode: 'ask',
  streaming: false,
  assistantBuf: '',
  assistantNode: null,
  lastUsage: null,
  model: '',
  rafPending: false,
};

/* ============================ 初始化 ============================ */

// 识别宿主：webview 加载时 popup.js 会追加 ?host=popup；
// BrowserWindow 直接加载是 standalone。
function detectHost() {
  const params = new URLSearchParams(location.search);
  const host = params.get('host') === 'popup' ? 'popup' : 'standalone';
  document.body.dataset.host = host;
  return host;
}

// 读 config.popup.theme 写到 body[data-theme]，与 popup 同步主题。
// 知识页以前 CSS 写死浅色、且 webview 收不到主窗口广播，所以切主题不会变。
// popup.js 会把 config:changed 转发到 webview（wv.send），这里监听后即应用。
// 注意：api.config.get() 是 ipcRenderer.invoke 的 Promise，必须 await。
// 之前漏 await 会读到 undefined → theme 一直 fallback 到 'light'，所以大背景不变。
async function applyTheme() {
  try {
    const cfg = (api.config && api.config.get) ? await api.config.get() : null;
    const theme = (cfg && cfg.popup && cfg.popup.theme) || 'light';
    document.body.dataset.theme = theme;
  } catch (e) { /* standalone 或 webview 未就绪时静默 */ }
}

function applyPopupLayout() {
  // popup 模式：去掉侧栏（领域 chip / 会话列表），砍掉多余按钮与模式切换
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) sidebar.remove();

  // 顶部 chat-actions：只留"下一个知识点"
  const clear = document.getElementById('btn-clear');
  if (clear) clear.remove();
  const settings = document.getElementById('btn-settings');
  if (settings) settings.remove();

  // 模式切换：在悬浮窗里默认走"知识卡片"，省掉一行 UI
  const modeRow = document.querySelector('.mode-row');
  if (modeRow) modeRow.remove();
  state.mode = 'card';

  // 标题栏：webview 里既无最小化/关闭按钮（hideGuestTitlebar 兜底），也没意义
  const titlebar = document.querySelector('.titlebar');
  if (titlebar) titlebar.remove();

  // 在消息流上方插一行紧凑的"领域切换"chip（侧栏删了，领域切换必须有入口）
  const chatHead = document.querySelector('.chat-head');
  const inline = document.createElement('div');
  inline.className = 'domain-chips-inline';
  inline.id = 'domain-chips-inline';
  chatHead.parentNode.insertBefore(inline, chatHead.nextSibling);
}

async function init() {
  const host = detectHost();
  bindUI();
  // popup 模式：必须在 renderChips 之前改 DOM，否则侧栏/模式 row 还在
  if (host === 'popup') applyPopupLayout();
  // 与 popup 同步主题：必须在 connect dot / chips 渲染前设好，
  // 否则首次渲染会按默认浅色出，再切主题会有闪烁。
  await applyTheme();

  api.onToken(onToken);
  api.onDone(onDone);
  api.onConfigChanged(async () => {
    await applyTheme();
    await updateConnDot();
  });
  api.onOpenDomain((domain) => openDomain(domain));

  try {
    const [presets, sessions, status] = await Promise.all([api.presets(), api.listSessions(), api.status()]);
    state.presets = presets;
    state.sessions = sessions;
    state.model = status.model || '';
    renderChips();
    if (host !== 'popup') renderSessions();
    await updateConnDot();
  } catch (e) {
    console.error(e);
  }
}

/* ============================ 侧栏渲染 ============================ */

function renderChips() {
  const host = $('domain-chips-inline') || $('domain-chips');
  if (!host) return;
  host.innerHTML = '';
  for (const p of state.presets) {
    const el = document.createElement('div');
    el.className = 'chip' + (state.current && state.current.domain === p.id ? ' active' : '');
    el.textContent = p.name;
    el.title = p.desc;
    el.addEventListener('click', () => openDomain(p.id));
    host.appendChild(el);
  }
}

async function renderSessions() {
  try {
    state.sessions = await api.listSessions();
  } catch (e) {}
  const host = $('session-list');
  if (!state.sessions.length) {
    host.innerHTML = '<div class="muted small">还没有会话，选一个领域开始吧。</div>';
    return;
  }
  host.innerHTML = '';
  for (const s of state.sessions) {
    const el = document.createElement('div');
    el.className = 'session-item' + (state.current && state.current.id === s.id ? ' active' : '');
    const when = relTime(s.updatedAt);
    el.innerHTML = `<div class="s-name">${esc(s.domainName)}</div><div class="s-meta">${s.messages} 条 · ${when}</div>`;
    el.addEventListener('click', () => openSession(s.id));
    host.appendChild(el);
  }
}

async function openDomain(domain) {
  try {
    const r = await api.open(domain);
    const preset = state.presets.find((p) => p.id === domain);
    const displayName = domain.startsWith('custom:') ? domain.slice('custom:'.length) : preset ? preset.name : domain;
    state.current = { id: r.session.id, domain, domainName: displayName };
    $('current-domain').textContent = displayName;
    $('welcome').style.display = 'none';
    renderChips();
    await renderSessions();
    renderHistory(r.history);
    await updateConnDot();
    flash('已打开：' + displayName);
  } catch (e) {
    flash('打开失败：' + (e.message || e));
  }
}

async function openSession(id) {
  const r = await api.history(id);
  const s = state.sessions.find((x) => x.id === id);
  state.current = { id, domain: s ? s.domain : '', domainName: s ? s.domainName : '' };
  $('current-domain').textContent = s ? s.domainName : '会话';
  $('welcome').style.display = 'none';
  await renderSessions();
  renderHistory(r);
}

/* ============================ 消息渲染 ============================ */

function renderHistory(history) {
  const host = $('messages');
  host.innerHTML = '';
  if (!history || !history.length) {
    const hint = document.createElement('div');
    hint.className = 'muted small';
    hint.style.cssText = 'margin:auto;text-align:center;color:var(--text-mute)';
    hint.textContent = '会话开始，试试「知识卡片」或「来道题」吧。';
    host.appendChild(hint);
    return;
  }
  for (const m of history) appendMessage(m.role, m.content, true);
  scrollBottom();
}

function appendMessage(role, text, final) {
  const host = $('messages');
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = role === 'user' ? '🙋' : '🤖';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  const md = document.createElement('div');
  md.className = 'md';
  md.innerHTML = role === 'assistant' ? mdToHtml(text) : esc(text);
  bubble.appendChild(md);
  wrap.appendChild(avatar);
  wrap.appendChild(bubble);
  host.appendChild(wrap);
  scrollBottom();
  return { wrap, bubble };
}

function createAssistantBubble() {
  const host = $('messages');
  const wrap = document.createElement('div');
  wrap.className = 'msg assistant';
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = '🤖';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  const md = document.createElement('div');
  md.className = 'md';
  md.innerHTML = '<span class="typing"></span>';
  const footer = document.createElement('div');
  footer.className = 'footer';
  footer.innerHTML = '<span class="typing">思考中</span>';
  bubble.appendChild(md);
  bubble.appendChild(footer);
  wrap.appendChild(avatar);
  wrap.appendChild(bubble);
  host.appendChild(wrap);
  scrollBottom();
  return bubble;
}

function renderAssistantContent(node, text, usage, typing) {
  const md = node.querySelector('.md');
  if (md) md.innerHTML = mdToHtml(text) || (typing ? '<span class="typing"></span>' : '');
  const footer = node.querySelector('.footer');
  if (footer) {
    if (usage && usage.total_tokens != null) {
      footer.innerHTML =
        `<span>🧠 ${esc(state.model || 'AI')}</span>` +
        `<span>${usage.total_tokens} tokens</span>` +
        `<span class="copy" data-copy>复制</span>`;
    } else if (typing) {
      footer.innerHTML = '<span class="typing">思考中</span>';
    } else {
      footer.innerHTML = `<span>🧠 ${esc(state.model || 'AI')}</span><span class="copy" data-copy>复制</span>`;
    }
  }
  scrollBottom();
}

function scheduleRenderAssistant() {
  if (state.rafPending) return;
  state.rafPending = true;
  requestAnimationFrame(() => {
    state.rafPending = false;
    if (state.assistantNode) renderAssistantContent(state.assistantNode, state.assistantBuf, null, true);
  });
}

function finalizeAssistant() {
  if (!state.assistantNode) {
    state.streaming = false;
    setComposeDisabled(false);
    return;
  }
  renderAssistantContent(state.assistantNode, state.assistantBuf, state.lastUsage, false);
  state.assistantNode = null;
  state.streaming = false;
  setComposeDisabled(false);
  scrollBottom();
  renderSessions();
}

/* ============================ 发送 / 流式 ============================ */

async function send() {
  if (state.streaming) return;
  if (!state.current) {
    flash(document.body.dataset.host === 'popup' ? '请先选择一个领域' : '请先在左侧选择一个领域');
    return;
  }
  // popup 模式没有模式切换 UI：用 mode 与 input 协同
  //   input 为空 → 走 'card'（生成知识卡片）
  //   input 非空 → 走 'ask'（把问题抛给 AI）
  // 这样点"下一个知识点"和"输入后发送"两个动作都顺，且无须额外控件。
  const input = $('input').value;
  let type;
  if (document.body.dataset.host === 'popup') {
    type = input.trim() ? 'ask' : 'card';
  } else {
    type = state.mode;
  }
  if (type === 'ask' && !input.trim()) {
    flash('请输入你的问题');
    return;
  }
  const topic = input.trim();
  const userText =
    type === 'ask'
      ? topic
      : type === 'card'
      ? '📇 生成知识卡片' + (topic ? '：' + topic : '')
      : '📝 来一道测验题' + (topic ? '：' + topic : '');
  appendMessage('user', userText);
  $('input').value = '';

  state.assistantBuf = '';
  state.lastUsage = null;
  state.assistantNode = createAssistantBubble();
  state.streaming = true;
  setComposeDisabled(true);

  try {
    const r = await api.ask(state.current.id, type, topic);
    state.lastUsage = r.usage;
    if (r.content) state.assistantBuf = r.content;
  } catch (e) {
    state.assistantBuf = '⚠️ 请求失败：' + (e.message || e);
  }
  finalizeAssistant();
}

function onToken({ sessionId, token }) {
  if (!state.current || sessionId !== state.current.id || !state.streaming) return;
  state.assistantBuf += token;
  scheduleRenderAssistant();
}

function onDone({ sessionId }) {
  if (!state.current || sessionId !== state.current.id) return;
  // invoke 也返回最终结果，由 send() 统一收尾；这里仅兜底
  if (state.assistantNode) finalizeAssistant();
}

/* ============================ 连接状态 ============================ */

async function updateConnDot() {
  const dot = $('conn-dot');
  try {
    const st = await api.status();
    state.model = st.model || state.model;
    dot.className = 'conn ' + (st.configured ? 'ok' : 'bad');
    dot.title = st.configured ? `已配置 · ${st.model}` : '未配置 / 未启用';
  } catch (e) {
    dot.className = 'conn bad';
  }
}

/* ============================ 交互绑定 ============================ */

function bindUI() {
  const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
  on('btn-minimize', () => api.win.minimize());
  on('btn-close', () => api.win.close());
  on('btn-send', send);
  on('btn-next', () => {
    state.mode = 'card';
    syncModeUI();
    send();
  });
  on('btn-clear', async () => {
    if (!state.current) return;
    if (!confirm('清空当前会话的学习记录？')) return;
    await api.reset(state.current.id);
    $('messages').innerHTML = '';
    flash('会话已清空');
    renderSessions();
  });
  on('btn-settings', () => api.win.openSettings('llm'));
  on('btn-custom-domain', () => {
    const v = $('custom-domain-input').value.trim();
    if (!v) {
      flash('请输入自定义领域');
      return;
    }
    openDomain('custom:' + v);
  });
  const cdi = $('custom-domain-input');
  if (cdi) cdi.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btn-custom-domain').click();
  });

  document.querySelectorAll('.mode').forEach((b) => {
    b.addEventListener('click', () => {
      state.mode = b.dataset.mode;
      syncModeUI();
    });
  });

  const ta = $('input');
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      send();
    }
  });

  // 复制
  $('messages').addEventListener('click', (e) => {
    const c = e.target.closest('[data-copy]');
    if (!c) return;
    const md = c.closest('.bubble').querySelector('.md');
    copyText(md ? md.textContent : '');
  });
}

function syncModeUI() {
  document.querySelectorAll('.mode').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mode));
}

function setComposeDisabled(disabled) {
  const setDis = (id) => { const el = $(id); if (el) el.disabled = disabled; };
  setDis('btn-send');
  setDis('btn-next');
  setDis('input');
}

function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    flash('已复制');
  } catch (e) {
    flash('复制失败');
  }
}

/* ============================ 工具 ============================ */

function scrollBottom() {
  const host = $('messages');
  host.scrollTop = host.scrollHeight;
}

function relTime(ts) {
  if (!ts) return '';
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return '刚刚';
  if (d < 3600) return Math.floor(d / 60) + ' 分钟前';
  if (d < 86400) return Math.floor(d / 3600) + ' 小时前';
  return Math.floor(d / 86400) + ' 天前';
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ----- 轻量 Markdown 渲染（安全：先转义再格式化） ----- */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function inline(s) {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

function mdToHtml(text) {
  const raw = String(text || '');
  // 先用 ``` 切分，奇数段为代码块
  const segs = raw.split(/```/);
  let html = '';
  segs.forEach((seg, i) => {
    if (i % 2 === 1) {
      const nl = seg.indexOf('\n');
      const code = nl >= 0 ? seg.slice(nl + 1) : seg;
      html += '<pre><code>' + escapeHtml(code.replace(/\n$/, '')) + '</code></pre>';
    } else {
      html += parseLines(seg);
    }
  });
  return html;
}

function parseLines(seg) {
  const lines = seg.split('\n');
  const out = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  for (const line of lines) {
    const l = line.replace(/\s+$/, '');
    if (/^\s*[-*]\s+/.test(l)) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push('<li>' + inline(escapeHtml(l.replace(/^\s*[-*]\s+/, ''))) + '</li>');
      continue;
    }
    closeList();
    if (/^###\s+/.test(l)) {
      out.push('<h3>' + inline(escapeHtml(l.replace(/^###\s+/, ''))) + '</h3>');
    } else if (/^##\s+/.test(l)) {
      out.push('<h2>' + inline(escapeHtml(l.replace(/^##\s+/, ''))) + '</h2>');
    } else if (/^#\s+/.test(l)) {
      out.push('<h2>' + inline(escapeHtml(l.replace(/^#\s+/, ''))) + '</h2>');
    } else if (/^>\s?/.test(l)) {
      out.push('<blockquote>' + inline(escapeHtml(l.replace(/^>\s?/, ''))) + '</blockquote>');
    } else if (l.trim() === '') {
      // 空行忽略
    } else {
      out.push('<p>' + inline(escapeHtml(l)) + '</p>');
    }
  }
  closeList();
  return out.join('');
}

init().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<pre style="padding:20px;color:#d85a30">初始化失败：${e.message}\n${e.stack}</pre>`;
});
