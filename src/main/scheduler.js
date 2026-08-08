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
  // 用「前台窗口是否真正全屏（几乎覆盖整个主屏）」来判定，
  // 而不是“进程是否在运行”。Teams / WeMeet / WebEx / PowerPoint 等会议/办公软件
  // 在绝大多数办公电脑上常驻后台，并不代表用户正在全屏演示——
  // 旧逻辑只要这些进程在跑就判定为全屏，导致定时推送对绝大多数用户静默失效。
  // 检测失败时（PowerShell 不可用 / 异常）一律按“非全屏”处理，保证推送照常触发。
  const script = `
try {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WFFull {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int n);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
  $fg = [WFFull]::GetForegroundWindow()
  if ($fg -eq [IntPtr]::Zero) { Write-Output 'false'; return }
  $r = New-Object WFFull+RECT
  if (-not [WFFull]::GetWindowRect($fg, [ref]$r)) { Write-Output 'false'; return }
  $sw = [WFFull]::GetSystemMetrics(0)
  $sh = [WFFull]::GetSystemMetrics(1)
  $fw = $r.Right - $r.Left
  $fh = $r.Bottom - $r.Top
  # 窗口几乎覆盖整个主屏（留 4px 容差）才视为全屏；最大化（含任务栏）不算。
  $full = ($fw -ge ($sw - 4)) -and ($fh -ge ($sh - 4))
  Write-Output $full.ToString().ToLower()
} catch {
  Write-Output 'false'
}`.trim();
  let encoded;
  try {
    encoded = Buffer.from(script, 'utf16le').toString('base64');
  } catch (e) {
    return cb(false);
  }
  execFile(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    { timeout: 3000 },
    (e, out) => {
      if (e) return cb(false);
      const v = (out || '').trim().toLowerCase();
      cb(v === 'true');
    }
  );
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