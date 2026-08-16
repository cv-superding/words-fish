'use strict';
/**
 * 通知器：根据当前 channel 决定如何呈现单词
 *  - bubble   自绘托盘气泡（无焦点、不抢桌面、可点击）
 *  - system   Windows 系统通知（需要 AppUserModelID，对全屏/锁屏可穿透）
 *  - popup    直接弹出单词悬浮窗（手动触发）
 */
const { app, Notification, nativeImage } = require('electron');
const path = require('path');
const { config } = require('./config');
const wordflow = require('./wordflow');
const wins = require('./windows');

let appIdSet = false;
function ensureAppUserModelID() {
  if (appIdSet) return;
  try {
    app.setAppUserModelId('com.wordsfish.app');
    appIdSet = true;
  } catch (e) {
    /* ignore */
  }
}

function nextPayload() {
  const p = wordflow.next();
  return p;
}

function push(trigger = 'manual') {
  const channel = config.get('push.channel', 'bubble');
  const payload = nextPayload();
  if (!payload) {
    wins.broadcast('notify:error', { reason: 'no-words' });
    return null;
  }
  if (channel === 'system') {
    pushSystem(payload, trigger);
  } else if (channel === 'popup') {
    wins.showPopup();
    wins.send('popup', 'word:update', payload);
  } else {
    wins.showBubble(config.get('push.bubbleDurationSec', 12));
    wins.send('bubble', 'word:update', payload);
  }
  wins.broadcast('notify:pushed', { trigger, channel, word: payload.word.w });
  return payload;
}

function pushSystem(payload, trigger) {
  ensureAppUserModelID();
  const w = payload.word;
  const meaning = (w.t || [])
    .slice(0, 3)
    .map((x) => (x.p ? `${x.p} ${x.c}` : x.c))
    .join('； ');
  const phonetic = [w.us ? `美[${w.us}]` : '', w.uk ? `英[${w.uk}]` : ''].filter(Boolean).join(' ');

  const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty() && process.resourcesPath) {
    // 兜底：打包后 asar 内路径读取失败时尝试 resources 目录
    icon = nativeImage.createFromPath(path.join(process.resourcesPath, 'assets', 'icon.png'));
  }
  const n = new Notification({
    title: `${w.w}  ${phonetic}`.trim(),
    body: meaning + (w.e ? `\n例：${w.e}` : ''),
    silent: config.get('push.silent', true),
    icon: icon.isEmpty() ? undefined : icon,
    timeoutType: 'default',
  });
  n.on('click', () => {
    wins.showPopup();
    wins.send('popup', 'word:update', payload);
  });
  n.show();
}

module.exports = { push, ensureAppUserModelID, nextPayload };