'use strict';
/**
 * 极简 HTTP 客户端（零依赖，纯 Node 标准库）。
 * 用途：调用 OpenAI 兼容的 /v1/chat/completions 接口，支持：
 *   - http / https
 *   - 流式（SSE）响应回调 onData
 *   - 可选 HTTP 代理（CONNECT 隧道，用于访问被墙的接口）
 *   - 超时 / AbortSignal 取消
 */
const http = require('http');
const https = require('https');
const tls = require('tls');

function parseProxy(proxy) {
  if (!proxy) return null;
  try {
    const u = new URL(proxy);
    const port = parseInt(u.port, 10);
    return {
      host: u.hostname,
      port: Number.isFinite(port) ? port : (u.protocol === 'https:' ? 443 : 80),
    };
  } catch (e) {
    return null;
  }
}

function normalizeHeaders(headers) {
  const out = {};
  for (const k of Object.keys(headers || {})) out[k.toLowerCase()] = headers[k];
  return out;
}

/**
 * @param {object} opts
 * @param {string} opts.method
 * @param {string} opts.url
 * @param {object} opts.headers
 * @param {string|null} opts.body
 * @param {number} opts.timeoutMs
 * @param {string} [opts.proxy]
 * @param {(chunk: Buffer) => void} [opts.onData]  流式回调（每个 body chunk）
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ status:number, headers:object, body:string|null }>}
 */
function request(opts) {
  const { method = 'POST', url, body = null, timeoutMs = 30000, proxy = null, onData = null, signal = null } = opts;

  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch (e) {
      return reject(new Error('非法 URL: ' + url));
    }
    const isHttps = target.protocol === 'https:';
    const lib = isHttps ? https : http;
    const proxyCfg = parseProxy(proxy);

    const headers = normalizeHeaders(opts.headers || {});
    if (body != null) headers['content-length'] = Buffer.byteLength(body);
    if (!headers['host']) headers['host'] = target.host;
    headers['connection'] = 'close';
    headers['accept'] = headers['accept'] || 'application/json';
    headers['user-agent'] = headers['user-agent'] || 'WordsFish/1.0';

    const path = target.pathname + target.search;
    const baseOpts = { method, path, headers, timeout: timeoutMs };

    let reqRef = null;
    let tlsSocketRef = null; // CONNECT 隧道阶段 reqRef 尚未创建，abort 时需直接销毁 TLS socket
    let settled = false;
    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      if (signal) safeRemove(signal, onAbort);
      fn(val);
    };

    function handleResponse(res) {
      const status = res.statusCode;
      const respHeaders = res.headers;
      if (onData) {
        const acc = [];
        res.on('data', (chunk) => {
          try {
            onData(chunk);
          } catch (e) {
            /* ignore */
          }
          // 同时累积原始 body：流式请求若返回 4xx/5xx，真实错误体由此解析（见 llm.js）。
          acc.push(chunk);
        });
        res.on('end', () => finish(resolve, { status, headers: respHeaders, body: Buffer.concat(acc).toString('utf8') }));
        res.on('error', (e) => finish(reject, e));
      } else {
        const acc = [];
        res.on('data', (c) => acc.push(c));
        res.on('end', () => finish(resolve, { status, headers: respHeaders, body: Buffer.concat(acc).toString('utf8') }));
        res.on('error', (e) => finish(reject, e));
      }
    }

    function onAbort() {
      if (reqRef && !reqRef.destroyed) reqRef.destroy(new Error('已取消'));
      if (tlsSocketRef && !tlsSocketRef.destroyed) tlsSocketRef.destroy();
    }
    if (signal) {
      if (signal.aborted) return reject(new Error('已取消'));
      signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      if (proxyCfg && isHttps) {
        // 1) 向代理发起 CONNECT，建立到目标主机的 TCP 隧道
        const conn = http.request({
          host: proxyCfg.host,
          port: proxyCfg.port,
          method: 'CONNECT',
          path: `${target.hostname}:${target.port || 443}`,
          timeout: timeoutMs,
        });
        conn.on('connect', (cres, socket) => {
          if (cres.statusCode !== 200) {
            try { socket.destroy(); } catch (e) {}
            return finish(reject, new Error('代理 CONNECT 失败：HTTP ' + cres.statusCode));
          }
          // 2) 在隧道之上做 TLS
          const tlsSocket = tls.connect({ socket, servername: target.hostname }, () => {
            reqRef = lib.request(
              { ...baseOpts, createConnection: () => tlsSocket, timeout: timeoutMs },
              handleResponse
            );
            attachTimeout(reqRef);
            reqRef.on('error', (e) => finish(reject, e));
            reqRef.end(body);
          });
          tlsSocketRef = tlsSocket;
          tlsSocket.on('error', (e) => finish(reject, e));
        });
        // 代理“接住 TCP 但不回 CONNECT 响应”时，conn 既不 emit error 也不进 connect，
        // 必须有超时来兜底，否则 Promise 永不 settle、socket 与闭包泄漏、LLM 请求卡死。
        conn.on('timeout', () => {
          try { conn.destroy(new Error('代理 CONNECT 超时')); } catch (e) {}
        });
        conn.on('error', (e) => finish(reject, e));
        conn.end();
      } else if (proxyCfg && !isHttps) {
        // http over 代理：直接把绝对 URL 作为请求路径发给代理
        reqRef = lib.request(
          { ...baseOpts, host: proxyCfg.host, port: proxyCfg.port, path: url, timeout: timeoutMs },
          handleResponse
        );
        reqRef.on('error', (e) => finish(reject, e));
        attachTimeout(reqRef);
        reqRef.end(body);
      } else {
        reqRef = lib.request(
          { ...baseOpts, host: target.hostname, port: target.port || (isHttps ? 443 : 80), timeout: timeoutMs },
          handleResponse
        );
        reqRef.on('error', (e) => finish(reject, e));
        attachTimeout(reqRef);
        reqRef.end(body);
      }
    } catch (e) {
      finish(reject, e);
    }

    function attachTimeout(req) {
      req.on('timeout', () => {
        if (req.destroyed) return;
        req.destroy(new Error('LLM 请求超时'));
      });
    }
    function safeRemove(sig, fn) {
      try { sig.removeEventListener('abort', fn); } catch (e) {}
    }
  });
}

module.exports = { request, parseProxy };
