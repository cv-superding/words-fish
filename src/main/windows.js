'use strict';
/**
 * 窗口管理：单词悬浮窗 / 托盘气泡 / 设置窗口
 */
const { BrowserWindow, screen } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { config } = require('./config');

const R = (...p) => path.join(__dirname, '..', 'renderer', ...p);
const P = (f) => path.join(__dirname, '..', 'preload', f);

let popupWin = null;
let bubbleWin = null;
let settingsWin = null;
let knowledgeWin = null;
let bubbleTimer = null;

/* ------------------------------ 工具 ------------------------------ */

function activeDisplay() {
  try {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  } catch (e) {
    return screen.getPrimaryDisplay();
  }
}

function clampToDisplay(x, y, w, h) {
  const d = activeDisplay().workArea;
  const nx = Math.round(Math.min(Math.max(x, d.x), d.x + d.width - w));
  const ny = Math.round(Math.min(Math.max(y, d.y), d.y + d.height - h));
  return { x: nx, y: ny };
}

/* --------------------------- 单词悬浮窗 --------------------------- */

let popupUserResized = false;

function createPopup() {
  if (popupWin && !popupWin.isDestroyed()) return popupWin;

  const savedSize = config.get('popup.size', {});
  const w = (Number.isFinite(savedSize.width) && savedSize.width >= 280) ? savedSize.width : config.get('popup.width', 380);
  const h = (Number.isFinite(savedSize.height) && savedSize.height >= 180) ? savedSize.height : 240;

  popupWin = new BrowserWindow({
    width: w,
    height: h,
    minWidth: 280,
    minHeight: 180,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    thickFrame: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    fullscreenable: false,
    acceptFirstMouse: true,
    webPreferences: {
      preload: P('popup.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      backgroundThrottling: false,
    },
  });

  popupWin.setAlwaysOnTop(true, 'screen-saver');
  popupWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  popupWin.loadFile(R('popup', 'index.html'));

  popupWin.on('moved', () => {
    if (!config.get('popup.rememberPosition')) return;
    const [x, y] = popupWin.getPosition();
    config.update({ popup: { position: { x, y } } }, { silentReload: true });
  });

  // 用户手动缩放后保存尺寸，后续不再被 scheduleResize 缩回去
  // 按当前视图分别保存（单词尺寸 / 知识尺寸），切换视图时各自还原
  popupWin.on('resized', () => {
    if (!popupWin || popupWin.isDestroyed()) return;
    popupUserResized = true;
    const [nw, nh] = popupWin.getSize();
    const view = config.get('popup.view', 'word');
    if (view === 'knowledge') {
      config.update({ popup: { knowledgeSize: { width: nw, height: nh } } }, { silentReload: true });
    } else {
      config.update({ popup: { size: { width: nw, height: nh } } }, { silentReload: true });
    }
  });

  popupWin.on('closed', () => {
    popupWin = null;
    popupUserResized = false;
  });

  return popupWin;
}

function positionPopup(win) {
  const [w, h] = win.getSize();
  const saved = config.get('popup.position', {});
  const remember = config.get('popup.rememberPosition', true);
  if (remember && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    const { x, y } = clampToDisplay(saved.x, saved.y, w, h);
    win.setPosition(x, y);
    return;
  }
  const d = activeDisplay().workArea;
  win.setPosition(
    Math.round(d.x + (d.width - w) / 2),
    Math.round(d.y + (d.height - h) * 0.32)
  );
}

function showPopup() {
  const win = createPopup();
  if (!win.isVisible()) positionPopup(win);
  win.setOpacity(1);
  win.showInactive();
  win.setAlwaysOnTop(true, 'screen-saver');
  return win;
}

function hidePopup() {
  if (popupWin && !popupWin.isDestroyed() && popupWin.isVisible()) popupWin.hide();
}

function togglePopup() {
  if (popupWin && !popupWin.isDestroyed() && popupWin.isVisible()) {
    hidePopup();
    return false;
  }
  showPopup();
  return true;
}

function isPopupVisible() {
  return !!(popupWin && !popupWin.isDestroyed() && popupWin.isVisible());
}

function resizePopup(width, height, force = false) {
  if (!popupWin || popupWin.isDestroyed()) return;
  let w = Math.round(width);
  let h = Math.round(height);

  // 用户手动缩放后，不再被 scheduleResize 缩回去
  // force=true 用于 grip 拖拽过程中，允许自由缩小
  if (!force && popupUserResized) {
    const savedSize = config.get('popup.size', {});
    if (Number.isFinite(savedSize.width) && savedSize.width >= 280) w = Math.max(w, savedSize.width);
    if (Number.isFinite(savedSize.height) && savedSize.height >= 180) h = Math.max(h, savedSize.height);
  }

  const [cw, ch] = popupWin.getSize();
  if (Math.abs(cw - w) < 2 && Math.abs(ch - h) < 2) return;
  popupWin.setSize(w, h);
}

/* ---------------------------- 托盘气泡 ---------------------------- */

function createBubble() {
  if (bubbleWin && !bubbleWin.isDestroyed()) return bubbleWin;

  bubbleWin = new BrowserWindow({
    width: 372,
    height: 196,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    fullscreenable: false,
    acceptFirstMouse: true,
    webPreferences: {
      preload: P('bubble.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  bubbleWin.setAlwaysOnTop(true, 'screen-saver');
  bubbleWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  bubbleWin.loadFile(R('bubble', 'index.html'));
  bubbleWin.on('closed', () => {
    bubbleWin = null;
  });
  return bubbleWin;
}

function showBubble(durationSec) {
  const win = createBubble();
  const d = activeDisplay().workArea;
  const [w, h] = win.getSize();
  win.setPosition(Math.round(d.x + d.width - w - 12), Math.round(d.y + d.height - h - 12));
  win.showInactive();
  win.setAlwaysOnTop(true, 'screen-saver');

  clearTimeout(bubbleTimer);
  const sec = durationSec ?? config.get('push.bubbleDurationSec', 12);
  if (sec > 0) {
    bubbleTimer = setTimeout(() => {
      if (bubbleWin && !bubbleWin.isDestroyed()) {
        bubbleWin.webContents.send('bubble:fadeout');
        setTimeout(() => hideBubble(), 320);
      }
    }, sec * 1000);
  }
  return win;
}

function hideBubble() {
  clearTimeout(bubbleTimer);
  if (bubbleWin && !bubbleWin.isDestroyed() && bubbleWin.isVisible()) bubbleWin.hide();
}

function holdBubble() {
  clearTimeout(bubbleTimer);
}

function resizeBubble(width, height) {
  if (!bubbleWin || bubbleWin.isDestroyed()) return;
  const w = Math.round(width);
  const h = Math.round(height);
  const [cw, ch] = bubbleWin.getSize();
  if (Math.abs(cw - w) < 2 && Math.abs(ch - h) < 2) return;
  bubbleWin.setSize(w, h);
  const d = activeDisplay().workArea;
  bubbleWin.setPosition(Math.round(d.x + d.width - w - 12), Math.round(d.y + d.height - h - 12));
}

/* ---------------------------- 设置窗口 ---------------------------- */

function openSettings(section) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.show();
    settingsWin.focus();
    if (section) settingsWin.webContents.send('settings:goto', section);
    return settingsWin;
  }

  settingsWin = new BrowserWindow({
    width: 960,
    height: 700,
    minWidth: 820,
    minHeight: 560,
    show: false,
    frame: false,
    backgroundColor: '#f6f7f9',
    title: '摸鱼背单词 · 设置',
    webPreferences: {
      preload: P('settings.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  settingsWin.loadFile(R('settings', 'index.html'));
  settingsWin.once('ready-to-show', () => {
    settingsWin.show();
    if (section) settingsWin.webContents.send('settings:goto', section);
  });
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
  return settingsWin;
}

function closeSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
}

/* ---------------------------- 知识学习窗口 ---------------------------- */

function openKnowledge(domain) {
  if (knowledgeWin && !knowledgeWin.isDestroyed()) {
    if (knowledgeWin.isMinimized()) knowledgeWin.restore();
    knowledgeWin.show();
    knowledgeWin.focus();
    if (domain) knowledgeWin.webContents.send('knowledge:openDomain', domain);
    return knowledgeWin;
  }

  knowledgeWin = new BrowserWindow({
    width: 940,
    height: 700,
    minWidth: 760,
    minHeight: 540,
    show: false,
    frame: false,
    backgroundColor: '#f6f7f9',
    title: '摸鱼背单词 · AI 知识学习',
    webPreferences: {
      preload: P('knowledge.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  knowledgeWin.loadFile(R('knowledge', 'index.html'));
  knowledgeWin.once('ready-to-show', () => {
    knowledgeWin.show();
    if (domain) knowledgeWin.webContents.send('knowledge:openDomain', domain);
  });
  knowledgeWin.on('closed', () => {
    knowledgeWin = null;
  });
  return knowledgeWin;
}

function closeKnowledge() {
  if (knowledgeWin && !knowledgeWin.isDestroyed()) knowledgeWin.close();
}

function toggleKnowledge() {
  if (knowledgeWin && !knowledgeWin.isDestroyed() && knowledgeWin.isVisible()) {
    knowledgeWin.hide();
    return false;
  }
  openKnowledge();
  return true;
}

/* ------------------------------ 广播 ------------------------------ */

function send(target, channel, payload) {
  const map = { popup: popupWin, bubble: bubbleWin, settings: settingsWin, knowledge: knowledgeWin };
  const win = map[target];
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function broadcast(channel, payload) {
  for (const win of [popupWin, bubbleWin, settingsWin, knowledgeWin]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function hideAll() {
  hidePopup();
  hideBubble();
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.hide();
  if (knowledgeWin && !knowledgeWin.isDestroyed()) knowledgeWin.hide();
}

function getWin(name) {
  return { popup: popupWin, bubble: bubbleWin, settings: settingsWin, knowledge: knowledgeWin }[name] || null;
}

module.exports = {
  createPopup,
  showPopup,
  hidePopup,
  togglePopup,
  isPopupVisible,
  resizePopup,
  positionPopup,
  createBubble,
  showBubble,
  hideBubble,
  holdBubble,
  resizeBubble,
  openSettings,
  closeSettings,
  openKnowledge,
  closeKnowledge,
  toggleKnowledge,
  send,
  broadcast,
  hideAll,
  getWin,
};
