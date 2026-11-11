# Feature Design：思考强度默认跟随与锁定 + 生成中边框跑马灯

status: approved
execution_lane: standard

## 目标与非目标

### 目标（Goals）

- busy 状态增加可见的边框跑马灯：CSS-only、无 JS 定时器、不影响布局与交互；给出可行性结论。
- 思考强度默认值：首次进入取当前模型默认挡位；非首次取上一次设定；挡位列表始终来自当前模型（或插件当前选中模型）。
- 插件菜单新增「锻造模型」选择项：默认当前 DSH 模型，可切换；支持锁定，锁定后模型与思考强度冻结。
- `efforts` 为空的模型：思考强度整行不渲染。
- 版本升至 0.6.1；完成后刷新 desktop profile 安装副本。

### 非目标（Non-goals）

- 不改变 DSH 会话的全局当前模型。
- 不复制图3 的搜索框、模型分组折叠等完整选择器交互；用原生分组下拉满足选择需求。
- 不引入第三方依赖、构建步骤或新的全局状态库。
- 不改动 style/preset 的现有行为与存储键。

## 需求拆解与实现方案

### 涉及模块与边界

| 文件 | 改动 |
|------|------|
| `client.js` | 新增模型/锁定/思考强度状态与存储函数；菜单新增模型行；busy 跑马灯 CSS；`postBody` 携带 provider/model；导出新纯函数供测试 |
| `index.js` | `resolveRoute` 支持显式 route 覆盖；`describeModel` 支持指定模型；新增 `GET /models`；`GET /model` 支持 `?provider=&model=`；`POST /optimize` 接受 `provider`/`model`；`VERSION` 改 0.6.1 |
| `package.json` | `version` 改 0.6.1 |
| `tools/selftest.mjs` | 覆盖新端点、默认值、锁定、无挡位隐藏、跑马灯 CSS；更新受菜单结构影响的断言 |
| `tools/preview.html` | 菜单预览的 hook 种子适配新增状态；busy 预览可看到跑马灯 |
| `README.md` | 更新思考强度/模型选择/锁定说明与版本 |
| `preview/harden-button.png` | 如重新生成预览图，则同步更新 |

### 核心数据流与逻辑拆解

```text
页面挂载
  ├─ readStoredLock() ── locked? ── 用锁定快照 {provider, model, effort}
  └─ readStoredModel() ── 有手动选择? ── 用它；否则等 /models.current
        ↓
GET /dsh-prompt-optimizer/models
  ├─ current = agentDefaultModel.currentSelection()
  └─ models = llm.listProviders() × llm.listModels(provider)
        ↓
GET /dsh-prompt-optimizer/model?provider=&model=
  ├─ efforts = llm.resolveModelInfo(...).reasoning.efforts
  └─ defaultEffort = reasoning.defaultEffort || currentSelection.reasoningEffort
        ↓
默认思考强度 = resolveEffort({ efforts, effort: defaultEffort }, 上次设定)
  ├─ 上次设定在 efforts 中 → 用它（非首次）
  ├─ 否则 defaultEffort 在 efforts 中 → 用它（首次）
  └─ 否则 efforts[0]
        ↓
用户改模型（未锁定）→ 重新拉 /model → 重算 efforts 与默认 effort
用户改强度（未锁定）→ setEffort + rememberEffort(provider/model, effort)
用户锁定 → 快照 {provider, model, effort} 存入 lock 键；UI 禁用模型与强度
用户解锁 → 清除 lock 键；保留当前选择，可继续改
        ↓
开锻 → POST /optimize { text, style, preset, reasoningEffort, provider, model }
        ↓
宿主 resolveRoute(config, override) → llm.stream(...)
```

状态字段（`HardForge`）：

- `models`: `[{ provider, providerName, model, name }]`
- `selection`: `{ provider, model, manual }` 或 `null`
- `locked`: `boolean`
- `efforts`: `[{ id, name }]`
- `effort`: `string`
- `effortSource`: `'stored' | 'model' | 'fallback'`（用于显示"上次设定/模型默认"）

新增 hook 一律追加在现有 `phase, note, picking, style, preset, efforts, effort` 之后，保持既有测试的 seed 顺序。

### 契约变更

**HTTP**

- 新增 `GET /dsh-prompt-optimizer/models`：
  ```json
  {
    "ok": true,
    "current": { "provider": "p", "model": "m" },
    "models": [
      { "provider": "p", "providerName": "P", "model": "m", "name": "M" }
    ]
  }
  ```
  `current` 不可用时为 `null`；`models` 枚举失败时为空数组。
- `GET /dsh-prompt-optimizer/model` 增加可选 query `provider` / `model`（两者同时非空才生效）；返回结构与现在一致。
- `POST /dsh-prompt-optimizer/optimize` 增加可选 `provider` / `model`；宿主优先用它们作为本次锻造路由，非法/缺失时回退现有 `resolveRoute` 逻辑。

**localStorage**

| 键 | 值 | 说明 |
|----|----|------|
| `dsh-prompt-optimizer:model` | `{ provider, model, manual }` | 用户模型选择；`manual=false` 表示跟随当前 |
| `dsh-prompt-optimizer:lock` | `{ provider, model, effort }` | 锁定快照；存在即锁定 |
| `dsh-prompt-optimizer:effort:<provider>/<model>` | `string` | 该模型上一次选择的挡位 |
| `dsh-prompt-optimizer:style` / `:preset` | 不变 | 现有行为 |

所有读写 try/catch；存储不可用时内存态照常工作。

### 关键技术选型与取舍

