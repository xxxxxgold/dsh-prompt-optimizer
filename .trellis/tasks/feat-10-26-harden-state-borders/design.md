# Feature Design — 四态边框特效 + 开锻按钮重做

status: draft   # draft | approved
execution_lane: standard

## 目标与非目标

### 目标（Goals）

- 四态边框**视觉语言各不相同**，关掉动画也能一眼分清。
- busy 跑马灯在默认配置下**必定运行**，即使系统 `prefers-reduced-motion: reduce`。
- 「开锻」按钮从"一条渐变"升级为有层次、有反馈的主行动按钮。
- 用配置项 `motion` 把"强制动画"与"尊重系统"变成显式选择。

### 非目标（Non-goals）

- 不改 `♂harden` 文案、不改插槽与菜单结构、不改 forge 逻辑。
- 不引入 JS 动画（`requestAnimationFrame`）或第三方库。
- 不动 `forced-colors` 兼容分支与 `prefers-reduced-motion` 之外的无障碍规则。

## 需求拆解与实现方案

### 涉及模块与边界

| 文件 | 改动 |
|---|---|
| `client.js` | `.dshPo_btn` 四态伪元素与变量；`.dshPo_go` 重做；挂载时读 `/health` 设置 `data-motion`；`CSS` 导出同步 |
| `index.js` | `DEFAULTS.motion='always'`；`normalizeConfig` 读取；`/health` 返回 `motion` |
| `tools/selftest.mjs` | 四态 CSS 断言更新；`motion` 默认值与 `/health` 断言；跑马灯断言改为"默认 always 下不被 reduce 关闭" |
| `tools/preview.html` | 四态与菜单预览（如需要，注入 `data-motion`） |
| `preview/harden-button.png` | 重新生成 |
| `README.md` | 四态边框 + `motion` 配置说明 |

### 四态视觉规格

统一用 `.dshPo_btn` 上的两个伪元素分层（`::before` 外环 / `::after` 纹理或高光），
背景渐变仍走现有三层 `background-clip` 方案；**只动颜色、纹理、动画曲线，不动尺寸与布局**。

| 状态 | 边框语义 | 具体实现 | 动画 |
|---|---|---|---|
| **idle** | 四色渐变细环（粉橙紫金） | 现有 `--dshPo-ring` 三色渐变；`background-size:300% 100%` | `dshPoFlow` 8s 极缓慢位移（低存在感） |
| **busy** | **跑马灯双环**：外环旋转 + 内环静态 | `::before`：conic-gradient 跑马灯，`inset:-2px`、`padding:2px`、`mask-composite:exclude`；`::after`：`inset:0` 静态琥珀 1px 内环 | 外环 `dshPoOrbit 1.05s linear infinite`（`--dshPoAngle` 驱动）+ 光晕 `dshPoPulse 1.5s` + 扫光 `dshPoSweep .95s` |
| **done** | **青绿双环 + 顶部高光** | `--dshPo-ring` 青绿三段；`::before` 静态双色环；`::after` 顶部 `radial-gradient` 高光点 | 一次性 `dshPoPop .5s` + 柔和呼吸 `dshPoBreathe 2.8s`（**不旋转**，区别于 busy） |
| **error** | **红橙警示斜纹** | `--dshPo-ring` 红橙；`::before` = `repeating-linear-gradient(45deg,#f04438 0 6px,#ff7a59 6px 12px)` 细纹理环；`::after` 内阴影 | 一次性 `dshPoShake .42s` + 边框 `dshPoAlarm 1.6s` 闪 2 次后停（**无光晕**，区别于 done） |

关键差异（不看文字也能分）：

- idle = 细环慢流（安静）
- busy = 双环旋转 + 光晕（在动）
- done = 双环 + 顶部高光（不转、亮）
- error = 斜纹环 + 抖动（纹理）

### 开锻按钮规格（`.dshPo_go`）

```css
/* 底层渐变 + 顶部内高光 */
background:
  linear-gradient(180deg,rgba(255,255,255,.20),rgba(255,255,255,0) 44%),
  linear-gradient(100deg,#ff3b30 0%,#ff6a00 46%,#ffb020 100%);
box-shadow:
  inset 0 1px 0 rgba(255,255,255,.30),
  0 4px 16px rgba(255,80,0,.34),
  0 0 0 1px rgba(255,120,0,.45);
/* hover：抬升 1px + 光晕加强 + 亮度 */
/* active：下压 1px + inset 暗角 */
/* disabled：去饱和 + 降阴影 */
/* ::after：斜向扫光条，hover 时 1.2s 扫过一次 */
```

### motion 协议

```text
host  DEFAULTS.motion = 'always'
      normalizeConfig: motion = raw.motion === 'auto' ? 'auto' : 'always'
      GET /health -> { ..., motion: 'always' | 'auto' }
        ↓
client 挂载后 fetch /health（一次，失败静默）-> 根节点 dataset.motion
        ↓
css   @media (prefers-reduced-motion: reduce) {
        [data-motion="auto"] .dshPo_btn, ... { animation: none !important }
      }
      未设置 data-motion 或 ="always" -> 动画照跑
```

### 契约变更

- `GET /health` 响应新增 `motion: 'always'|'auto'`（**向后兼容**：新增字段，不改既有字段）。
- Loader 配置新增 `motion`（默认 `always`）。

### 关键技术选型与取舍

- **纯 CSS 分层而非 JS**：沿用现有 conic + mask 方案，保持合成层友好；新增效果只动 `transform`/`opacity`/自定义属性。
- **默认 always**：用户明确要求"强制开动画"；用 `auto` 提供退出开关，README 明示取舍。
- **每个状态独占 `::before` 语义**：同一时刻只有一种 phase 生效，不存在伪元素争用。

## 验证计划

1. `node tools/selftest.mjs`：全绿（含新增四态/motion 断言）。
2. 无头渲染 + CDP/注入探测：四态 `::before` 的 `animationName` / `backgroundImage` / `maskComposite` 逐一比对；
   在 `reducedMotion: true` 下确认 `animationName` **不是** `none`。
3. `tools/preview.html` 截图：四态 + 菜单，肉眼比对差异。
4. 桌面版真机：`PrintWindow` 截图四态（idle/busy/done/error），确认边框可辨、按钮有 hover/active 反馈。
5. `README.md` / `preview/harden-button.png` 同步。

## 风险与回滚

- **风险 1**：改 `.dshPo_btn` 基础层会连带影响 idle；缓解：四态逐个截图比对。
- **风险 2**：`mask-composite` 在部分 Chromium 版本不接受 `exclude`；已确认本机支持，保留 `-webkit-` 前缀兜底。
- **风险 3**：selftest 的 CSS 字符串断言会因重写而失败；必须同步更新且保持"非恒真"。
- **回滚**：改动集中在 `client.js` 样式数组 + `index.js` 一个默认值；`git revert` 单个 commit 即可。

## 人审检查点

- [ ] 四态边框语义清晰、互不混淆
- [ ] 开锻按钮方案符合"酷炫"预期
- [ ] `motion` 默认 `always` + `auto` 开关的取舍可接受
- [ ] design 已获用户确认（status=approved）后再进入实现
