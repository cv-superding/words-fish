'use strict';
/**
 * 离线截图脚本（仅供 README 截图更新用）：
 *   用 dev electron 跑本脚本，按 --capture=popup|settings 创建对应窗口、
 *   注入 mock 数据、调 webContents.capturePage() 输出 PNG 后退出。
 *   （托盘气泡 2026-08-15 已从 README 移除，故脚本不再支持 bubble 目标）
 *
 * 不打包、不进 asar、不污染生产代码。生产代码（src/main/main.js、windows.js）完全不动。
 *
 * 用法：
 *   ./node_modules/.bin/electron scripts/capture.js --capture=popup   --out=assets/screenshots/popup.png
 *   ./node_modules/.bin/electron scripts/capture.js --capture=settings --out=assets/screenshots/settings.png
 *
 * 必须在项目根目录执行（D:\360Downloads\Software\words-fish）。
 *
 * ⚠️ 此沙箱环境下设置了 ELECTRON_RUN_AS_NODE=1、NODE_OPTIONS=--use-system-ca，
 *    导致 electron.exe 默认以 Node 模式运行（app 是 undefined、process.type 是 undefined）。
 *    启动检测到这种情况时，会自动重派自身（带正确的环境变量）以真正进入 main 进程。
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

// === 自我重派：确保在 main 进程模式里运行 ===
// 条件：app 不存在（说明 Electron 处于 node 模式）
if (typeof app === 'undefined' || typeof app.whenReady !== 'function') {
  console.error('[capture] Electron running in node mode, re-spawning in main mode…');
  const electronExe = path.join(__dirname, '..', 'node_modules', 'electron', 'dist',
    process.platform === 'win32' ? 'electron.exe' : 'electron');
  const env = Object.assign({}, process.env);
  delete env.NODE_OPTIONS;
  delete env.ELECTRON_RUN_AS_NODE;
  env.ELECTRON_NO_ATTACH_CONSOLE = '1';
  const args = ['--disable-gpu', '--no-sandbox', __filename, ...process.argv.slice(2)];
  const r = spawnSync(electronExe, args, { stdio: 'inherit', env });
  process.exit(r.status || 0);
}

// 关掉 GPU 加速（沙箱环境下 GPU 进程频繁崩，多次看到 FATAL gpu_data_manager_impl_private）
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');

function getArg(prefix) {
  const a = process.argv.find((x) => x.startsWith(prefix));
  return a ? a.slice(prefix.length) : null;
}

const target = getArg('--capture='); // 'popup' | 'settings'  (bubble 已被用户从 README 移除)
const outPath = path.resolve(getArg('--out=') || path.join(ROOT, 'assets', 'screenshots', `${target || 'capture'}.png`));

if (!['popup', 'settings'].includes(target)) {
  console.error('Usage: electron scripts/capture.js --capture=<popup|settings> --out=<png path>');
  process.exit(1);
}

/* =========================== Mock 数据 =========================== */
// popup 截图中注入的单词 payload
function mockWord() {
  return {
    w: 'serendipity',
    us: '/ˌserənˈdɪpəti/',
    uk: '/ˌserənˈdɪpəti/',
    t: [
      { p: 'n.', c: '意外发现美好事物的能力；机缘巧合' },
      { p: 'n.', c: '巧遇；意外的好运' },
    ],
    e: 'It was pure serendipity that we met on the train that day.',
    ec: '我们在那天火车上相遇纯属机缘巧合。',
    ph: [
      { p: 'by serendipity', c: '靠机缘巧合' },
      { p: 'a stroke of serendipity', c: '一次意外的好运' },
    ],
    m: '词根 serai(=to dream)+ped(=foot), 想象“踩到意外的金子” → 意外发现珍宝的好运。',
  };
}

const MOCK_PAYLOAD = {
  word: mockWord(),
  rec: { marked: false, seen: 1, status: 'learning' },
  source: 'due',
  gestures: {},
  view: {
    theme: 'light',
    opacity: 1,           // 截图为保持卡片"实心"完全显示
    fontSize: 15,
    width: 420,
    height: 320,
    showPhonetic: true,
    showSentence: true,
    showPhrase: true,
    pinned: false,
  },
};

