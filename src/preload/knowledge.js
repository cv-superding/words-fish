'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
const on = (ch, fn) => {
  const wrapped = (_e, payload) => fn(payload);
  ipcRenderer.on(ch, wrapped);
  return () => ipcRenderer.removeListener(ch, wrapped);
};

contextBridge.exposeInMainWorld('wfKnowledge', {
  presets: () => invoke('knowledge:presets'),
  listSessions: () => invoke('knowledge:listSessions'),
  open: (domain) => invoke('knowledge:open', domain),
  ask: (sessionId, type, input) => invoke('knowledge:ask', sessionId, type, input),
  history: (sessionId) => invoke('knowledge:history', sessionId),
  reset: (sessionId) => invoke('knowledge:reset', sessionId),
  status: () => invoke('knowledge:status'),
  testConnection: () => invoke('knowledge:test'),

  config: {
    get: () => invoke('config:get'),
    update: (patch, meta) => invoke('config:update', patch, meta),
  },
  win: {
    close: () => invoke('win:close'),
    minimize: () => invoke('win:minimize'),
    openSettings: (section) => invoke('win:openSettings', section),
  },
  app: {
    platform: process.platform,
    version: () => invoke('app:version'),
  },

  onToken: (fn) => on('knowledge:token', fn),
  onDone: (fn) => on('knowledge:done', fn),
  onConfigChanged: (fn) => on('config:changed', fn),
  onOpenDomain: (fn) => on('knowledge:openDomain', fn),
});
