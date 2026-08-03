'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
const on = (ch, fn) => {
  const wrapped = (_e, payload) => fn(payload);
  ipcRenderer.on(ch, wrapped);
  return () => ipcRenderer.removeListener(ch, wrapped);
};

contextBridge.exposeInMainWorld('wfPopup', {
  current: () => invoke('study:word', 'current'),
  next: () => invoke('study:word', 'next'),
  prev: () => invoke('study:word', 'prev'),
  rate: (p) => invoke('study:rate', p),
  markUnknown: () => invoke('study:markUnknown'),
  markKnown: () => invoke('study:markKnown'),
  resize: (w, h) => invoke('win:resizePopup', w, h),
  fireGesture: (gesture) => invoke('gesture:fire', gesture),
  savePosition: (x, y) => invoke('win:savePosition', x, y),
  close: () => invoke('win:hidePopup'),
  alwaysOnTop: (flag) => invoke('win:alwaysOnTop', flag),
  speak: (text, lang = 'en-US') => {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = 0.9;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) {}
  },

  onWord: (fn) => on('word:update', fn),
  onGesture: (fn) => on('gesture:fire', fn),
  onConfig: (fn) => on('config:changed', fn),
  onStats: (fn) => on('stats:update', fn),
});