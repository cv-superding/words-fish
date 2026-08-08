'use strict';
/**
 * 单词流转：维护「当前单词」状态，串联词库、SRS、窗口广播
 */
const { config } = require('./config');
const dict = require('./dict');
const { records } = require('./records');
const wins = require('./windows');

const HISTORY_MAX = 50;

let history = [];
let cursor = -1; // history 中的位置
let currentBookId = null;

function getBook() {
  // 注意：这是“读取”路径，被 buildPayload / next / statsSnapshot 反复调用，
  // 不应在此写入配置（旧逻辑会在 activeBookId 失效时 config.update，触发广播，
  // 既引入副作用又有潜在回环风险）。resolveBook 在 id 失效时自动回退到可用词库，
  // 真正的纠错发生在用户显式切词库（dict:setActive）时。
  const want = config.get('study.activeBookId');
  const book = dict.resolveBook(want);
  currentBookId = book ? book.id : null;
  return book;
}

function buildPayload(word, source) {
  const book = getBook();
  if (!book || !word) return null;
  const rec = records.get(book.id, word.w) || { s: 'new', n: 0, m: false, due: 0, d: 0.3 };
  const prog = records.progress(book);
  const today = records.todayStats();
  const p = config.get('popup');

  return {
    word,
    rec: { status: rec.s, seen: rec.n, marked: !!rec.m, difficulty: rec.d, due: rec.due },
    book: { id: book.id, name: book.name, count: book.words.length },
    source: source || 'new',
    progress: {
      learned: prog.learned,
      known: prog.known,
      marked: prog.marked,
      due: prog.due,
      total: prog.total,
      todayLearned: today.learned || 0,
      todayExposed: today.exposed || 0,
      dailyGoal: config.get('study.dailyGoal', 30),
    },
    view: {
      theme: p.theme,
      opacity: p.opacity,
      fontSize: p.fontSize,
      width: p.width,
      showPhonetic: p.showPhonetic,
      showSentence: p.showSentence,
      showPhrase: p.showPhrase,
      showProgress: p.showProgress,
      meaningHidden: p.meaningHidden,
      pinned: p.pinned,
    },
    gestures: config.get('gestures'),
    ts: Date.now(),
  };
}

function current() {
  if (cursor < 0 || cursor >= history.length) return null;
  return history[cursor];
}

function currentPayload() {
  const c = current();
  if (!c) return null;
  return buildPayload(c.word, c.source);
}

/** 抽取下一个单词（前进；若有前进历史则复用） */
function next({ countExposure = true } = {}) {
  const book = getBook();
  if (!book) return null;

  // 若曾经后退过，先沿历史前进
  if (cursor >= 0 && cursor < history.length - 1) {
    cursor++;
    return buildPayload(history[cursor].word, history[cursor].source);
  }

  const excl = current() ? current().word.w : null;
  const picked = records.pick(book, {
    newWordRatio: config.get('study.newWordRatio', 0.6),
    priorityMarked: config.get('study.priorityMarked', true),
    reviewEnabled: config.get('study.reviewEnabled', true),
    exclude: excl,
  });
  if (!picked) return null;

  if (countExposure) records.markExposed(book.id, picked.word.w);

  history.push({ word: picked.word, source: picked.source, bookId: book.id });
  if (history.length > HISTORY_MAX) history.shift();
  cursor = history.length - 1;

  return buildPayload(picked.word, picked.source);
}

function prev() {
  if (cursor <= 0) return currentPayload();
  cursor--;
  return buildPayload(history[cursor].word, history[cursor].source);
}

function resetHistory() {
  history = [];
  cursor = -1;
}

/* ------------------------------ 动作 ------------------------------ */

function markUnknown() {
  const c = current();
  if (!c) return null;
  records.setMarked(c.bookId, c.word.w, true);
  return buildPayload(c.word, c.source);
}

function markKnown() {
  const c = current();
  if (!c) return null;
  records.setKnown(c.bookId, c.word.w);
  records.review(c.bookId, c.word.w, 1);
  return buildPayload(c.word, c.source);
}

/** 用户在气泡/悬浮窗上给出记忆反馈：0..1 */
function rate(performance) {
  const c = current();
  if (!c) return null;
  records.review(c.bookId, c.word.w, performance);
  if (performance < 0.6) records.setMarked(c.bookId, c.word.w, true);
  return buildPayload(c.word, c.source);
}

/* ------------------------------ 广播 ------------------------------ */

function pushToPopup(payload) {
  if (!payload) return;
  wins.send('popup', 'word:update', payload);
}

function pushToBubble(payload) {
  if (!payload) return;
  wins.send('bubble', 'word:update', payload);
}

function broadcastState() {
  const p = currentPayload();
  if (p) {
    pushToPopup(p);
    pushToBubble(p);
  }
  wins.send('settings', 'stats:update', statsSnapshot());
}

function statsSnapshot() {
  const book = getBook();
  return {
    book: book ? { id: book.id, name: book.name, count: book.words.length } : null,
    progress: book ? records.progress(book) : null,
    today: records.todayStats(),
    recent: records.recentDays(14),
    totals: records.stats.totals,
  };
}

module.exports = {
  getBook,
  current,
  currentPayload,
  buildPayload,
  next,
  prev,
  resetHistory,
  markUnknown,
  markKnown,
  rate,
  pushToPopup,
  pushToBubble,
  broadcastState,
  statsSnapshot,
};
