# Feature PRD — 思考强度默认跟随与锁定 + 生成中边框跑马灯

> **重建说明（2026-10-26）**：本文件原内容于 2026-10-26 01:08 被 `trellis_artifact_update`
> 误覆盖（工具未按会话绑定选取任务目录）。仓库 `.trellis/` 未纳入 git，无版本备份。
> 现依据同目录 `task.json`（description + 10 个 steps 的 acceptance/verificationNotes）、
> `design.md`（目标/非目标/契约）、`review.md`（验收对照表）重建。若与原稿有措辞差异，
> 以代码与 `task.json` 的事实为准。

## 背景

`♂harden` 插件已有按钮四态、口味/规范选择与本地兜底，但缺少三件事：

1. **生成中缺少可见反馈**：`data-phase=busy` 只有静态样式，长耗时的模型调用期间用户不知道还在跑。
2. **思考强度默认值不合理**：每次进入都取模型默认挡位，覆盖不了用户上一次的选择。
3. **锻造模型不可选**：插件只能跟随 DSH 当前模型，也无法锁定，切换会话/模型时会漂移。

本轮补齐这三条线，并把版本升到 0.6.1、刷新 desktop profile 安装副本。

## 范围

### In Scope

- **图1 跑马灯**：busy 状态增加边框跑马灯（CSS-only，无 JS 定时器），先给可行性结论再实现；
  不破坏布局与交互，`prefers-reduced-motion` 下停动。
- **图2 思考强度默认值**：首次进入取当前模型默认挡位；非首次取该模型上一次设定；
  挡位列表始终随当前模型（或插件当前选中模型）变化。
- **图3 模型选择 + 锁定**：插件菜单新增「锻造模型」选择项，默认当前 DSH 模型、可切换；
  新增锁定开关，锁定后模型与思考强度冻结；解锁后保留选择可继续改。
- **无挡位隐藏**：`efforts` 为空的模型不渲染思考强度。
- 版本升至 0.6.1；selftest / preview.html / README 同步更新。
- 收尾流程：测试 → 远程 git 提交 → 项目卫生 → 刷新插件到 desktop profile。

### Out of Scope

- 不改变 DSH 会话的全局当前模型。
- 不复制图3 的搜索框、模型分组折叠等完整选择器交互；用原生分组下拉满足选择需求。
- 不引入第三方依赖、构建步骤或新的全局状态库。
- 不改动 style/preset 的现有行为与存储键。

## 验收标准

- [x] **改动点清单**：覆盖图1、图2、图3 与无挡位隐藏四项，无遗漏。
- [x] **图1 可行性 + 实现**：结论明确（CSS-only 双层环，1.05s 一圈），方案可直接落地；
      静态/动画结构验证通过，`pointer-events:none` 不影响交互，reduced-motion 停动。
- [x] **图2 三条子项**：首次=模型默认；非首次=该模型上次设定；挡位随当前/选中模型。
- [x] **图3 选择与锁定**：模型行默认当前模型；锁定时 `select` 与 effort chips 全部 `disabled`；
      锁定快照优先。
- [x] **无挡位隐藏**：`efforts` 为空时不渲染思考强度行，且请求不带 `reasoningEffort`。
- [x] **全量测试**：`node tools/selftest.mjs` 通过（收尾时为 228 项，后续返工增至 235 项）；
      `node --check` 均通过。
- [x] **远程提交**：功能提交 `f75374c` + Trellis 属性 `13a446c` 已推送 `origin/main`。
- [x] **项目卫生**：无临时文件、无调试代码残留。
- [x] **插件刷新**：desktop profile 安装副本 0.6.1，client/index/package 哈希一致。
- [x] **扁平化 UI（step-10）**：锁定改 toggle；模型+思考强度+锁定同一行；菜单扁平紧凑。
- [x] **模型下拉返工**：原生 `<select>` 深色下白底白字，改为自绘下拉；235 项测试通过。

## 约束与风险

- **模型列表端点依赖** `llm.listProviders/listModels`：不可用时返回空列表，前端降级为「当前模型」单选，
  不阻断锻造。
- **`@property` 兼容性**：不支持时环静止但可见，现有流动动画兜底，不出现布局破坏。
- **localStorage 残留**：旧版本无这些键，首次进入即走「首次」路径；键名带命名空间，不与其他插件冲突。
- **路由覆盖**：`provider/model` 只接受非空字符串并限制长度；模型不可用时沿用现有失败回退。
- **回滚**：改动集中在两个源文件与测试/文档，`git revert <commit>` 可整段回滚；
  新增 localStorage 键可忽略，不影响旧版本运行。

## 相关代码/文档

- `client.js` — 模型/锁定/思考强度状态与存储、菜单模型行、busy 跑马灯 CSS、`postBody` 携带路由
- `index.js` — `resolveRoute` 路由覆盖、`describeModel`、`GET /models`、`GET /model` 查询参数、
  `POST /optimize` 接受 `provider`/`model`、`VERSION` 0.6.1
- `package.json` — `version` 0.6.1
- `tools/selftest.mjs` — 新端点、默认值、锁定、无挡位隐藏、跑马灯 CSS 断言
- `tools/preview.html` — 菜单预览 hook 种子适配
- `README.md` / `preview/harden-button.png` — 文档与截图同步
