'use strict';
/**
 * 词库引擎
 * - 内置词库：data/builtin/*.json（只读）
 * - 自定义词库：userData/dicts/*.json（导入生成）
 * - 支持导入 JSON / JSONL(有道原始格式) / CSV / TXT
 *
 * 统一词条格式：
 *   { w, us, uk, t:[{p,c}], e, ec, ph:[{p,c}], m }
 */
const fs = require('fs');
const path = require('path');
const paths = require('./paths');

const cache = new Map(); // bookId -> book object

function safeReadJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

function slugify(name) {
  const base = String(name || 'custom')
    .replace(/\.[^.]+$/, '')
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '_')
    .slice(0, 32);
  return `u_${base}_${Date.now().toString(36)}`;
}

/* ------------------------------ 列表与加载 ------------------------------ */

function listBuiltin() {
  const idx = safeReadJSON(path.join(paths.builtinDict, 'index.json'));
  if (!idx || !Array.isArray(idx.books)) return [];
  return idx.books.map((b) => ({ ...b, builtin: true }));
}

function listCustom() {
  const dir = paths.customDictDir;
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch (e) {
    return [];
  }
  const out = [];
  for (const f of files) {
    const j = safeReadJSON(path.join(dir, f));
    if (j && j.id && Array.isArray(j.words)) {
      out.push({
        id: j.id,
        name: j.name || j.id,
        tag: j.tag || '自定义',
        count: j.words.length,
        builtin: false,
      });
    }
  }
  return out;
}

function listBooks() {
  return [...listBuiltin(), ...listCustom()];
}

function bookFile(id) {
  const b = path.join(paths.builtinDict, `${id}.json`);
  if (fs.existsSync(b)) return b;
  const c = path.join(paths.customDictDir, `${id}.json`);
  if (fs.existsSync(c)) return c;
  return null;
}

function loadBook(id) {
  if (cache.has(id)) return cache.get(id);
  const file = bookFile(id);
  if (!file) return null;
  const j = safeReadJSON(file);
  if (!j || !Array.isArray(j.words)) return null;
  cache.set(id, j);
  return j;
}

function clearCache(id) {
  if (id) cache.delete(id);
  else cache.clear();
}

/** 取一本可用的词库，activeBookId 失效时自动回退 */
function resolveBook(preferredId) {
  let b = preferredId ? loadBook(preferredId) : null;
  if (b) return b;
  const all = listBooks();
  for (const meta of all) {
    b = loadBook(meta.id);
    if (b) return b;
  }
  return null;
}

/* -------------------------------- 导入 -------------------------------- */

function normalizeEntry(raw) {
  if (!raw) return null;

  // 已是本项目精简格式
  if (raw.w && (raw.t || raw.trans)) {
    const t = Array.isArray(raw.t)
      ? raw.t
      : Array.isArray(raw.trans)
        ? raw.trans.map((x) => (typeof x === 'string' ? { p: '', c: x } : { p: x.p || x.pos || '', c: x.c || x.tranCn || '' }))
        : [];
    if (!t.length) return null;
    const e = { w: String(raw.w).trim(), t };
    if (raw.us) e.us = raw.us;
    if (raw.uk) e.uk = raw.uk;
    if (raw.e) e.e = raw.e;
    if (raw.ec) e.ec = raw.ec;
    if (Array.isArray(raw.ph)) e.ph = raw.ph;
    if (raw.m) e.m = raw.m;
    return e;
  }

  // 有道原始 JSONL 格式
  if (raw.headWord && raw.content && raw.content.word) {
    const c = raw.content.word.content || {};
    const t = (c.trans || [])
      .filter((x) => x.tranCn)
      .slice(0, 4)
      .map((x) => ({ p: (x.pos || '').trim(), c: x.tranCn.trim() }));
    if (!t.length) return null;
    const e = { w: String(raw.headWord).trim(), t };
    if (c.usphone) e.us = c.usphone;
    if (c.ukphone) e.uk = c.ukphone;
    const sents = (c.sentence && c.sentence.sentences) || [];
    if (sents[0]) {
      e.e = sents[0].sContent;
      if (sents[0].sCn) e.ec = sents[0].sCn;
    }
    const phrases = (c.phrase && c.phrase.phrases) || [];
    if (phrases.length) {
      e.ph = phrases.slice(0, 3).map((p) => ({ p: p.pContent, c: p.pCn })).filter((p) => p.p && p.c);
      if (!e.ph.length) delete e.ph;
    }
    if (c.remMethod && c.remMethod.val) e.m = c.remMethod.val.trim();
    return e;
  }

  // 通用扁平对象
  const w = raw.word || raw.headWord || raw.单词 || raw.英文;
  if (!w) return null;
  const meaning = raw.meaning || raw.trans || raw.tranCn || raw.释义 || raw.中文 || raw.翻译;
  if (!meaning) return null;
  const e = { w: String(w).trim(), t: [{ p: String(raw.pos || raw.词性 || '').trim(), c: String(meaning).trim() }] };
  const ph = raw.phonetic || raw.音标 || raw.usphone;
  if (ph) e.us = String(ph).replace(/^\/|\/$/g, '').trim();
  const s = raw.sentence || raw.example || raw.例句;
  if (s) e.e = String(s).trim();
  const sc = raw.sentenceCN || raw.例句翻译 || raw.例句中文;
  if (sc) e.ec = String(sc).trim();
  return e;
}

