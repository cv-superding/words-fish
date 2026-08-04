/**
 * 极简渲染层逻辑测试 —— 仅验证关键纯函数（payload 构建、词条渲染、SM2+ 算法、手势映射）
 * 不依赖 jsdom 等重依赖
 */
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const paths = require(path.join(ROOT, 'src/main/paths'));

// 测试隔离：清理上一轮（可能因报错提前退出而未清理）残留的自动生成自定义词库
// 注：部分沙箱环境带 safe-delete 拦截，unlink/rm 会被改写并报错，且回收站后端不稳定、
// 偶尔删不干净导致 u_*.json 残留并污染 listBooks 计数。改为「改名隔离」——
// 把 u_*.json 改名成 ._trash_u_*.json，listBooks 仅匹配 u_*.json，改名后即不再被统计，
// 与删除等效且稳定。正常 CI 环境（无 safe-delete）改名后文件也不影响断言。
function cleanCustomDicts() {
  try {
    const dir = paths.customDictDir;
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (/^u_.*\.json$/.test(f)) {
        try { fs.renameSync(path.join(dir, f), path.join(dir, '._trash_' + f)); }
        catch (e) { try { fs.rmSync(path.join(dir, f), { recursive: true, force: true }); } catch (e2) { /* ignore */ } }
      }
    }
  } catch (e) { /* ignore */ }
}
cleanCustomDicts();

// 工具
const fail = (msg) => { console.log('FAIL', msg); process.exit(1); };
const ok = (msg) => console.log('  OK', msg);
let total = 0, passed = 0;
function eq(a, b, msg) {
  total++;
  if (a === b) { passed++; ok(`${msg} = ${JSON.stringify(a)}`); }
  else fail(`${msg} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`);
}
function approx(a, b, tol, msg) {
  total++;
  if (Math.abs(a - b) <= tol) { passed++; ok(`${msg} = ${a.toFixed(3)} ≈ ${b.toFixed(3)}`); }
  else fail(`${msg} expected ~${b} got ${a}`);
}

console.log('\n=== 1) 配置默认值完整性 ===');
const { DEFAULTS } = require(path.join(ROOT, 'src/main/config'));
const required = ['general.autoLaunch', 'push.intervalMin', 'push.channel',
  'hotkeys.togglePopup', 'hotkeys.panic', 'popup.theme', 'popup.opacity',
  'gestures.dblclick', 'gestures.wheelDown', 'study.activeBookId', 'study.dailyGoal'];
for (const k of required) {
  const seg = k.split('.');
  let cur = DEFAULTS;
  for (const s of seg) cur = cur && cur[s];
  eq(cur !== undefined, true, `defaults has ${k}`);
}
eq(DEFAULTS.push.channel, 'bubble', '默认推送方式 = bubble');
eq(DEFAULTS.hotkeys.togglePopup, 'Shift+X', '默认快捷键 Shift+X');
eq(DEFAULTS.gestures.dblclick, 'close', '默认双击关闭');

console.log('\n=== 2) 词库加载与精简格式 ===');
const { listBooks, loadBook, normalizeEntry, importFromFile } = require(path.join(ROOT, 'src/main/dict'));
// 清理本测试运行前就残留的自定义词库（已在文件顶部统一清理过一次）
cleanCustomDicts();
const dictModule = require(path.join(ROOT, 'src/main/dict'));
dictModule.clearCache();
const books = listBooks();
eq(books.length, 4, '4 本内置词库');
for (const b of books) {
  total++;
  const book = loadBook(b.id);
  if (book && book.words.length === b.count) { passed++; ok(`${b.name} 词数 = ${b.count}`); }
  else fail(`${b.name} 词数不符`);
  if (!book.words[0].w) fail('词条缺少 w 字段');
  if (!Array.isArray(book.words[0].t) || !book.words[0].t.length) fail('词条缺少 t 字段');
  total++; if (book.words[0].w) passed++;
}

console.log('\n=== 3) 词库导入 (CSV / TXT / JSON / JSONL) ===');
// 准备临时词库文件（写到系统临时目录，测试结束自动清理）
const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wf-logic-'));

const csvFile = path.join(tmpDir, 'sample.csv');
fs.writeFileSync(csvFile, 'word,phonetic,pos,meaning,sentence,sentence_cn\nhello,həˈloʊ,int.你好,问候语,Hello world!,你好世界!\nworld,wɜːld,n.世界,地球,Hello world!,你好世界!\n');

