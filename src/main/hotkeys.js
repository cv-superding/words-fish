'use strict';
/**
 * 全局快捷键
 *  注册失败（被占用/无效）时给出明确提示，并保留其他热键继续生效。
 */
const { globalShortcut } = require('electron');
const { config } = require('./config');
const { HOTKEY_ITEMS } = require('./constants');
const wins = require('./windows');
const wordflow = require('./wordflow');
const scheduler = require('./scheduler');

const handlers = {
  togglePopup: () => wins.togglePopup(),
  nextWord: () => {
    const p = wordflow.next();
    if (wins.isPopupVisible()) {
      if (p) wins.send('popup', 'word:update', p);
    } else {
      wins.showPopup();
      if (p) wins.send('popup', 'word:update', p);
    }
  },
  markUnknown: () => {
    const p = wordflow.markUnknown();
    if (p) wins.broadcast('word:update', p);
  },
  toggleMeaning: () => wins.send('popup', 'gesture:fire', { gesture: 'toggleMeaning' }),
  openSettings: () => wins.openSettings(),
  openKnowledge: () => wins.openKnowledge(),
  panic: () => {
    scheduler.suppress(60 * 60 * 1000);
    wins.hideAll();
    if (process.platform === 'win32') {
      const { exec } = require('child_process');
      exec('powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(\'^d\')"');
    }
  },
};

let current = {};

function unregisterAll() {
  for (const acc of Object.values(current)) {
    try {
      globalShortcut.unregister(acc);
    } catch (e) {
      /* ignore */
    }
  }
  current = {};
}

function applyOne(key, accel) {
  const prev = current[key];
  if (prev && prev === accel) return { ok: true, accelerator: accel };
  if (prev) {
    try {
      globalShortcut.unregister(prev);
    } catch (e) {}
  }
  if (!accel) {
    delete current[key];
    return { ok: true, accelerator: null };
  }
  const ok = globalShortcut.register(accel, handlers[key]);
  if (!ok) {
    delete current[key];
    return { ok: false, accelerator: accel, error: '注册失败：快捷键被占用或无效' };
  }
  current[key] = accel;
  return { ok: true, accelerator: accel };
}

function applyAll() {
  unregisterAll();
  const cfg = config.get('hotkeys', {});
  const results = {};
  for (const { key } of HOTKEY_ITEMS) {
    const accel = cfg[key];
    if (!accel) continue;
    const r = applyOne(key, accel);
    if (!r.ok) results[key] = r;
  }
  return results;
}

function unregister() {
  unregisterAll();
}

module.exports = { applyAll, applyOne, unregister, handlers };