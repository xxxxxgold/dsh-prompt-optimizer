# Feature Design — 全方位全面测试，确保项目一点问题都没有

status: approved   # draft | approved
execution_lane: standard

## 目标与非目标

### 目标（Goals）

- 用 8 个执行批次覆盖六维：功能正确性、边界/错误路径、契约一致性、真实运行、文档、打包安装。
- 全部批次可执行、可取证；每个断言都落到命令输出或截图，不靠「看起来没问题」。
- 发现的真实缺陷（含文档缺陷）修复后复跑受影响批次，最终给出「项目一点问题都没有」的判定。

### 非目标（Non-goals）

- 不新增依赖、不改测试框架、不重写既有 selftest。
- 不追求覆盖率数字（项目无覆盖率工具），只要求六维无盲区。
- 不做架构级重构；修复限定在缺陷点。
- 不验证非 Windows 平台、不实跑 GitHub CI 云端。

## 需求拆解与实现方案

### 涉及模块与边界

| 对象 | 本任务角色 |
|---|---|
| `index.js` | 被测对象（宿主半）；仅在被证实有缺陷时修改 |
| `client.js` | 被测对象（客户端半）；同上 |
| `tools/selftest.mjs` | 既有测试，作为批次 A 执行；若发现测试本身失效（假绿灯/恒真断言）需修 |
| `tools/preview.html` | 真组件渲染载体，供 F 批次交叉验证外观 |
| `package.json` / `cordis.patch.yml` | 打包与挂载契约，H 批次被测 |
| `README.md` | 文档一致性被测，G 批次 |
| `.github/workflows/selftest.yml` | 跨版本矩阵的事实来源，D 批次备案依据 |
| 真机 `127.0.0.1:54265` | E/F 批次的真实运行环境 |

### 批次矩阵（执行单元）

| 批次 | 名称 | 覆盖维度 | 关键动作 | 判定 |
|---|---|---|---|---|
| **A** | 离线自测 | 功能正确性 | `node tools/selftest.mjs` 全量；记录 6 个 section 的通过数；连跑 2 次确认无随机性 | 235/235，两次一致 |
| **B** | 语法与静态体检 | 契约/打包 | `node --check` ×4；`package.json` 解析 + `exports` 路径存在性；`cordis.patch.yml` 结构解析；`client.js` 无未声明模块 | 全绿，无缺失文件 |
| **C** | 静态代码审计 | 边界/安全/生命周期 | 错误码全集 × 抛出点 × 测试覆盖三方交叉；边界输入矩阵；`ctx.effect` 清理；`BUSY` 互斥的 `finally` 释放；AbortController/监听器泄漏；client↔host 字段名一致性 | 每项有结论+证据 |
| **D** | 跨 Node 版本 | 兼容性 | 探测 nvm4w 能否装 18/20 → 切换跑 A+B → 切回 22 | 三版本全绿；不可行须给替代证据 |
| **E** | 真机接口 E2E | 真实运行/契约 | `/health`、`/models`、`/model`、`/probe`、`/optimize`（真实模型抽样 3 次）+ 5 类错误路径 | 契约字段/状态码/错误码全对；输出合铁律 |
| **F** | 桌面版 GUI E2E | 真实交互 | 桌面窗口 `hwnd=2559802`：截图定位 → 切本任务会话 → 填草稿 → 点 `♂harden` → 点「开锻」→ 截图取证 | 文案恒 `♂harden`；回填成功；未自动发送 |
| **G** | 文档一致性 | 文档 | README 项数/路由/配置键/错误码/版本 vs 代码实况；三方版本号一致 | 无过期描述（修后） |
| **H** | 打包与安装契约 | 打包安装 | `npm pack --dry-run` vs `files`；`exports` 逐个可解析；`dsh.bundle.patch` 指向；profile link 与哈希 | 清单一致、可加载 |

### 执行波次（并行策略）

```text
波次 1（互不依赖，并行）：A + B + C + G(静态部分) + H
波次 2（依赖 A/B 命令与真机）：D + E
波次 3（依赖 E 可用性）：F
波次 4（收敛）：缺陷汇总 → 修复 → 复跑受影响批次 → 全量回归（A+B）
```

理由：A/B/H/G 是纯本地只读或打包元数据；C 是静态阅读；D 复用 A/B 命令；E 打真机 HTTP；
F 必须在 E 确认接口可用后才有意义。

### 批次详细断言

**A 离线自测**

- `node tools/selftest.mjs` 输出必须含 `PASS`，`failed` 为 0。
- 逐 section 计数：host half / client half / thin answers / model config / probe route / effort fallback。
- 连跑第二次结果必须一致（排除时间/随机依赖）。

