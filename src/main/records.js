'use strict';
/**
 * 学习记录 + SM2+ 间隔重复 + 选词策略
 *
 * 设计要点：词库（只读）与学习记录（可写）完全分离，
 * 记录以 `bookId::word` 为键，换词库 / 更新词库都不会丢失进度。
 *
 * 记录字段（缩写以压缩体积）：
 *   s   status: new | learning | known
 *   d   difficulty 0..1（SM2+ 连续难度）
 *   i   intervalDays 复习间隔（天，可为小数）
 *   r   lastReviewedAt (ms)
 *   due nextDueAt (ms)
 *   n   曝光次数
 *   k   判定“记得”的次数
 *   m   是否被标记为生词
 *   f   首次出现时间 (ms)
 */
const fs = require('fs');
const paths = require('./paths');

const DAY = 86400000;
const MIN_INTERVAL_DAYS = 10 / 1440; // 10 分钟：允许同一摸鱼时段内复现
const MAX_INTERVAL_DAYS = 365;

function todayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

class Records {
  constructor() {
    this.map = {}; // key -> record
    this.stats = { days: {}, totals: { learned: 0, reviewed: 0, marked: 0, exposed: 0 } };
    this._t1 = null;
    this._t2 = null;
  }

  load() {
    try {
      if (fs.existsSync(paths.recordsFile)) {
        const j = JSON.parse(fs.readFileSync(paths.recordsFile, 'utf8'));
        if (j && typeof j === 'object') this.map = j.records || j;
      }
    } catch (e) {
      console.error('[records] 读取失败:', e.message);
      this.map = {};
    }
    try {
      if (fs.existsSync(paths.statsFile)) {
        const j = JSON.parse(fs.readFileSync(paths.statsFile, 'utf8'));
        if (j && j.days) this.stats = j;
      }
    } catch (e) {
      /* ignore */
    }
  }

  saveRecordsDebounced() {
    clearTimeout(this._t1);
    this._t1 = setTimeout(() => {
      try {
        paths.ensureDir(paths.userData);
        fs.writeFileSync(paths.recordsFile, JSON.stringify({ v: 1, records: this.map }), 'utf8');
      } catch (e) {
        console.error('[records] 保存失败:', e.message);
      }
    }, 800);
  }

  saveStatsDebounced() {
    clearTimeout(this._t2);
    this._t2 = setTimeout(() => {
      try {
        paths.ensureDir(paths.userData);
        fs.writeFileSync(paths.statsFile, JSON.stringify(this.stats), 'utf8');
      } catch (e) {
        /* ignore */
      }
    }, 800);
  }

  flush() {
    clearTimeout(this._t1);
    clearTimeout(this._t2);
    try {
      fs.writeFileSync(paths.recordsFile, JSON.stringify({ v: 1, records: this.map }), 'utf8');
      fs.writeFileSync(paths.statsFile, JSON.stringify(this.stats), 'utf8');
    } catch (e) {
      /* ignore */
    }
  }

  key(bookId, word) {
    return `${bookId}::${word}`;
  }

  get(bookId, word) {
    return this.map[this.key(bookId, word)] || null;
  }

  ensure(bookId, word) {
    const k = this.key(bookId, word);
    if (!this.map[k]) {
      this.map[k] = { s: 'new', d: 0.3, i: 0, r: 0, due: 0, n: 0, k: 0, m: false, f: Date.now() };
    }
    return this.map[k];
  }

  bump(name, delta = 1) {
    const t = todayKey();
    if (!this.stats.days[t]) this.stats.days[t] = { learned: 0, reviewed: 0, marked: 0, exposed: 0 };
    this.stats.days[t][name] = (this.stats.days[t][name] || 0) + delta;
    if (this.stats.totals[name] !== undefined) this.stats.totals[name] += delta;
    this.saveStatsDebounced();
  }

