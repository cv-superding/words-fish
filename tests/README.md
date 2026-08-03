# Tests

自动化测试套件。本项目有两套稳定可跑的测试，和一套待修复的渲染层测试。

## 快速运行

```bash
# 全部（推荐）
npm test

# 单独
npm run test:logic          # 50 项逻辑测试
npm run test:integration    # 24 项无头集成测试
```

> **GUI 测试说明**：沙箱环境无法启动真实 Electron 窗口，  
> `verify-headless.js` 用桩件模拟 `electron` 模块跑全链路；  
> 真实视觉验收需在本机 `npm start` 后肉眼确认。

## 套件详情

### `logic-test.js`（50 项 · 纯 Node）

覆盖范围：

- 配置默认值与合并
- 4 本内置词库加载（cet4/cet6/kaoyan/ielts，共 7158 词）
- 4 种导入格式：JSON / JSONL / CSV / TSV / TXT
- SM2+ 算法正确性（难度单调性、间隔上下界、known 转换）
- 选词策略：生词优先 / 到期复习 / 新词 / 已掌握
- 切换词库不丢进度（`bookId::word` 键）
- 失效词库回退
- 手势 → 动作映射表完整性
- 默认热键完整性
- 自定义词库清理

运行无外部依赖（不需要 Electron、不需要联网），CI 默认跑这套。

### `verify-headless.js`（24 项 · 桩件模拟）

把 `electron` 桩成最小可用 stub，然后 `require('./src/main/main.js')`，捕获所有 IPC handler 注册并模拟关键用户调用。

覆盖范围：

- 主进程初始化全链路（`whenReady().then(...)`）无异常
- 全部 IPC 通道数量与可达性
- `config:get` / `config:update` / `config:reset`
- `dict:list` / `dict:load`
- `study:word` / `study:rate` / `study:markUnknown` / `study:stats`
- `gesture:fire`（dblclick→close、rightclick→markUnknown 等）
- `notify:push` / `notify:status`
- `win:togglePopup` / `win:openSettings`
- `app:version`
- 持久化落盘（确认 `config.json` / `records.json` 能正确写入 `userData`）

**关键价值**：能抓住模块加载、引用错、IPC handler 异常、配置无法落盘等**真集成 bug**。

### `render-test.js`（待修复）

用 jsdom 加载 `src/renderer/*/index.html` 并验证初始化。  
当前环境 `jsdom` 依赖损坏（`http-proxy-agent` / `agent-base` 缺失），待修复后纳入。

## fixtures/

| 文件 | 用途 |
| --- | --- |
| `sample.csv` | 测试 CSV 导入 |
| `sample.json` | 测试 JSON 导入 |
| `sample.jsonl` | 测试 JSONL 导入 |
| `sample.txt` | 测试 TXT 导入 |

## 添加新测试

1. 简单断言：直接加到 `logic-test.js` 对应 section
2. 集成场景：加到 `verify-headless.js`
3. 视觉回归：等 `render-test.js` 修好后加

所有测试**不引入新依赖**（除 `jsdom`，已装）。

## 调试技巧

```bash
# 单跑某个套件
node tests/logic-test.js
node tests/verify-headless.js

# 详细输出（verify-headless 把报告写到 verify-report.txt）
node tests/verify-headless.js
cat tests/verify-report.txt
```

`verify-headless.js` 在 50ms 内完成所有断言；`logic-test.js` 在 200ms 内完成。
