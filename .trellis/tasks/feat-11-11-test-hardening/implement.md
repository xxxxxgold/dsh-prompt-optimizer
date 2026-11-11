# 实现记录 — feat-11-11-test-hardening

> 记录实施过程中与方案的实际偏差、修复轮次与本轮全部验证证据。
> 与 `design.md` 冲突时以本文 + 代码事实为准。

## 一、与方案的偏差

| 方案原定 | 实际实施 | 原因 |
|---|---|---|
| `client.js` 补注释 + `eslint-disable-next-line no-var` 局部豁免 | 改为 `const module` / `const exports` + 注释写清前提，**不做任何豁免** | 核实 `exports` 只做属性挂载、从不整体重赋值；宿主 `factory(require)` 只传一个参数，不注入 `module`/`exports`（对照 asar 内 `dsh-client-modules` 的 materialize 与全部官方 bundle 生成模式）。`const` 与 `var` 在此前提下等价，`no-var` 得以对全仓库生效 |
| 未计划 | 额外修复 `index.js:818` 未使用的 `catch (repairError)` 绑定 | lint `no-unused-vars` 暴露；裸 `catch {}` 零行为变更 |
| PRD 只写 6 项 | 实为 7 项（含上面这条） | 同上 |

## 二、第一轮审查发现的假绿灯与修复

第一轮独立审查（`review.md`，status: blocking）指出新增门禁存在三处"断言永真"，以及一个 asar 回归。均已修复：

### 1. lint 不拦 warning
- **问题**：`eslint .` 默认在"只有 warning"时退出 0，但 PRD/CI step 声称"0 error / 0 warning"。
- **修复**：`package.json` 的 `lint` 与 `check` 都改为 `eslint . --max-warnings=0`。
- **反例证据**（`probe-warn3.js`，只含未使用的 disable 指令）：
  - `eslint probe-warn3.js` → 1 warning，退出码 **0**
  - `eslint probe-warn3.js --max-warnings=0` → 1 warning，退出码 **1**（`ESLint found too many warnings (maximum: 0).`）
- **断言**：selftest 新增 `the lint script refuses warnings`。

### 2. 发布包断言只看 `package.json.files`
- **问题**：原断言只读 `files` 数组；`files: ["."]` 或 `["./tools"]` 都能通过，但实际会打包整个仓库。
- **修复**：
  - selftest 现在真的执行 `npm pack --dry-run --json`（`execFileSync`，`shell: true`，`cwd` = 仓库根），断言三件事：无 `tools/`、含 6 个必需文件、无 `tmp/` `.trellis/` `.dsh*` 残留。
  - 同时把 `files` 断言收紧为"排序后精确等于白名单" + "无目录/glob 项"。
- **反例证据**：把 `files` 改成 `["."]` 后 →
  - `FAIL the files whitelist is exactly the runtime set — ["."]`
  - `FAIL the files whitelist holds no directory or glob entries — ["."]`
  - `FAIL the published tarball still carries every runtime file`
  - 汇总 `FAIL — 293 passed, 3 failed`，退出码 1。
- **一处认知更正**（第二轮复审指出）：在 npm 11 下 `files: ["."]` 并不会"打包整个仓库"，而是只打包 npm 默认包含的 4 个文件（缺 `client.js` 与 `cordis.patch.yml`）——包是**残缺**而不是臃肿。结论不变：断言能拦住，但原因要说准。

### 3. 零依赖断言不检查 `dependencies`
- **问题**：原断言只查 `devDependencies.eslint` 非空，`dependencies` 里塞 eslint 也能通过。
- **修复**：新增 `the package ships no runtime dependencies`（`dependencies` 必须为空）；`both lint packages are dev dependencies with a pinned range`（`eslint` 与 `@eslint/js` 都必须在 `devDependencies` 且匹配 `^\d+\.\d+\.\d+$`）。
- **反例证据**（谓词级验证）：
  - `{ dependencies: { eslint: '^9.39.5' } }` → 断言 false ✓
  - `{ devDependencies: { eslint: '*' } }` → 断言 false ✓

