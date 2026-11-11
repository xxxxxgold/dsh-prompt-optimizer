# Directory Structure

> How the code in this repository is organized.

---

## Overview

This is a **single-package DSH plugin**, not a multi-package monorepo. There is no `src/` tree:
the two halves that ship live at the repo root, because the plugin's `exports` map and the
`dsh.bundle.patch` / `dsh.client` manifest fields point at them by path.

The split that matters is **runtime vs development**:

| Bucket | Files | Ships in the npm tarball? |
|---|---|---|
| Runtime | `index.js`, `client.js`, `cordis.patch.yml`, `package.json` | yes |
| Docs / licence | `README.md`, `LICENSE` | yes |
| Development | `tools/`, `eslint.config.js`, `package-lock.json`, `preview/` | **no** (excluded by `files`) |
| Workspace state | `.trellis/`, `.agents/`, `.dsh/`, `AGENTS.md` | no |
| Local only | `tmp/`, `scratch/`, `.dsh-ops/`, `node_modules/` | no (gitignored) |

---

## Directory Layout

```
dsh-prompt-optimizer/
├── index.js              # 宿主半：HTTP 面（health / models / model / optimize / probe）+ 提示词锻造
├── client.js             # 客户端半：♂harden 按钮 + 样式表 + 插槽注册（浏览器 bundle）
├── cordis.patch.yml      # 挂载声明：往 profile 里插一行 loader
├── package.json          # exports / dsh 清单 / scripts / files 白名单 / devDependencies
├── eslint.config.js      # ESLint 9 flat config（前后端 globals 分层）
├── package-lock.json     # 开发期依赖锁定（只有 eslint + @eslint/js）
├── README.md
├── LICENSE
├── preview/
│   └── harden-button.png # 四态 + 菜单截图（CI 之外的重生成见 README）
├── tools/
│   ├── selftest.mjs      # 离线自测：宿主半 + 客户端半 + 工程治理断言（296 项）
│   ├── preview.html      # 真组件预览 + 计算样式探测（无头浏览器截图用）
│   └── asar.mjs          # Electron ASAR 迷你读取器（本地侦察 DSH 应用包）
├── .github/workflows/
│   └── selftest.yml      # CI：语法 + 自测（18/20/22）、lint（20/22）
├── .trellis/             # Trellis 工作流：spec / tasks / workspace / scripts
├── .agents/skills/       # Trellis 自动触发技能
└── .dsh/skills/          # dsh 私有入口技能（trellis-start / continue / finish-work）
```

---

## Module Organization

**宿主半 `index.js` 的内部顺序**（从上往下读就是调用方向）：

```
name / inject                    插件清单（Loader 只读这三项）
DEFAULTS / STYLES / PRESETS      配置默认值与合法取值
STYLE_SAMPLES / STYLE_FLAVOURS   系统提示词的「语气」素材
PRESET_SKELETONS                 三种 Trellis 任务书骨架
buildSystemPrompt / buildUserPrompt
hardenLocally / isThin / buildExpandPrompt / sanitizeOutput
normalizeConfig                  不可信配置 → 完整设置对象
sendJson / readBody / resolveRoute / streamRewrite
describeModel / describeModels   模型行与思考挡位
optimize                         一次锻造的完整决策（路由、重试、兜底）
apply                            挂载 HTTP 路由
__internals                      自测入口（Loader 不使用）
```

**客户端半 `client.js`** 是一个 `window.__ModuleLoader__.load({ id, factory })` 调用；
`factory` 内部顺序：

```
CJS 包装层（module / exports）
常量（NS / ENDPOINT / 各 STORAGE_KEY / LABEL）
存储读写助手
zh / en 字典
CSS 样式表字符串
纯函数（postBody / readResult / readModel / readModels / resolveEffort / translator）
HardForge 组件
HardForgeEntry 包装 + apply（插槽注册 + 样式注入）
exports.* 挂载
```

**新增能力时的落点**：

| 要加的东西 | 放哪 | 注意 |
|---|---|---|
| 新的 HTTP 路由 | `index.js` 的 `apply` 内，按 `route` 分支 | 未知路由必须回 404 `NOT_FOUND` |
| 新的配置项 | `DEFAULTS` + `normalizeConfig` + `/health` 输出 | 三处同改，缺一处就会「配置了但不生效」 |
| 新的提示词语气 | `STYLES` + `STYLE_FLAVOURS` + `client.js` 的 `STYLE_IDS` 与两份字典 | 四味必须处处一致 |
| 新的任务书形状 | `PRESET_IDS` + `PRESET_SKELETONS` + 字典 | `native` 不产出任务书 |
| 开发者工具 | `tools/` | 记得它不进发布包，也不能被运行时 `import` |

---

## Naming Conventions

- **文件名**：全小写，`.js` / `.mjs`。运行时只有 `index.js` 与 `client.js` 两个入口。
- **导出**：宿主半用具名导出（`export const name` / `export function apply`），没有 default export。
- **常量**：`UPPER_SNAKE`（`ROUTE_PREFIX`、`PRESET_SKELETONS`、`MODEL_ENDPOINT`）。
- **内部状态**：`camelCase`；`__internals` 双下划线前缀表示「只给测试用」。
- **错误码**：`UPPER_SNAKE` 字符串（`EMPTY_INPUT`、`INPUT_TOO_LONG`、`BUSY`、`NO_ADAPTER`），
  客户端按码映射成用户可读文案，不要在后端塞中文长句当码。
- **存档键**：`client.js` 顶部集中定义（`STYLE_STORAGE_KEY` 等），不要散落在函数里。
- **locale key**：`<family>.<id>` / `<family>.<id>.hint`，family ∈ button / effort / model / style / preset / state / note。

---

## Examples

写得好的参照物：

- `tools/asar.mjs` —— 纯函数导出 + 可注入依赖（`isFile` / `platform` / `io`）+ 入口守卫，是「开发者工具该长什么样」的模板。
- `index.js` 的 `normalizeConfig` —— 把不可信输入收敛成一个完整对象，下游不用再做防御。
- `client.js` 的 `readResult` / `readModel` —— 把 HTTP 响应收敛成 `{ ok, ... }`，组件里不出现状态码判断。
