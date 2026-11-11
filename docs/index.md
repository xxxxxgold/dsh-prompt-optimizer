# 文档索引

> README 只放「怎么装、怎么用」。要调参数、看接口、改代码，从这里进。

---

## 使用

| 文档 | 内容 | 什么时候看 |
|---|---|---|
| [配置](./configuration.md) | 全部 `config` 字段、默认值、行为含义 | 想改口味默认值、换模型、调超时或并发 |
| [HTTP 面](./http-api.md) | 5 个端点、错误码、预算与降级路径 | 想直接用 `curl` 调，或排查「为什么没走模型」 |
| [已知边界](./known-limits.md) | 刻意取舍与模型天性 | 遇到「怎么跟我想的不一样」先看这里 |

## 开发

| 文档 | 内容 | 什么时候看 |
|---|---|---|
| [开发](./development.md) | `npm run check`、CI、296 项自测覆盖、目录、重出截图 | 要改代码、提 PR |

工程规范（编码约定、禁止模式、断言有效性要求）在
[`.trellis/spec/frontend/index.md`](../.trellis/spec/frontend/index.md)，
不随 npm 包发布，只对在本仓库工作的人有意义。

---

## 阅读顺序建议

- **第一次装** → [README](../README.md) 的「安装」段，装完照「装完自己验一遍」做三步。
- **装好了想调** → [配置](./configuration.md)
- **想接自己的工具** → [HTTP 面](./http-api.md)
- **要改代码** → 先读 [开发](./development.md)，再读 `.trellis/spec/frontend/` 下的规范。
