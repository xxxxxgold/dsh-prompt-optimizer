# Frontend Development Guidelines

> 本项目（dsh-prompt-optimizer）的工程规范。全部条目都绑定真实代码，不写理想化的空话。

---

## Overview

这个仓库是一个 **DSH 插件**，分两半：

- **宿主半** `index.js` —— Node 侧，注册一条 HTTP 前缀路由，调 `ctx.llm.stream()` 锻造提示词；
- **客户端半** `client.js` —— 浏览器侧，往输入框工具行挂一个 `♂harden` 按钮，调宿主半的接口。

零运行时依赖、无构建步骤、无 TypeScript。质量门是 `npm run check` 一条命令。

> **写文档用中文。** Trellis 模板默认要求英文，但本仓库的 README、代码注释、任务产物都是中文，
> 规范跟着已有的实际语言走，不为了模板统一而制造混排。

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | 目录布局、模块内部顺序、新代码该放哪 | 已填写 |
| [Component Guidelines](./component-guidelines.md) | `HardForge` 的结构、props 契约、样式与无障碍 | 已填写 |
| [Hook Guidelines](./hook-guidelines.md) | state 顺序契约、四条 fetch 路径、竞态与卸载 | 已填写 |
| [State Management](./state-management.md) | 宿主状态 / 组件瞬态 / localStorage 三分法 | 已填写 |
| [Quality Guidelines](./quality-guidelines.md) | 质量门、断言必须可证伪、发布包与平台约定 | 已填写 |
| [Type Safety](./type-safety.md) | 无 TS 下的边界收敛与校验纪律 | 已填写 |

跨模块思考指引见 [`../guides/index.md`](../guides/index.md)。

---

## Pre-Development Checklist

动手改代码前逐条过：

- [ ] 读 `prd.md`（在有 active task 时）确认这次要交付什么、明确不做什么
- [ ] 确认改的是**哪一半**：宿主半改完要重启插件；客户端半改完刷新页面
- [ ] 如果是新增配置项 → 记得 `DEFAULTS` + `normalizeConfig` + `/health` 三处同改
- [ ] 如果是新增口味/形状 → 记得 `index.js` 的枚举 + `client.js` 的 `STYLE_IDS`/`PRESET_IDS` + 两份字典
- [ ] 新增断言时先想清楚「它怎么才可能失败」，想不出来就别写
- [ ] 改 `client.js` 的状态顺序 → 同步改 `tools/selftest.mjs` 的 `preset` 数组

---

## Quality Check

改完必须全绿：

```powershell
npm run check     # 语法 → lint(0 warning) → 296 项自测
```

补充验证（视改动范围）：

| 改了什么 | 额外验证 |
|---|---|
| `client.js` 样式或结构 | 无头浏览器渲染 `tools/preview.html` 截图对比 |
| 发布相关（`files`、`scripts`） | `npm pack --dry-run` 核对文件清单 |
| `tools/asar.mjs` | `node tools/asar.mjs ls <substr>` + junction 调用各跑一次 |
| 文档里的数字 | 由自测的 README 计数断言强制校验，跑 `npm test` 即可 |

---

## How These Guidelines Stay True

规则不是一次性写完就冻结的。三轮独立代码审查在本仓库打出的教训，都已固化进
[Quality Guidelines](./quality-guidelines.md) 的禁止模式一节——尤其是「断言必须是可证伪的」
这一类问题（自比较、同义反复、只在不会触发条件的输入上验证）。

发现新坑时：先修代码，再把「为什么会踩」写进对应 guide，与代码同批提交。
