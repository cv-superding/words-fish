'use strict';
/**
 * 配置中心：默认值 + 磁盘持久化 + 深合并 + 变更订阅
 */
const fs = require('fs');
const paths = require('./paths');

const DEFAULTS = {
  version: 1,

  general: {
    autoLaunch: false,
    startMinimized: true,
    closeToTray: true,
    showTrayCount: true,
  },

  // 定时推送
  push: {
    enabled: true,
    channel: 'bubble', // bubble=自绘托盘气泡 | system=Windows 系统通知 | popup=直接弹悬浮窗
    intervalMin: 15, // 推送间隔（分钟）
    jitterMin: 3, // 随机浮动 ±N 分钟，避免过于规律引人注意
    bubbleDurationSec: 12, // 气泡停留秒数
    silent: true, // 系统通知是否静音
    quietHours: { enabled: false, start: '12:00', end: '13:30' },
    workdayOnly: false,
    pauseWhenFullscreen: true, // 检测到全屏（会议/演示）时暂停
  },

  // 全局快捷键
  hotkeys: {
    togglePopup: 'Shift+X',
    nextWord: 'Shift+C',
    markUnknown: 'Shift+Z',
    toggleMeaning: '',
    openSettings: '',
    panic: 'Shift+Esc',
  },

  // 悬浮窗
  popup: {
    theme: 'light',
    opacity: 0.96,
    fontSize: 15,
    width: 380,
    showPhonetic: true,
    showSentence: true,
    showPhrase: false,
    showProgress: true,
    meaningHidden: false, // true = 先只显示单词，需触发才看释义（自测模式）
    rememberPosition: true,
    position: { x: null, y: null },
    autoCloseSec: 0, // 0 表示不自动关闭
    pinned: false,
  },

  // 手势映射
  gestures: {
    click: 'none',
    dblclick: 'close',
    rightclick: 'markUnknown',
    middleclick: 'toggleMeaning',
    wheelUp: 'prevWord',
    wheelDown: 'nextWord',
    longpress: 'openSettings',
  },

  // 学习策略
  study: {
    activeBookId: 'cet4',
    dailyGoal: 30,
    newWordRatio: 0.6, // 新词 : 复习词 的比例
    reviewEnabled: true,
    priorityMarked: true, // 生词优先复现
  },
};

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k of Object.keys(patch || {})) {
    const pv = patch[k];
    if (isObj(pv) && isObj(base[k])) out[k] = deepMerge(base[k], pv);
    else if (pv !== undefined) out[k] = pv;
  }
  return out;
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

class Config {
  constructor() {
    this.data = clone(DEFAULTS);
    this.listeners = new Set();
    this._saveTimer = null;
  }

  load() {
    try {
      if (fs.existsSync(paths.configFile)) {
        const raw = JSON.parse(fs.readFileSync(paths.configFile, 'utf8'));
        this.data = deepMerge(DEFAULTS, raw);
      }
    } catch (e) {
      console.error('[config] 读取失败，回退默认配置:', e.message);
      this.data = clone(DEFAULTS);
    }
    return this.data;
  }

  get all() {
    return this.data;
  }

  get(pathStr, fallback) {
    const seg = pathStr.split('.');
    let cur = this.data;
    for (const s of seg) {
      if (cur == null) return fallback;
      cur = cur[s];
    }
    return cur === undefined ? fallback : cur;
  }

  /** 局部更新（深合并），返回新配置 */
  update(patch, meta = {}) {
    const before = clone(this.data);
    this.data = deepMerge(this.data, patch);
    this.saveDebounced();
    for (const fn of this.listeners) {
      try {
        fn(this.data, before, meta);
      } catch (e) {
        console.error('[config] listener error', e);
      }
    }
    return this.data;
  }

  reset(section) {
    if (section && DEFAULTS[section]) {
      this.update({ [section]: clone(DEFAULTS[section]) }, { reset: section });
    } else {
      this.data = clone(DEFAULTS);
      this.saveDebounced();
      for (const fn of this.listeners) fn(this.data, null, { reset: 'all' });
    }
    return this.data;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  saveDebounced() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.saveNow(), 300);
  }

  saveNow() {
    try {
      paths.ensureDir(paths.userData);
      fs.writeFileSync(paths.configFile, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.error('[config] 保存失败:', e.message);
    }
  }
}

module.exports = { config: new Config(), DEFAULTS };