/* =========================== Preload stub =========================== */
// 只在 popup / bubble 模式注入；用 ipcRenderer 把"注入 payload"作为 IPC 命令往下传
function makeStubPreload(channelName) {
  return `
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('${channelName}', new Proxy({}, {
  get() {
    return () => Promise.resolve();
  },
}));
contextBridge.exposeInMainWorld('__captureBridge', {
  inject: (payload) => ipcRenderer.send('__capture_inject', payload),
});
ipcRenderer.on('__capture_payload', (_e, payload) => {
  // 渲染进程通过自定义事件注入数据；render() 期待的是 window 上的全局函数
  try { window.render && window.render(payload); } catch (e) {}
  try { window.__captureDoRender && window.__captureDoRender(payload); } catch (e) {}
});
`;
}

/* =========================== 窗口工厂 =========================== */
function createWindow(channel) {
  if (target === 'popup') {
    return new BrowserWindow({
      width: 460,
      height: 360,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      fullscreenable: false,
      webPreferences: {
        preload: path.join(__dirname, '__capture_preload_popup.js'), // 写盘再做
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
  }
  // settings
  return new BrowserWindow({
    width: 960,
    height: 700,
    show: false,
    frame: false,
    backgroundColor: '#f6f7f9',
    webPreferences: {
      preload: path.join(__dirname, '__capture_preload_settings.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
}

/* =========================== 主流程 =========================== */
async function run() {
  // 先把 stub preload 写盘（Electron preload 只接受文件路径，不接受代码字符串）
  fs.mkdirSync(path.join(__dirname, '_tmp'), { recursive: true });
  const stubPopup = path.join(__dirname, '_tmp', `__capture_preload_${target}.js`);
  const channel = target === 'popup' ? 'wfPopup' : 'wfSettings';
  fs.writeFileSync(stubPopup, makeStubPreload(channel), 'utf8');

  const win = createWindow(channel);

  const html =
    target === 'popup'   ? path.join(RENDERER, 'popup', 'index.html') :
                           path.join(RENDERER, 'settings', 'index.html');

  await win.loadFile(html);

  // 等渲染稳定（DOM 渲染、字体加载、CSS 应用）
  await new Promise((r) => setTimeout(r, 600));

  // 注入数据再渲染（仅 popup 需要；settings 表单自成体系）
  if (target === 'popup') {
    // 直接在 renderer 里调用 render() —— popup.js / bubble.js 的 render() 是全局函数
    const payloadJson = JSON.stringify(MOCK_PAYLOAD);
    await win.webContents.executeJavaScript(`
      (function(){
        try {
          const p = ${payloadJson};
          if (typeof window.render === 'function') {
            window.render(p);
          }
          // popup 还要把 progress / 视图切到 word
          if ('${target}' === 'popup') {
            try {
              const prog = document.getElementById('progress');
              if (prog) prog.textContent = '142 / 7158 · 3 / 20';
              document.body.dataset.theme = 'light';
            } catch(e) {}
          }
        } catch(e) { return String(e); }
      })();
    `);
    await new Promise((r) => setTimeout(r, 400));
  } else {
    // settings: 确保 ready-to-show 后再截
    if (win.webContents.isLoading()) {
      await new Promise((r) => win.webContents.once('did-finish-load', r));
    }
    await new Promise((r) => setTimeout(r, 800));
  }

  // 截图
  const image = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, image.toPNG());
  const stat = fs.statSync(outPath);
  console.log(`[capture] wrote ${outPath} (${stat.size} bytes, ${image.getSize().width}x${image.getSize().height})`);

  // 清理 stub
  try { fs.unlinkSync(stubPopup); } catch (e) {}

  win.destroy();
  app.quit();
}

app.whenReady().then(() => {
  run().catch((err) => {
    console.error('[capture] failed:', err);
    app.exit(1);
  });
});

app.on('window-all-closed', () => app.quit());