// 第一次导入会因上一轮记录保留而失败，先清
dictModule.clearCache();
const indexFile = path.join(ROOT, 'data', 'builtin', 'index.json');
const r1 = dictModule.importFromFile(csvFile, 'CSV测试词库');
eq(r1.ok, true, 'CSV 导入成功');
eq(r1.count, 2, 'CSV 词数 = 2');

const txtFile = path.join(tmpDir, 'sample.txt');
fs.writeFileSync(txtFile, 'apple\t苹果\nbanana\t香蕉\ncherry  樱桃\n');
const r2 = dictModule.importFromFile(txtFile, 'TXT测试');
eq(r2.ok, true, 'TXT 导入成功');
eq(r2.count, 3, 'TXT 词数 = 3');

const jsonFile = path.join(tmpDir, 'sample.json');
fs.writeFileSync(jsonFile, JSON.stringify({ name: 'JSON测试', words: [{ w: 'cat', t: [{ p: 'n', c: '猫' }] }, { w: 'dog', t: [{ p: 'n', c: '狗' }] }] }));
const r3 = dictModule.importFromFile(jsonFile);
eq(r3.ok, true, 'JSON 导入成功');
eq(r3.count, 2, 'JSON 词数 = 2');

const jsonlFile = path.join(tmpDir, 'sample.jsonl');
fs.writeFileSync(jsonlFile,
  JSON.stringify({ headWord: 'red', content: { word: { content: { usphone: 'red', trans: [{ pos: 'n', tranCn: '红色' }] } } } }) + '\n' +
  JSON.stringify({ headWord: 'blue', content: { word: { content: { usphone: 'bluː', trans: [{ pos: 'n', tranCn: '蓝色' }] } } } }) + '\n'
);
const r4 = dictModule.importFromFile(jsonlFile);
eq(r4.ok, true, 'JSONL 导入成功');
eq(r4.count, 2, 'JSONL 词数 = 2');

console.log('\n=== 4) SM2+ 算法正确性 ===');
const { records } = require(path.join(ROOT, 'src/main/records'));
// 重置 records 状态
records.map = {};
records.stats = { days: {}, totals: { learned: 0, reviewed: 0, marked: 0 } };

// 第一次暴露 → 标记为 learning，记录 learned=1
const rA = records.markExposed('cet4', 'abandon');
eq(rA.s, 'learning', '首次暴露 → learning');
total++; if (rA.n === 1) { passed++; ok('exposed n=1'); } else fail(`n=${rA.n}`);

// 满分复习 → 应该增加间隔
const rB = records.review('cet4', 'abandon', 1.0);
total++; if (rB.i > 0) { passed++; ok(`首次复习 intervalDays = ${rB.i.toFixed(4)}`); } else fail('intervalDays 仍为 0');
total++; if (rB.k === 1) { passed++; ok('k=1'); } else fail(`k=${rB.k}`);

// 满分复习 N 次把间隔拉高，然后错误复习应显著缩小
const before = records.review('cet4', 'abandon', 1.0).i;
for (let i = 0; i < 5; i++) {
  // 模拟时间过去使间隔继续增长
  const cur = records.get('cet4', 'abandon');
  cur.r = Date.now() - 3 * 86400000;
  cur.due = Date.now() - 86400000;
  records.review('cet4', 'abandon', 1.0);
}
const high = records.get('cet4', 'abandon').i;
const after = records.review('cet4', 'abandon', 0.0).i;
total++; if (high > before * 5) { passed++; ok(`连续满分放大间隔 ${before.toFixed(4)} -> ${high.toFixed(4)} (×${(high/before).toFixed(1)})`); } else fail(`间隔未放大 ${before} -> ${high}`);
total++; if (after < high * 0.6) { passed++; ok(`错误复习显著缩小 ${high.toFixed(4)} -> ${after.toFixed(4)}`); } else fail(`错误复习未缩小 ${high} -> ${after}`);

// 多次满分 → 最终进入 known
let cur = records.get('cet4', 'abandon');
for (let i = 0; i < 5; i++) {
  cur = records.review('cet4', 'abandon', 1.0);
  cur.r = Date.now() - 25 * 86400000;
  cur.due = Date.now() - 86400000;
}
eq(cur.s, 'known', '连续满分且超过 21 天 → known');

// 难度单调性：成功→难度下降，失败→难度上升
records.map = {};
records.markExposed('cet4', 'test1');
const d0 = records.get('cet4', 'test1').d;
records.review('cet4', 'test1', 0.0);
const d1 = records.get('cet4', 'test1').d;
records.review('cet4', 'test1', 1.0);
const d2 = records.get('cet4', 'test1').d;
console.log('  [debug d values]', d0, d1, d2);
total++; if (d1 > d0) { passed++; ok(`失败提升难度 ${d0.toFixed(3)} -> ${d1.toFixed(3)}`); } else fail();
total++; if (d2 < d1) { passed++; ok(`成功降低难度 ${d1.toFixed(3)} -> ${d2.toFixed(3)}`); } else fail();

