# Code Review

status: passed
verdict: PASS

## 审查方式

- 主会话派发**独立审查子代理**（8d7ee847），只读审查 `git diff`（`README.md` / `index.js` /
  `tools/selftest.mjs`，58+/19-），并要求其做变异实验验证测试有效性；子代理未修改工作区，
  全部变异在临时副本中进行。
- 主会话另行复核：实跑 `node tools/selftest.mjs`、`node --check`、真机 26 项接口、桌面 GUI 截图。

## Findings（子代理初判）

### blocking

无。

### major

1. **400 / 413 / 502 三条退出路径的槽位释放无断言**。新增并发段只覆盖 200 与 429；
   既有 bad-inputs 段用默认 `maxConcurrent=4`，三个错误请求撞不到上限，看不见泄漏。
   子代理实证：清空 `finally`、只在 200 前手动 `inFlight -= 1;`，自测仍 `PASS 240/240`。

### minor

1. `release()` 无 `try/finally` 保护（仅崩溃式失败时 `firstRun` 可能 pending）。
2. 提前占槽 + `readBody` 无超时：半截 body 的慢连接可占住槽位（needs-verification：宿主是否设请求体超时）。
3. 429 分支不消费请求体直接 `res.end()`（needs-verification：真实 Node http 是否 drain）。
4. README 覆盖清单未提并发上限 / 429。
5. 提交时勿 `git add -A`（`.trellis/` 等未跟踪目录不应混入）。

## 处置

| # | 处置 | 证据 |
|---|---|---|
| major-1 | **已修**：`tools/selftest.mjs` 补 6 条断言——400 后 200、413 后 200、502 后 502；并新增 `maxConcurrent:1 + localFallback:false + throwOnStream` 的独立挂载块 | 变异验证：清空 `finally` 只保留 200 释放 → **4 FAIL**（`a 400 hands the slot back` / `an oversized draft answers 413` / `a 413 hands the slot back` / `a 502 hands the slot back`，244 passed / 4 failed）；恢复后 **248 passed, 0 failed** |
| minor-1 | 记录，不改：`check()` 只计数不 throw，断言失败不会触发该路径 | 连跑 20 次无 flake（子代理证据） |
| minor-2 | 记录为限制：见 check.md 第六节；宿主 `webServer` 是否设请求体超时未验证 | — |
| minor-3 | 记录为限制：离线 fakeResponse 看不到 drain 层，真机并发未压测 | — |
| minor-4 | **已修**：README `248 项` + 覆盖清单补「并发上限（429 `BUSY`）」 | `grep -c "248 项" README.md` → 3 |
| minor-5 | 遵守：本轮只 `git add` 三个显式文件 | `git status --short` → 仅 3 个 M |

## 验收对照

| PRD 验收 | 结论 | 证据 |
|---|---|---|
| 已做一遍全方位全面测试 | 通过 | 8 批次 A–H 全部执行，见 check.md |
| 项目一点问题都没有 | 有条件通过 | 已发现并修复 1 个真缺陷 + 3 处文档过期；6 项限制如实列出（check.md 第六节） |
| 零失败 | 通过 | `PASS — 248 passed, 0 failed` |
| 跨版本 | 通过 | Node 18.20.7 / 20.19.5 / 22.20.0 全 `0 failed` |
| 真机接口 | 通过 | 26/26（修复后复跑仍全过） |
| 桌面 GUI | 通过 | 截图 5 张：会话切换 / 草稿 / 菜单 / busy / 回填 |
| 文档对齐 | 通过 | 版本三方 0.6.1；项数 3 处 248；README 覆盖清单补并发 |
| 打包一致性 | 通过 | profile 5 文件 SHA256 与仓库全同 |

## 结论

**PASS**。核心修复（并发槽位提前预留 + `try/finally`）经独立审查确认正确；审查指出的唯一 major
（错误路径释放无回归护栏）已补齐并用变异实验证明断言有效。剩余 minor 均为已声明的限制或低成本
卫生项，不阻塞合并。
