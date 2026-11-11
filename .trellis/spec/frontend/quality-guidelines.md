# Quality Guidelines

> Code quality standards for this project.

---

## Overview

这个仓库是**零运行时依赖**的 DSH 插件：`index.js`（宿主半，HTTP 面）与 `client.js`（客户端半，浏览器 bundle）
是全部运行时代码；`tools/` 下是开发期工具，**不进发布包**。

质量门由一条命令串起来：

```powershell
npm run check    # node --check ×2 → eslint . --max-warnings=0 → node tools/selftest.mjs
```

任何一项失败，整体失败。

---

## Forbidden Patterns

### 1. 断言只检查"标志字符串"而非行为

**禁止**：`check('x', pkg.scripts.lint.includes('--max-warnings=0'))`

`echo --max-warnings=0` 携带这个子串，却不是 linter；`eslint . --max-warnings=0 || true` 也通过。

**正确**：按空白分词后验证首词与必需参数，并拒绝 shell 元字符：

```js
const tokens = pkg.scripts.lint.trim().split(/\s+/);
tokens[0] === 'eslint' && tokens.includes('.') && tokens.includes('--max-warnings=0') && !/[|&;<>]/.test(pkg.scripts.lint)
```

### 2. 断言两侧同源（自比较）

**禁止**：`resolve(...).candidates === candidatePaths(同一 env)` —— 两侧都调用同一个函数重算，判别力为零。

**正确**：与**字面量**比对，或用与实现无关的固定期望值。

### 3. 断言只在"不会触发条件"的输入上验证

**禁止**：用 `X:\PF` 验证"候选去重"——该输入本来就不产生重复，去重失效也能通过。

**正确**：找出真正会撞车的输入。本项目的例子是 `C:\Program Files`：它同时来自 `env.ProgramFiles`
与硬编码的 `C:` 盘符字面量，去重后 8 项、不去重 9 项。

### 4. 在生产源码里留调试输出

`no-console` 只允许 `console.warn`（客户端半有 5 处刻意的降级诊断）。`console.log` / `info` / `debug` 会被 lint 拦住。

### 5. 用 `var`

`no-var` 全仓库生效，无豁免。`client.js` 的 CJS 包装层用 `const` 模拟 `module` / `exports` 绑定
（只做属性读写、从不整体重赋值）。

### 6. 空的 catch 绑定

**禁止**：`catch (error) { /* 没用 error */ }` → 触发 `no-unused-vars`。
**正确**：确实不用就写 `catch {`。刻意静默是允许的（`no-empty` 已放开 `allowEmptyCatch`），但别留无用绑定。

---

## Required Patterns

### 1. 新增门禁必须自带反例验证

加一条断言后，**手动制造一次它该失败的情形**，确认它真的红。本任务的例子：

| 断言 | 反例 | 期望 |
|---|---|---|
| lint 带 `--max-warnings=0` | 改成 `echo --max-warnings=0` | FAIL |
| lint 无元字符 | 改成 `... \|\| true` | FAIL |
| `files` 精确白名单 | 改成 `["."]` | FAIL |
| 零运行时依赖 | 注入 `optionalDependencies` | FAIL |
| README 计数 | 改成 999 | FAIL |
| asar 去重 | 换成不会撞车的输入 | 该断言应变得无意义（说明输入要改） |

### 2. 文档里的数字要与测试同源

README 三处自测计数（`离线 N 项`、`验证覆盖**（N 项）`、`离线自测（N 项）`）由 `tools/selftest.mjs`
最后一条断言强制校验：数字不符即 FAIL。**新增检查后必须同步 README**，且新检查要放在该断言之前。

### 3. 发布包内容要用 `npm pack` 实测，不能只看 `package.json.files`

`files` 是声明，tarball 是事实。selftest 会执行 `npm pack --dry-run --json` 并断言：
无 `tools/`、含 6 个必需文件、无 `tmp/` `.trellis/` `.dsh*` 残留。

> 实测认知：npm 11 下 `files: ["."]` **不是**"打包整个仓库"，而是只打包 npm 默认包含的 4 个文件
> （缺 `client.js` 与 `cordis.patch.yml`）——包是**残缺**而不是臃肿。

### 4. 开发者工具要可测、可注入

`tools/asar.mjs` 的写法可作模板：

- 纯函数导出（`candidatePaths` / `resolveAsarPath` / `describeResolutionFailure`）
- 副作用可注入（`isFile`、`platform`、`io`）
- 入口守卫 `isDirectInvocation()` 用 `realpathSync` 比较，**不能用字符串比较**——Node 把入口解析成真实路径，
  而 `process.argv[1]` 保留 shell 用的 junction/symlink 路径，字符串比较在链接调用下会静默 no-op。

### 5. 平台行为要参数化

`candidatePaths(env, platform)` 在 `win32` 之外不生成盘符候选。硬编码 `C:/D:/E:` 会在 macOS/Linux 上产生
无意义的探测项。

---

## Testing Requirements

| 层级 | 要求 |
|---|---|
| 语法 | `node --check index.js client.js` 必须通过 |
| 风格 | `eslint . --max-warnings=0`，**0 error / 0 warning** |
| 行为 | `node tools/selftest.mjs` 全绿（当前 296 项） |
| 发布包 | `npm pack --dry-run` 11 个文件（6 个运行时 + 5 个 docs）、无 `tools/` |
| 渲染 | 改动 `client.js` 后，用无头浏览器渲染 `tools/preview.html` 对比截图 |

自测的沙箱方式：宿主半直接 `import` 并挂到假的 Cordis context；客户端半在 `node:vm` 里跑，
用假的 `window.__ModuleLoader__` / `react` / `react/jsx-runtime`。

**vm 沙箱里的 React stub 必须遵循真实语义**：`useEffect` 的 cleanup 只在依赖变化或卸载时调用。
早期用一个"每次渲染都跑 cleanup"的 stub，会把在途请求 abort 掉，症状是 `state.aborted`（"收工了，没锻"）——
那是测试壳的缺陷，不是产品 bug。

---

## Code Review Checklist

- [ ] `npm run check` 通过（含 lint 严格模式）
- [ ] 新增断言有对应的失败反例（不是永真）
- [ ] `npm pack --dry-run` 内容符合预期
- [ ] 运行时行为无变化（或变化已明确说明并验证）
- [ ] 行尾与仓库一致（本仓库跟踪文件是 CRLF；`tools/asar.mjs` 与 workflow YAML 是 LF），
      编辑后 `git diff --stat` 没有出现"整文件重写"
- [ ] README 中的数字与实测一致
