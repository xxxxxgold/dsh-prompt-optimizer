# 配置

> 插件行为全部由 profile 的 loader row 配置。所有字段都有默认值，不写也能跑。

回到 [README](../README.md) · 相关：[HTTP 面](./http-api.md) · [开发](./development.md)


配置写在 profile 的 loader row 上（`cordis.patch.yml`）：

```yaml
- insert:
    - id: dsh-prompt-optimizer
      name: dsh-prompt-optimizer
      config:
        style: hard            # hard | team | cool
        preset: native         # native | feat | issue | refactor
        provider: ''           # 留空 = 用当前 agent 默认模型
        model: ''              # 与 provider 同时给才生效
        maxTokens: 0            # 0 = 交给模型自己的配置
        temperature: 0.9
        timeoutMs: 180000
        maxInputChars: 20000
        maxConcurrent: 4
        localFallback: true    # 模型不可用时仍给本地兜底
        styleHint: ''          # 追加口气要求，比如「多用军事比喻」
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `style` | `hard` | 口味；非法值回落到 `hard` |
| `preset` | `native` | 产出规范；非法值回落到 `native`。`native` 以外必须够得着模型 |
| `provider` / `model` | 空 | 显式模型路由。留空则依次试 `ctx.agentDefaultModel` → 适配器目录里第一个有模型的 route |
| `maxTokens` | `0` | `0` = **不传这个字段**，由模型自己的输出上限/上下文窗口说了算；填正整数才覆盖 |
| `reasoningEffort` | 空 | 空 = 不强制；界面按「该模型上一次设定 → 模型默认 → 首个挡位」自行决定并随请求发送。填 `low`/`high`/`max` 才强制覆盖 |
| `temperature` | `0.9` | 采样温度（0–2） |
| `timeoutMs` | `180000` | 单次调用超时，超时中止 |
| `maxInputChars` | `20000` | 草稿字符上限，超了 413 |
| `maxConcurrent` | `4` | 并发上限，超了 429 |
| `motion` | `always` | 边框动效策略。`always` = 即使系统开了「减少动画」也照跑；`auto` = 尊重系统 `prefers-reduced-motion` |
| `localFallback` | `true` | 模型失败时是否本地兜底；关掉就把错误抛给界面 |
| `styleHint` | 空 | 追加口气要求，拼在系统提示词末尾 |