**B 语法与静态体检**

- `node --check index.js|client.js|tools/selftest.mjs|tools/asar.mjs` 全部 0 退出。
- `JSON.parse(package.json)` 成功；`main`/`exports` 每个路径 `fs.existsSync` 为真。
- `cordis.patch.yml` 可解析为数组，含 `insert[0].id === 'dsh-prompt-optimizer'`。
- `client.js` 引用的模块仅限 `react`/`react/jsx-runtime`/注入声明的 `@deepseek-ai/*`。

**C 静态代码审计（逐项）**

1. 错误码全集：`BAD_URL` `NO_LLM` `NO_ROUTE` `NOT_FOUND` `BUSY` `BAD_JSON` `EMPTY_INPUT`
   `INPUT_TOO_LONG` `PRESET_NEEDS_MODEL`；warning 码：`EXPANDED` `THIN_OUTPUT` `EMPTY_OUTPUT`
   `TRUNCATED` `NO_ROUTE` `NO_LLM`。每个码必须有生产点 + 至少一条测试断言；缺一即缺陷。
2. 边界矩阵：空串/纯空白/20000/20001 字符/坏 JSON/缺 text/非法 style/非法 preset/
   非法 provider/model/超长 provider-model 字符串。
3. 安全：输出写回是否走 `inputActions.setDraft`（非 innerHTML）；`readBody` 上限是否生效；
   并发计数器是否在异常路径释放；是否记录敏感内容（草稿全文）到日志。
4. 生命周期：`ctx.effect` 返回的 disposer 是否真的注销路由；重复 apply 是否叠加监听。
5. 泄漏：`AbortController`、`setTimeout`、`storage`/`resize` 监听、`Set`/`Map` 增长。
6. 跨层字段一致性：client 发送的 `provider`/`model`/`reasoningEffort` 与 host 解析名逐字相同；
   `warning.code` 与 client 展示分支一致。

**D 跨 Node 版本**

- 探测 `nvm version`、`nvm list available`（需网络）。可装则 `nvm install 18.20.4` / `20.18.0`，
  `nvm use` 后跑 A+B，记录 `node -v` 与结果；结束 `nvm use 22.20.0` 并复跑一次确认恢复。
- 不可行备案：核对 `.github/workflows/selftest.yml` 矩阵声明；用 `node --check` + 语法特性人工审计
  （确认无 20+ 语法）；明确标注「本机未执行，沿用 CI 声明」并列为限制。

**E 真机接口 E2E**

| 断言 | 期望 |
|---|---|
| `GET /health` | `ok:true`、`version` 与 package.json 一致、`styles` 三值、`presets` 四值 |
| `GET /models` | `current` 为 `{provider,model}` 或 null；`models` 为数组且字段齐 |
| `GET /model` | 默认路由可取；`?provider=&model=` 生效；只给一个参数时应被忽略 |
| `GET /probe` | 真实调用模型返回 `ok/route/chars/finish`；消耗 1 次 |
| `POST /optimize` | 真实模型抽样 3 次（hard/team/cool 各一），输出满足铁律 1/2/3 |
| 错误路径 | 空输入 400 `EMPTY_INPUT`；20001 字 400 `INPUT_TOO_LONG`；坏 JSON 400 `BAD_JSON`；
未知路由 404 `NOT_FOUND`；并发第 2 请求 429 `BUSY` |

