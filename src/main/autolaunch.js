'use strict';
/**
 * 开机自启动
 *  - macOS: app.setLoginItemSettings({openAtLogin})
 *  - Windows: 注册表 Run / Electron 内置 API
 */
const { app } = require('electron');
const { execFile } = require('child_process');
const { config } = require('./config');

function applyAutostart(enabled) {
  if (process.platform !== 'win32') {
    app.setLoginItemSettings({ openAtLogin: !!enabled });
    return true;
  }
  // Windows 上 Electron 内部会写注册表，但传入 args 可以让「开机后最小化启动」
  const args = enabled && config.get('general.startMinimized', true) ? ['--minimized'] : [];
  app.setLoginItemSettings({
    openAtLogin: !!enabled,
    openAsHidden: true,
    args,
  });
  return true;
}

function refreshAutostart() {
  applyAutostart(config.get('general.autoLaunch', false));
}

function isEnabled() {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch (e) {
    return false;
  }
}

module.exports = { refreshAutostart, isEnabled };