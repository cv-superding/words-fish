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

  // 设置窗口（可选，--minimized 时不弹）
  if (!minimizedStart && !config.get('general.startMinimized', true)) {
    wins.openSettings();
  }

  // 首次启动主动推一次，建立“今天看了几个”的初始数据
  setTimeout(() => {
    try {
      notifier.push('first-launch');
    } catch (e) {
      console.error('首次推送失败', e);
    }
  }, 1200);
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
});

process.on('uncaughtException', (err) => {
  console.error('未捕获异常:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('未处理 Promise 拒绝:', err);
});