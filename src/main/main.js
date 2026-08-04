'use strict';
/**
 * 主入口
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

const { config } = require('./config');
const { records } = require('./records');
const wins = require('./windows');
const tray = require('./tray');
const scheduler = require('./scheduler');
const hotkeys = require('./hotkeys');
const ipc = require('./ipc');
const notifier = require('./notifier');
const autolaunch = require('./autolaunch');
const { knowledge } = require('./knowledge');

// 单实例
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

const minimizedStart = process.argv.includes('--minimized');

app.setAppUserModelId('com.wordsfish.app');
app.setName('WordsFish');

app.whenReady().then(() => {
  // 初始化
  config.load();
  records.load();

  // 注册 IPC 处理器
  ipc.register();

  // 托盘
  tray.create();

  // 热键
  hotkeys.applyAll();

  // 自启同步
  autolaunch.refreshAutostart();

  // 调度
  scheduler.start();

  // 首次启动引导：打开设置窗口让用户先配置词库/推送/AI，
  // 避免“一打开就是个单词气泡、还关不掉”的困惑。之后再启动按 startMinimized 静默待在托盘。
  const isFirstRun = !config.get('general.firstRunDone', false);
  if (!minimizedStart && (isFirstRun || !config.get('general.startMinimized', true))) {
    wins.openSettings();
  }
  try { config.update({ general: { firstRunDone: true } }, { silentReload: true }); } catch (e) { /* ignore */ }
});

app.on('second-instance', () => {
  wins.openSettings();
});

// macOS 关闭（即使没有 Mac 用户也能兜底）
app.on('window-all-closed', (e) => {
  if (process.platform !== 'darwin') {
    // 不退出，仅隐藏窗口
  }
});

// 退出前把数据落地
app.on('before-quit', () => {
  config.saveNow();
  records.flush();
  knowledge.saveNow();
});

process.on('uncaughtException', (err) => {
  console.error('未捕获异常:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('未处理 Promise 拒绝:', err);
});