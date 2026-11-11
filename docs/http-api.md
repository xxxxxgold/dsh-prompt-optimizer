# HTTP 面（宿主半）

> 宿主半注册的全部端点。客户端半就是这些接口的唯一消费者，你也可以直接用 `curl` 调。

回到 [README](../README.md) · 相关：[配置](./configuration.md) · [开发](./development.md)


同源、无鉴权（与 DSH 其它插件控制面一致）：

```
GET  /dsh-prompt-optimizer/models
     → { ok, current: { provider, model }|null, models: [{ provider, providerName, model, name }] }

GET  /dsh-prompt-optimizer/model[?provider=&model=]
     → { ok, provider, model, effort, efforts: [{ id, name }] }   # 指定模型时读该模型的挡位

GET  /dsh-prompt-optimizer/health
     → { ok, plugin, version, style, styles, preset, presets, localFallback, motion }

POST /dsh-prompt-optimizer/optimize
     body: { "text": "<草稿>", "style": "hard|team|cool", "preset": "native|feat|issue|refactor", "provider": "…", "model": "…" }
     → { ok: true, style, preset, text, engine: "llm"|"local", route: { provider, model }|null, ms, warning? }
     → { ok: false, error: { code, message } }

POST /dsh-prompt-optimizer/probe          # 诊断：原样跑一次模型调用
     body: { "text": "…", "maxTokens": 4000, "reasoningEffort": "low" }
     → { ok, route, effort, maxTokens, chars, finish, usage, ms, text }
```

错误码：`EMPTY_INPUT`(400)、`INPUT_TOO_LONG`(413)、`BAD_JSON`(400)、`BUSY`(429)、`NOT_FOUND`(404)、`PRESET_NEEDS_MODEL`(502，选了 Trellis 规范但没有可用模型)；模型侧失败原样带出 provider-neutral code（`NO_ADAPTER` / `RATE_LIMIT` / `CONTEXT_WINDOW_EXCEEDED`…，502）。

**预算从哪来**：插件不猜数字。`maxTokens` 没填就不往请求里放这个字段，适配器用它安装时配好的上限；思考强度由界面按当前模型决定：该模型有上次设定就用上次，没有就用模型 `defaultEffort`，再没有就用第一个挡位；模型没有挡位时整行隐藏、请求里也不带 `reasoningEffort`。只有你在插件配置里显式写了值，才强制覆盖 —— 适配器若不认这个强度，会去掉它重试一次。

三条降级路径：

1. **模型可用** → `ctx.llm.stream()` 流式锻造，取 `text-delta` 拼文本，读 `finish.reason` 判成败。
2. **模型交回一句话** → 太短就当场打回重锻一次（`buildExpandPrompt` 把上一版贴回去，逐条要求补齐），成功时 `warning.code = "EXPANDED"`。
3. **模型不可用/报错/连着偷懒**（默认开 `localFallback`）→ **本地确定性兜底**：原文按分句逐条摊开，一字不改塞进硬汉外壳（动员 + 每条一行硬指标 + 自查 + 催命收尾）。连本地都只能交一句话时 `warning.code = "THIN_OUTPUT"`；选了 Trellis 规范却没有可用模型则直接 502 `PRESET_NEEDS_MODEL`，绝不拿两行残卡冒充任务书。
