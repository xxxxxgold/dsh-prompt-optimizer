# Code Review（第三轮）

status: passed

## 结论

第二轮指出的 4 个断言缺陷均已按描述修复，且修复在真实反例下生效：把 `scripts.lint` 换成 `echo --max-warnings=0` 后断言 FAIL（295 passed / 1 failed，退出码 1）；向 `optionalDependencies` 注入 `left-pad` 后零依赖断言 FAIL；asar fixture 增加 `other/c.js` 后，若 `run()` 忽略过滤会输出 4 条，精确集合比对与 `matched: 3` 两条断言都会失败；"报告每个候选"已从长度比对改为数组逐项比对。基线 `npm run lint` / `npm test` / `npm run check` / `npm pack --dry-run` 全部通过（296 passed），`package.json` 经字节级还原后 md5 与备份一致，无临时改动残留。

## 四个修复点的验证

### 1. lint 断言

- 结论：已修复
- 证据：
  - 谓词在 `tools/selftest.mjs:1486-1491`：先按空白分词，再要求 `lintTokens[0] === 'eslint'`、`includes('.')`、`includes('--max-warnings=0')`，不是子串匹配。
  - 反例：将 `scripts.lint` 改为 `"echo --max-warnings=0"` 后运行 `node tools/selftest.mjs`，输出
    `FAIL the lint script runs eslint itself with a warning gate — ["echo","--max-warnings=0"]`
    `FAIL — 295 passed, 1 failed`，退出码 1。`echo` 不是 eslint、且缺 `.`，两道条件同时拦截，不再被 flag 子串骗过。
  - 还原后 `node tools/selftest.mjs` → `PASS — 296 passed, 0 failed`，退出码 0。

### 2. asar ls 过滤断言

- 结论：已修复
- 证据：
  - fixture 4 条：`pkg/a.js`、`pkg/b.json`、`pkg/skip.png`、`other/c.js`（`tools/selftest.mjs:1644-1658`）；断言为 `code === 0 && JSON.stringify([...out].sort()) === JSON.stringify(['pkg/a.js','pkg/b.json','pkg/skip.png'])`（`:1663-1668`），另有 `matched: 3` 的总数断言（`:1669`）。
  - 用真实 `run()` 做等价探针（不改实现）：`ls pkg/` 输出 3 条、断言为 true；`ls ""`（等价于忽略过滤）输出 `["pkg/a.js","pkg/b.json","pkg/skip.png","other/c.js"]`，断言为 false，stderr 为 `total files: 4, matched: 4`。两个方向的失效都会被捕获（集合不等、matched 不是 3）。
  - `fixture asar lists every entry`（4 条）保证加载层确实看到 decoy，排除"fixture 没进去所以永远 3 条"的假阳性。

### 3. 候选路径断言

- 结论：已修复
- 证据：`tools/selftest.mjs:1598-1604` 同时断言 `nothing.path === null`、`nothing.source === 'missing'`，并做 `JSON.stringify(nothing.candidates) === JSON.stringify(expectedCandidates)` 的元素级全数组比对；不再是 `.length` 比对，长度相同但内容缺失/重排/重复都会失败。
- 边界：`expectedCandidates` 由同一个 `candidatePaths()` 重新计算（`:1599`），所以该断言只能证明 `resolveAsarPath` 原样透传完整候选列表，不能发现 `candidatePaths` 自身少算候选——这属于该断言的固有上限，不是本轮退化。

### 4. 零依赖三桶断言

- 结论：已修复
- 证据：
  - `tools/selftest.mjs:1503-1505`：`runtimeBuckets = ['dependencies','optionalDependencies','peerDependencies']`，任一桶存在且非空即 `leaked`，断言 `leaked.length === 0`。
  - 反例：注入 `"optionalDependencies": {"left-pad": "^1.3.0"}` 后运行，输出
    `FAIL the package ships no runtime dependencies — [["optionalDependencies",{"left-pad":"^1.3.0"}]]`，`FAIL — 295 passed, 1 failed`，退出码 1。旧版只查 `dependencies` 时该用例会漏过。

## 验证记录

| 命令 | 结果 |
| --- | --- |
| `npm run lint` | 退出码 0，无告警 |
| `npm test` | `PASS — 296 passed, 0 failed`，退出码 0 |
| `npm run check` | `PASS — 296 passed, 0 failed`，退出码 0（syntax → lint → selftest 全部通过） |
| `npm pack --dry-run` | 6 个文件：LICENSE、README.md、client.js、cordis.patch.yml、index.js、package.json；48.2 kB / unpacked 155.9 kB；不含 `tools/`、`tmp/`、`.trellis/` |
| `git diff --stat` | 7 files changed, 526 insertions(+), 73 deletions(-)：`.github/workflows/selftest.yml`、README.md、client.js、index.js、package.json、tools/asar.mjs、tools/selftest.mjs（均为作者既有未提交改动，非本轮引入） |
| `md5sum package.json` | `DAF6A3E4CA78F5B763FCEC16DE15FE71`，与备份一致；`git diff -- package.json` 内容仅含作者的 files/scripts/devDependencies 修改 |

还原说明：
- `package.json` 两次反例修改后均以备份文件字节级覆盖，还原后 md5 与备份一致（`DAF6A3E4CA78F5B763FCEC16DE15FE71`），并跑出 `PASS — 296 passed, 0 failed`。
- 反例脚本与 fixture 均建在 `os.tmpdir()`，探针进程内 `rmSync` 清理；临时脚本与备份文件已删除。
- 除本文件外未修改任何仓库文件；`git status` 中的 7 个已修改文件是审查开始前就存在的作者改动。

## 未覆盖项

- 未实际改写 `run()` 的过滤实现来跑失败用例（按要求仅做代码推理 + `ls ""` 等价探针）；结论基于真实 `run()` 在无过滤时的输出。
- 未给 `scripts.check` 的精确数组断言构造反例（如步骤重排）；该断言代码本身是 4 元素全等比对，但本轮未实测。
- 候选路径断言未覆盖 `candidatePaths` 自身漏算候选的情况（见第 3 点边界）。
- 仅在 Windows + Node v22.20.0 上验证，未覆盖其他平台/Node 版本。
- README 计数断言只验证 3 处数字与本次 296 一致，未审查文案语义。