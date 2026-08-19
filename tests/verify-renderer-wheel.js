'use strict';
// 在 Node 里用手写桩加载真实 popup.js，模拟滚轮事件，验证手势链路是否真的派发。
// 不依赖 jsdom：popup.js 只用了 window / document / window.wfPopup 几个全局。

const path = require('path');

// ---- 假 DOM 元素 ----
function makeEl() {
  return {
    innerHTML: '',
    textContent: '',
    dataset: {},
    style: {},
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() { return { height: 100, width: 380, top: 0, left: 0 }; },
    querySelector() { return makeEl(); },
    send() {},
  };
}

const elCache = {};
function getEl(id) { return (elCache[id] = elCache[id] || makeEl()); }

// ---- 事件总线（window 上的监听器）----
const winHandlers = {};
let wheelHandler = null;

// ---- api (window.wfPopup) 桩 ----
const firedGestures = [];
const api = {
  current: () => process.env.NULL_STARTUP
    ? Promise.resolve(null)
    : Promise.resolve({
    word: { w: 'automatic', e: 'adj. 自动的', ec: '', ph: [], m: 'tip' },
    view: { theme: 'light', fontSize: 15, width: 380, opacity: 0.96, pinned: false, meaningHidden: false },
    progress: { learned: 1, total: 1162, todayLearned: 1, dailyGoal: 20 },
    rec: { seen: 1, marked: false, status: 'new' },
    source: 'new',
    gestures: { click: 'none', dblclick: 'close', rightclick: 'markUnknown', middleclick: 'toggleMeaning', wheelUp: 'prevWord', wheelDown: 'nextWord', longpress: 'openSettings' },
  }),
  next: () => Promise.resolve({ word: { w: 'next' } }),
  prev: () => Promise.resolve({ word: { w: 'prev' } }),
  rate: () => Promise.resolve({}),
  markUnknown: () => Promise.resolve({}),
  markKnown: () => Promise.resolve({}),
  resize: () => Promise.resolve({}),
  fireGesture: (g) => { firedGestures.push(g); return Promise.resolve({ handled: true, action: 'nextWord' }); },
  savePosition: () => Promise.resolve({}),
  getPopup: () => Promise.resolve({ view: 'word' }),
  configUpdate: () => Promise.resolve({}),
  setView: () => Promise.resolve({}),
  requestAssets: () => Promise.resolve({}),
  close: () => Promise.resolve({}),
  alwaysOnTop: () => Promise.resolve({}),
  speak: () => {},
  onWord: () => {},
  onGesture: () => {},
  onConfig: () => {},
  onStats: () => {},
  onAssets: () => {},
};

// ---- 全局 stub ----
global.window = {
  wfPopup: api,
  addEventListener: (type, fn) => { if (type === 'wheel') wheelHandler = fn; winHandlers[type] = fn; },
  removeEventListener: () => {},
  speechSynthesis: { cancel() {}, speak() {} },
  requestAnimationFrame: (fn) => fn(),
};
global.document = {
  getElementById: getEl,
  querySelector: () => makeEl(),
  documentElement: { style: {} },
  body: makeEl(),
  addEventListener: () => {},
};
global.requestAnimationFrame = (fn) => fn();
global.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };

// ---- 加载真实 popup.js ----
require(path.resolve(__dirname, '..', 'src', 'renderer', 'popup', 'popup.js'));

// 等初始 IIFE 完成（api.current -> loadWord -> render）
setTimeout(() => {
  if (!wheelHandler) { console.log('FAIL: 未注册 wheel 监听'); process.exit(1); }
  // 模拟向下滚动（deltaY>0 => wheelDown）
  wheelHandler({ deltaY: 120, stopPropagation() {}, preventDefault() {} });
  // 向上滚动需间隔 > 400ms（绕过滚轮节流），确认两个方向都能派发
  setTimeout(() => {
    wheelHandler({ deltaY: -120, stopPropagation() {}, preventDefault() {} });
    console.log('滚轮派发的手势:', JSON.stringify(firedGestures));
    if (firedGestures.includes('wheelDown') && firedGestures.includes('wheelUp')) {
      console.log('PASS: 滚轮正确触发 wheelDown/wheelUp 手势');
      process.exit(0);
    } else {
      console.log('FAIL: 滚轮未触发预期手势');
      process.exit(2);
    }
  }, 500);
}, 200);
