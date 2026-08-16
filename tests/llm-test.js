'use strict';
/**
 * LLM + 知识学习 集成测试（纯 Node，起一个 mock OpenAI 服务器）。
 * 覆盖：流式 SSE 拼接、非流式、错误码、连接测试、知识会话历史持久化、自定义领域解析。
 */
const http = require('http');
const path = require('path');
const { config } = require(path.join(__dirname, '..', 'src', 'main', 'config'));
const { knowledge } = require(path.join(__dirname, '..', 'src', 'main', 'knowledge'));
const llm = require(path.join(__dirname, '..', 'src', 'main', 'llm'));

let pass = 0;
let fail = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) {
    pass++;
    console.log('  OK', msg);
  } else {
    fail++;
    fails.push(msg);
    console.log('  FAIL', msg);
  }
}
function eq(a, b, msg) {
  ok(a === b, `${msg} (got ${JSON.stringify(a)})`);
}

const FULL = '股票是一种**证券**，代表对公司的一部分所有权。\n\n- 可交易\n- 有风险';
const TOKENS = ['股票是', '一种**证券**', '，代表对公司的一部分', '所有权。\n\n- 可交易\n- 有风险'];

// 本测试直接改 config 单例的 llm 段：先快照，结束后（含异常路径）还原，
// 避免测试把真实用户配置的 LLM 留在「已启用 / 空 key」等中间状态
const LLM_SNAPSHOT = JSON.parse(JSON.stringify(config.get('llm') || {}));
function restoreLlm() {
  try {
    config.update({ llm: LLM_SNAPSHOT });
    // 马上要 process.exit，等不到 300ms 防抖落盘，这里立即写回
    config.saveNow();
  } catch (e) { /* 还原失败不掩盖测试结果 */ }
}

function startMock() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (req.url === '/v1/chat/completions' && req.method === 'POST') {
          if ((req.headers['authorization'] || '').includes('bad')) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Incorrect API key' } }));
            return;
          }
          let parsed = {};
          try {
            parsed = JSON.parse(body);
          } catch (e) {}
          if (parsed.stream) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
            for (const t of TOKENS) {
              res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
            }
            res.write(`data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 5, completion_tokens: 12, total_tokens: 17 } })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ model: parsed.model, choices: [{ message: { content: 'pong' } }], usage: { total_tokens: 3 } }));
          }
        } else if (req.url === '/v1/error' && req.method === 'POST') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Incorrect API key' } }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const server = await startMock();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  console.log('\n=== A) 非流式 chat/completions ===');
  config.update({
    llm: { enabled: true, baseUrl: base + '/v1', apiKey: 'sk-test', model: 'mock-model', temperature: 0.7, maxTokens: 900, timeoutMs: 10000, proxy: '' },
  });
  const r1 = await llm.chatCompletions({ messages: [{ role: 'user', content: 'ping' }], stream: false });
  eq(r1.content, 'pong', '非流式返回 content=pong');
  eq(r1.model, 'mock-model', '非流式返回 model');

  console.log('\n=== B) 流式 SSE 拼接 ===');
  let tokenCount = 0;
  let streamed = '';
  const r2 = await llm.chatCompletions({
    messages: [{ role: 'user', content: 'hi' }],
    stream: true,
    onToken: (t) => {
      tokenCount++;
      streamed += t;
    },
  });
  eq(streamed, FULL, '流式拼接结果 == 完整文本');
  eq(r2.content, FULL, '流式返回 content == 完整文本');
  ok(tokenCount === TOKENS.length, `流式回调次数=${tokenCount} (期望 ${TOKENS.length})`);
  ok(r2.usage && r2.usage.total_tokens === 17, '流式尾部 usage 解析');

  console.log('\n=== C) 错误码透传 ===');
  config.update({ llm: { apiKey: 'bad' } });
  let threw = false;
  try {
    await llm.chatCompletions({ messages: [{ role: 'user', content: 'x' }], stream: false });
  } catch (e) {
    threw = /Incorrect API key/.test(e.message);
  }
  ok(threw, '401 错误被抛出并携带服务端消息');

  console.log('\n=== D) 知识会话：卡片 + 历史 ===');
  config.update({ llm: { baseUrl: base + '/v1', apiKey: 'sk-test', model: 'mock-model' } });
  const s = knowledge.getOrCreate('stock');
  eq(s.domain, 'stock', 'getOrCreate 返回 stock 会话');
  const ask = await knowledge.ask(s.id, 'card', '', { onToken: () => {} });
  eq(ask.content, FULL, 'knowledge.ask 卡片内容完整');
  eq(ask.model, 'mock-model', 'knowledge.ask 返回 model');
  const hist = knowledge.history(s.id);
  eq(hist.length, 2, '会话历史含 user+assistant 两条');
  eq(hist[0].role, 'user', '历史首条为 user');
  eq(hist[1].role, 'assistant', '历史次条为 assistant');

  console.log('\n=== E) 追问（ask 模式）+ 历史累积 ===');
  const ask2 = await knowledge.ask(s.id, 'ask', '均线是什么？', { onToken: () => {} });
  eq(ask2.content, FULL, 'ask 模式同样返回内容');
  eq(knowledge.history(s.id).length, 4, '历史累积到 4 条');

  console.log('\n=== F) 自定义领域解析 ===');
  const cs = knowledge.getOrCreate('custom:围棋');
  eq(cs.domain, 'custom:围棋', '自定义领域会话 domain 正确');
  const pm = knowledge._preset('custom:围棋');
  ok(pm.name === '围棋', '自定义预设 name 解析为「围棋」');
  ok(/围棋/.test(pm.cardHint), '自定义预设 cardHint 注入领域名「围棋」');
  const askc = await knowledge.ask(cs.id, 'card', '', { onToken: () => {} });
  ok(askc.content.length > 0, '自定义领域也能正常生成');

  console.log('\n=== G) 连接测试 ===');
  const t1 = await knowledge.testConnection();
  ok(t1.ok === true, 'testConnection 成功');
  ok(typeof t1.latencyMs === 'number', 'testConnection 返回延迟');
  config.update({ llm: { enabled: false } });
  const t2 = await knowledge.testConnection();
  ok(t2.ok === false, '未启用时 testConnection 返回 ok:false');

  console.log('\n=== H) 未配置时抛错 ===');
  config.update({ llm: { enabled: true, apiKey: '', baseUrl: '' } });
  let threw2 = false;
  try {
    await llm.chatCompletions({ messages: [{ role: 'user', content: 'x' }], stream: false });
  } catch (e) {
    threw2 = /未配置/.test(e.message);
  }
  ok(threw2, 'baseUrl/apiKey 缺失时抛出「未配置」');

  console.log(`\n=== 总结 ===\n通过 ${pass} / 失败 ${fail}`);
  if (fails.length) console.log('失败项: ' + fails.join(' | '));
  server.close();
  return fail > 0 ? 1 : 0;
}

main()
  .then((code) => {
    restoreLlm();
    process.exit(code);
  })
  .catch((e) => {
    console.error(e);
    restoreLlm();
    process.exit(1);
  });
