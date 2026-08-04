'use strict';
const api = window.wfKnowledge;

const $ = (id) => document.getElementById(id);
const flash = (text) => {
  const el = $('status-line');
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

async function init() {
  bindUI();
  api.onToken(onToken);
  api.onDone(onDone);
  api.onConfigChanged(async ({ section }) => {
    if (!section || section === 'llm') await updateConnDot();
  });
  api.onOpenDomain((domain) => openDomain(domain));

  try {
    const [presets, sessions, status] = await Promise.all([api.presets(), api.listSessions(), api.status()]);
    state.presets = presets;
    state.sessions = sessions;
    state.model = status.model || '';
    renderChips();
    renderSessions();
    await updateConnDot();
  } catch (e) {
    console.error(e);
  }
}

/* ============================ 侧栏渲染 ============================ */

function renderChips() {
  const host = $('domain-chips');
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
    flash('请先在左侧选择一个领域');
    return;
  }
  const type = state.mode;
  const input = $('input').value;
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
  $('btn-minimize').addEventListener('click', () => api.win.minimize());
  $('btn-close').addEventListener('click', () => api.win.close());
  $('btn-send').addEventListener('click', send);
  $('btn-next').addEventListener('click', () => {
    state.mode = 'card';
    syncModeUI();
    send();
  });
  $('btn-clear').addEventListener('click', async () => {
    if (!state.current) return;
    if (!confirm('清空当前会话的学习记录？')) return;
    await api.reset(state.current.id);
    $('messages').innerHTML = '';
    flash('会话已清空');
    renderSessions();
  });
  $('btn-settings').addEventListener('click', () => api.win.openSettings('llm'));
  $('btn-custom-domain').addEventListener('click', () => {
    const v = $('custom-domain-input').value.trim();
    if (!v) {
      flash('请输入自定义领域');
      return;
    }
    openDomain('custom:' + v);
  });
  $('custom-domain-input').addEventListener('keydown', (e) => {
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
  $('btn-send').disabled = disabled;
  $('btn-next').disabled = disabled;
  $('input').disabled = disabled;
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