/** 极简 CSV 解析（支持引号包裹与转义） */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else if (ch !== '\r') cur += ch;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const CSV_ALIAS = {
  w: ['word', '单词', 'headword', '英文', 'en'],
  us: ['phonetic', '音标', 'usphone', '美式音标', 'phonetic_us'],
  uk: ['ukphone', '英式音标', 'phonetic_uk'],
  p: ['pos', '词性'],
  c: ['meaning', 'trans', '释义', '中文', '翻译', 'definition', 'cn'],
  e: ['sentence', 'example', '例句', '例句英文'],
  ec: ['sentencecn', '例句翻译', '例句中文', 'example_cn'],
};

function csvToEntries(text) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const map = {};
  let matched = 0;
  for (const [field, aliases] of Object.entries(CSV_ALIAS)) {
    const i = header.findIndex((h) => aliases.includes(h));
    if (i >= 0) {
      map[field] = i;
      matched++;
    }
  }
  // 没有表头 → 按 [单词, 释义, 音标, 例句, 例句翻译] 位置解析
  const body = matched >= 2 ? rows.slice(1) : rows;
  if (matched < 2) {
    Object.assign(map, { w: 0, c: 1, us: 2, e: 3, ec: 4 });
  }
  const out = [];
  for (const r of body) {
    const g = (k) => (map[k] !== undefined && r[map[k]] !== undefined ? String(r[map[k]]).trim() : '');
    const w = g('w');
    const c = g('c');
    if (!w || !c) continue;
    const e = { w, t: [{ p: g('p'), c }] };
    if (g('us')) e.us = g('us').replace(/^\/|\/$/g, '');
    if (g('uk')) e.uk = g('uk').replace(/^\/|\/$/g, '');
    if (g('e')) e.e = g('e');
    if (g('ec')) e.ec = g('ec');
    out.push(e);
  }
  return out;
}

function txtToEntries(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    // 支持 "word<TAB>释义" / "word  释义" / "word=释义" / 纯单词
    const m = s.match(/^([A-Za-z][A-Za-z'\-. ]*?)\s*(?:\t|=|\s{2,}|\s+(?=[\u4e00-\u9fa5]))\s*(.+)$/);
    if (m) out.push({ w: m[1].trim(), t: [{ p: '', c: m[2].trim() }] });
    else if (/^[A-Za-z][A-Za-z'\-. ]*$/.test(s)) out.push({ w: s, t: [{ p: '', c: '（无释义）' }] });
  }
  return out;
}

/**
 * 导入词库文件
 * @returns {{ok:boolean, id?:string, name?:string, count?:number, error?:string}}
 */
function importFromFile(filePath, customName) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return { ok: false, error: '文件读取失败：' + e.message };
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const ext = path.extname(filePath).toLowerCase();
  let entries = [];
  let srcName = path.basename(filePath, ext);

  try {
    if (ext === '.json' || ext === '.jsonl') {
      const trimmed = text.trim();
      let parsed = null;
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          parsed = JSON.parse(trimmed);
        } catch (e) {
          parsed = null;
        }
      }
      if (parsed) {
        if (Array.isArray(parsed)) entries = parsed.map(normalizeEntry).filter(Boolean);
        else if (Array.isArray(parsed.words)) {
          entries = parsed.words.map(normalizeEntry).filter(Boolean);
          if (parsed.name) srcName = parsed.name;
        }
      }
      // JSONL 逐行
      if (!entries.length) {
        for (const line of trimmed.split('\n')) {
          const l = line.trim();
          if (!l) continue;
          try {
            const o = normalizeEntry(JSON.parse(l));
            if (o) entries.push(o);
          } catch (e) {
            /* skip */
          }
        }
      }
    } else if (ext === '.csv' || ext === '.tsv') {
      entries = csvToEntries(ext === '.tsv' ? text.replace(/\t/g, ',') : text);
    } else {
      entries = txtToEntries(text);
    }
  } catch (e) {
    return { ok: false, error: '解析失败：' + e.message };
  }

  // 去重
  const seen = new Set();
  entries = entries.filter((e) => {
    const k = e.w.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (!entries.length) {
    return { ok: false, error: '未解析出有效词条。请确认文件包含「单词 + 释义」两列。' };
  }

  const name = (customName && customName.trim()) || srcName || '自定义词库';
  const id = slugify(name);
  const book = {
    id,
    name,
    tag: '自定义',
    builtin: false,
    source: path.basename(filePath),
    importedAt: new Date().toISOString(),
    count: entries.length,
    words: entries,
  };
  try {
    fs.writeFileSync(path.join(paths.customDictDir, `${id}.json`), JSON.stringify(book), 'utf8');
  } catch (e) {
    return { ok: false, error: '写入失败：' + e.message };
  }
  clearCache(id);
  return { ok: true, id, name, count: entries.length };
}

function deleteBook(id) {
  const f = path.join(paths.customDictDir, `${id}.json`);
  if (!fs.existsSync(f)) return { ok: false, error: '内置词库不可删除' };
  try {
    fs.unlinkSync(f);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  clearCache(id);
  return { ok: true };
}

module.exports = { listBooks, loadBook, resolveBook, importFromFile, deleteBook, clearCache, normalizeEntry };
