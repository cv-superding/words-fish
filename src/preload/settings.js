'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
const on = (ch, fn) => {
  const wrapped = (_e, p) => fn(p);
  ipcRenderer.on(ch, wrapped);
  return () => ipcRenderer.removeListener(ch, wrapped);
};

contextBridge.exposeInMainWorld('wfSettings', {
  config: {
    get: () => invoke('config:get'),
    update: (patch, meta) => invoke('config:update', patch, meta),
    reset: (section) => invoke('config:reset', section),
    constants: () => invoke('config:constants'),
  },
  dict: {
    list: () => invoke('dict:list'),
    load: (id) => invoke('dict:load', id),
    setActive: (id) => invoke('dict:setActive', id),
    import: () => invoke('dict:import'),
    delete: (id) => invoke('dict:delete', id),
  },
  study: {
    current: () => invoke('study:word', 'current'),
    next: () => invoke('study:word', 'next'),
    rate: (p) => invoke('study:rate', p),
    markUnknown: () => invoke('study:markUnknown'),
    markKnown: () => invoke('study:markKnown'),
    stats: () => invoke('study:stats'),
    marked: () => invoke('study:marked'),
    reset: (id) => invoke('study:reset', id),
  },
  notify: {
    push: () => invoke('notify:push'),
    pause: (ms) => invoke('notify:pause', ms),
    resume: () => invoke('notify:resume'),
    status: () => invoke('notify:status'),
  },
  win: {
    open: (section) => invoke('win:openSettings', section),
    hide: () => invoke('win:hide'),
    showPopup: () => invoke('win:showPopup'),
    togglePopup: () => invoke('win:togglePopup'),
    close: () => invoke('win:close'),
    minimize: () => invoke('win:minimize'),
    alwaysOnTop: (flag) => invoke('win:alwaysOnTop', flag),
    openDataDir: () => invoke('app:openDataDir'),
  },
  app: {
    version: () => invoke('app:version'),
    getAutoLaunch: () => invoke('app:getAutoLaunch'),
    setAutoLaunch: (flag) => invoke('app:setAutoLaunch', flag),
    platform: process.platform,
  },

  onConfigChanged: (fn) => on('config:changed', fn),
  onStats: (fn) => on('stats:update', fn),
  onGoto: (fn) => on('settings:goto', fn),
  onNotifyPushed: (fn) => on('notify:pushed', fn),
  onNotifyResponse: (fn) => on('notify:response', fn),
});