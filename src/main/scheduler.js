'use strict';
/**
 * 定时推送调度器
 *  间隔 = config.push.intervalMin ± config.push.jitterMin
 *  支持：免打扰时段、工作日判断、暂停（老板键/全屏时）
 */
const { app } = require('electron');
const { execFile } = require('child_process');
const { config } = require('./config');
const wordflow = require('./wordflow');

let timer = null;
let nextAt = 0;
let paused = false; // 用户主动暂停（托盘菜单 → 暂停推送）
let suppressed = 0; // 临时抑制（会议模式 / 老板键）

function log(...a) {
  console.log('[scheduler]', ...a);
}

function inQuietHours(now = new Date()) {
  const qh = config.get('push.quietHours');
  if (!qh || !qh.enabled) return false;
  const m = now.getHours() * 60 + now.getMinutes();
  const toMin = (s) => {
    const [h, mm] = s.split(':').map(Number);
    return h * 60 + (mm || 0);
  };
  const s = toMin(qh.start);
  const e = toMin(qh.end);
  return s < e ? m >= s && m <= e : m >= s || m <= e; // 跨天情况
}

function isWorkday(now = new Date()) {
  const d = now.getDay();
  return d >= 1 && d <= 5;
}

function isFullscreenPlaying(cb) {
  // 调用 PowerShell 检测系统是否处于“正在投影 / 全屏应用”状态。
  // 因为完整 OS API 需要 native 模块，这里通过 cmd + tasklist 简化判断：
  //  检测是否有 PowerPoint / Zoom / Teams / OBS 等常见“全屏应用”正在运行。
  execFile('tasklist', ['/fi', 'imagename eq Powerpnt.exe /fo csv /nh'], { timeout: 1500 }, (e1, p1) => {
    if (e1) return cb(false);
    let playing = p1 && p1.trim() && !/INFO/i.test(p1);
    if (playing) return cb(true);
    execFile(
      'tasklist',
      ['/fo', 'csv', '/nh'],
      { timeout: 2000 },
      (e2, out) => {
        if (e2 || !out) return cb(false);
        const low = out.toLowerCase();
        const hot = ['pptview', 'zoomit', 'obs', 'obs64', 'teams', 'ms-teams', 'wemeetapp', 'webexmta'];
        cb(hot.some((n) => low.includes(n + '.exe')));
      }
    );
  });
}

function shouldFire(now = new Date()) {
  if (!config.get('push.enabled', true)) return { ok: false, reason: '已关闭' };
  if (paused) return { ok: false, reason: '用户暂停' };
  if (suppressed > 0) return { ok: false, reason: '临时抑制' };
  if (config.get('push.workdayOnly') && !isWorkday(now)) return { ok: false, reason: '非工作日' };
  if (inQuietHours(now)) return { ok: false, reason: '免打扰时段' };
  return { ok: true };
}

function planNext() {
  const base = config.get('push.intervalMin', 15);
  const jit = config.get('push.jitterMin', 3);
  const min = Math.max(1, base - jit);
  const max = base + jit;
  const ms = (min + Math.random() * (max - min)) * 60_000;
  nextAt = Date.now() + ms;
  timer = setTimeout(tick, ms);
  log(`下次推送在 ${(ms / 1000 / 60).toFixed(1)} 分钟后`);
}

function tick() {
  const d = shouldFire();
  if (!d.ok) {
    planNext();
    return;
  }
  if (config.get('push.pauseWhenFullscreen', true)) {
    isFullscreenPlaying((playing) => {
      if (playing) {
        log('检测到全屏应用，本次跳过');
        planNext();
        return;
      }
      fire('scheduler');
    });
    return;
  }
  fire('scheduler');
}

function fire(reason) {
  log('推送单词, reason=', reason);
  require('./notifier').push('scheduler');
  planNext();
}

/* ------------------- 暂停/恢复（多源：托盘菜单、老板键、设置） ------------------- */

function pauseToggle() {
  paused = !paused;
  return paused;
}

function suppress(ms = 0) {
  suppressed = Date.now() + ms;
}

function unsuppress() {
  suppressed = 0;
}

function isPaused() {
  return paused || (suppressed && suppressed > Date.now());
}

/* --------------------------- 启动 / 关闭 --------------------------- */

function start() {
  paused = false;
  if (timer) clearTimeout(timer);
  planNext();
}

function stop() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

function reconfigure() {
  if (!timer) return;
  clearTimeout(timer);
  planNext();
}

function getStatus() {
  return {
    paused,
    suppressed: suppressed > Date.now() ? suppressed : 0,
    nextAt,
    shouldFire: shouldFire().ok,
  };
}

// 集成到 app 生命周期
if (app && app.on) {
  app.on('before-quit', () => stop());
}

module.exports = { start, stop, reconfigure, pauseToggle, suppress, unsuppress, isPaused, fire, getStatus };