  /** 单词被展示了一次 */
  markExposed(bookId, word) {
    const rec = this.ensure(bookId, word);
    const isFirst = rec.n === 0;
    rec.n++;
    if (isFirst) {
      rec.s = 'learning';
      this.bump('learned');
    }
    this.bump('exposed');
    this.saveRecordsDebounced();
    return rec;
  }

  /**
   * SM2+ 复习评分
   * @param {number} performance 0..1，0=完全不记得，1=秒答
   */
  review(bookId, word, performance) {
    const rec = this.ensure(bookId, word);
    const now = Date.now();
    const correct = performance >= 0.6;

    const daysSince = rec.r ? (now - rec.r) / DAY : 0;
    const prevInterval = rec.i > 0 ? rec.i : MIN_INTERVAL_DAYS;
    // 期望间隔 vs 实际间隔的比例（>1 表示超期复习，<1 表示提前复习）
    const expectedRatio = prevInterval > 0 ? daysSince / prevInterval : 1;
    const overdue = clamp(expectedRatio, 0, 3);

    // ---- 难度更新（SM2+ 连续难度 d∈[0,1]，0=极易，1=极难）----
    // 关键：答对永远降低难度；答错永远升高难度。
    // 超期仍答对（记了很久还能想起）→ 更熟，额外降难度；超期却答错 → 更陌生，额外升难度。
    let delta;
    if (correct) {
      delta = -(0.18 * (0.6 + 0.4 * performance));   // 永远为负 → 难度下降
      if (overdue > 1.5) delta -= 0.06;              // 超期仍答对 → 更熟
    } else {
      delta = 0.18 * (1 - performance) + 0.10;       // 永远为正 → 难度上升
      if (overdue > 1.5) delta += 0.04;              // 超期且答错 → 更陌生
    }
    rec.d = clamp(rec.d + delta, 0, 1);

    // ---- 间隔更新（EF 由难度派生：d=0→EF=2.5 易记，d=1→EF=1.3 难记）----
    const EF = clamp(2.5 - 1.2 * rec.d, 1.3, 2.6);
    if (correct) {
      const overdueBoost = clamp(expectedRatio, 0, 2.5);
      // 答对：间隔 ≈ 上次间隔 × EF，超期答对再小幅放大（说明很熟）
      rec.i = clamp(prevInterval * EF * (1 + 0.15 * overdueBoost), MIN_INTERVAL_DAYS, MAX_INTERVAL_DAYS);
      rec.k++;
    } else {
      // 答错：间隔显著缩短（EF 越小缩短越狠）
      rec.i = clamp(prevInterval * (1 / (EF * EF)), MIN_INTERVAL_DAYS, MAX_INTERVAL_DAYS);
    }

    rec.r = now;
    rec.due = now + rec.i * DAY;

    // 连续 3 次记得且间隔超过 21 天 → 视为已掌握
    if (correct && rec.k >= 3 && rec.i >= 21) rec.s = 'known';
    else if (rec.s === 'known' && !correct) rec.s = 'learning';
    else if (rec.s === 'new') rec.s = 'learning';

    if (correct) rec.m = false; // 记住了就摘掉生词标记

    this.bump('reviewed');
    this.saveRecordsDebounced();
    return rec;
  }

  setMarked(bookId, word, marked) {
    const rec = this.ensure(bookId, word);
    if (marked && !rec.m) this.bump('marked');
    rec.m = !!marked;
    if (marked) {
      rec.s = 'learning';
      rec.i = MIN_INTERVAL_DAYS;
      rec.due = Date.now() + MIN_INTERVAL_DAYS * DAY;
      rec.d = clamp(rec.d + 0.15, 0, 1);
    }
    this.saveRecordsDebounced();
    return rec;
  }

  setKnown(bookId, word) {
    const rec = this.ensure(bookId, word);
    rec.s = 'known';
    rec.m = false;
    rec.k = Math.max(rec.k, 3);
    rec.i = Math.max(rec.i, 30);
    rec.r = Date.now();
    rec.due = Date.now() + rec.i * DAY;
    this.saveRecordsDebounced();
    return rec;
  }