### 4. `tools/asar.mjs` 的 junction 静默 no-op（回归）
- **问题**：`import.meta.url === pathToFileURL(process.argv[1]).href` 是字符串比较；Node 把入口解析成真实路径，junction/symlink 调用时两者不等 → `main` 不执行、无输出、退出码 0。原实现没有该守卫，这是重写引入的回归。
- **修复**：`isDirectInvocation()` 改用 `realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])`，失败再回退字符串比较。
- **证据**：`mklink /J tmp\linktest\tools-link tools` 后 `node tmp/linktest/tools-link/asar.mjs ls dsh-client-locale` → 9 个匹配、`total files: 18309`、退出码 0（修复前无输出）。

## 三、其它审查意见的处理

| 审查意见 | 处理 |
|---|---|
| `check` 断言只查子串 | 改为按 `&&` 拆分后精确比对 4 步序列（含 `node --check client.js`） |
| README 计数断言位置脆弱、正则过宽 | 保持为最后一条断言并加注释说明"新增检查必须放在它之前"；正则收窄为三种明确的表述（`离线 N 项` / `验证覆盖**（N 项）` / `离线自测（N 项）`），并要求恰好 3 处 |
| asar 自测覆盖不足、`ProgramFiles` 断言同义反复 | 断言改用 `X:\PF` 假根（不再与硬编码 `C:/Program Files` 撞车）；新增平台参数断言（POSIX 不生成盘符候选）、trim 断言、失败文案断言；新增**自建最小合法 asar fixture** 覆盖 `ls` / `cat` / `grep` / 未知命令退出码 / 总数统计 |
| `eslint.config.js` 注释与实现不符 | 整份重写，删除过时的 var/disable 描述 |
| `no-console` 注释与配置矛盾、tools 覆盖冗余 | 改为 `'no-console': ['error', { allow: ['warn'] }]`；tools 目录整体 off（因为测试脚本本就要 console.log，与生产规则不同源，不算冗余） |
| 前后端 globals 未隔离 | 拆成四层 config：共享基础 → Node（`index.js` / `eslint.config.js` / `tools/**`）→ 浏览器（`client.js`）→ tools 的 no-console 放行。已用反例验证：`client.js` 写 `process` → no-undef；`index.js` 写 `window` → no-undef |
| asar 提示是 Unix 语法 | `describeResolutionFailure` 同时给 PowerShell 与 POSIX 两种写法，并新增断言 |
| asar 每条命令都打 `asar:` 行 | 只在 `source === 'env'` 时打印，自动探测保持安静（与重写前行为一致） |
| asar `candidatePaths` 空白/平台/目录处理 | `push` 内 trim 后再存；平台参数化，POSIX 不生成盘符候选；默认探测用 `statSync().isFile()`，目录不再被当成 asar |
| PRD/design 残留 262 与"仅注释" | 已校正为 296 与"注释 + 可证等价的改写" |
| 发布包保留指向 `tools/` 的 scripts | README 开发段顶部加警示："命令需在仓库工作树运行，发布包不含 `tools/`" |
| `engines.node >=18` 低于 ESLint 9 要求 | 不动运行时 `engines`（插件确实支持 18）；README 明确"本地 lint 需 Node ≥ 18.18，运行时仍只要 >=18" |
| `git diff` 不含两个新文件 | 已在下文"提交清单"里显式列出 `eslint.config.js` 与 `package-lock.json` |

## 四、验证证据（本轮实跑）

```
npm run lint    → 0 error / 0 warning，退出码 0（--max-warnings=0 生效）
npm test        → PASS — 296 passed, 0 failed，退出码 0
npm run check   → 语法 + lint + 自测 三步全过，退出码 0
npm pack --dry-run → total files: 6；无 tools/、无 eslint.config.js、无 package-lock.json
```

发布包 6 个文件：`LICENSE` / `README.md` / `client.js` / `cordis.patch.yml` / `index.js` / `package.json`。

`tools/asar.mjs` 四种场景：