铁律判定（人工+脚本辅助）：① 原文关键事实词（交付物/数量/技术栈各抽 2 个）必须出现在输出；
② 输出不含 ``` 围栏；③ 输出不以「以下是」/「希望」/「如果需要」开头或收尾。

**F 桌面版 GUI E2E（环境已核实）**

运行环境事实（规划期实测）：

- 桌面版主进程 `DeepSeek Harness.exe` PID 30288；其子进程 PID 1668 监听 `127.0.0.1:54265`。
  **`127.0.0.1:54265` 就是桌面版内嵌运行时，不是独立 Web 版**；E 批次打的就是桌面版。
- 桌面主窗口 `hwnd=2559802`，`2576×1408`，类名 `Chrome_WidgetWin_1`；`PrintWindow` 可稳定截图，
  截图中已可见 `♂harden` 按钮（输入框左下角）。
- UIA 仅暴露窗口按钮（最小化/恢复/关闭），Chromium a11y 树未向 UIA 开放 → **不能按名字 Invoke**。
- 窗口随用户切换会话改变标题与内容；自动化前必须先把窗口切到本任务会话。

执行方式（三选一，批准时确认）：

- **F-A 自动点击（彻底但要抢焦点）**：`SetForegroundWindow` → 截图定位 → `SetCursorPos` +
  `mouse_event` 坐标点击（先点左侧会话项切到本任务，再填草稿、点 `♂harden`、点「开锻」）→
  每步截图取证。代价：抢焦点、切会话、覆盖输入框草稿（草稿覆盖已获授权）。
- **F-B 用户手动点验（零误伤、最真实）**：我给 5 步清单 + 逐项期望，用户操作后回传截图/确认。
- **F-C 只读子集**：仅 `PrintWindow` 截图证明按钮已渲染、文案为 `♂harden`；不做交互点击。

断言（无论哪种方式）：按钮文案恒为 `♂` + `harden` 共 7 字符；菜单两行 chip（模型/强度/锁定 +
口味/规范）；点「开锻」后 `busy → done` 且输入框被替换；**不自动发送**（消息列表不新增条目）。
证据：截图 ≥3 张（空闲 / 菜单展开 / 回填结果）+ 可见文本。

**G 文档一致性**

- README 中所有数字/路由/配置键/错误码逐条比对代码；重点：`185 项` → 实测值。
- 版本三处一致：`package.json.version`、`index.js` 的 `VERSION`、`/health.version`。
- README 提到的文件路径全部存在。

**H 打包与安装契约**

- `npm pack --dry-run --json` 的文件列表 ⊆ `files` 字段声明的集合，且核心四件都在。
- 对 `exports` 每个子路径做 `import.meta.resolve` 或 `fs.existsSync`。
- `cordis.patch.yml` 的 `id` 与 `package.json.name` 一致。
- `~/.dsh/profiles/desktop/node_modules/dsh-prompt-optimizer` 为 link 且指向本项目；
  安装副本三文件哈希与仓库一致。

### 契约变更

- 本任务**不新增**任何对外契约。若修复必须触碰契约（例如错误码文案、路由字段），
  须在报告中单列，并保证向后兼容。

### 关键技术选型与取舍

- **复用既有 selftest 而非新写测试框架**：235 项已覆盖纯函数/假挂载/客户端沙箱，
  重写等于重复劳动且违背零依赖约束。
- **真机 E2E 用 HTTP 直连 + 浏览器双通道**：HTTP 验契约与错误路径（便宜、可重复）；
  浏览器验 UI 真值（贵、有副作用，只跑一次）。
- **跨版本优先本机 nvm**：能装就装，装不上就如实降级为 CI 声明 + 语法人工审计，
  绝不伪造执行结果。
- **静态审计用「断言清单 + 交叉核对」而非泛读**：错误码/字段名这类机械项靠 grep 交叉，
  逻辑项靠阅读，避免误报（预算 35%）。

## 验证计划

1. 批次 A：`node tools/selftest.mjs`（期望 `PASS — 235 passed, 0 failed`）。
2. 批次 B：`node --check index.js && node --check client.js && node --check tools/selftest.mjs && node --check tools/asar.mjs`。
3. 批次 D：`nvm use 18` → 跑 1/2 → `nvm use 20` → 跑 1/2 → `nvm use 22.20.0`。
4. 批次 E：`curl` 各路由（含错误路径），记录状态码与 body。
5. 批次 F：浏览器工具打开 GUI，截图 + 文本断言。
6. 批次 G/H：脚本核对 + `npm pack --dry-run`。
7. 修复后：受影响批次复跑 + A 全量回归。

步骤验证标注：`s1` 批次清单（human）、`s2` 批次执行（human）、`s3` 结论汇总（human），
与 `task.json.steps` 一致；每个批次内部另有 ai 级证据（命令输出）。

## 风险与回滚

- **真机副作用**：`/probe` 与 3 次真实 `/optimize` 会消耗模型额度；`F` 批次会覆盖输入框草稿
  （已获用户授权，不发送）。回滚：无（只读探测 + 草稿可重输）。
- **nvm 切换影响其他会话**：切版本期间其他终端 `node` 会变；结束必须切回 22.20.0 并验证。
- **误报**：静态审计结论必须回代码核实；不确定的标「待验证」而非「缺陷」。
- **工具风险（已发生）**：`trellis_artifact_update` 曾误写其他任务目录；本任务后续所有产物写入
  一律显式传 `slug`，并在写后核对 `filePath`。
- **回滚策略**：修复提交按批次独立，单批次可 `git checkout -- <file>` 或 `git revert`；
  文档修复与代码修复分开提交。

## 人审检查点

- [ ] 批次矩阵覆盖六维，无遗漏
- [ ] 每批次有可执行命令与判定标准
- [ ] 并行波次合理（不违反依赖）
- [ ] 设计已获用户确认（status=approved）后再进入实现
