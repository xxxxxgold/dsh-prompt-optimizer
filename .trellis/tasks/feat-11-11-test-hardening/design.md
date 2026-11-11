# Feature Design

status: approved   # draft | approved（用户已确认：按方案执行，引入 ESLint devDependency）
execution_lane: standard   # quick | standard

## 目标与非目标

### 目标（Goals）

把 2026-11-11 全量检测暴露的 6 项工程治理问题修到「下次不用人肉发现」：

1. `tools/asar.mjs` 默认 ASAR 路径可移植
2. `package.json` 有可用的 `test` / `lint` / `check` 入口
3. 仓库根有正式 ESLint 9 flat config，CI 有 lint 门禁
4. npm 发布包不再夹带 `tools/`
5. `client.js` CJS 包装层改为 `const` 并写清前提（宿主以 `factory(require)` 调用），不需要 lint 豁免
6. README 计数与目录和实际一致

### 非目标（Non-goals）

- 不改 `index.js` / `client.js` 的运行行为（只允许注释、以及 `var → const` 这类可证明等价的改写）
- 不引入 prettier / typescript / 测试框架
- 不动 HTTP 契约、配置项、UI
- 不解决模型侧慢（20000 字 99 秒兜底）—— 另立任务

## 需求拆解与实现方案

### 涉及模块与边界

| 文件 | 改动性质 | 边界 |
|------|---------|------|
| `tools/asar.mjs` | 路径探测 + 报错提示 | 仅开发者工具，不进发布包（本任务后） |
| `package.json` | 新增 `scripts`、收窄 `files`、新增 `devDependencies` | 影响 `npm pack` 与 `npm test` 入口 |
| `eslint.config.js` | 新建 | 仓库根正式配置，替代之前的 `tmp/` 临时配置 |
| `.github/workflows/selftest.yml` | 新增 lint job/step | CI |
| `client.js` | 仅补注释（44-49 行） | 不改逻辑 |
| `README.md` | 计数与目录校正 | 文档 |
| `tools/selftest.mjs` | 新增断言 | 自测项数会变，README 必须同源 |

### 核心数据流与逻辑拆解

```text
开发者 / CI
  └─ npm run check
       ├─ 1. node --check index.js client.js        （语法门）
       ├─ 2. eslint .                               （风格门，0 warning）
       └─ 3. node tools/selftest.mjs                （行为门，296 项）
             └─ 打印 "PASS — N passed"，N 即 README 引用数字

asar.mjs 启动
  └─ ASAR 路径解析顺序：
       DSH_ASAR 环境变量
         → 逐个探测候选安装路径
           → 全部不存在：stderr 打印候选清单 + DSH_ASAR 用法，exit 1
```

### 契约变更

**新增（开发者面，非运行时）：**

- `package.json.scripts.test` = `node tools/selftest.mjs`
- `package.json.scripts.lint` = `eslint .`
- `package.json.scripts.check` = 语法 + lint + 自测串联
- `package.json.devDependencies.eslint` / `@eslint/js`
- `package.json.files` 精确化（去掉 `tools`）
- 仓库根 `eslint.config.js`

**不新增/不修改：**

- 插件导出的 `name` / `inject` / `apply` 不变
- HTTP 路由、请求/响应结构不变
- Loader 配置项不变
- `client.js` 的 `ENDPOINT` / `ENTRY_ID` / `LABEL` 等公开常量不变

### 关键技术选型与取舍

**1. ESLint 9 flat config 放仓库根，还是继续用临时文件？**

选：仓库根 `eslint.config.js`。

- 理由：临时配置只在 `tmp/` 里，`tmp/` 被 git 忽略，CI 与贡献者都拿不到，等于没有门禁。
- 代价：新增 devDependency 与 lockfile（`pnpm-lock.yaml` 已在 `.gitignore`，需确认用 npm 的 `package-lock.json`）。
- 取舍：devDependency 不进 `files`，安装者零影响。

**2. `files` 收窄后，`tools/` 会不会影响本地开发或 CI？**

不会。`files` 只控制 `npm pack` / `npm publish` 的内容，本地与 CI 都用仓库工作树。

