'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..', '..');

// app 仅在 Electron 环境可用；纯 Node 测试时用 cwd 兜底
function getUserDir() {
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') return app.getPath('userData');
  } catch (e) {
    /* fallthrough */
  }
  return path.join(ROOT, '.tmp', 'userData');
}

function ensureDir(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch (e) {
    /* ignore */
  }
  return p;
}

const paths = {
  root: ROOT,
  builtinDict: path.join(ROOT, 'data', 'builtin'),
  assets: path.join(ROOT, 'assets'),
  get userData() {
    return getUserDir();
  },
  get configFile() {
    return path.join(getUserDir(), 'config.json');
  },
  get recordsFile() {
    return path.join(getUserDir(), 'records.json');
  },
  get statsFile() {
    return path.join(getUserDir(), 'stats.json');
  },
  get customDictDir() {
    return ensureDir(path.join(getUserDir(), 'dicts'));
  },
  ensureDir,
};

module.exports = paths;
