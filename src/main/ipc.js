'use strict';
/**
 * IPC 处理：所有从渲染层发起的调用都通过这里，统一登记。
 */
const { ipcMain, shell, app } = require('electron');
const dialog = require('./ipc-dialog');
const { config, DEFAULTS } = require('./config');
const dict = require('./dict');
const { records } = require('./records');
const wordflow = require('./wordflow');
const wins = require('./windows');
const scheduler = require('./scheduler');
const notifier = require('./notifier');
const hotkeys = require('./hotkeys');
const tray = require('./tray');
const autolaunch = require('./autolaunch');
const constants = require('./constants');
const { knowledge } = require('./knowledge');

function getRouted(reqWin) {
  return {
    popup: wins.getWin('popup'),
    bubble: wins.getWin('bubble'),
    settings: wins.getWin('settings'),
  }[reqWin] || null;
}

function register() {
  /* ------------------------- 配置读取 / 修改 ------------------------- */
  ipcMain.handle('config:get', () => config.all);
  ipcMain.handle('config:getSection', (_, section) => config.get(section));
  ipcMain.handle('config:update', (_, patch, meta) => {
    const before = JSON.parse(JSON.stringify(config.all));
    config.update(patch, meta);
    onConfigChanged(before, config.all, meta);
    return config.all;
  });
  ipcMain.handle('config:reset', (_, section) => {
    config.reset(section);
    return config.all;
  });
  ipcMain.handle('config:constants', () => constants);

  /* --------------------------- 词库相关 --------------------------- */
  ipcMain.handle('dict:list', () => dict.listBooks());
  ipcMain.handle('dict:load', (_, id) => {
    const b = dict.loadBook(id);
    return b ? { id: b.id, name: b.name, count: b.words.length, builtin: !!b.builtin } : null;
  });
  ipcMain.handle('dict:setActive', (_, id) => {
    config.update({ study: { activeBookId: id } });
    wordflow.resetHistory();
    return true;
  });
  ipcMain.handle('dict:import', async (e) => {
    const win = e.sender.getOwnerBrowserWindow();
    const r = await dialog.openImport(win);
    if (!r || r.canceled) return { canceled: true };
    const out = dict.importFromFile(r.filePath);
    if (out.ok && out.id) {
      config.update({ study: { activeBookId: out.id } });
      wordflow.resetHistory();
      tray.refresh();
    }
    return out;
  });
  ipcMain.handle('dict:delete', (_, id) => {
    const r = dict.deleteBook(id);
    if (r.ok && config.get('study.activeBookId') === id) {
      const books = dict.listBooks();
      config.update({ study: { activeBookId: books[0] ? books[0].id : null } });
      wordflow.resetHistory();
    }
    return r;
  });

  /* --------------------------- 学习相关 --------------------------- */
  ipcMain.handle('study:word', (_, kind = 'current') => {
    if (kind === 'current') return wordflow.currentPayload();
    if (kind === 'next') return wordflow.next();
    if (kind === 'prev') return wordflow.prev();
    return null;
  });
  ipcMain.handle('study:rate', (_, performance) => wordflow.rate(performance));
  ipcMain.handle('study:markUnknown', () => wordflow.markUnknown());
  ipcMain.handle('study:markKnown', () => wordflow.markKnown());
  ipcMain.handle('study:reset', (_, bookId) => {
    const id = bookId || config.get('study.activeBookId');
    const n = records.resetBook(id);
    wordflow.resetHistory();
    return { ok: true, cleared: n };
  });
  ipcMain.handle('study:stats', () => wordflow.statsSnapshot());
  ipcMain.handle('study:marked', () => wordflow.getBook() && records.markedList(wordflow.getBook()));

  /* --------------------------- 知识学习（LLM） --------------------------- */
  ipcMain.handle('knowledge:presets', () => knowledge.listPresets());
  ipcMain.handle('knowledge:listSessions', () => knowledge.listSessions());
  ipcMain.handle('knowledge:open', (_, domain) => {
    const s = knowledge.getOrCreate(domain);
    return { session: { id: s.id, domain: s.domain }, history: knowledge.history(s.id), status: knowledge.status() };
  });
  ipcMain.handle('knowledge:ask', async (e, sessionId, type, input) => {
    return await knowledge.ask(sessionId, type, input, {
      onToken: (token) => {
        try {
          e.sender.send('knowledge:token', { sessionId, token });
        } catch (err) {}
      },
      onDone: () => {
        try {
          e.sender.send('knowledge:done', { sessionId });
        } catch (err) {}
      },
    });
  });
  ipcMain.handle('knowledge:history', (_, sessionId) => knowledge.history(sessionId));
  ipcMain.handle('knowledge:reset', (_, sessionId) => knowledge.reset(sessionId));
  ipcMain.handle('knowledge:status', () => knowledge.status());
  ipcMain.handle('knowledge:test', () => knowledge.testConnection());

  /* --------------------------- 通知 / 推送 --------------------------- */
  ipcMain.handle('notify:push', (_, trigger = 'manual') => notifier.push(trigger));
  ipcMain.handle('notify:pause', (_, ms = 0) => {
    scheduler.suppress(ms);
    tray.refresh();
    return scheduler.getStatus();
  });
  ipcMain.handle('notify:resume', () => {
    scheduler.unsuppress();
    if (scheduler.isPaused()) scheduler.pauseToggle();
    tray.refresh();
    return scheduler.getStatus();
  });
  ipcMain.handle('notify:status', () => scheduler.getStatus());

  /* --------------------------- 窗口控制 --------------------------- */
  ipcMain.handle('win:showPopup', () => {
    wins.showPopup();
    return true;
  });
  ipcMain.handle('win:hidePopup', () => {
    wins.hidePopup();
    return true;
  });
  ipcMain.handle('win:togglePopup', () => wins.togglePopup());
  ipcMain.handle('win:resizePopup', (_, w, h, force) => wins.resizePopup(w, h, force));
  ipcMain.handle('win:resizeBubble', (_, w, h) => wins.resizeBubble(w, h));
  ipcMain.handle('win:holdBubble', () => wins.holdBubble());
  ipcMain.handle('win:hideBubble', () => wins.hideBubble());
  ipcMain.handle('win:hideAll', () => wins.hideAll());
  ipcMain.handle('win:openSettings', (_, section) => wins.openSettings(section));
  ipcMain.handle('win:openKnowledge', (_, domain) => wins.openKnowledge(domain));
  ipcMain.handle('win:close', (e) => {
    const w = e.sender.getOwnerBrowserWindow();
    if (w) w.close();
  });
  ipcMain.handle('win:minimize', (e) => {
    const w = e.sender.getOwnerBrowserWindow();
    if (w) w.minimize();
  });
  ipcMain.handle('win:alwaysOnTop', (e, flag) => {
    const w = e.sender.getOwnerBrowserWindow();
    if (w) w.setAlwaysOnTop(!!flag, 'screen-saver');
    return true;
  });
  ipcMain.handle('win:positionPopup', () => {
    const p = wins.getWin('popup');
    if (p) wins.positionPopup(p);
    return true;
  });
  ipcMain.handle('win:savePosition', (_, x, y) => {
    config.update({ popup: { position: { x, y } } });
    return true;
  });

  /* --------------------------- 手势 / 广播 --------------------------- */
  ipcMain.handle('gesture:fire', (e, gesture) => {
    const action = config.get(`gestures.${gesture}`);
    if (!action || action === 'none') return { handled: false };
    const win = e.sender.getOwnerBrowserWindow();
    const isFromPopup = win === wins.getWin('popup');
    dispatchAction(action, { source: isFromPopup ? 'popup' : 'bubble' });
    return { handled: true, action };
  });

  /* --------------------------- 自启动 --------------------------- */
  ipcMain.handle('app:setAutoLaunch', (_, enabled) => {
    autolaunch.refreshAutostart();
    return enabled;
  });
  ipcMain.handle('app:getAutoLaunch', () => autolaunch.isEnabled());
  ipcMain.handle('app:openDataDir', () => {
    const { shell } = require('electron');
    shell.openPath(app.getPath('userData'));
    return true;
  });
  ipcMain.handle('app:version', () => app.getVersion());

  /* --------------------------- 订阅配置变更 --------------------------- */
  config.onChange((now, before, meta) => {
    onConfigChanged(before || now, now, meta || {});
  });
}