| 场景 | 命令 | 结果 |
|---|---|---|
| 自动探测 | `node tools/asar.mjs ls dsh-client-locale` | 命中 `D:/Program Files/.../app.asar`，9 匹配，exit 0 |
| 显式覆盖 | `DSH_ASAR=... node tools/asar.mjs ls ...` | 首行打印来源，9 匹配，exit 0 |
| 显式不存在 | `DSH_ASAR=Z:/nope node tools/asar.mjs ls x` | stderr 指出文件不存在，exit 1 |
| junction 调用 | `node tmp/linktest/tools-link/asar.mjs ls ...` | 9 匹配，exit 0（修复前无输出） |
| 未知命令 | `node tools/asar.mjs nope` | usage，exit 2 |
| 无参数 | `node tools/asar.mjs` | usage，exit 2 |

README 计数反例（把 `离线 296 项` 改成 999）→ `FAIL README states this exact check count — README=[999,296,296] actual=296`，已还原。

## 五、提交清单（含未跟踪新文件）

```
M  .github/workflows/selftest.yml
M  README.md
M  client.js
M  index.js
M  package.json
M  tools/asar.mjs
M  tools/selftest.mjs
A  eslint.config.js          ← 新文件，必须显式 git add
A  package-lock.json         ← 新文件，CI 的 npm ci 依赖它
```

## 六、第三轮复审（status: passed）之后的自主收紧

第三轮独立复审通过（见 `review.md`），但顺带指出三处"断言判别力不足"的 minor。作者在复审通过后继续收紧，**没有新增断言、总数仍为 296**：

1. **`asar reports every candidate` 曾是自比较**
   原写法把 `nothing.candidates` 与 `candidatePaths(同一 env)` 重算结果比对——两侧同源，判别力为零。
   改为与**字面量**比对：必须包含 `X:/PF/DeepSeek Harness/resources/app.asar`、必须包含 macOS bundle 路径、且每项都以 `DeepSeek Harness/resources/app.asar` 或 `DeepSeek Harness.app/Contents/Resources/app.asar` 结尾。

2. **去重断言被输入架空**
   原用 `X:\PF`，该输入本来就不产生重复（去重前后都是 10），断言恒真。
   改用唯一会真实撞车的 `C:\Program Files`（同时来自 `env.ProgramFiles` 与硬编码 `C:` 盘符字面量）：去重后 8 项，若去重失效则为 9 项，断言 `length === 8` 能抓住。
   *注*：新断言首次跑出 8，与起初预期的 9 不同——因为 `env.ProgramFiles` 与硬编码 `C:` 完全撞车，实际候选是 C:/PF、C:/PF(x86)、D:/PF、D:/PF(x86)、E:/PF、E:/PF(x86)、macOS、/opt 共 8 项。

3. **lint 断言可被 `|| true` 绕过**
   分词检查已排除 `echo --max-warnings=0`，但 `eslint . --max-warnings=0 || true` 仍能通过。
   增加拒绝 shell 元字符（`|&;<>`）的条件。反例验证：改成 `|| true` 后
   `FAIL the lint script runs eslint itself with a warning gate — ["eslint",".","--max-warnings=0","||","true"]`。

收紧后复跑：`npm run check` → `PASS — 296 passed, 0 failed`；`npm run lint` exit 0。

## 七、未覆盖项（如实记录）

- 真实 GitHub Actions 未跑；Node 18 未实测（本机只有 Node 22）。
- 未在干净环境执行 `npm ci` + 安装 tarball 后跑插件。
- `tools/asar.mjs` 的 `main()` 里"自动探测全失败"分支未直接触发（本机真实 asar 存在），只验证了 `resolveAsarPath` 返回值与 `describeResolutionFailure` 文案；显式 `DSH_ASAR` 缺失分支已实跑。
- 未重跑真实 GUI 内点击（需 `dsh web` 认证 token）；第一轮检测记录的历史端到端结果未在本轮复核。
- 模型的响应速度问题（20000 字输入约 99 秒走本地兜底）不在本任务范围，已在 PRD 的 Out of Scope 记录。
