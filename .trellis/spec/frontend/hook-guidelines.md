# Hook Guidelines

> How hooks are used in this project.

---

## Overview

客户端**没有自定义 hook**，也没有用 React Query / SWR 之类。`HardForge` 里直接用 React 原语：
`useState` / `useEffect` / `useRef` / `useCallback`。

唯一一个外部「hook 形状」的东西是宿主给的 `useInput(selector)`——它不是我们定义的，
是插槽 props 传进来的快照读取器。**不要为它写包装 hook**，直接用。

---

## Custom Hook Patterns

不定义自定义 hook 的原因：组件只有一个，逻辑内聚在一块比抽出去更好读；
抽 hook 会让「状态顺序」这个隐式契约跨文件，更难维护。

如果将来确实需要抽，遵守：

- 命名 `useXxx`，与 React 惯例一致；
- 只抽**无 UI** 的逻辑，UI 结构留在组件；
- 抽出去之后必须同步更新 `tools/selftest.mjs` 里的状态序列（见「Common Mistakes」）。

---

## Data Fetching

三条固定路径，全部手写 `fetch`，**不用 axios，不做全局拦截器**：

| 时机 | 端点 | 处理 |
|---|---|---|
| 挂载 | `GET /dsh-prompt-optimizer/health` | 只读 `motion`；失败静默（保持默认 `always`） |
| 挂载 + 选中变化 | `GET /dsh-prompt-optimizer/model?provider=&model=` | 拿该模型的思考挡位；失败降级为空列表 |
| 挂载 | `GET /dsh-prompt-optimizer/models` | 拿可选模型目录；失败降级为空 |
| 点击开锻 | `POST /dsh-prompt-optimizer/optimize` | 唯一会花模型额度的调用 |

规则：

1. **每处 `fetch` 都要有 `catch`**，且失败要落到一个可见或无害的状态（不能把组件卡在 busy）。
2. **挂载期请求要防竞态**：用 `let alive = true` + cleanup 里 `alive = false`，
   回包后先判 `alive` 再 `setState`。
3. **可取消的请求要留 abort 通道**：`AbortController` 存在 `abortRef`，卸载时 abort 在途请求。
4. **响应先过收敛函数**：`readResult` / `readModel` / `readModels`，组件里不出现状态码判断。
5. 端点常量集中在文件顶部（`ENDPOINT` / `MODEL_ENDPOINT` / `MODELS_ENDPOINT`），不要写字符串字面量。

```js
// 竞态防护的标准形状
react.useEffect(() => {
  let alive = true;
  fetch(MODELS_ENDPOINT, { headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((body) => {
      if (!alive) return;
      setModels(readModels(body, 200).models);
    })
    .catch(() => {});
  return () => { alive = false; };
}, []);
```

---

## Naming Conventions

- 自定义 hook：`useXxx`（当前没有）。
- 状态对：`const [x, setX] = react.useState(...)`，setter 名与状态同名加 `set` 前缀。
- ref：`xxxRef`（`abortRef` / `rootRef` / `modelFieldRef`）。
- 事件处理器：动词开头（`openPicker` / `forge` / `choose` / `choosePreset` / `copyNote`）。
- 派生布尔：形容词（`empty` / `busy` / `picking` / `modelOpen` / `copied`）。

---

## Common Mistakes

| 坑 | 症状 | 正确做法 |
|---|---|---|
| **自测桩的 effect 语义写错** | 自测报 `state.aborted`（「收工了，没锻」），但真实浏览器正常 | 测试用 React 桩必须遵守真实语义：cleanup 只在依赖变化或卸载时调用。每帧都跑 cleanup 会把在途请求 abort 掉 |
| 改 `useState` 顺序不同步测试 | 自测里菜单渲染错乱 | 同步更新 `selftest` 的 `preset` 数组与它上方的顺序注释 |
| 在 effect 里依赖整个 `selection` 对象 | 每次渲染都换引用 → 无限请求 | 依赖 `selection?.provider` / `selection?.model` 这样的原子值，或依赖稳定化的派生值 |
| 挂载请求不防竞态 | 快速切换模型时旧响应覆盖新状态 | `alive` 标志或 `AbortController` |
| 把 `fetch` 放进渲染体 | 每次渲染发一次请求 | 放进 `useEffect` |
| `busy` 期间允许打开菜单 | 用户以为能重锻，实际会被忽略 | `openPicker` 里先判 `busy` |
| 卸载时不 abort | 组件已消失，回调仍 `setState` | 在 cleanup 里 abort 并置空 ref |