**图1 跑马灯：可行性结论 = 可行，CSS-only 双层环。**

- 在 `.dshPo_btn[data-phase=busy]::before` 上画 1.5px 的 conic-gradient 环，用 `mask`/`mask-composite: exclude` 只保留边缘；`@property --dshPoAngle` 驱动 `from` 角度旋转，1.05s 一圈。
- 保留现有 `background-position` 流动与 pulse 作为底层光效，跑马灯是叠加层；不改 DOM 结构。
- 性能：动画只作用于按钮自身约 80×26px 的伪元素，无布局属性；`prefers-reduced-motion` 下同时停掉伪元素动画。降级路径：不支持 `@property` 的浏览器看到静态渐变环，现有流动动画仍在。
- 不选 JS `requestAnimationFrame`（多一个常驻循环、还要处理卸载），不选 `border-image`（不能平滑动画渐变角度）。

**图3 模型选择：原生 `<select>` + provider `<optgroup>`。**

- 原生控件自带键盘导航、滚动与可访问性；零依赖、零弹出层管理。
- 不复制搜索框：模型数量由本机 provider 决定，原生 select 可滚动；搜索属于额外功能（YAGNI）。
- 锁定按钮用 `role="switch"` + `aria-checked`；锁定时 `select` 与 effort chips 都 `disabled`。

**思考强度记忆：按 `provider/model` 分别记忆。**

- 不同模型挡位集合不同，全局"最后一次"可能落在非法挡位；按模型记忆能同时满足"上一次设定"和"挡位合法"。
- 首次（该模型无记录）用模型 `defaultEffort`；记录失效（模型改配置）回退 `defaultEffort`；再回退 `efforts[0]`。

**模型跟随语义：**

- 默认 `manual=false`：每次打开菜单刷新 `/models`，跟随 DSH 当前模型。
- 用户手动选择后 `manual=true`：保持选择，不因 DSH 当前模型变化而覆盖。
- 锁定：冻结快照；解锁后保留选择（`manual=true`），用户可手动改回，或重新选择当前模型。

## 验证计划

1. `node tools/selftest.mjs`：全量离线自测通过（宿主机路由 + 客户端纯函数 + 菜单结构 + CSS 断言）。
2. 浏览器打开 `tools/preview.html`：肉眼确认 busy 态边框跑马灯连续旋转；菜单出现模型行、锁定开关、思考强度行；无挡位时思考强度行消失。
3. 实际 DSH Web GUI（插件刷新后重启）：打开 `♂harden` 菜单，验证：
   - 首次清空 localStorage → 思考强度 = 当前模型默认；
   - 改一次强度后重开 → 默认 = 上次设定；
   - 切换模型 → 挡位列表随模型变化；
   - 锁定 → 切换 DSH 模型后插件模型与强度不变；解锁 → 可改；
   - 选一个无 `efforts` 的模型 → 思考强度行不显示。
4. `git diff` 人工过一遍：无调试代码、无临时文件、无无关改动。
5. 推送后 `git ls-remote origin main` 核对远程 HEAD 与本地一致。

## 风险与回滚

- **模型列表端点依赖 `llm.listProviders/listModels`**：宿主不提供时返回空列表，前端降级为「当前模型」单选，不阻断锻造。
- **`@property` 兼容性**：不支持时环静止但可见，现有流动动画兜底；不会出现布局破坏。
- **localStorage 残留**：旧版本没有这些键，首次进入即"首次"路径；键名带命名空间，不与其它插件冲突。
- **路由覆盖**：`provider/model` 只接受非空字符串并限制长度；模型不可用时沿用现有失败回退（本地兜底或错误提示），不抛新异常。
- **回滚**：本次改动集中在两个源文件与测试/文档，可用 `git revert <commit>` 整段回滚；localStorage 新键可忽略，不影响旧版本运行。

## 人审检查点

- [ ] 需求拆解完整，实现方案清晰
- [ ] 设计已获用户确认（status=approved）后再进入实现
- [ ] 确认「思考强度按模型分别记忆」的口径符合预期
- [ ] 确认「模型选择用原生分组下拉，不做图3 搜索框」的范围

## UI 返工（step-10，2026-10-25）

- 模型、思考强度、锁定合并为同一行：`[模型 select] [Low/High/Max] [锁定 label + toggle]`；不再单独渲染思考强度行，也不显示「首个挡位/上次设定」来源提示。
- 锁定从文字按钮改为 30×16 的 toggle switch（白色滑块，锁定后右移并变橙），保留「锁定/已锁定」小标签与 `role="switch"`/`aria-checked`。
- 扁平化：菜单 padding 8、圆角 10、轻阴影；chips 26px（effort chips 24px）、圆角 6、选中只留浅橙底 + 细边；select 26px；开锻按钮 34px、圆角 8、去掉重渐变和投影。
- 测试同步：模型行结构、switch 禁用态、effort chips 并排、扁平尺寸断言；预览图 `preview/harden-button.png` 已更新。

## 模型下拉返工（2026-10-26）

- 原生 `<select>` 的 option 在深色模式下是白底白字；改为自绘下拉，颜色完全跟随 `--dsw-alias-bg-layer-2` / `--dsw-alias-label-primary`。
- 结构：`.dshPo_modelField` 内放 `.dshPo_modelButton`（当前模型名 + CSS 箭头）和 `.dshPo_modelList`（provider 分组、选项、选中勾）。
- 交互：点击开关、外部点击/Escape 关闭、锁定后按钮禁用；选项点击后关闭并调用 `chooseModel`。
- 测试：235 项通过；覆盖下拉主题色、非原生 select、分组与选中态。

