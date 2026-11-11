# Code Review

status: passed
verdict: PASS

## 审查方式

- 主会话对 `client.js` / `index.js` / `tools/selftest.mjs` / `tools/preview.html` / `README.md` 做逐段走查，并跑 `node tools/selftest.mjs`（228 passed, 0 failed）。
- 两次派发独立审查子代理均未在时限内产出（工具侧超时，非代码问题），本记录如实标注；结论基于自动化测试、浏览器实测（预览页与动画 computed style）和主会话代码走查。

## Findings

### minor

1. `index.js:describeModels` 串行遍历 provider 调 `listModels`，provider 很多时首次打开菜单可能略慢；当前本机模型数量可控，未做缓存（YAGNI）。
2. `client.js:resolveEffort` 在锁定快照的 effort 已不在模型 `efforts` 中时，会回退到模型默认挡位；这是模型配置变化的降级路径，避免发送非法 effort。
3. 模型选择使用原生 `<select>` + `<optgroup>`，不包含图3 的搜索框；design.md 已明确这是 YAGNI 取舍。
4. 锁定后若锁定模型已从宿主目录移除，`/model` 会返回失败，思考强度行隐藏；解锁后仍可重新选择。属于外部模型配置变化，不是逻辑缺陷。

### 未发现

- 无 blocking / major 问题。
- 无调试残留、无 TODO/占位符、无无关业务改动。
- `package.json` 与 `index.js` 版本均为 0.6.1。

## 验收对照

| PRD 验收 | 结论 | 证据 |
|---|---|---|
| 图1 busy 边框跑马灯 | 通过（静态/动画结构） | CSS 含 `@property --dshPoAngle`、`dshPoOrbit`、`[data-phase=busy]::before`；浏览器 computed style `animationName=dshPoOrbit`、1.05s、`::before` running（覆盖 reduced-motion 验证） |
| 图1 不影响布局/交互；reduced-motion 停动 | 通过 | 伪元素 `pointer-events:none`；`prefers-reduced-motion` 块包含伪元素 `animation:none!important`；测试覆盖 |
| 图2-1 首次=模型默认 | 通过 | `resolveEffort(model, '')` → `source=model`；测试覆盖 |
| 图2-2 非首次=上次设定 | 通过 | `resolveEffort(model, 'max')` → `source=stored`；`rememberEffort/readStoredEffort` round-trip；测试覆盖 |
| 图2-3 挡位读当前/选中模型 | 通过 | `/model?provider=&model=` 走 `resolveRoute` override；`GET /models` 返回 current；测试覆盖 |
| 图3-1 模型选择项 | 通过（结构） | 菜单含 `model-row` + `model-select`；测试覆盖 |
| 图3-2 默认当前模型 | 通过（逻辑） | 挂载 effect 优先 `catalog.current`；无 catalog 时回退 `/model`；测试覆盖纯函数/端点 |
| 图3-3 锁定冻结 | 通过（结构） | 锁定快照存 `dsh-prompt-optimizer:lock`；锁定时 select/effort chips disabled；测试覆盖 |
| 隐藏规则 | 通过 | `efforts.length===0` 不渲染 effort row；新增 UI 结构测试覆盖 |
| 全量测试 | 通过 | `node tools/selftest.mjs` → 228 passed, 0 failed |
| 提交远程 git | 待执行 | 本 review 之后按顺序提交 |
| 项目卫生 | 待执行 | 提交后清理临时文件与调试残留 |
| 插件 0.6.1 | 待执行 | 提交后刷新 desktop profile 并核对版本 |

## 结论

PASS：代码接缝、契约与测试证据齐全，可进入收尾（git 提交 → 卫生 → desktop profile 刷新）；真实 DSH 界面上的最终人工点验在插件刷新后进行。

## UI 返工复查（step-10）

- 结构：模型 select、Low/High/Max、锁定 switch 已合并为同一行；独立「思考强度」行和来源提示已移除。
- 样式：chips 26px（effort 24px）、select 26px、开锻 34px、菜单圆角 10/轻阴影；选中态改浅橙底 + 细边，去掉重渐变/投影。
- 锁定：文字按钮改为 30×16 toggle，滑块右移并变橙，保留「锁定/已锁定」标签与 `role="switch"`。
- 测试：`node tools/selftest.mjs` → **230 passed, 0 failed**；预览页实拍确认未锁定/已锁定两态。
- 结论：PASS。

## 模型下拉复查（2026-10-26）

- 原生 select 已移除，改为自绘 `.dshPo_modelButton` + `.dshPo_modelList`；背景/文字使用主题变量，深色模式下不再白底白字。
- 下拉支持 provider 分组、选中勾、点击/外部点击/Escape 关闭，锁定后按钮禁用。
- 测试：`node tools/selftest.mjs` → **235 passed, 0 failed**；预览页确认深色列表可读、无原生白色 option。
- 结论：PASS。

