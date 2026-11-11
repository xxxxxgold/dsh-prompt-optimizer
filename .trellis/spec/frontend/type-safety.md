# Type Safety

> Type safety patterns in this project.

---

## Overview

**这个项目不用 TypeScript，也没有构建步骤。** 运行时是纯 ESM（`index.js`）与一个手写的
CJS 风格 bundle（`client.js`），零运行时依赖。

类型安全靠三样东西顶住：

1. **JSDoc 注释**给关键函数标出形状（`@param` / `@returns`），供 IDE 与阅读者使用；
2. **`normalizeConfig` 式的边界收敛**——不可信输入在入口就被压成完整对象；
3. **`{ ok, ... }` 结果对象**——跨出的每一层都先判 `ok`，不做「信任上游」的假设。

没有类型检查门禁（`tsc` 不在 CI 里），所以**边界收敛必须靠代码纪律**，下一节是具体写法。

---

## Type Organization

这个项目没有类型文件，形状信息跟着实现走：

| 形状 | 定义位置 | 说明 |
|---|---|---|
| 插件配置 | `index.js` 的 `DEFAULTS` + `normalizeConfig` | 前者是默认值，后者是「配置 → 完整设置」的唯一入口 |
| HTTP 响应 | 每个分支的 `sendJson(res, status, {...})` 字面量 | 成功恒有 `ok: true`，失败恒有 `ok: false, error: { code, message }` |
| LLM 流式 chunk | `streamRewrite` 的 `for await` 分支 | 只认 `text-delta` / `usage` / `finish`，其余忽略 |
| 客户端存储项 | `client.js` 顶部 `*_STORAGE_KEY` | 读出来一律当不可信，由 `readStored*` 归一 |
| 字典 | `client.js` 的 `zh` / `en` | 两份 key 必须完全一致（自测有断言） |

---

## Validation

### 1. 配置：一次收敛，下游不再防御

```js
// 好：normalizeConfig 里把每个字段压成确定类型
maxTokens: Math.max(0, Math.floor(pickNumber('maxTokens', 16))),
style: STYLES.has(raw.style) ? raw.style : DEFAULTS.style,
```

```js
// 差：在业务函数里再判断一次
const style = config.style || 'hard';   // 空字符串会被放过
```

### 2. 请求体：先当不可信，再逐项校验

`apply` 里的顺序固定：

```
readBody → JSON.parse（失败 → 400 BAD_JSON）
       → text 必须是非空字符串（否则 400 EMPTY_INPUT）
       → 长度上限（否则 413 INPUT_TOO_LONG）
       → style / preset 白名单校验，非法则回落配置默认
       → provider / model 同时存在才算显式路由（半条路由丢弃）
```

**关键**：`text` 用 `typeof === 'string'` 判断，不用真值判断——`0` 和 `false` 会漏过去。

### 3. 外部服务：能力探测而非假设

```js
const soft = (key) => {
  try {
    return typeof ctx.get === 'function' ? ctx.get(key) : undefined;
  } catch {
    return undefined;
  }
};
```

宿主可能没有 `llm`、没有 `webServer`、`ctx.get` 可能抛错。所有宿主能力都走这种「软取」，
取不到就走降级路径（`NO_LLM` → 本地兜底）。

### 4. 错误对象：只认 `code`

```js
error.code = 'PRESET_NEEDS_MODEL';
```

跨层传递失败时**只依赖 `code` 字符串**，不依赖 `instanceof` 或错误类——因为错误可能来自
任意 adapter，类信息不可靠。`failureOf(error)` 负责把任意 thrown 值归一成 `{ code, message }`。

### 5. 客户端：结果对象优于异常

```js
const result = readResult(body, response.status);
if (result.ok) { ... } else { result.error.code ... }
```

`readResult` / `readModel` / `readModels` 都返回 `{ ok: true, ... } | { ok: false, error }`，
网络层异常在调用处 `try/catch`，转换成同形状的失败结果。

---

## Common Patterns

- **白名单用 `Set`**：`STYLES = new Set([...])`、`PRESETS`，配合 `PRESETS.has(x)` 而不是 `includes`。
- **`Array.isArray` 前置**：`if (!Array.isArray(providers)) return null;`
- **数字收敛三步**：`Number(...)` → `Number.isFinite(...)` → 上下限钳制，缺一步就可能拿到 `NaN`。
- **`String(...)` 兜底**：`sanitizeOutput` 用 `String(raw === undefined || raw === null ? '' : raw)`，
  保证模型返回 `null` 时不炸。
- **可注入的探测函数**：`resolveAsarPath(env, isFile, platform)` 让「类型」可以跨平台伪造，便于测试。

---

## Forbidden Patterns

| 禁止 | 原因 | 正确写法 |
|---|---|---|
| `.includes()` 判断枚举成员 | 子串会误命中（`'hard'.includes('har')`） | `Set.has()` |
| 用真值判断跨层的字符串 | `''` / `0` / `false` 全部漏过，且看不出意图 | `typeof x === 'string' && x !== ''` |
| 直接读 `payload.foo.bar` | 中间层可能是 `null` | 逐层判空，或先收敛 |
| 把中文长句当错误码 | 客户端要按码映射文案，长句无法映射 | `code: 'BUSY'` + `message` 给日志 |
| 在业务函数里重复校验同一字段 | 校验点分散，改一处漏一处 | 在 `normalizeConfig` / 入口收敛一次 |
| `catch (e)` 但不用 `e` | 触发 `no-unused-vars`，也掩盖意图 | `catch {`（刻意静默是有意的） |
| 假设宿主一定提供某服务 | DSH 各 profile 能力不同 | `ctx.get(...)` 软取 + 降级 |
