'use strict';
/**
 * LLM 客户端：封装对 OpenAI 兼容 /v1/chat/completions 的调用。
 * 支持流式（SSE）输出与超时 / 代理 / 取消。
 */
const { config } = require('./config');
const { request } = require('./http');

/** 读取当前 LLM 配置（归一化） */
function getCfg() {
  const l = config.get('llm', {}) || {};
  const baseUrl = (l.baseUrl || 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
  return {
    enabled: !!l.enabled,
    baseUrl,
    apiKey: l.apiKey || '',
    model: l.model || 'gpt-4o-mini',
    temperature: typeof l.temperature === 'number' ? l.temperature : 0.7,
    maxTokens: l.maxTokens || 900,
    timeoutMs: l.timeoutMs || 30000,
    proxy: l.proxy || '',
    systemPrompt: l.systemPrompt || '',
  };
}

function buildHeaders(apiKey) {
  const h = { 'Content-Type': 'application/json' };
  if (apiKey) h['Authorization'] = 'Bearer ' + apiKey;
  return h;
}

/**
 * 调用 chat/completions
 * @param {object} opts
 * @param {Array<{role:string, content:string}>} opts.messages
 * @param {boolean} [opts.stream]  流式输出
 * @param {(token:string)=>void} [opts.onToken]  流式回调（每条 delta）
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ content:string, model:string, usage:object|null }>}
 */
async function chatCompletions(opts) {
  const cfg = getCfg();
  if (!cfg.baseUrl || !cfg.apiKey) {
    throw new Error('LLM 未配置：请先在「设置 → AI / 知识学习」中填写 API 地址与密钥并启用。');
  }

  const url = cfg.baseUrl + '/chat/completions';
  const payload = {
    model: cfg.model,
    messages: opts.messages,
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
    stream: !!opts.stream,
  };
  if (opts.stream) payload.stream_options = { include_usage: true };

  const deltas = []; // 用于在非流式或尾部取 usage
  let sseBuf = '';
  let streamed = '';

  const resp = await request({
    method: 'POST',
    url,
    headers: buildHeaders(cfg.apiKey),
    body: JSON.stringify(payload),
    timeoutMs: cfg.timeoutMs,
    proxy: cfg.proxy,
    signal: opts.signal,
    onData: opts.onToken
      ? (chunkBuf) => {
          sseBuf += chunkBuf.toString('utf8');
          let idx;
          while ((idx = sseBuf.indexOf('\n')) >= 0) {
            const line = sseBuf.slice(0, idx).trim();
            sseBuf = sseBuf.slice(idx + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') continue;
            let json;
            try {
              json = JSON.parse(data);
            } catch (e) {
              continue; // 跳过不完整片段
            }
            deltas.push(json);
            const choice = json.choices && json.choices[0];
            const delta =
              (choice && choice.delta && choice.delta.content) ||
              (choice && choice.message && choice.message.content) ||
              '';
            if (delta) {
              streamed += delta;
              try {
                opts.onToken(delta);
              } catch (e) {
                /* ignore */
              }
            }
          }
        }
      : null,
  });

  if (resp.status < 200 || resp.status >= 300) {
    let msg = 'HTTP ' + resp.status;
    try {
      const j = JSON.parse(resp.body || '{}');
      if (j && j.error && j.error.message) msg = j.error.message;
    } catch (e) {}
    throw new Error('LLM 接口返回错误：' + msg);
  }

  if (opts.onToken) {
    return { content: streamed, model: cfg.model, usage: extractUsage(deltas) };
  }

  let data;
  try {
    data = JSON.parse(resp.body || '{}');
  } catch (e) {
    throw new Error('LLM 响应解析失败（非 JSON）');
  }
  const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  return { content, model: data.model || cfg.model, usage: data.usage || null };
}

function extractUsage(deltas) {
  for (let i = deltas.length - 1; i >= 0; i--) {
    if (deltas[i] && deltas[i].usage) return deltas[i].usage;
  }
  return null;
}

module.exports = { chatCompletions, getCfg };
