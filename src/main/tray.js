'use strict';
/**
 * 系统托盘
 */
const { Tray, Menu, app, nativeImage } = require('electron');
const path = require('path');
const { config } = require('./config');
const dict = require('./dict');
const { records } = require('./records');
const wins = require('./windows');
const wordflow = require('./wordflow');
const scheduler = require('./scheduler');
const notifier = require('./notifier');

let tray = null;
let lastTemplate = null;
let lastStats = null;

const ASSETS = path.join(__dirname, '..', '..', 'assets');

function trayIcon() {
  const paused = scheduler.isPaused();
  const file = paused ? 'tray-paused.png' : 'tray.png';
  return nativeImage.createFromPath(path.join(ASSETS, file)).resize({ width: 16, height: 16 });
}

function buildTemplate() {
  const stats = records.todayStats();
  const book = wordflow.getBook();
  const books = dict.listBooks();
  const booksSubmenu = books.map((b) => ({
    label: `${b.name}  (${b.count})`,
    type: 'radio',
    checked: book && b.id === book.id,
    click: () => {
      config.update({ study: { activeBookId: b.id } });
      wordflow.resetHistory();
      rebuild();
      notifier.push('book-switch');
    },
  }));

  const template = [
    {
      label: book ? `当前词库: ${book.name}` : '当前词库: 无',
      enabled: false,
    },
    { label: `今日: 已学 ${stats.learned || 0} · 已复习 ${stats.reviewed || 0} · 生词 ${stats.marked || 0}`, enabled: false },
    { type: 'separator' },
    {
      label: '立即推送单词',
      accelerator: 'Shift+X',
      click: () => notifier.push('tray'),
    },
    {
      label: '单词悬浮窗（Shift+X）',
      click: () => wins.togglePopup(),
    },
    {
      label: '下一个单词',
      click: () => {
        const p = wordflow.next();
        if (wins.isPopupVisible()) wins.send('popup', 'word:update', p);
        else {
          wins.showPopup();
          wins.send('popup', 'word:update', p);
        }
      },
    },
    {
      label: '标记为生词',
      click: () => {
        const p = wordflow.markUnknown();
        wins.broadcast('word:update', p);
      },
    },
    { type: 'separator' },
    {
      label: scheduler.isPaused() ? '▶ 恢复定时推送' : '⏸ 暂停定时推送',
      click: () => {
        scheduler.pauseToggle();
        rebuild();
      },
    },
    {
      label: '🔇 临时静默 1 小时',
      click: () => {
        scheduler.suppress(60 * 60 * 1000);
        rebuild();
      },
    },
    { label: '切换词库', submenu: booksSubmenu },
    { type: 'separator' },
    {
      label: '🧠 AI 知识学习（Shift+K）',
      click: () => wins.openKnowledge(),
    },
    {
      label: '设置面板...',
      accelerator: 'Ctrl+,',
      click: () => wins.openSettings(),
    },
    {
      label: '退出摸鱼背单词',
      click: () => {
        config.saveNow();
        records.flush();
        app.quit();
      },
    },
  ];
  return template;
}

function rebuild() {
  if (!tray) return;
  lastTemplate = buildTemplate();
  const menu = Menu.buildFromTemplate(lastTemplate);
  tray.setContextMenu(menu);
  const stats = records.todayStats();
  if (config.get('general.showTrayCount', true) && stats.exposed > 0) {
    tray.setToolTip(`摸鱼背单词 · 今日已看 ${stats.exposed} 个`);
  } else {
    tray.setToolTip('摸鱼背单词');
  }
  tray.setImage(trayIcon());
}

function create() {
  if (tray) return tray;
  tray = new Tray(trayIcon());
  tray.setToolTip('摸鱼背单词');
  rebuild();

  // 双击托盘直接弹悬浮窗
  tray.on('double-click', () => wins.togglePopup());
  tray.on('click', () => wins.togglePopup());

  // 定时刷新菜单（用于显示今日统计变化）
  setInterval(() => {
    if (!tray) return;
    const cur = JSON.stringify(records.todayStats());
    if (cur !== lastStats) {
      lastStats = cur;
      rebuild();
    }
  }, 15000);

  return tray;
}

function refresh() {
  rebuild();
}

module.exports = { create, refresh };