function dispatchAction(action, ctx) {
  switch (action) {
    case 'close':
      wins.hidePopup();
      wins.hideBubble();
      break;
    case 'nextWord': {
      const p = wordflow.next();
      wins.send('popup', 'word:update', p);
      wins.send('bubble', 'word:update', p);
      break;
    }
    case 'prevWord': {
      const p = wordflow.prev();
      wins.send('popup', 'word:update', p);
      wins.send('bubble', 'word:update', p);
      break;
    }
    case 'toggleMeaning':
      wins.send('popup', 'gesture:fire', { gesture: 'toggleMeaning' });
      wins.send('bubble', 'gesture:fire', { gesture: 'toggleMeaning' });
      break;
    case 'markUnknown': {
      const p = wordflow.markUnknown();
      wins.broadcast('word:update', p);
      break;
    }
    case 'markKnown': {
      const p = wordflow.markKnown();
      wins.broadcast('word:update', p);
      break;
    }
    case 'speak':
      wins.send('popup', 'gesture:fire', { gesture: 'speak' });
      wins.send('bubble', 'gesture:fire', { gesture: 'speak' });
      break;
    case 'togglePin':
      config.update({ popup: { pinned: !config.get('popup.pinned') } });
      const cur = wins.getWin('popup');
      if (cur) {
        const pinned = config.get('popup.pinned');
        cur.setAlwaysOnTop(pinned, pinned ? 'screen-saver' : 'normal');
      }
      break;
    case 'copyWord': {
      const c = wordflow.current();
      if (c) {
        const { clipboard } = require('electron');
        clipboard.writeText(c.word.w);
      }
      break;
    }
    case 'openSettings':
      wins.openSettings();
      break;
    case 'openKnowledge':
      wins.openKnowledge();
      break;
  }
}

function onConfigChanged(before, now, meta) {
  if (meta && meta.silentReload) return;
  // 热键
  const hk = JSON.stringify(before.hotkeys) !== JSON.stringify(now.hotkeys);
  if (hk) hotkeys.applyAll();
  // 推送间隔
  scheduler.reconfigure();
  // 自启
  if (before.general.autoLaunch !== now.general.autoLaunch) {
    autolaunch.refreshAutostart();
  }
  // 托盘刷新（统计、菜单可见性）
  tray.refresh();
  // 广播给所有窗口
  wins.broadcast('config:changed', { meta, section: meta && meta.reset ? meta.reset : null });
}

module.exports = { register, dispatchAction };