**3. asar 路径怎么"可移植"而不写死一堆机器？**

选：候选列表 + 环境变量优先。

```text
候选：
  process.env.DSH_ASAR
  <常见 Windows 安装目录>/DeepSeek Harness/resources/app.asar
  <常见 macOS 路径>/DeepSeek Harness.app/Contents/Resources/app.asar
```

不引入 glob 扫描整个磁盘（慢且噪声大）。全找不到就报错并列出候选，明确告诉用户设 `DSH_ASAR`。

**4. `no-var` 那两行怎么处理？**

原计划：补注释 + `/* eslint-disable-next-line no-var */` 局部豁免。

**实施时改为**：直接改用 `const`，不做豁免。

- 核实依据：`exports` 在整个文件里只有 `exports.X = ...` 形式的属性挂载，没有整体重赋值；
  `module` 只在末尾 `return module.exports` 被读取。两者都只做属性读写，`const` 与 `var` 等价。
- 另一个核实点：`factory` 的形参只有 `require`，宿主 `__ModuleLoader__` 不会注入 `module` /
  `exports`（对照 asar 内全部官方 bundle 的生成模式确认），所以 `const module` 不会与外部绑定冲突。
- 收益：`no-var` 规则继续对整个仓库生效，不用为一个文件开豁免口子。

**5. selftest 项数与 README 数字怎么不再漂？**

选：selftest 末尾打印确定数字，并新增一条断言：读取 `README.md` 里的「N 项」与本次 `passed` 相等；不一致就 FAIL。

这样数字漂移会在 CI 阶段被自己的测试抓住，而不是靠人记。

**6. Node 18 上的 ESLint 9**

ESLint 9 要求 Node `^18.18.0 || ^20.9.0 || >=21.1.0`。`setup-node` 的 `18` 会装当前 18.x 最新（≥18.18），可用。
保险起见 CI 的 lint 步骤只在 Node 20/22 矩阵跑，避免 18 末端补丁版本差异卡住；`node --check` + selftest 仍覆盖 18/20/22。

## 验证计划

每项验收标准对应的可执行验证命令：

1. `npm test` → 期望 `PASS — N passed, 0 failed`，退出码 0
2. `npm run lint` → 期望无输出、退出码 0
3. `npm run check` → 期望三步全过、退出码 0
4. `npx eslint .` → 退出码 0
5. `env -u DSH_ASAR node tools/asar.mjs ls x`（并把候选路径指向不存在）→ 期望 stderr 含 `DSH_ASAR`、退出码 1
6. `npm pack --dry-run` → 期望输出无 `tools/`
7. `npm pack --dry-run` → 期望仍含 6 个必需文件
8. `node tools/selftest.mjs` → 期望 296 项全绿
9. `grep -n "248" README.md` → 期望无输出
10. `git diff --stat` → 期望 `index.js` 仅一行 catch 绑定、`client.js` 仅注释与 `var → const`

步骤标注：第 5、6、7 项属外部命令行为验证，`verification: 'ai'`；第 10 项需人工确认改动边界，`verification: 'human'`。

## 风险与回滚

### 风险点

1. **新增 devDependency 触发 lockfile 变更**：若仓库原本不用 npm lockfile，会新增一个文件。
   处置：确认 `.gitignore` 只忽略 `pnpm-lock.yaml`，新增 `package-lock.json` 属预期，随任务提交。
2. **`files` 收窄误删必需文件**：可能漏掉 `cordis.patch.yml` 或 `README.md`。
   处置：用 `npm pack --dry-run` 的输出逐项比对 PRD 验收清单。
3. **selftest 新增断言依赖 README 文本格式**：README 措辞一变测试就红。
   处置：用稳定的模式匹配（`离线 (\d+) 项`），并在 README 保持该句式。
4. **CI 在 Node 18 上 lint 失败**：见上，lint 只在 20/22 跑兜底。

### 回滚策略

全部改动为配置/文档/工具层，`git revert <commit>` 即可完全回退；无数据迁移、无运行时状态。

## 人审检查点

- [ ] 需求拆解完整，实现方案清晰
- [ ] 设计已获用户确认（status=approved）后再进入实现
