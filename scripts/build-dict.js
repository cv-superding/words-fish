/**
 * 词库转换脚本
 * 输入：kajweb/dict 的有道 JSONL 原始词库
 * 输出：words-fish 精简词库格式（data/builtin/*.json）
 *
 * 精简后的词条字段（尽量短，减小体积）：
 *   w  headWord      单词
 *   us usphone       美式音标
 *   uk ukphone       英式音标
 *   t  [{p,c}]       释义列表 pos + 中文
 *   e  sentence      例句英文
 *   ec sentenceCN    例句中文
 *   ph [{p,c}]       常用短语（最多 3 条）
 *   m  remMethod     助记法（可选）
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '.tmp', 'dict');
const OUT = path.join(__dirname, '..', 'data', 'builtin');

const BOOKS = [
  { file: 'CET4_1.json', id: 'cet4', name: '四级核心词汇', tag: 'CET-4' },
  { file: 'CET6_1.json', id: 'cet6', name: '六级核心词汇', tag: 'CET-6' },
  { file: 'KaoYan_1.json', id: 'kaoyan', name: '考研核心词汇', tag: '考研' },
  { file: 'IELTS_2.json', id: 'ielts', name: '雅思核心词汇', tag: 'IELTS' },
];

function pickSentence(c) {
  const list = (c.sentence && c.sentence.sentences) || [];
  for (const s of list) {
    if (s.sContent && s.sCn && s.sContent.length <= 120) {
      return { e: s.sContent.trim(), ec: s.sCn.trim() };
    }
  }
  if (list[0] && list[0].sContent) {
    return { e: list[0].sContent.trim(), ec: (list[0].sCn || '').trim() };
  }
  return null;
}

function convert(book) {
  const src = path.join(SRC, book.file);
  if (!fs.existsSync(src)) {
    console.warn(`  跳过（源文件不存在）: ${book.file}`);
    return null;
  }
  const lines = fs.readFileSync(src, 'utf8').split('\n');
  const words = [];
  const seen = new Set();

  for (const line of lines) {
    const raw = line.trim();
    if (!raw) continue;
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch (e) {
      continue;
    }
    const head = obj.headWord;
    if (!head || seen.has(head)) continue;

    const c =
      obj.content && obj.content.word && obj.content.word.content
        ? obj.content.word.content
        : null;
    if (!c) continue;

    // 释义：必须有中文释义才收录
    const trans = (c.trans || [])
      .filter((t) => t.tranCn)
      .slice(0, 4)
      .map((t) => ({ p: (t.pos || '').trim(), c: t.tranCn.trim() }));
    if (!trans.length) continue;

    const item = { w: head };
    if (c.usphone) item.us = c.usphone.trim();
    if (c.ukphone) item.uk = c.ukphone.trim();
    item.t = trans;

    const sent = pickSentence(c);
    if (sent) {
      item.e = sent.e;
      if (sent.ec) item.ec = sent.ec;
    }

    const phrases = (c.phrase && c.phrase.phrases) || [];
    if (phrases.length) {
      item.ph = phrases
        .slice(0, 3)
        .map((p) => ({ p: (p.pContent || '').trim(), c: (p.pCn || '').trim() }))
        .filter((p) => p.p && p.c);
      if (!item.ph.length) delete item.ph;
    }

    if (c.remMethod && c.remMethod.val) {
      const m = c.remMethod.val.trim();
      if (m && m.length <= 80) item.m = m;
    }

    seen.add(head);
    words.push(item);
  }

  const out = {
    id: book.id,
    name: book.name,
    tag: book.tag,
    builtin: true,
    source: 'kajweb/dict (有道词库)',
    count: words.length,
    words,
  };
  const dst = path.join(OUT, `${book.id}.json`);
  fs.writeFileSync(dst, JSON.stringify(out), 'utf8');
  const kb = Math.round(fs.statSync(dst).size / 1024);
  console.log(`  ${book.name.padEnd(8)} -> ${book.id}.json  ${String(words.length).padStart(5)} 词  ${kb}KB`);
  return { id: book.id, name: book.name, tag: book.tag, count: words.length, builtin: true };
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  console.log('开始转换词库...');
  const index = [];
  for (const b of BOOKS) {
    const r = convert(b);
    if (r) index.push(r);
  }
  fs.writeFileSync(
    path.join(OUT, 'index.json'),
    JSON.stringify({ books: index }, null, 2),
    'utf8'
  );
  console.log(`完成，共 ${index.length} 本词库。`);
}

main();
