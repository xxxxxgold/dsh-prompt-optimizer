# Feature PRD

## 背景

2026-11-11 对 dsh-prompt-optimizer 0.6.1 做了一轮全量静态 + 运行实测，功能面全绿：

- `node --check` ×3 通过；`tools/selftest.mjs` 262/262 通过（本次新增断言后为 296）
- ESLint recommended：0 error / 2 warning
- i18n：zh/en 各 46 key 完全对齐，无空值、无漏译、无僵尸文案
- 版本号 package.json 与 index.js 一致（0.6.1）
- 真实宿主三端口（55465 / 54880 / 60592）`health` / `models` / `model` 全 200
- 真实模型 `optimize`：10.9s / 22.5s / 25.5s 三次均 200 且 `engine=llm`
- 端到端（组件渲染 → 点击 → HTTP → 回填）：PASS，回填保留原文全部要素
- 并发守卫 maxConcurrent=4：8 并发精确分流为 4×200 + 4×429，槽位无泄漏
- 畸形载荷 16 项、错误路径语义、注入防护、响应头：全部符合预期

功能无缺陷，但检测暴露 6 项工程治理问题，趁现在一并修掉，避免以后每次都要人肉发现。

## 范围

### In Scope

1. **`tools/asar.mjs` 默认 ASAR 路径过期**
   当前写死 `D:/Software/DeepSeek Harness/resources/app.asar`，本机实际安装在
   `D:\Program Files\DeepSeek Harness\resources\app.asar`。工具本身逻辑正常（用 `DSH_ASAR`
   覆盖后 `ls` / `grep` 都能跑）。
   → 让默认值可移植：按常见安装位置探测，找不到时给出清晰报错与 `DSH_ASAR` 用法提示。

2. **`package.json` 缺 `scripts` 字段**
   `npm test` 跑不起来，贡献者必须记住 `node tools/selftest.mjs`。
   → 补 `test` / `lint` / `check` 三个入口，`check` 串起「语法 + lint + 自测」。

3. **CI 没有 lint 门禁**
   现在只有 `node --check` + selftest，代码风格无强制约束。
   → 引入 ESLint 9 flat config（放仓库根，作为正式配置而非临时文件），CI 增加 lint 步骤。

4. **发布包混入开发工具**
   `files: ["... ", "tools"]` 把 82 kB 开发件（`selftest.mjs` / `preview.html` / `asar.mjs`）
   打进 npm 包。安装者不需要它们。
   → 精确列出发布所需文件，`tools/` 不进包；本地开发不受影响。

5. **`client.js` CJS 包装层缺说明**
   47-48 行 `var module` / `var exports` 触发 2 个 `no-var` 警告。这是刻意的 CJS 作用域模拟，
   但代码里没写为什么，后续人会想「顺手改成 const」。
   → 补注释说明约束。**实施时改进了原方案**：核实 `exports` 只做属性挂载、从不整体重赋值，
   且 factory 只接收 `require`（不注入 module/exports），因此 `const` 与 `var` 完全等价，
   直接改用 `const` 消除警告，不再需要局部豁免——保留 `no-var` 对全仓库生效。

6. **`index.js` 存在一个未使用的 catch 绑定**
   `optimize()` 的短答重锻分支写的是 `catch (repairError)`，但变量从未使用。
   → 改为裸 `catch {`，零行为变更。

7. **README 计数与目录过时**
   README 三处写「248 项」，实际自测 262 项；目录段未体现新增配置。
   → 校正为实际数字，目录段同步。

### Out of Scope

- 不改变插件任何运行时行为（`index.js` / `client.js` 的功能逻辑零改动）
- 不改 HTTP 契约、不改配置项语义、不改 UI
- 不引入 ESLint 之外的检查工具（不做 prettier / tsc / 测试框架迁移）
- 不处理检测中记录的「20000 字输入耗时 99 秒走本地兜底」——那是模型侧速度问题，需要单独评估
- 不做真实 GUI 内点击的自动化（需 `dsh web` 认证 token，另立任务）
- 不做长时间运行的内存/句柄泄漏与多用户压测

## 验收标准

- [ ] `npm test` 能跑通 296 项离线自测，退出码 0
- [ ] `npm run lint` 退出码 0，0 error、0 warning
- [ ] `npm run check` 依次通过语法检查、lint、自测，任一失败则整体失败
- [ ] `npx eslint .` 在仓库根能直接运行（有正式 flat config，无需外部临时配置）
- [ ] `DSH_ASAR` 未设置且默认路径不存在时，`tools/asar.mjs` 报错信息包含 `DSH_ASAR` 用法提示，且退出码非 0
- [ ] `npm pack --dry-run` 输出不含 `tools/` 下任何文件
- [ ] `npm pack --dry-run` 仍包含 `index.js` / `client.js` / `cordis.patch.yml` / `README.md` / `LICENSE` / `package.json`
- [ ] `node tools/selftest.mjs` 为 296/296，且新增断言真实覆盖 asar 路径探测 / ls-cat-grep、package.json scripts、发布包实际内容与零运行时依赖
- [ ] README 中所有自测项计数与实际一致（无 248 残留）
- [ ] `git diff` 不含 `index.js` / `client.js` 的行为改动（`index.js` 仅允许去掉未使用的 catch 绑定，
      `client.js` 仅允许 CJS 包装层的等价改写与注释）

## 约束与风险

- **零依赖原则**：插件运行时必须保持零依赖。ESLint 只能是 devDependency，且不能进入 `files`。
  这带来一个张力：加了 devDependency 就有 lockfile 与 `npm install` 需求。
  → 取舍：devDependencies 只给开发者用，CI 用 `npm ci`；运行时与安装者完全不受影响。
- **CI 运行环境**：GitHub Actions Ubuntu + Node 18/20/22。ESLint 9 要求 Node ≥ 18.18，需确认
  matrix 里的 18 能跑（必要时 18 用 `node --check` 兜底，lint 只在 20/22 跑）。
- **selftest 的项数是硬数字**：新增断言会改变总数，README 数字必须同源更新，否则又漂移；现已由 selftest 自己的断言强制校验。
  → 让 selftest 自己打印项数，README 引用该数字；或断言项数与 README 一致。
- **回滚**：全部改动集中在配置文件、CI、tools、README；`git revert` 即可，无数据迁移。

## 相关代码/文档

- `tools/asar.mjs:17-19` — 硬编码 ASAR 路径
- `package.json` — 缺 `scripts`、`files` 含 `tools`
- `.github/workflows/selftest.yml` — 缺 lint 步骤
- `client.js:44-49` — CJS 包装层
- `README.md:307`、`README.md:320`、`README.md:347` — 248 项计数
- `.trellis/spec/frontend/quality-guidelines.md` — 项目质量门定义
