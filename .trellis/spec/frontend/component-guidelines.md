# Component Guidelines

> How components are built in this project.

---

## Overview

客户端只有一个组件：`HardForge`，外加一层薄包装 `HardForgeEntry`。没有组件库、没有构建步骤、
没有 JSX 编译——**用 `react/jsx-runtime` 的 `jsx` / `jsxs` 函数直接构造元素树**。

```
HardForgeEntry(props)        // 守卫：props 不齐全就 return null
└── HardForge(props)         // 真正的一块 UI
    ├── 药丸按钮 ♂harden      // 永远挂载，四态换外观
    └── 菜单（picking 时）     // 模型行 + 口味行 + 规范行 + 开锻按钮
```

组件不碰 DOM，不碰编辑器实例：草稿从 `useInput(selector)` 读，改写结果通过
`inputActions.setDraft(text)` 写回。**这是唯一的输入输出契约。**

---

## Component Structure

一个组件的固定阅读顺序：

```
1. 依赖与常量引用
2. 本地状态（useState）—— 按注释里的顺序排列，测试桩依赖这个顺序
3. ref（abortRef / rootRef / modelFieldRef）
4. effects（挂载期 / 卸载期 / 依赖变化期）
5. 派生值（empty / busy / title / label）
6. 事件处理器（openPicker / forge / choose / choosePreset / copyNote）
7. 渲染（一个根节点，子节点顺序即 DOM 顺序）
```

**状态顺序是有契约价值的**：`tools/selftest.mjs` 用 `useState` 的调用顺序注入预设值来渲染菜单，
顺序变了测试会红。改顺序就要同步改测试里的 `preset` 数组注释。

---

## Props Conventions

`HardForgeEntry` 只接受宿主插槽给的三样：

| prop | 形状 | 用法 |
|---|---|---|
| `useInput` | `(selector) => selector(state)` | 取草稿：`useInput((s) => s?.draft ?? '')` |
| `inputActions` | `{ setDraft(text) }` | 唯一写回通道 |
| `t` | `(key) => string` \| `undefined` | 宿主字典；缺省时用自己的内置字典 |

守卫写法（缺任何一样就不渲染，绝不半渲染）：

```js
if (typeof p.useInput !== 'function' || p.inputActions == null || typeof p.inputActions.setDraft !== 'function') {
  return null;
}
```

**禁止**要求调用方提供更多 props。需要新数据就自己 `fetch` 自己的端点。

---

## Styling Patterns

- **全部样式在 `client.js` 的 `CSS` 字符串里**，类名统一 `dshPo_` 前缀，避免与宿主冲突。
- 注入方式：创建 `<style data-plugin-css>` 塞进 `<head>`，`apply` 返回的 dispose 里移除。
- 主题色走宿主 CSS 变量（`--dsw-alias-bg-layer-1/2`、`--dsw-alias-label-primary`），
  **不要写死颜色**，否则暗色主题会瞎。
- 环与光效用伪元素 + `background-clip: padding-box,padding-box,border-box` 三层背景，
  不额外套 DOM 节点。
- 动效必须能被宿主关闭：`/health` 返回 `motion: 'auto'` 时给根节点加 `data-motion="auto"`，
  样式里用 `@media (prefers-reduced-motion: reduce)` 配合 `[data-motion=auto]` 关掉。
- `forced-colors` 模式要保证文案可见（有专门断言）。

---

## Accessibility

- 药丸：`aria-expanded` 反映菜单开合，`data-open` 只用于样式。
- 开关（锁定）：用 `role="switch"` + `aria-checked`，不要只靠颜色表达状态。
- 模型下拉：选项带 `role="option"`、当前项 `data-active="true"`；分组用 `.dshPo_modelGroup`。
- 菜单可用 Escape 关闭；点击外部关闭走 `pointerdown`。
- 四态（idle/busy/done/error）**文案完全相同**（钉死为 `♂harden`，7 个字符），
  状态只靠外观与 `title` 提示表达——这是产品要求，不要「顺手」改成动态文案。

---

## Common Mistakes

| 踩过的坑 | 后果 | 正确做法 |
|---|---|---|
| 打开菜单时卸载药丸 | 焦点丢失、`aria-expanded` 无处可挂 | 药丸常驻，菜单作为兄弟节点 |
| 用真实 DOM 查询改样式 | 宿主升级即碎 | 只通过 props 与 CSS 变量交互 |
| 把 `/health` 的 motion 策略当可选 | 无障碍用户被强制动效 | 挂载期拉一次 health，读到 `auto` 就设 `data-motion` |
| 在渲染里直接 `fetch` | 每次渲染都发请求 | 放进 `useEffect`，依赖数组只放真正相关的值 |
| 忘记在 dispose 里移除 `<style>` | 热重载后样式重复叠加 | `apply` 返回清理函数 |
| 改了状态顺序不同步测试 | 自测红但看不出原因 | 同步改 `selftest` 里的 `preset` 数组与注释 |