  resetBook(bookId) {
    const prefix = `${bookId}::`;
    let n = 0;
    for (const k of Object.keys(this.map)) {
      if (k.startsWith(prefix)) {
        delete this.map[k];
        n++;
      }
    }
    this.saveRecordsDebounced();
    return n;
  }

  /* ---------------------------- 选词策略 ---------------------------- */

  /**
   * @param {object} book  词库对象
   * @param {object} opts  { newWordRatio, priorityMarked, reviewEnabled, exclude }
   */
  pick(book, opts = {}) {
    const words = book.words;
    if (!words || !words.length) return null;
    const bookId = book.id;
    const now = Date.now();
    const exclude = opts.exclude || null;
    const newRatio = opts.newWordRatio ?? 0.6;

    const due = [];
    const marked = [];
    const fresh = [];

    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (exclude && w.w === exclude) continue;
      const rec = this.map[`${bookId}::${w.w}`];
      // 生词标记优先：即使从未曝光（n=0）也视为生词优先复习
      if (rec && rec.m) {
        marked.push(i);
      } else if (!rec || rec.n === 0) {
        fresh.push(i);
      } else if (rec.s === 'known' && rec.due > now) {
        continue;
      } else if (rec.due <= now) {
        due.push(i);
      }
    }

    const pool = [];
    // 生词优先
    if (opts.priorityMarked !== false && marked.length) pool.push({ list: marked, weight: 0.35, source: 'marked' });
    if (opts.reviewEnabled !== false && due.length) pool.push({ list: due, weight: (1 - newRatio) * (marked.length ? 0.65 : 1), source: 'due' });
    if (fresh.length) pool.push({ list: fresh, weight: newRatio, source: 'new' });

    if (!pool.length) {
      // 全部已掌握且未到期 → 随机复现一个，避免无词可推
      const i = Math.floor(Math.random() * words.length);
      return { word: words[i], index: i, source: 'random' };
    }

    const total = pool.reduce((s, p) => s + p.weight, 0);
    let r = Math.random() * total;
    let chosen = pool[pool.length - 1];
    for (const p of pool) {
      if (r < p.weight) {
        chosen = p;
        break;
      }
      r -= p.weight;
    }
    const list = chosen.list;
    const idx = list[Math.floor(Math.random() * list.length)];
    // 用显式 source 标记判定来源，避免依赖 pool 中 list 与 fresh/marked/due 的引用相等（脆弱）。
    const source = chosen.source || 'random';
    return { word: words[idx], index: idx, source };
  }

  /** 某本词库的进度概览 */
  progress(book) {
    if (!book) return { total: 0, learned: 0, known: 0, marked: 0, due: 0 };
    const bookId = book.id;
    const now = Date.now();
    let learned = 0;
    let known = 0;
    let marked = 0;
    let dueCount = 0;
    for (const w of book.words) {
      const rec = this.map[`${bookId}::${w.w}`];
      if (!rec || rec.n === 0) continue;
      learned++;
      if (rec.s === 'known') known++;
      if (rec.m) marked++;
      if (rec.due <= now && rec.s !== 'known') dueCount++;
    }
    return { total: book.words.length, learned, known, marked, due: dueCount };
  }

  /** 生词本 */
  markedList(book, limit = 500) {
    if (!book) return [];
    const out = [];
    for (const w of book.words) {
      const rec = this.map[`${book.id}::${w.w}`];
      if (rec && rec.m) {
        out.push({ w: w.w, t: w.t, us: w.us, n: rec.n, due: rec.due, d: rec.d });
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  todayStats() {
    return this.stats.days[todayKey()] || { learned: 0, reviewed: 0, marked: 0, exposed: 0 };
  }

  recentDays(n = 14) {
    const out = [];
    const d = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const dd = new Date(d.getTime() - i * DAY);
      const k = todayKey(dd);
      out.push({ date: k, ...(this.stats.days[k] || { learned: 0, reviewed: 0, marked: 0, exposed: 0 }) });
    }
    return out;
  }
}

module.exports = { records: new Records(), todayKey };
