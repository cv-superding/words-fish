/**
 * 渲染层集成测试（无 Electron，仅 jsdom 模拟 DOM + 假 IPC）
 * 验证：popup / bubble / settings 三个渲染页都能完成初始化与首次渲染
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, ResourceLoader } = require('jsdom');

const HERE = __dirname.replace(/\\/g, '/');
const ROOT = HERE.replace('/tests', '');

class LocalLoader extends ResourceLoader {}

async function setupMockIpc(winName) {
  const handlers = {
    popup: {
      'study:word': () => mockPayload(),
      'win:resizePopup': () => true,
      'win:savePosition': () => true,
      'win:hidePopup': () => true,
      'win:alwaysOnTop': () => true,
      'gesture:fire': () => ({ handled: true, action: 'toggleMeaning' }),
    },
    bubble: {
      'win:resizeBubble': () => true,
      'win:hideBubble': () => true,
      'win:holdBubble': () => true,
      'win:showPopup': () => true,
      'study:rate': () => true,
      'study:markUnknown': () => true,
      'study:markKnown': () => true,
      'study:word': () => mockPayload(),
    },
    settings: {
      'config:get': () => require(path.join(ROOT, 'src/main/config')).DEFAULTS,
      'config:constants': () => require(path.join(ROOT, 'src/main/constants')),
      'dict:list': () => [
        { id: 'cet4', name: '四级核心词汇', tag: 'CET-4', count: 1162, builtin: true },
        { id: 'cet6', name: '六级核心词汇', tag: 'CET-6', count: 1228, builtin: true },
        { id: 'kaoyan', name: '考研核心词汇', tag: '考研', count: 1341, builtin: true },
        { id: 'ielts', name: '雅思核心词汇', tag: 'IELTS', count: 3427, builtin: true },
      ],
      'app:version': () => '1.0.0-test',
      'app:getAutoLaunch': () => false,
      'app:setAutoLaunch': () => true,
      'win:openDataDir': () => true,
      'win:minimize': () => true,
      'win:close': () => true,
      'win:open': () => true,
      'win:showPopup': () => true,
      'win:togglePopup': () => true,
      'notify:status': () => ({ paused: false, suppressed: 0, nextAt: Date.now() + 600000, shouldFire: true }),
      'notify:pause': () => ({ paused: false }),
      'notify:resume': () => ({ paused: false }),
      'notify:push': () => true,
      'study:stats': () => ({
        book: { id: 'cet4', name: '四级核心词汇', count: 1162 },
        progress: { total: 1162, learned: 0, known: 0, marked: 0, due: 0 },
        today: { learned: 0, reviewed: 0, marked: 0, exposed: 0 },
        recent: [],
        totals: { learned: 0, reviewed: 0, marked: 0 },
      }),
      'study:marked': () => [],
      'study:reset': () => ({ ok: true, cleared: 0 }),
      'dict:setActive': () => true,
      'dict:delete': () => ({ ok: true }),
      'dict:load': () => ({ id: 'cet4', name: '四级', count: 1162, builtin: true }),
      'dict:import': () => ({ canceled: true }),
      'study:word': () => mockPayload(),
      'study:markUnknown': () => true,
      'study:markKnown': () => true,
      'study:rate': () => true,
      'config:update': (_e, patch) => {
        const cfg = JSON.parse(JSON.stringify(require(path.join(ROOT, 'src/main/config')).DEFAULTS));
        function merge(a, b) {
          for (const k of Object.keys(b)) {
            if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) {
              a[k] = a[k] || {}; merge(a[k], b[k]);
            } else a[k] = b[k];
          }
        }
        merge(cfg, patch);
        return cfg;
      },
      'config:reset': () => require(path.join(ROOT, 'src/main/config')).DEFAULTS,
    },
  };
  return handlers[winName];
}

function mockPayload() {
  return {
    word: {
      w: 'subsequent',
      us: "'sʌbsɪkwənt",
      uk: "'sʌbsɪkwənt",
      t: [{ p: 'adj', c: '随后的；后来的' }],
      e: 'The subsequent events shocked everyone.',
      ec: '随后发生的事件震惊了所有人。',
    },
    rec: { status: 'learning', seen: 1, marked: false, difficulty: 0.3, due: 0 },
    book: { id: 'cet4', name: '四级核心词汇', count: 1162 },
    source: 'new',
    progress: { learned: 1, known: 0, marked: 0, due: 0, total: 1162, todayLearned: 1, todayExposed: 1, dailyGoal: 30 },
    view: { theme: 'light', opacity: 0.96, fontSize: 15, width: 380, showPhonetic: true, showSentence: true, showPhrase: false, showProgress: true, meaningHidden: false, pinned: false },
    gestures: { click: 'toggleMeaning', dblclick: 'close', rightclick: 'markUnknown', middleclick: 'toggleMeaning', wheelUp: 'prevWord', wheelDown: 'nextWord', longpress: 'openSettings' },
    ts: Date.now(),
  };
}

async function testWindow(winName) {
  const dir = path.join(ROOT, 'src', 'renderer', winName);
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'file:///' + dir.replace(/\\/g, '/') + '/index.html',
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(window) {
      const handlers = setupMockIpc(winName);
      window.wfPopup = winName === 'popup' ? makePopupApi(handlers) : undefined;
      window.wfBubble = winName === 'bubble' ? makeBubbleApi(handlers) : undefined;
      window.wfSettings = winName === 'settings' ? makeSettingsApi(handlers) : undefined;
      window.speechSynthesis = { cancel() {}, speak() {} };
    },
  });
  await new Promise((r) => setTimeout(r, 350));
  return dom;
}

function makePopupApi(h) {
  return {
    current: () => Promise.resolve(h['study:word']()),
    next: () => Promise.resolve(h['study:word']()),
    prev: () => Promise.resolve(h['study:word']()),
    rate: (p) => Promise.resolve(h['study:rate'](null, p)),
    markUnknown: () => Promise.resolve(h['study:markUnknown']()),
    markKnown: () => Promise.resolve(h['study:markKnown']()),
    resize: (w, hh) => h['win:resizePopup'](null, w, hh),
    fireGesture: (g) => Promise.resolve(h['gesture:fire'](null, g)),
    savePosition: () => Promise.resolve(true),
    close: () => Promise.resolve(true),
    alwaysOnTop: () => Promise.resolve(true),
    speak: () => {},
    onWord: (fn) => { setTimeout(() => fn(h['study:word']()), 50); return () => {}; },
    onGesture: () => () => {},
    onConfig: () => () => {},
    onStats: () => () => {},
  };
}
function makeBubbleApi(h) {
  return {
    resize: () => Promise.resolve(true),
    close: () => Promise.resolve(true),
    hold: () => Promise.resolve(true),
    rate: () => Promise.resolve(true),
    markUnknown: () => Promise.resolve(true),
    markKnown: () => Promise.resolve(true),
    next: () => Promise.resolve(true),
    showPopup: () => Promise.resolve(true),
    onWord: (fn) => { setTimeout(() => fn(h['study:word']()), 50); return () => {}; },
    onFadeOut: () => () => {},
    onGesture: () => () => {},
  };
}
function makeSettingsApi(h) {
  return {
    config: {
      get: () => Promise.resolve(h['config:get']()),
      update: (patch, meta) => Promise.resolve(h['config:update'](null, patch, meta)),
      reset: (s) => Promise.resolve(h['config:reset'](null, s)),
      constants: () => Promise.resolve(h['config:constants']()),
    },
    dict: {
      list: () => Promise.resolve(h['dict:list']()),
      load: (id) => Promise.resolve(h['dict:load'](null, id)),
      setActive: (id) => Promise.resolve(h['dict:setActive'](null, id)),
      import: () => Promise.resolve(h['dict:import']()),
      delete: (id) => Promise.resolve(h['dict:delete'](null, id)),
    },
    study: {
      current: () => Promise.resolve(h['study:word']()),
      next: () => Promise.resolve(h['study:word']()),
      rate: () => Promise.resolve(true),
      markUnknown: () => Promise.resolve(true),
      markKnown: () => Promise.resolve(true),
      stats: () => Promise.resolve(h['study:stats']()),
      marked: () => Promise.resolve(h['study:marked']()),
      reset: () => Promise.resolve(h['study:reset']()),
    },
    notify: {
      push: () => Promise.resolve(true),
      pause: () => Promise.resolve({ paused: false }),
      resume: () => Promise.resolve({ paused: false }),
      status: () => Promise.resolve(h['notify:status']()),
    },
    win: {
      open: () => Promise.resolve(true),
      close: () => Promise.resolve(true),
      minimize: () => Promise.resolve(true),
      alwaysOnTop: () => Promise.resolve(true),
      showPopup: () => Promise.resolve(true),
      togglePopup: () => Promise.resolve(true),
      openDataDir: () => Promise.resolve(true),
    },
    app: {
      version: () => Promise.resolve('1.0.0-test'),
      getAutoLaunch: () => Promise.resolve(false),
      setAutoLaunch: () => Promise.resolve(true),
      platform: 'win32',
    },
    onConfigChanged: () => () => {},
    onStats: () => () => {},
    onGoto: () => () => {},
    onNotifyPushed: () => () => {},
    onNotifyResponse: () => () => {},
  };
}

(async () => {
  const results = {};
  for (const w of ['popup', 'bubble', 'settings']) {
    try {
      const dom = await testWindow(w);
      const doc = dom.window.document;
      const summary = {};
      if (w === 'popup') {
        summary.word = (doc.querySelector('.word')?.textContent || '').trim();
        summary.phonetic = (doc.querySelector('.phonetic')?.textContent || '').trim();
        summary.trans = (doc.querySelector('.trans .c')?.textContent || '').trim();
        summary.progress = (doc.querySelector('#progress')?.textContent || '').trim();
      }
      if (w === 'bubble') {
        summary.word = (doc.querySelector('.word')?.textContent || '').trim();
        summary.phonetic = (doc.querySelector('.phonetic')?.textContent || '').trim();
      }
      if (w === 'settings') {
        summary.pages = doc.querySelectorAll('.page').length;
        summary.books = doc.querySelectorAll('.book-item').length;
        summary.themes = doc.querySelectorAll('.theme-card').length;
        summary.hotkeys = doc.querySelectorAll('.hotkey-item').length;
        summary.gestures = doc.querySelectorAll('.gesture-item').length;
        summary.statCards = doc.querySelectorAll('.stat-card').length;
      }
      console.log(`[${w}] OK`, summary);
      results[w] = summary;
    } catch (e) {
      console.log(`[${w}] FAIL`, e.message);
      console.log(e.stack);
      results[w] = { error: e.message };
    }
  }
  console.log('\n=== 总结 ===');
  console.log(JSON.stringify(results, null, 2));
})();