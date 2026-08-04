'use strict';
/**
 * 无头集成验证（headless smoke test）
 *  - 用桩件拦截 require('electron')，跑通 main.js 的完整初始化链路
 *  - 捕获所有 ipcMain.handle 处理器，模拟渲染层调用，验证无异常、返回结构正确
 *  - 不依赖 GUI / 不启动真实 Electron
 */
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const HERE = __dirname;
const os = require('os');
const TMP = path.join(os.tmpdir(), 'wf-verify-' + Date.now());
require('fs').mkdirSync(TMP, { recursive: true });

/* ----------------------------- electron 桩 ----------------------------- */

class FakeBrowserWindow {
  constructor(opts = {}) {
    this._w = opts.width || 380;
    this._h = opts.height || 240;
    this._visible = false;
    this.webContents = { send() {} };
  }
  isDestroyed() { return false; }
  setAlwaysOnTop() {}
  setVisibleOnAllWorkspaces() {}
  loadFile() {}
  on() {}
  once() {}
  getPosition() { return [0, 0]; }
  getSize() { return [this._w, this._h]; }
  setPosition() {}
  setOpacity() {}
  showInactive() { this._visible = true; }
  show() { this._visible = true; }
  hide() { this._visible = false; }
  isVisible() { return this._visible; }
  setSize(w, h) { this._w = w; this._h = h; }
  isMinimized() { return false; }
  restore() {}
  focus() {}
  minimize() {}
  close() {}
}

const ipcHandlers = {};
const appEvents = {};

const electronStub = {
  app: {
    requestSingleInstanceLock: () => true,
    quit() {},
    exit() {},
    setAppUserModelId() {},
    setName() {},
    whenReady: () => Promise.resolve(),
    getPath: () => TMP,
    getAppPath: () => ROOT,
    getVersion: () => '0.1.0-verify',
    getLoginItemSettings: () => ({ openAtLogin: false }),
    setLoginItemSettings() {},
    isReady: () => true,
    getName: () => 'WordsFish',
    on(ev, cb) { appEvents[ev] = cb; },
  },
  BrowserWindow: FakeBrowserWindow,
  Tray: class { constructor() {} setToolTip() {} setContextMenu() {} setImage() {} on() {} },
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu() {} },
  nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
  globalShortcut: {
    register: () => true,
    unregister() {},
    isRegistered: () => false,
  },
  Notification: class { constructor() {} on() {} show() {} },
  ipcMain: {
    handle(channel, fn) { ipcHandlers[channel] = fn; },
    on(channel, fn) { ipcHandlers['#on:' + channel] = fn; },
  },
  dialog: {
    showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
    showMessageBox: () => Promise.resolve({ response: 0 }),
  },
  shell: { openPath: () => '' },
  clipboard: { writeText() {} },
  screen: {
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
  },
};

// 拦截 require('electron')
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronStub;
  return origLoad.apply(this, arguments);
};

