# Feature PRD — 四态边框特效 + 开锻按钮重做（动画强制开启）

## 背景

用户反馈两件事：

1. **busy 态跑马灯没有了**；
2. **「开锻」按钮没有之前的效果了**，要求重做成酷炫版本；
3. 追加要求：**每个状态都要有独一无二的边框特效**。

规划期实测定位到根因：

| 事实 | 证据 |
|---|---|
| 系统动画被关闭 | `SPI_GETCLIENTAREAANIMATION = 0`、`MinAnimate = 0` |
| 渲染层因此报告 reduce | 无头探测 `reducedMotion: true` |
| 插件 CSS 全量停动画 | `@media (prefers-reduced-motion:reduce){ … animation:none!important }` |
| 跑马灯代码本身还在 | `@keyframes dshPoOrbit`、`[data-phase=busy]::before`、`mask-composite:exclude` 均存在且被支持 |
| 计算样式确认被停 | busy `::before` → `animationName: none`、`animationDuration: 0s` |
| 开锻按钮被扁平化做素 | `.dshPo_go` 仅一条线性渐变 + `filter:brightness(1.04)`，`box-shadow:none` |

结论：不是样式丢失，是**动画被无障碍媒体查询全量关掉**，加上按钮在上一轮「扁平化」被削到只剩基础渐变。

## 范围

### In Scope

- **四态边框特效**：idle / busy / done / error 各一套**视觉语言不同**的边框（环数、纹理、光晕、动画曲线均不同），静态下也能一眼区分。
- **busy 跑马灯恢复并强化**：外环 conic 跑马灯 + 内环静态琥珀 + 呼吸光晕 + 扫光。
- **开锻按钮重做**：多层渐变 + 内高光 + 外发光 + hover 抬升 + active 下压 + 扫光条。
- **motion 策略**：新增 `motion` 配置（`always` | `auto`），**默认 `always`**（满足用户"强制开动画"），
  `auto` 时恢复尊重系统 `prefers-reduced-motion`。
- 预览页、预览截图、README、selftest 断言同步更新。

### Out of Scope

- 不改按钮文案（恒为 `♂harden`）、不改插槽/菜单结构、不改任何 HTTP 契约语义。
- 不改 forge 流程、模型选择、锁定、口味/规范逻辑。
- 不引入第三方依赖、不加 JS 动画循环（纯 CSS）。
- 不做主题系统重构。

## 验收标准

- [ ] **四态可辨**：四张真渲染截图两两对比，边框视觉语言（颜色/环数/纹理/动效）均不同，不看文字也能区分。
- [ ] **busy 跑马灯**：`::before` 的 `animationName` 为 `dshPoOrbit` 且 `animationDuration` 非 0（在默认 `motion=always` 下，即使系统 reduce 为 true）。
- [ ] **动效默认开**：系统 `prefers-reduced-motion: reduce` 时，默认配置下动画仍运行；`motion=auto` 时才停。
- [ ] **开锻按钮**：hover / active / disabled 三态有明确视觉反馈，扫光条可见。
- [ ] **回归**：`node tools/selftest.mjs` 全绿；四态 label 仍恒为 `♂harden`；`prefers-reduced-motion` 之外的
      `forced-colors` 兼容仍保留。
- [ ] **文档**：README 更新四态边框与 `motion` 配置说明；预览图重新生成。

## 约束与风险

- **无障碍取舍**：默认 `always` 与「尊重用户系统设置」相悖；通过 `motion:auto` 留出口，并在 README 明示。
- **性能**：conic 渐变 + mask 已在用，新增效果须保持合成层友好（只动 `transform`/`opacity`/自定义属性，不动布局属性）。
- **视觉回归**：改 `.dshPo_btn` 基础样式会影响 idle，需逐一比对四态，避免"改一个坏三个"。
- **测试耦合**：selftest 有多条 CSS 字符串断言（`background-clip`、`dshPoOrbit`、`prefers-reduced-motion` 等），
  改动需同步更新断言，且不得把断言改成恒真。
- **真机验证依赖坐标点击**：沿用上一轮方法（`PrintWindow` + `SetCursorPos`），窗口布局变化需重新定位。

## 相关代码/文档

- `client.js` — `.dshPo_btn` 四态样式、`::before` 跑马灯、`.dshPo_go` 开锻按钮、`CSS` 导出
- `index.js` — `DEFAULTS` / `normalizeConfig` 新增 `motion`；`/health` 暴露 `motion`
- `tools/selftest.mjs` — 四态 CSS 断言、motion 默认值断言
- `tools/preview.html` — 四态与菜单预览
- `preview/harden-button.png` — 预览截图
- `README.md` — 样式与配置说明
