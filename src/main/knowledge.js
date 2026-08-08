'use strict';
/**
 * 知识学习模块：管理「领域 → 学习会话 → 对话历史」，
 * 通过 LLM（OpenAI 兼容接口）动态生成 / 讲解领域知识。
 *
 * 会话历史持久化在 userData/knowledge.json，重启不丢。
 */
const fs = require('fs');
const paths = require('./paths');
const llm = require('./llm');

// 历史窗口上限，防止 token 成本线性膨胀并最终撑爆模型上下文窗口
const MAX_CONTEXT_MESSAGES = 20; // 发给 LLM 的历史轮次上限
const MAX_PERSIST_MESSAGES = 60; // 持久化历史上限，超出滚动丢弃
const MAX_SESSIONS = 50; // 会话数量上限，超出删除最旧者，避免 knowledge.json 无限增长

/* ----------------------------- 领域预设 ----------------------------- */

const PRESETS = [
  {
    id: 'stock',
    name: '股票投资',
    desc: '基础概念、交易机制、指标与技术分析、风险管理',
    system:
      '你是一位耐心的中文股票投资科普助教，面向零基础到入门的学习者。' +
      '讲解时先用一句大白话定义概念，再补充为什么重要、常见误区与一句实战提示。' +
      '涉及具体标的时只做知识讲解，不做买卖建议，并提示「投资有风险」。',
    cardHint:
      '请给我一张关于「股票投资」的今日知识卡片，使用 Markdown 排版：\n' +
      '## 概念\n（一个名词 + 一句话大白话定义）\n## 释义\n（为什么重要、常见误区，1-2 句）\n' +
      '## 例子\n（贴近 A 股实际的一个例子）\n## 要点\n（一句话记忆 / 风险提示）\n' +
      '聚焦一个具体、常用的知识点，全文不超过 180 字。',
    quizHint:
      '请出一道关于「股票投资」的测验题：一道单选题（4 个选项，用 A/B/C/D 标注），' +
      '并附「答案：X」和简短解析。题干贴近 A 股实际应用场景，避免诱导具体操作。',
  },
  {
    id: 'finance',
    name: '金融与经济',
    desc: '宏观指标、利率、汇率、通胀、公司财务',
    system:
      '你是一位中文金融与经济学科普助教。用生活化类比解释宏观指标、利率、汇率、通胀、' +
      '公司财务等概念，强调概念之间的因果联系。保持客观，不做预测。',
    cardHint:
      '请给我一张关于「金融与经济」的知识卡片，使用 Markdown 排版：\n' +
      '## 概念\n## 释义\n## 例子\n## 要点\n聚焦一个具体常用概念，全文不超过 180 字。',
    quizHint:
      '请出一道关于「金融与经济」的单选题（4 选项，A/B/C/D），附「答案：X」与解析。',
  },
  {
    id: 'programming',
    name: '编程开发',
    desc: '算法、数据结构、语言特性、工程实践',
    system:
      '你是一位中文编程开发助教。讲解概念时尽量给出可运行的小例子或伪代码，' +
      '点明适用场景与常见坑。语言中立、偏工程实践。',
    cardHint:
      '请给我一张关于「编程开发」的知识卡片，使用 Markdown 排版：\n' +
      '## 概念\n## 释义\n## 例子\n（一小段伪代码或示例）\n## 要点\n不超过 180 字。',
    quizHint:
      '请出一道关于「编程开发」的单选题（4 选项，A/B/C/D），附「答案：X」与解析，可含代码片段。',
  },
  {
    id: 'history',
    name: '历史人文',
    desc: '中外历史、制度、人物与事件脉络',
    system: '你是一位中文历史人文科普助教。讲故事式讲解，厘清时间线与因果，区分事实与观点。',
    cardHint:
      '请给我一张关于「历史人文」的知识卡片，使用 Markdown 排版：\n' +
      '## 概念 / 事件\n## 释义\n## 例子\n（一个具体史实）\n## 要点\n不超过 180 字。',
    quizHint: '请出一道关于「历史人文」的单选题（4 选项，A/B/C/D），附「答案：X」与解析。',
  },
  {
    id: 'medicine',
    name: '医学健康',
    desc: '常见疾病、营养、用药与安全常识',
    system:
      '你是一位中文医学健康科普助教。只做通识科普，强调「不能替代医生诊断」，' +
      '涉及用药时提示遵医嘱。语言温和、严谨。',
    cardHint:
      '请给我一张关于「医学健康」的知识卡片，使用 Markdown 排版：\n' +
      '## 概念\n## 释义\n## 例子\n## 要点\n（含安全提示）不超过 180 字。',
    quizHint: '请出一道关于「医学健康」的单选题（4 选项，A/B/C/D），附「答案：X」与解析，并提示科普性质。',
  },
  {
    id: 'science',
    name: '科学科普',
    desc: '物理、化学、生物、天文与前沿科技',
    system: '你是一位中文科学科普助教。用类比把抽象原理讲明白，区分确定知识与前沿假说。',
    cardHint:
      '请给我一张关于「科学科普」的知识卡片，使用 Markdown 排版：\n' +
      '## 概念\n## 释义\n## 例子\n## 要点\n不超过 180 字。',
    quizHint: '请出一道关于「科学科普」的单选题（4 选项，A/B/C/D），附「答案：X」与解析。',
  },
  {
    id: 'law',
    name: '法律常识',
    desc: '民法、合同、劳动、知识产权基础',
    system:
      '你是一位中文法律常识科普助教。只做通识讲解，强调「以正式法律法规与专业意见为准」,' +
      '不提供法律意见。',
    cardHint:
      '请给我一张关于「法律常识」的知识卡片，使用 Markdown 排版：\n' +
      '## 概念\n## 释义\n## 例子\n## 要点\n（含免责提示）不超过 180 字。',
    quizHint: '请出一道关于「法律常识」的单选题（4 选项，A/B/C/D），附「答案：X」与解析。',
  },
  {
    id: 'custom',
    name: '自定义领域',
    desc: '输入你关心的任意领域（如：围棋、咖啡、心理学…）',
    system:
      '你是一位善于把任意领域知识讲得通俗易懂的中文助教。根据用户指定的领域调整讲解风格，' +
      '聚焦具体知识点，多用例子。',
    cardHint:
      '请给我一张关于用户指定领域的知识卡片，使用 Markdown 排版：\n' +
      '## 概念\n## 释义\n## 例子\n## 要点\n聚焦一个具体常用知识点，全文不超过 180 字。',
    quizHint: '请出一道关于用户指定领域的单选题（4 选项，A/B/C/D），附「答案：X」与解析。',
  },
];