/* ----------------------------- 断言工具 ----------------------------- */
let pass = 0, fail = 0;
const fails = [];
const report = [];
function logLine(s) { report.push(s); console.log(s); }
function ok(cond, msg) { if (cond) { pass++; logLine('  OK ' + msg); } else { fail++; fails.push(msg); logLine('  FAIL ' + msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} (got ${JSON.stringify(a)})`); }

/* ----------------------------- 跑初始化 ----------------------------- */
let initError = null;
process.on('unhandledRejection', (e) => { initError = e; });

logLine('\n=== A) 加载 main.js 并跑通初始化链路 ===');
let mainLoaded = true;
try {
  require(path.join(ROOT, 'src/main/main.js'));
} catch (e) {
  mainLoaded = false;
  initError = e;
}
// 等待 whenReady().then(...) 的微任务完成
setImmediate(async () => {
  await new Promise((r) => setTimeout(r, 50));
  try {
    if (initError) {
      logLine('  FAIL 初始化抛出异常: ' + (initError && initError.stack || initError));
      finish(1);
      return;
    }
    ok(mainLoaded, 'main.js 模块加载无异常');
    const reg = Object.keys(ipcHandlers).filter((k) => !k.startsWith('#on:'));
    ok(reg.length >= 30, `IPC 处理器已注册 (${reg.length} 个)`);

    // 通过同一 require 缓存取出单例，便于断言
    const { config } = require(path.join(ROOT, 'src/main/config'));
    const wordflow = require(path.join(ROOT, 'src/main/wordflow'));
    const { records } = require(path.join(ROOT, 'src/main/records'));
    const dict = require(path.join(ROOT, 'src/main/dict'));

    const H = (ch) => ipcHandlers[ch];
    const ev = () => ({ sender: { getOwnerBrowserWindow: () => new FakeBrowserWindow({}) } });
    // IPC 处理器签名为 (event, ...args)，统一用 call() 传入事件对象
    const call = (ch, ...args) => H(ch)(ev(), ...args);

    logLine('\n=== B) 配置 / 词库 IPC ===');
    const all = await call('config:get');
    ok(all && all.push && all.push.channel === 'bubble', 'config:get 返回完整默认配置');
    const constants = await call('config:constants');
    ok(constants && Array.isArray(constants.GESTURE_EVENTS) && constants.GESTURE_EVENTS.length >= 7, 'config:constants 含手势事件定义');
    const books = await call('dict:list');
    ok(Array.isArray(books) && books.length === 4, `dict:list 返回 4 本词库 (got ${books && books.length})`);
    const loaded = await call('dict:load', 'cet4');
    ok(loaded && loaded.id === 'cet4' && loaded.count > 1000, `dict:load cet4 词数 ${loaded && loaded.count}`);

    logLine('\n=== C) 单词流转（取词 / 评分 / 标记生词）===');
    const first = await call('study:word', 'next');
    ok(first && first.word && first.word.w, `study:word next 返回单词: ${first && first.word && first.word.w}`);
    ok(first.book && first.book.name && first.progress, 'payload 含 book / progress 结构');
    const rated = await call('study:rate', 1.0);
    ok(rated && rated.word, 'study:rate 返回 payload');
    const afterRate = records.get('cet4', first.word.w);
    ok(afterRate && afterRate.k >= 1, '评分后记录 k>=1');
    const marked = await call('study:markUnknown');
    const recM = records.get('cet4', first.word.w);
    ok(recM && recM.m === true, 'study:markUnknown 标记为生词 (m=true)');
    const stats = await call('study:stats');
    ok(stats && stats.book && stats.progress, 'study:stats 返回快照');

    logLine('\n=== D) 手势分发（动作映射）===');
    const g1 = await call('gesture:fire', 'dblclick');
    ok(g1 && g1.handled && g1.action === 'close', `dblclick → close (got ${JSON.stringify(g1)})`);
    const g2 = await call('gesture:fire', 'rightclick');
    ok(g2 && g2.handled && g2.action === 'markUnknown', `rightclick → markUnknown`);
    const gNone = await call('gesture:fire', 'click');
    ok(gNone && gNone.handled === false, 'click → 未映射 (handled=false)');

    logLine('\n=== E) 通知 / 推送 / 窗口 ===');
    const pushed = await call('notify:push', 'manual');
    ok(pushed && pushed.word, 'notify:push 返回 payload（bubble 通道）');
    const status = await call('notify:status');
    ok(status && typeof status.paused === 'boolean', 'notify:status 返回状态对象');
    const toggled = await call('win:togglePopup');
    ok(typeof toggled === 'boolean', `win:togglePopup 返回 ${toggled}`);
    const opened = await call('win:openSettings');
    ok(opened && typeof opened === 'object', 'win:openSettings 创建设置窗口无异常');
    const ver = await call('app:version');
    ok(typeof ver === 'string' && ver.length > 0, `app:version = ${ver}`);

    logLine('\n=== F) 配置变更热更新 ===');
    const upd = await call('config:update', { push: { intervalMin: 20 } });
    ok(upd && upd.push.intervalMin === 20, 'config:update 生效 (intervalMin=20)');
    const reset = await call('config:reset', 'push');
    ok(reset && reset.push.intervalMin === 15, 'config:reset push 回到默认 15');

    logLine('\n=== G) 配置/记录持久化（paths 修复回归）===');
    config.saveNow();
    records.flush();
    const fs2 = require('fs');
    ok(fs2.existsSync(path.join(TMP, 'config.json')), 'config.json 已写入磁盘');
    ok(fs2.existsSync(path.join(TMP, 'records.json')), 'records.json 已写入磁盘');

    logLine('\n=== H) 知识学习模块（LLM）IPC ===');
    const llmCfg = await call('config:get');
    ok(llmCfg && llmCfg.llm && typeof llmCfg.llm.enabled === 'boolean', 'config 含 llm 段（enabled 字段）');
    ok(Array.isArray(constants.HOTKEY_ITEMS) && constants.HOTKEY_ITEMS.some((h) => h.key === 'openKnowledge'), 'config:constants 含 openKnowledge 快捷键');
    const presets = await call('knowledge:presets');
    ok(Array.isArray(presets) && presets.length >= 7, `knowledge:presets 返回 ${presets.length} 个领域`);
    const kstatus = await call('knowledge:status');
    ok(kstatus && kstatus.configured === false, 'knowledge:status 未配置时为 false');
    const kopen = await call('knowledge:open', 'stock');
    ok(kopen && kopen.session && kopen.session.domain === 'stock', 'knowledge:open 创建 stock 会话');
    ok(Array.isArray(kopen.history) && kopen.history.length === 0, '新会话历史为空');
    const klist = await call('knowledge:listSessions');
    ok(Array.isArray(klist) && klist.length >= 1, 'knowledge:listSessions 至少 1 条');
    let askErr = null;
    try {
      await call('knowledge:ask', kopen.session.id, 'card', '');
    } catch (e) {
      askErr = e;
    }
    ok(askErr && /未配置|LLM/.test(askErr.message), '未配置时 knowledge:ask 抛出清晰错误（不崩溃）');
    const kreset = await call('knowledge:reset', kopen.session.id);
    ok(kreset === true, 'knowledge:reset 返回 true');

    logLine(`\n=== 总结 ===\n通过 ${pass} / 失败 ${fail}`);
    finish(fail > 0 ? 1 : 0);
  } catch (e) {
    logLine('  FAIL 验证过程抛出异常: ' + (e && e.stack || e));
    finish(1);
  }
});

function finish(code) {
  if (fails.length) logLine('失败项: ' + fails.join(' | '));
  try {
    require('fs').writeFileSync(path.join(HERE, 'verify-report.txt'), report.join('\n'), 'utf8');
  } catch (e) {}
  // 杀掉可能残留的定时器（tray 15s 刷新 / scheduler）
  process.exit(code);
}