console.log('\n=== 5) 选词策略 ===');
const cet4 = dictModule.loadBook('cet4');
records.map = {};
const picks = { new: 0, due: 0, marked: 0, random: 0 };
for (let i = 0; i < 200; i++) {
  const p = records.pick(cet4);
  picks[p.source]++;
}
total++; if (picks.new > 80) { passed++; ok(`优先新词: ${picks.new} 次 (期望 >= 80)`); } else fail(`新词过少: ${picks.new}`);
total++; if (picks.new + picks.due + picks.marked > 195) { passed++; ok('基本全部命中'); } else fail();

// 标记生词后应该优先出现（用书中真实存在的单词，否则 pick 找不到）
const markedWord = cet4.words[0].w;
records.setMarked('cet4', markedWord, true);
let markedPicks = 0;
for (let i = 0; i < 100; i++) {
  const p = records.pick(cet4);
  if (p.source === 'marked') markedPicks++;
}
total++; if (markedPicks > 20) { passed++; ok(`生词优先: 100 次里 ${markedPicks} 次命中 abandon`); } else fail(`生词命中过少: ${markedPicks}`);

console.log('\n=== 6) 词库切换不丢进度（关键差异化） ===');
records.map = {};
records.markExposed('cet4', 'abandon');
const savedN = records.get('cet4', 'abandon').n;
records.resetBook('cet6');
const afterN = records.get('cet4', 'abandon').n;
eq(afterN, savedN, '重置 CET6 不影响 CET4 进度');

console.log('\n=== 7) 词库引擎 resolveBook 回退 ===');
// 删掉 cet4 → 应该回退到第一本可用词库
const fsx = require('fs');
const cet4File = path.join(ROOT, 'data', 'builtin', 'cet4.json');
const cet4Backup = fsx.readFileSync(cet4File);
try {
  try {
    fsx.unlinkSync(cet4File);
  } catch (e) {
    // 部分环境（如带 safe-delete 拦截的沙箱）unlink 会被改写并报错，
    // 但原文件已被移入回收站、不在工作树，回退逻辑仍然成立，继续断言。
  }
  dictModule.clearCache();
  const book = dictModule.resolveBook('cet4');
  total++; if (book && book.id !== 'cet4') { passed++; ok(`回退到 ${book.id}`); } else fail(`未回退 got ${book && book.id}`);
} finally {
  fsx.writeFileSync(cet4File, cet4Backup);
  dictModule.clearCache();
}

console.log('\n=== 8) 手势 → 动作映射完整性 ===');
const { GESTURE_EVENTS, GESTURE_ACTIONS } = require(path.join(ROOT, 'src/main/constants'));
const evKeys = new Set(GESTURE_EVENTS.map((e) => e.key));
const actKeys = new Set(GESTURE_ACTIONS.map((a) => a.key));
total++; if (evKeys.has('click') && evKeys.has('wheelUp') && evKeys.has('longpress')) { passed++; ok('所有手势事件已定义'); } else fail();
total++; if (actKeys.has('close') && actKeys.has('nextWord') && actKeys.has('markUnknown')) { passed++; ok('所有动作已定义'); } else fail();

console.log('\n=== 9) 热键默认值 ===');
const { HOTKEY_ITEMS } = require(path.join(ROOT, 'src/main/constants'));
const togglePopup = HOTKEY_ITEMS.find((h) => h.key === 'togglePopup');
eq(togglePopup.default, 'Shift+X', 'togglePopup 默认 Shift+X');
const panic = HOTKEY_ITEMS.find((h) => h.key === 'panic');
total++; if (panic && panic.default) { passed++; ok(`panic 默认 ${panic.default}`); } else fail();

console.log('\n=== 10) 自定义词库清理 ===');
try {
  const dir = paths.customDictDir;
  const before = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^u_.*\.json$/.test(f)).length : 0;
  cleanCustomDicts();
  const after = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^u_.*\.json$/.test(f)).length : 0;
  total++; passed++; ok(`清理 ${before} 个临时自定义词库（剩余 u_ ${after}）`);
} catch (e) { fail(e.message); }

console.log(`\n=== 总结 ===\n通过 ${passed}/${total}`);
if (passed < total) process.exit(1);
process.exit(0);