/* ----------------------------- 会话管理 ----------------------------- */

class Knowledge {
  constructor() {
    this.sessions = new Map();
    this._timer = null;
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(paths.knowledgeFile)) {
        const raw = JSON.parse(fs.readFileSync(paths.knowledgeFile, 'utf8'));
        for (const s of raw.sessions || []) {
          if (s && s.id && s.domain) this.sessions.set(s.id, s);
        }
      }
    } catch (e) {
      console.error('[knowledge] 读取失败，忽略:', e.message);
    }
  }

  saveDebounced() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.saveNow(), 400);
  }

  saveNow() {
    try {
      this._pruneSessions();
      paths.ensureDir(paths.userData);
      const arr = [...this.sessions.values()].map((s) => ({
        id: s.id,
        domain: s.domain,
        history: s.history,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      }));
      fs.writeFileSync(paths.knowledgeFile, JSON.stringify({ sessions: arr }, null, 2), 'utf8');
    } catch (e) {
      console.error('[knowledge] 保存失败:', e.message);
    }
  }

  listPresets() {
    return PRESETS.map((p) => ({ id: p.id, name: p.name, desc: p.desc }));
  }

  _preset(domain) {
    const base = PRESETS.find((p) => p.id === domain) || PRESETS.find((p) => p.id === 'custom');
    if (domain && typeof domain === 'string' && domain.startsWith('custom:')) {
      const name = domain.slice('custom:'.length) || '自定义领域';
      const sub = (s) => String(s).replace(/用户指定领域/g, name).replace(/用户指定/g, name);
      return {
        name,
        system: sub(base.system),
        cardHint: sub(base.cardHint),
        quizHint: sub(base.quizHint),
      };
    }
    return base;
  }

  _newId() {
    return 'k_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /** 打开（或复用）某领域的会话 */
  getOrCreate(domain) {
    let found = null;
    for (const s of this.sessions.values()) {
      if (s.domain === domain) {
        if (!found || s.updatedAt > found.updatedAt) found = s;
      }
    }
    if (found) return found;
    const s = { id: this._newId(), domain, history: [], createdAt: Date.now(), updatedAt: Date.now() };
    this.sessions.set(s.id, s);
    this._pruneSessions();
    this.saveDebounced();
    return s;
  }

  listSessions() {
    return [...this.sessions.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((s) => ({
        id: s.id,
        domain: s.domain,
        domainName: this._preset(s.domain).name,
        messages: s.history.length,
        updatedAt: s.updatedAt,
      }));
  }

  history(sessionId) {
    const s = this.sessions.get(sessionId);
    return s ? s.history.slice() : [];
  }

  /** 构造发给 LLM 的 messages，并返回要写入历史的 user 内容 */
  buildMessages(session, type, input) {
    const p = this._preset(session.domain);
    const messages = [{ role: 'system', content: p.system }];
    // 仅取最近 MAX_CONTEXT_MESSAGES 条历史作为上下文，避免长对话 token 爆炸 / 超窗
    const ctx = session.history.slice(-MAX_CONTEXT_MESSAGES);
    for (const m of ctx) messages.push({ role: m.role, content: m.content });

    let userContent;
    if (type === 'card') {
      userContent = p.cardHint + (input ? `\n（请聚焦这个方向：${input}）` : '');
    } else if (type === 'quiz') {
      userContent = p.quizHint + (input ? `\n（请围绕这个方向出题：${input}）` : '');
    } else {
      userContent = input && input.trim() ? input.trim() : '（请接着上一个知识点继续展开讲讲）';
    }
    messages.push({ role: 'user', content: userContent });
    return { messages, userContent };
  }

  /**
   * 发起一次学习请求（流式）
   * @param {string} sessionId
   * @param {'card'|'ask'|'quiz'} type
   * @param {string} input
   * @param {{onToken?:function, onDone?:function, signal?:AbortSignal}} [hooks]
   */
  async ask(sessionId, type, input, hooks = {}) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('知识会话不存在，请重新打开领域');
    const { messages, userContent } = this.buildMessages(session, type, input);

    let result;
    try {
      result = await llm.chatCompletions({
        messages,
        stream: true,
        onToken: hooks.onToken,
        signal: hooks.signal,
      });
    } catch (e) {
      // LLM 失败：不要把用户提问写入持久化历史，否则下次打开会话会看到一条“无回复”的提问。
      // 渲染端（knowledge 页 send()）已对异常做了兜底展示，这里直接上抛即可。
      throw e;
    }

    // 仅当 LLM 成功返回时才落盘历史，保证 (user, assistant) 成对、不留悬空消息。
    session.history.push({ role: 'user', content: userContent });
    session.history.push({ role: 'assistant', content: result.content });
    // 持久化历史上限裁剪（与发给 LLM 的窗口解耦）
    if (session.history.length > MAX_PERSIST_MESSAGES) {
      session.history = session.history.slice(-MAX_PERSIST_MESSAGES);
    }
    session.updatedAt = Date.now();
    this.saveDebounced();

    if (hooks.onDone) {
      try {
        hooks.onDone();
      } catch (e) {}
    }
    return { content: result.content, model: result.model, usage: result.usage };
  }

  reset(sessionId) {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    s.history = [];
    s.updatedAt = Date.now();
    this.saveDebounced();
    return true;
  }

  delete(sessionId) {
    if (!this.sessions.has(sessionId)) return false;
    this.sessions.delete(sessionId);
    this.saveDebounced();
    return true;
  }

  /** 会话数量上限裁剪：保留最近更新的 MAX_SESSIONS 个，丢弃最旧的 */
  _pruneSessions() {
    if (this.sessions.size <= MAX_SESSIONS) return;
    const sorted = [...this.sessions.values()].sort((a, b) => a.updatedAt - b.updatedAt);
    const excess = this.sessions.size - MAX_SESSIONS;
    for (let i = 0; i < excess; i++) this.sessions.delete(sorted[i].id);
  }

  status() {
    const c = llm.getCfg();
    return {
      configured: c.enabled && !!c.apiKey && !!c.baseUrl,
      enabled: c.enabled,
      model: c.model,
      baseUrl: c.baseUrl,
    };
  }

  async testConnection() {
    const c = llm.getCfg();
    if (!c.enabled || !c.apiKey || !c.baseUrl) {
      return { ok: false, error: '未配置：请先在「设置 → AI / 知识学习」填写地址与密钥并启用。' };
    }
    const t0 = Date.now();
    try {
      const r = await llm.chatCompletions({
        messages: [{ role: 'user', content: '请用一句话回复：pong' }],
        stream: false,
      });
      return {
        ok: true,
        model: r.model,
        latencyMs: Date.now() - t0,
        sample: (r.content || '').slice(0, 48),
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
}

module.exports = { knowledge: new Knowledge(), PRESETS };
