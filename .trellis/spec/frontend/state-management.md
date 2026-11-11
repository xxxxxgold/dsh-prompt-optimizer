# State Management

> How state is managed in this project.

---

## Overview

**没有全局状态库。** 所有状态分三类，各自有明确的归属：

| 类型 | 归属 | 生命周期 | 载体 |
|---|---|---|---|
| 草稿文本 | **宿主的 `InputState`** | 跟随会话 | `useInput(selector)` 读 / `inputActions.setDraft()` 写 |
| 组件瞬态 | `HardForge` 的 `useState` | 组件存活期 | 组件内部 |
| 用户偏好 | `localStorage` | 跨会话 | `client.js` 顶部的 `*_STORAGE_KEY` |

**关键原则：草稿是宿主的，不是我们的。** 插件不缓存草稿副本，每次渲染都从 `useInput` 现读。
这样用户在编辑框里继续打字时，按钮看到的是最新文本。

---

## State Categories

### 1. 宿主状态（只读快照 + 受控写入）

```js
const draft = useInput((state) =>
  state !== null && typeof state === 'object' && typeof state.draft === 'string' ? state.draft : '',
);
```

写入只有一处：锻造成功后 `inputActions.setDraft(result.text)`。
**不要**在插件里维护 `draft` 的镜像 state，双写必然不一致。

### 2. 组件瞬态（11 个 `useState`，顺序是契约）

```
phase          'idle' | 'busy' | 'done' | 'error'
note           一句话提示（成功/失败/忙碌）
picking        菜单开合
style          当前口味（持久化）
preset         当前任务书形状（持久化）
efforts        当前模型支持的思考挡位
effort         选中的挡位
models         可选模型目录
selection      当前选中的模型（持久化）
lockSnapshot   锁定时的快照，非 null 表示已锁定
modelOpen      模型下拉开合
copied         复制提示的短暂反馈
```

`phase` 是唯一的「主状态」，其它都是围绕它或用户偏好。

### 3. 持久化状态（`localStorage`）

| key | 内容 | 读函数 | 写函数 |
|---|---|---|---|
| `STYLE_STORAGE_KEY` | 口味 id | `readStoredStyle` | `rememberStyle` |
| `PRESET_STORAGE_KEY` | 形状 id | `readStoredPreset` | `rememberPreset` |
| `MODEL_STORAGE_KEY` | `{ provider, model, manual }` | `readStoredModel` | `rememberModel` |
| `LOCK_STORAGE_KEY` | `{ provider, model, effort }` | `readStoredLock` | `rememberLock` / `clearStoredLock` |
| `EFFORT_STORAGE_PREFIX + provider:model` | 该模型上次选的挡位 | `readStoredEffort` | `rememberEffort` |

**所有读都要容错**：`localStorage` 可能不可用（隐私模式、宿主限制）、存的 JSON 可能被手改坏。
读函数统一返回「安全默认值」，绝不抛。

---

## When to Use Global State

不要引入全局状态。判断标准：

- 状态需要跨组件共享？→ 本插件只有一个组件，**不存在这个需求**。
- 状态需要跨会话保留？→ 用 `localStorage`，不要用全局变量。
- 状态属于宿主？→ 用 `useInput` / `inputActions`，不要自己存。

如果将来真的要加第二个组件，优先把共享状态提升到共同的父组件（`HardForge`），
而不是引入 context 或 store。

---

## Server State

**不缓存。** 每次挂载都重新拉：

- `models` 目录与 `model` 思考挡位：挂载期拉一次，选中变化时重拉。失败就空着，
  下拉里显示「没有可用模型」，用户仍可用配置默认值锻造。
- 乐观更新：**没有**。锻造是长操作（10–25 秒），期间 `phase='busy'`，按钮禁用，不预测结果。
- 失败：`readResult` 归一成 `{ ok:false, error:{code} }`，按码映射成用户文案，
  `phase='error'`，短暂显示后自动回到 `idle`（`NOTE_MS.error`）。

---

## Common Mistakes

| 坑 | 症状 | 正确做法 |
|---|---|---|
| 镜像草稿到本地 state | 用户继续打字后按钮仍按旧文本锻造 | 每次渲染从 `useInput` 现读 |
| `localStorage` 读取不 try/catch | 隐私模式直接抛错、整个组件不渲染 | 读函数内 try/catch，返回默认值 |
| 存储的值不校验就信 | 手改过的 `style` 值导致 `translate('style.'+x)` 取不到文案 | 读出来过白名单，非法则回落默认 |
| 在 `busy` 期间允许二次点击 | 两个请求竞争，结果互相覆盖 | `run()` 开头判 `busy`，`forge()` 前也判 |
| 忘记把 `phase` 回到 `idle` | 按钮永远停在「已锻造」 | `done`/`error` 都用定时器回 `idle`，卸载时清定时器 |
| 锁定快照与当前选择双写 | 解锁后选不回原值 | 锁定只存快照，解锁时再写回 `selection` |
| 把 `note` 当长期消息 | 提示永远不消失 | 定时器清空，`NOTE_MS` 集中定义 |
