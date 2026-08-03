'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wfBubble', {
  resize: (w, h) => ipcRenderer.invoke('win:resizeBubble', w, h),
  close: () => ipcRenderer.invoke('win:hideBubble'),
  hold: () => ipcRenderer.invoke('win:holdBubble'),
  rate: (p) => ipcRenderer.invoke('study:rate', p),
  markUnknown: () => ipcRenderer.invoke('study:markUnknown'),
  markKnown: () => ipcRenderer.invoke('study:markKnown'),
  next: () => ipcRenderer.invoke('study:word', 'next'),
  showPopup: () => ipcRenderer.invoke('win:showPopup'),

  onWord: (fn) => {
    const wrapped = (_e, p) => fn(p);
    ipcRenderer.on('word:update', wrapped);
    return () => ipcRenderer.removeListener('word:update', wrapped);
  },
  onFadeOut: (fn) => {
    const wrapped = () => fn();
    ipcRenderer.on('bubble:fadeout', wrapped);
    return () => ipcRenderer.removeListener('bubble:fadeout', wrapped);
  },
  onGesture: (fn) => {
    const wrapped = (_e, p) => fn(p);
    ipcRenderer.on('gesture:fire', wrapped);
    return () => ipcRenderer.removeListener('gesture:fire', wrapped);
  },
});